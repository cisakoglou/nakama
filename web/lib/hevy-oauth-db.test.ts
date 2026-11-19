import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const first = "00000000-0000-4000-8000-000000000001";
const second = "00000000-0000-4000-8000-000000000002";
const provider = "00000000-0000-4000-8000-000000000003";
const attempt = "00000000-0000-4000-8000-000000000004";
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
    "202611190001_hevy_oauth.sql",
    "202611190002_hevy_request_budget.sql",
  ]) await db.exec(await readFile(new URL(`../../supabase/migrations/${file}`, import.meta.url), "utf8"));
}, 30_000);
beforeEach(async () => {
  await db.exec(`
    begin;
    insert into auth.users values ('${first}', 'one@example.test'), ('${second}', 'two@example.test');
    insert into public.beta_invitations (email) values ('one@example.test'), ('two@example.test');
    set local role service_role;
  `);
});
afterEach(async () => { await db.exec("rollback"); });
afterAll(async () => { await db.close(); });

async function result<T = string>(sql: string, parameters: (string | number | boolean)[] = []) {
  return (await db.query<{ result: T }>(`select ${sql} as result`, parameters)).rows[0].result;
}
const begin = (user = first) => result("public.begin_hevy_oauth($1, $2, $3)", [user, state, browser]);
const consume = (user = first, binding = browser) => result<boolean>("public.consume_hevy_oauth_state($1, $2, $3)", [user, state, binding]);
const complete = (user = first, hevyUser = provider) => result(
  "public.complete_hevy_oauth($1, $2, $3, 'lifter', 'encrypted-pair', now() + interval '1 hour')", [user, state, hevyUser],
);
async function connect() {
  expect(await begin()).toBe("started");
  expect(await consume()).toBe(true);
  expect(await complete()).toBe("saved");
  return (await db.query<{ revision: string }>("select revision from public.hevy_connections where user_id = $1", [first])).rows[0].revision;
}
async function expire() {
  const revision = await connect();
  await db.query("update public.hevy_connections set access_expires_at = now() - interval '1 minute'");
  return revision;
}
const claim = (revision: string, id = attempt) => result(
  "public.claim_hevy_oauth_refresh($1, $2, 0, $3)", [first, revision, id],
);
const finish = (revision: string, id = attempt) => result<boolean>(
  "public.finish_hevy_oauth_refresh($1, $2, 0, $3, 'rotated-pair', now() + interval '1 hour')", [first, revision, id],
);

describe("OAuth database lifecycle", () => {
  it("preserves API-key connections and prevents accidental credential-method replacement", async () => {
    await result("public.save_hevy_api_key($1, 'key', $2)", [first, first]);
    expect(await begin()).toBe("migration_required");
    expect((await db.query("select encrypted_key, credential_method from public.hevy_connections")).rows)
      .toEqual([{ encrypted_key: "key", credential_method: "api_key" }]);
  });

  it("binds single-use state to its user, browser and expiry", async () => {
    await begin();
    expect(await consume(second)).toBe(false);
    expect(await consume(first, "c".repeat(64))).toBe(false);
    expect(await consume()).toBe(true);
    expect(await consume()).toBe(false);
    await begin();
    await db.query("update public.hevy_oauth_states set expires_at = now() - interval '1 second'");
    expect(await consume()).toBe(false);
    expect(await complete()).toBe("invalid_state");
  });

  it("requires consumption before save and exposes metadata, not OAuth tokens, to its owner", async () => {
    await begin();
    expect(await complete()).toBe("invalid_state");
    await consume();
    expect(await complete()).toBe("saved");
    expect((await db.query("select * from public.hevy_oauth_states")).rows).toEqual([]);
    await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: first, email: "one@example.test" })]);
    await db.exec("set local role authenticated");
    const status = await result("public.hevy_connection_status()");
    expect(status).toMatchObject({ connected: true, method: "oauth", state: "active", hevy_username: "lifter" });
    expect(JSON.stringify(status)).not.toContain("encrypted-pair");
  });

  it("invalidates pending callbacks on disconnect even when there was no connection row", async () => {
    await begin();
    await consume();
    await result("public.disconnect_hevy($1)", [first]);
    expect(await complete()).toBe("invalid_state");
    expect((await db.query("select * from public.hevy_connections")).rows).toEqual([]);
  });

  it("cannot resurrect a callback after an API key was saved", async () => {
    await begin();
    await consume();
    await result("public.save_hevy_api_key($1, 'key', $2)", [first, first]);
    expect(await complete()).toBe("invalid_state");
  });

  it("preserves logical revision during same-account reauthorization and rejects a different provider account", async () => {
    const revision = await connect();
    await db.query("insert into public.workout_reports (user_id, workout_id, connection_revision) values ($1, 'pending-workout', $2)", [first, revision]);
    await begin();
    await consume();
    expect(await complete(first, second)).toBe("account_mismatch");
    expect(await complete()).toBe("saved");
    expect((await db.query("select revision, token_version from public.hevy_connections")).rows)
      .toEqual([{ revision, token_version: 1 }]);
    expect((await db.query("select connection_revision from public.claim_next_workout_report(5)")).rows)
      .toEqual([{ connection_revision: revision }]);
    expect(await result("public.save_hevy_api_key($1, 'key', $2)", [first, first])).toBeNull();
  });

  it("does not map one provider account to two Nakama accounts", async () => {
    await connect();
    await begin(second);
    await consume(second);
    expect(await complete(second)).toBe("account_in_use");
  });

  it("claims one refresh and fences completion by attempt, version and logical connection", async () => {
    const revision = await expire();
    expect(await claim(revision)).toBe("claimed");
    expect(await claim(revision, second)).toBe("busy");
    expect(await finish(revision, second)).toBe(false);
    expect(await finish(revision)).toBe(true);
    expect(await finish(revision)).toBe(false);
    expect((await db.query("select revision, token_version, encrypted_oauth, refresh_attempt_id from public.hevy_connections")).rows)
      .toEqual([{ revision, token_version: 1, encrypted_oauth: "rotated-pair", refresh_attempt_id: null }]);
    expect(await claim(revision)).toBe("updated");
  });

  it("never retries a token that a crashed refresher might have consumed", async () => {
    const revision = await expire();
    await claim(revision);
    await db.query("update public.hevy_connections set refresh_started_at = now() - interval '61 seconds'");
    expect(await claim(revision, second)).toBe("reconnect_required");
    expect(await finish(revision)).toBe(false);
    expect(await claim(revision)).toBe("reconnect_required");
  });

  it("rejects completion after disconnect/replacement and cannot overwrite the new key", async () => {
    const revision = await expire();
    await claim(revision);
    await result("public.disconnect_hevy($1)", [first]);
    await result("public.save_hevy_api_key($1, 'replacement-key', $2)", [first, second]);
    expect(await finish(revision)).toBe(false);
    expect((await db.query("select encrypted_key from public.hevy_connections")).rows)
      .toEqual([{ encrypted_key: "replacement-key" }]);
  });

  it("rejects a stale refresh after reauthorization has stored a newer token pair", async () => {
    const revision = await expire();
    await claim(revision);
    await begin();
    await consume();
    await complete();
    expect(await finish(revision)).toBe(false);
  });

  it("permits retry after an explicit rejection but requires reauthorization after an ambiguous failure", async () => {
    const revision = await expire();
    await claim(revision);
    expect(await result("public.fail_hevy_oauth_refresh($1, $2, 0, $3, true)", [first, revision, attempt])).toBe(true);
    expect(await claim(revision)).toBe("claimed");
    await result("public.fail_hevy_oauth_refresh($1, $2, 0, $3, false)", [first, revision, attempt]);
    expect(await claim(revision)).toBe("reconnect_required");
  });

  it("checks invitation eligibility again before saving or refreshing credentials", async () => {
    const revision = await expire();
    await db.exec("reset role");
    await db.query("delete from public.beta_invitations where email = 'one@example.test'");
    await db.exec("set local role service_role");
    expect(await claim(revision)).toBe("not_eligible");
    expect(await begin()).toBe("not_eligible");
  });

  it("only marks the same user's current, non-refreshing OAuth token rejected", async () => {
    const revision = await expire();
    const reject = (user: string, version: number) => result(
      "public.reject_hevy_oauth_token($1, $2, $3)", [user, revision, version],
    );
    await reject(second, 0);
    await reject(first, 1);
    expect(await claim(revision)).toBe("claimed");
    await reject(first, 0);
    expect(await finish(revision)).toBe(true);
    await reject(first, 0);
    expect(await claim(revision)).toBe("updated");
    await reject(first, 1);
    expect(await claim(revision)).toBe("reconnect_required");
    await begin();
    await consume();
    await complete();
    await reject(first, 1);
    expect(await claim(revision)).toBe("updated");
  });

  it("serializes request slots and rejects excess backlog without extending it", async () => {
    const waits = await Promise.all(Array.from({ length: 4 }, () => result<number>("public.reserve_hevy_request()")));
    expect(waits[0]).toBe(0);
    expect(waits[1]).toBeGreaterThan(250);
    expect(waits[3]).toBeGreaterThan(900);
    await db.exec("reset role");
    await db.exec("update public.hevy_request_budget set next_at = clock_timestamp() + interval '10 seconds'");
    const original = (await db.query("select next_at from public.hevy_request_budget")).rows;
    await db.exec("set local role service_role");
    expect(await result<number>("public.reserve_hevy_request()")).toBe(-1);
    await db.exec("reset role");
    expect((await db.query("select next_at from public.hevy_request_budget")).rows).toEqual(original);
  });

  it("makes every OAuth mutation RPC server-only", async () => {
    const permissions = await db.query<{ proname: string; browser: boolean; server: boolean }>(`
      select proname,
        has_function_privilege('anon', oid, 'execute') or has_function_privilege('authenticated', oid, 'execute') as browser,
        has_function_privilege('service_role', oid, 'execute') as server
      from pg_proc where pronamespace = 'public'::regnamespace and proname in (
        'save_hevy_api_key', 'disconnect_hevy', 'begin_hevy_oauth', 'consume_hevy_oauth_state',
        'complete_hevy_oauth', 'claim_hevy_oauth_refresh', 'finish_hevy_oauth_refresh', 'fail_hevy_oauth_refresh',
        'reserve_hevy_request', 'reject_hevy_oauth_token'
      )
    `);
    expect(permissions.rows).toHaveLength(10);
    for (const permission of permissions.rows) expect(permission).toMatchObject({ browser: false, server: true });
  });

  it.each(["hevy_connections", "hevy_oauth_states", "hevy_request_budget"])("does not let browser sessions read %s", async table => {
    await db.exec("set local role authenticated");
    await expect(db.query(`select * from public.${table}`)).rejects.toThrow(/permission denied/);
  });
});
