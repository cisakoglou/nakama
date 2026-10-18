import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const first = "00000000-0000-4000-8000-000000000001";
const second = "00000000-0000-4000-8000-000000000002";
let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role supabase_auth_admin;
    create role service_role bypassrls;
    create schema auth;
    revoke all on schema public from public;
    grant usage on schema public to anon, authenticated;
    grant usage on schema auth to anon, authenticated, supabase_auth_admin;
    create table auth.users (id uuid primary key);
    create function auth.jwt() returns jsonb language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
    $$;
    create function auth.uid() returns uuid language sql stable as $$
      select (auth.jwt()->>'sub')::uuid;
    $$;
  `);
  await db.exec(await readFile(new URL("../../supabase/migrations/202610180001_invite_only_profiles.sql", import.meta.url), "utf8"));
  await db.exec(await readFile(new URL("../../supabase/migrations/202610180002_hevy_connections.sql", import.meta.url), "utf8"));
}, 30_000);

beforeEach(async () => {
  await db.exec(`
    begin;
    insert into auth.users values ('${first}'), ('${second}');
    insert into public.beta_invitations (email) values ('one@example.test'), ('two@example.test');
    insert into public.profiles (user_id, goal, experience, training_days, equipment, units) values
      ('${first}', 'strength', 'beginner', 3, 'gym', 'kg'),
      ('${second}', 'muscle', 'intermediate', 4, 'home', 'lb');
    insert into public.hevy_connections (user_id, encrypted_key, revision) values
      ('${first}', 'encrypted-first', '${first}'),
      ('${second}', 'encrypted-second', '${second}');
  `);
});

afterEach(async () => { await db.exec("rollback"); });
afterAll(async () => { await db.close(); });

async function signIn(id = first, email = "one@example.test") {
  await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: id, email })]);
  await db.exec("set local role authenticated");
}

describe("real PostgreSQL invite and profile policies", () => {
  it("lets the auth hook accept normalized invited emails and refuse everyone else", async () => {
    await db.exec("set local role supabase_auth_admin");
    const allowed = await db.query<{ result: object }>(
      "select public.hook_enforce_beta_invite($1::jsonb) as result",
      [JSON.stringify({ user: { email: "ONE@example.test" } })],
    );
    expect(allowed.rows[0].result).toEqual({});
    const denied = await db.query<{ result: object }>(
      "select public.hook_enforce_beta_invite($1::jsonb) as result",
      [JSON.stringify({ user: { email: "outsider@example.test" } })],
    );
    expect(denied.rows[0].result).toEqual({
      error: { http_code: 403, message: expect.stringContaining("invite-only") },
    });
  });

  it("shows each invited user only their own persisted profile", async () => {
    await signIn();
    expect((await db.query("select user_id, goal from public.profiles")).rows).toEqual([{ user_id: first, goal: "strength" }]);
    await db.exec("reset role");
    await signIn(second, "two@example.test");
    expect((await db.query("select user_id, goal from public.profiles")).rows).toEqual([{ user_id: second, goal: "muscle" }]);
  });

  it("lets a user create and update their own profile", async () => {
    await db.query("delete from public.profiles where user_id = $1", [first]);
    await signIn();
    await db.query(
      "insert into public.profiles (user_id, goal, experience, training_days, equipment, units) values ($1, 'strength', 'beginner', 1, 'bodyweight', 'kg')",
      [first],
    );
    await db.query("update public.profiles set training_days = 7 where user_id = $1", [first]);
    expect((await db.query("select training_days from public.profiles")).rows).toEqual([{ training_days: 7 }]);
  });

  it("hides another user's profile from updates and prevents identity changes", async () => {
    await signIn();
    expect((await db.query("update public.profiles set training_days = 1 where user_id = $1 returning user_id", [second])).rows).toEqual([]);
    await expect(db.query("update public.profiles set user_id = $1 where user_id = $2", [second, first]))
      .rejects.toThrow(/row-level security/);
  });

  it("rejects insertion for another user", async () => {
    await signIn();
    await expect(db.query(
      "insert into public.profiles (user_id, goal, experience, training_days, equipment, units) values ($1, 'strength', 'beginner', 3, 'gym', 'kg')",
      [second],
    )).rejects.toThrow(/row-level security/);
  });

  it("revokes reads and writes when an invitation is removed", async () => {
    await db.query("delete from public.beta_invitations where email = $1", ["one@example.test"]);
    await signIn();
    expect((await db.query("select public.has_beta_access() as allowed")).rows).toEqual([{ allowed: false }]);
    expect((await db.query("select * from public.profiles")).rows).toEqual([]);
    expect((await db.query("update public.profiles set training_days = 1 returning user_id")).rows).toEqual([]);
  });

  it("does not expose profiles to anonymous users", async () => {
    await db.exec("set local role anon");
    await expect(db.query("select * from public.profiles")).rejects.toThrow(/permission denied/);
  });

  it("does not expose the invitation list to signed-in users", async () => {
    await signIn();
    await expect(db.query("select * from public.beta_invitations")).rejects.toThrow(/permission denied/);
  });

  it("does not let signed-in users invoke the signup hook", async () => {
    await signIn();
    await expect(db.query("select public.hook_enforce_beta_invite('{}'::jsonb)")).rejects.toThrow(/permission denied/);
  });

  it("does not grant browser deletion of profiles", async () => {
    await signIn();
    await expect(db.query("delete from public.profiles")).rejects.toThrow(/permission denied/);
  });

  it.each([0, 8])("enforces the training-day bounds in the database (%i)", async (days) => {
    await signIn();
    await expect(db.query("update public.profiles set training_days = $1", [days])).rejects.toThrow(/check constraint/);
  });

  it("returns only the current user's non-secret connection metadata", async () => {
    await signIn();
    const result = await db.query<{ status: object }>("select public.hevy_connection_status() as status");
    expect(result.rows[0].status).toEqual({
      connected: true, revision: first, connected_at: expect.any(String),
    });
  });

  it("hides connection status after invitation revocation", async () => {
    await db.exec("delete from public.beta_invitations where email = 'one@example.test'");
    await signIn();
    expect((await db.query("select public.hevy_connection_status() as status")).rows)
      .toEqual([{ status: { connected: false } }]);
  });

  it.each([
    "select * from public.hevy_connections",
    "update public.hevy_connections set encrypted_key = 'forged'",
    "delete from public.hevy_connections",
  ])("does not expose stored credentials to browser sessions (%s)", async (sql) => {
    await signIn();
    await expect(db.query(sql)).rejects.toThrow(/permission denied/);
  });

  it("allows the server role to read the requested owner's encrypted credential", async () => {
    await db.exec("set local role service_role");
    expect((await db.query("select encrypted_key from public.hevy_connections where user_id = $1", [first])).rows)
      .toEqual([{ encrypted_key: "encrypted-first" }]);
  });
});
