import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const first = "00000000-0000-4000-8000-000000000001";
const provider = "00000000-0000-4000-8000-000000000003";
const otherProvider = "00000000-0000-4000-8000-000000000005";
const workout = "f1085cdb-32b2-4003-967d-53a3af8eaecb";
const state = "a".repeat(64);
const browser = "b".repeat(64);
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
    create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid; $$;
  `);
  for (const file of [
    "202610180001_invite_only_profiles.sql", "202610180002_hevy_connections.sql",
    "202611040001_chat_conversations.sql", "202611130001_workout_reports.sql",
    "202611190001_hevy_oauth.sql", "202611190002_hevy_request_budget.sql", "202611190003_hevy_app_webhook.sql",
  ]) await db.exec(await readFile(new URL(`../../supabase/migrations/${file}`, import.meta.url), "utf8"));
}, 30_000);
beforeEach(async () => {
  await db.exec(`
    begin;
    insert into auth.users values ('${first}', 'one@example.test');
    insert into public.beta_invitations (email) values ('one@example.test');
    set local role service_role;
  `);
});
afterEach(async () => { await db.exec("rollback"); });
afterAll(async () => { await db.close(); });

async function result<T = string>(sql: string, parameters: (string | number | boolean | null)[] = []) {
  return (await db.query<{ result: T }>(`select ${sql} as result`, parameters)).rows[0].result;
}
async function connect(hevyUser = provider) {
  expect(await result("public.begin_hevy_oauth($1, $2, $3)", [first, state, browser])).toBe("started");
  expect(await result<boolean>("public.consume_hevy_oauth_state($1, $2, $3)", [first, state, browser])).toBe(true);
  expect(await result("public.complete_hevy_oauth($1, $2, $3, 'lifter', 'pair', now() + interval '1 hour')", [first, state, hevyUser])).toBe("saved");
  return (await db.query<{ revision: string }>("select revision from public.hevy_connections where user_id = $1", [first])).rows[0].revision;
}
const accept = async (hevyUser = provider, workoutId = workout) => (await db.query<{ result: string; user_id: string | null }>(
  "select * from public.accept_hevy_app_webhook($1, $2, now() + interval '20 seconds')", [hevyUser, workoutId],
)).rows[0];
const jobs = async () => (await db.query<{ workout_id: string; connection_revision: string }>(
  "select workout_id, connection_revision from public.workout_reports")).rows;
const status = () => result<Record<string, unknown> | null>("public.hevy_report_status($1, 5)", [first]);
const setEnabled = (enabled: boolean) => result<boolean>("public.set_hevy_reports_enabled($1, $2)", [first, enabled]);
const eligibility = (revision: string) => result("public.workout_report_eligibility($1, $2)", [first, revision]);

describe("app webhook acceptance", () => {
  it("ignores unknown Hevy users and API-key connections", async () => {
    expect(await accept()).toEqual({ result: "unknown_user", user_id: null });
    await result("public.save_hevy_api_key($1, 'key', $2)", [first, first]);
    expect(await accept()).toEqual({ result: "unknown_user", user_id: null });
    expect(await jobs()).toEqual([]);
  });

  it("queues one job per workout, also when the legacy route queued it first", async () => {
    const revision = await connect();
    expect(await accept()).toEqual({ result: "queued", user_id: first });
    expect(await accept()).toEqual({ result: "duplicate", user_id: first });
    // The legacy personal webhook writes the same (user_id, workout_id) key.
    await db.query("insert into public.workout_reports (user_id, workout_id, connection_revision) values ($1, $2, $3) on conflict do nothing",
      [first, "11111111-1111-4111-8111-111111111111", revision]);
    expect(await accept(provider, "11111111-1111-4111-8111-111111111111")).toEqual({ result: "duplicate", user_id: first });
    expect(await jobs()).toHaveLength(2);
    expect((await jobs())[0].connection_revision).toBe(revision);
  });

  it("records the event but queues nothing for opted-out, uninvited or reconnect-required users", async () => {
    await connect();
    expect(await setEnabled(false)).toBe(true);
    expect(await accept()).toEqual({ result: "reports_off", user_id: first });
    expect(await status()).toMatchObject({ enabled: false, status: "off" });
    expect((await status())!.last_received_at).not.toBeNull();

    expect(await setEnabled(true)).toBe(true);
    await db.query("update public.hevy_connections set oauth_status = 'reconnect_required'");
    expect(await accept()).toEqual({ result: "reconnect_required", user_id: first });

    await db.query("update public.hevy_connections set oauth_status = 'active'");
    await db.exec("reset role; delete from public.beta_invitations; set local role service_role;");
    expect(await accept()).toEqual({ result: "not_eligible", user_id: first });
    expect(await jobs()).toEqual([]);
  });
});

describe("report preference and status", () => {
  it("is not_oauth (null) without an OAuth connection", async () => {
    expect(await status()).toBeNull();
    expect(await setEnabled(false)).toBe(false);
    await result("public.save_hevy_api_key($1, 'key', $2)", [first, first]);
    expect(await status()).toBeNull();
    expect(await setEnabled(false)).toBe(false);
  });

  it("defaults to enabled and waiting, then working once a signed event arrives", async () => {
    await connect();
    expect(await status()).toEqual({ enabled: true, status: "waiting", last_received_at: null, last_report: null });
    await accept();
    const after = await status();
    expect(after).toMatchObject({ enabled: true, status: "working", last_report: { status: "pending", conversation_id: null } });
    expect(typeof after!.last_received_at).toBe("string");
  });

  it("reports delivery truthfully", async () => {
    await connect();
    await accept();
    await db.query("update public.workout_reports set status = 'failed', attempts = 2");
    expect((await status())!.last_report).toMatchObject({ status: "pending", conversation_id: null });
    await db.query("update public.workout_reports set attempts = 5");
    expect((await status())!.last_report).toMatchObject({ status: "failed", conversation_id: null });
    await db.query("update public.workout_reports set status = 'skipped'");
    expect((await status())!.last_report).toMatchObject({ status: "failed" });
    await db.query("update public.workout_reports set status = 'delivered'");
    const { conversation_id } = (await db.query<{ conversation_id: string }>("select conversation_id from public.workout_reports")).rows[0];
    expect((await status())!.last_report).toMatchObject({ status: "delivered", conversation_id });
  });

  it("keeps the preference across reconnects of the same Hevy account, and token refresh", async () => {
    const revision = await connect();
    await accept();
    await setEnabled(false);
    await db.query("update public.hevy_connections set token_version = token_version + 1, access_expires_at = now() + interval '2 hours'");
    expect(await status()).toMatchObject({ enabled: false, status: "off" });

    await result("public.disconnect_hevy($1)", [first]);
    const next = await connect();
    expect(next).not.toBe(revision);
    // New connection: still off, and nothing received for it yet.
    expect(await status()).toEqual({ enabled: false, status: "off", last_received_at: null, last_report: null });
    await setEnabled(true);
    expect(await status()).toMatchObject({ enabled: true, status: "waiting", last_received_at: null });
  });

  it("starts enabled for a different Hevy account", async () => {
    await connect();
    await setEnabled(false);
    await result("public.disconnect_hevy($1)", [first]);
    await connect(otherProvider);
    expect(await status()).toMatchObject({ enabled: true, status: "waiting" });
    expect(await accept(otherProvider)).toEqual({ result: "queued", user_id: first });
  });

  it("lets the worker skip after opt-out or a connection change", async () => {
    const revision = await connect();
    expect(await eligibility(revision)).toBe("eligible");
    await setEnabled(false);
    expect(await eligibility(revision)).toBe("reports_off");
    await setEnabled(true);
    await result("public.disconnect_hevy($1)", [first]);
    expect(await eligibility(revision)).toBe("connection_changed");
    await result("public.save_hevy_api_key($1, 'key', $2)", [first, revision]);
    expect(await eligibility(revision)).toBe("eligible");
  });

  it("is server-role only", async () => {
    await db.exec("reset role; set local role authenticated");
    for (const sql of [
      `select public.hevy_report_status('${first}', 5)`,
      `select public.set_hevy_reports_enabled('${first}', false)`,
      `select public.workout_report_eligibility('${first}', '${first}')`,
      "select * from public.hevy_report_settings",
      `select * from public.accept_hevy_app_webhook('${provider}', '${workout}', now())`,
    ]) {
      await db.exec("savepoint denied");
      await expect(db.query(sql)).rejects.toThrow(/permission denied/);
      await db.exec("rollback to savepoint denied");
    }
  });
});
