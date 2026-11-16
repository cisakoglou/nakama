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
    create role service_role bypassrls;
    create schema auth;
    grant usage on schema public to anon, authenticated, service_role;
    create table auth.users (id uuid primary key, email text);
  `);
  await db.exec(await readFile(new URL("../../supabase/migrations/202611150001_push_subscriptions.sql", import.meta.url), "utf8"));
}, 30_000);

beforeEach(async () => {
  await db.exec(`begin; insert into auth.users values ('${first}', 'one@example.test'), ('${second}', 'two@example.test');`);
});
afterEach(async () => { await db.exec("rollback"); });
afterAll(async () => { await db.close(); });

const subscribe = (user: string, endpoint: string, createdAt: string) => db.query(
  `insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, created_at) values ($1, $2, 'key', 'auth', $3)
   on conflict (endpoint) do update set user_id = excluded.user_id, created_at = excluded.created_at`,
  [user, endpoint, createdAt],
);
const endpoints = async (user: string) => (await db.query<{ endpoint: string }>(
  "select endpoint from public.push_subscriptions where user_id = $1 order by created_at desc", [user],
)).rows.map((row) => row.endpoint);

describe("push subscription storage", () => {
  it("keeps only the ten newest subscriptions per account", async () => {
    for (let n = 1; n <= 12; n++) await subscribe(first, `https://push.test/${n}`, `2026-11-${String(n).padStart(2, "0")}T00:00:00Z`);
    await subscribe(second, "https://push.test/other", "2026-11-01T00:00:00Z");
    expect(await endpoints(first)).toEqual(Array.from({ length: 10 }, (_, i) => `https://push.test/${12 - i}`));
    expect(await endpoints(second)).toEqual(["https://push.test/other"]);
  });

  it("moves a re-subscribed endpoint to the account that saved it last", async () => {
    await subscribe(first, "https://push.test/shared", "2026-11-01T00:00:00Z");
    await subscribe(second, "https://push.test/shared", "2026-11-02T00:00:00Z");
    expect(await endpoints(first)).toEqual([]);
    expect(await endpoints(second)).toEqual(["https://push.test/shared"]);
  });

  it("rejects non-https endpoints and is not readable by signed-in clients", async () => {
    await db.exec("savepoint plain;");
    await expect(subscribe(first, "http://push.test/1", "2026-11-01T00:00:00Z")).rejects.toThrow(/check/);
    await db.exec("rollback to savepoint plain;");
    await db.exec("savepoint client; set local role authenticated;");
    await expect(db.query("select * from public.push_subscriptions")).rejects.toThrow(/permission denied/);
    await db.exec("rollback to savepoint client;");
  });

  it("deletes subscriptions with the account", async () => {
    await subscribe(first, "https://push.test/1", "2026-11-01T00:00:00Z");
    await db.query("delete from auth.users where id = $1", [first]);
    expect(await endpoints(first)).toEqual([]);
  });
});
