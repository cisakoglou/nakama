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
    create table auth.users (id uuid primary key, email text);
    create function auth.jwt() returns jsonb language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
    $$;
    create function auth.uid() returns uuid language sql stable as $$
      select (auth.jwt()->>'sub')::uuid;
    $$;
  `);
  for (const file of [
    "202610180001_invite_only_profiles.sql", "202610180002_hevy_connections.sql",
    "202611040001_chat_conversations.sql", "202611130001_workout_reports.sql",
  ]) {
    await db.exec(await readFile(new URL(`../../supabase/migrations/${file}`, import.meta.url), "utf8"));
  }
}, 30_000);

beforeEach(async () => {
  await db.exec(`
    begin;
    insert into auth.users values ('${first}', 'One@example.test'), ('${second}', 'two@example.test');
    insert into public.beta_invitations (email) values ('one@example.test');
    insert into public.hevy_connections (user_id, encrypted_key, revision) values
      ('${first}', 'encrypted-first', '${first}'), ('${second}', 'encrypted-second', '${second}');
  `);
});
afterEach(async () => { await db.exec("rollback"); });
afterAll(async () => { await db.close(); });

const hashA = "a".repeat(64);
const hashB = "b".repeat(64);
const enqueue = (workout: string, user = first) => db.query<{ workout_id: string }>(
  `insert into public.workout_reports (user_id, workout_id, connection_revision) values ($1, $2, $1)
   on conflict (user_id, workout_id) do nothing returning workout_id`, [user, workout],
);
const claimNext = () => db.query<{ user_id: string; workout_id: string; connection_revision: string; conversation_id: string; attempts: number }>(
  "select * from public.claim_next_workout_report(3)",
);
const owner = (hash: string) => db.query("select * from public.hevy_webhook_owner($1)", [hash]);

describe("workout report storage", () => {
  it("resolves a webhook token only for its own current connection and invited owner", async () => {
    await db.exec("set local role service_role");
    await db.query("insert into public.hevy_webhook_tokens (user_id, token_hash, connection_revision) values ($1, $2, $1), ($3, $4, $3)",
      [first, hashA, second, hashB]);
    expect((await owner(hashA)).rows).toEqual([{ user_id: first, connection_revision: first }]);
    expect((await owner(hashB)).rows).toEqual([]);
    expect((await owner("c".repeat(64))).rows).toEqual([]);
    await db.query("update public.hevy_connections set revision = gen_random_uuid() where user_id = $1", [first]);
    expect((await owner(hashA)).rows).toEqual([]);
    await db.query("delete from public.hevy_connections where user_id = $1", [first]);
    expect((await db.query("select * from public.hevy_webhook_tokens where user_id = $1", [first])).rows).toEqual([]);
  });

  it("enqueues each webhook workout once per user", async () => {
    await db.exec("set local role service_role");
    expect((await enqueue("w1")).rows).toEqual([{ workout_id: "w1" }]);
    expect((await enqueue("w1")).rows).toEqual([]);
    expect((await enqueue("w1", second)).rows).toEqual([{ workout_id: "w1" }]);
    expect((await db.query("select * from public.workout_reports")).rows).toHaveLength(2);
  });

  it("claims due jobs once, retries failures when due, and stops at the attempt limit", async () => {
    await db.exec("set local role service_role");
    await enqueue("w1");
    const initial = await claimNext();
    expect(initial.rows).toEqual([{ user_id: first, workout_id: "w1", connection_revision: first, conversation_id: expect.any(String), attempts: 1 }]);
    expect((await claimNext()).rows).toEqual([]);
    await db.query("update public.workout_reports set status = 'failed', available_at = now() + interval '1 minute'");
    expect((await claimNext()).rows).toEqual([]);
    await db.query("update public.workout_reports set available_at = now()");
    expect((await claimNext()).rows[0]).toMatchObject({ conversation_id: initial.rows[0].conversation_id, attempts: 2 });
    await db.query("update public.workout_reports set status = 'failed'");
    expect((await claimNext()).rows[0].attempts).toBe(3);
    await db.query("update public.workout_reports set status = 'failed'");
    expect((await claimNext()).rows).toEqual([]);
  });

  it("never reclaims delivered or skipped jobs, but recovers abandoned claims", async () => {
    await db.exec("set local role service_role");
    await enqueue("done");
    await enqueue("skip");
    await claimNext();
    await claimNext();
    await db.query("update public.workout_reports set status = case workout_id when 'done' then 'delivered' else 'skipped' end");
    await enqueue("stale");
    await claimNext();
    expect((await claimNext()).rows).toEqual([]);
    await db.query("update public.workout_reports set claimed_at = now() - interval '11 minutes' where workout_id = 'stale'");
    expect((await claimNext()).rows[0]).toMatchObject({ workout_id: "stale", attempts: 2 });
  });

  it("lets the server deliver a report conversation that passes transcript validation", async () => {
    await db.exec("set local role service_role");
    await enqueue("w1");
    const { rows } = await claimNext();
    await db.query(
      "insert into public.chat_conversations (id, user_id, title, messages) values ($1, $2, 'Workout report: Legs', $3::jsonb)",
      [rows[0].conversation_id, first, JSON.stringify([{ id: "workout-report-w1", role: "assistant", content: "Report" }])],
    );
    await expect(db.query(
      "insert into public.chat_conversations (id, user_id, messages) values ($1, $2, '[]'::jsonb)",
      [rows[0].conversation_id, first],
    )).rejects.toThrow(/duplicate key/);
  });

  it.each([
    "select * from public.workout_reports",
    "select * from public.hevy_webhook_tokens",
    `select * from public.hevy_webhook_owner('${"a".repeat(64)}')`,
    "select * from public.claim_next_workout_report(3)",
  ])("does not expose report state to browser sessions (%s)", async (sql) => {
    await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: first, email: "one@example.test" })]);
    await db.exec("set local role authenticated");
    await expect(db.query(sql)).rejects.toThrow(/permission denied/);
  });

  it("removes report state when an account is deleted", async () => {
    await db.exec("set local role service_role");
    await enqueue("w1");
    await db.query("insert into public.hevy_webhook_tokens (user_id, token_hash, connection_revision) values ($1, $2, $1)", [first, hashA]);
    await db.exec("reset role");
    await db.query("delete from auth.users where id = $1", [first]);
    expect((await db.query("select * from public.workout_reports")).rows).toEqual([]);
    expect((await db.query("select * from public.hevy_webhook_tokens")).rows).toEqual([]);
  });
});
