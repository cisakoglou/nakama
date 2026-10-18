import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  decryptHevyKey, deleteHevyConnection, encryptHevyKey, HevyConnectionError,
  loadHevyConnection, saveHevyConnection,
} from "./hevy-connection";

const mocks = vi.hoisted(() => ({
  admin: vi.fn(), from: vi.fn(), upsert: vi.fn(), select: vi.fn(), eq: vi.fn(),
  single: vi.fn(), maybeSingle: vi.fn(), remove: vi.fn(), fetch: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.admin }));

const one = "00000000-0000-4000-8000-000000000001";
const two = "00000000-0000-4000-8000-000000000002";
const query = {
  upsert: mocks.upsert, select: mocks.select, eq: mocks.eq,
  single: mocks.single, maybeSingle: mocks.maybeSingle, delete: mocks.remove,
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test");
  vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_server_only");
  vi.stubEnv("HEVY_CREDENTIAL_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
  vi.stubEnv("HEVY_API_KEY", "legacy-owner-key-never-use");
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.admin.mockReturnValue({ from: mocks.from });
  mocks.from.mockReturnValue(query);
  for (const fn of [mocks.upsert, mocks.select, mocks.remove]) fn.mockReturnValue(query);
  mocks.eq.mockResolvedValue({ error: null });
  mocks.single.mockResolvedValue({ data: { revision: one, updated_at: "2026-10-18T00:00:00Z" }, error: null });
  mocks.fetch.mockResolvedValue(new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", mocks.fetch);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("private Hevy credentials", () => {
  it("round trips credentials with fresh nonces without storing plaintext", () => {
    const first = encryptHevyKey(one, "personal-api-key");
    const second = encryptHevyKey(one, "personal-api-key");
    expect(first).not.toBe(second);
    expect(first).not.toContain("personal-api-key");
    expect(decryptHevyKey(one, first)).toBe("personal-api-key");
  });

  it("rejects credentials moved to another account or tampered with", () => {
    const encrypted = encryptHevyKey(one, "personal-api-key");
    expect(() => decryptHevyKey(two, encrypted)).toThrow(HevyConnectionError);
    const parts = encrypted.split(".");
    const data = Buffer.from(parts[3], "base64");
    data[0] ^= 1;
    parts[3] = data.toString("base64");
    expect(() => decryptHevyKey(one, parts.join("."))).toThrow(HevyConnectionError);
  });

  it("validates against Hevy then stores ciphertext under the trusted owner", async () => {
    const result = await saveHevyConnection(one, "personal-api-key");
    expect(mocks.fetch).toHaveBeenCalledWith("https://api.hevyapp.com/v1/user/info", expect.objectContaining({
      headers: { "api-key": "personal-api-key" },
    }));
    const stored = mocks.upsert.mock.calls[0][0];
    expect(stored.user_id).toBe(one);
    expect(decryptHevyKey(one, stored.encrypted_key)).toBe("personal-api-key");
    expect(result).toEqual({ connected: true, revision: one, connected_at: "2026-10-18T00:00:00Z" });
    expect(JSON.stringify(result)).not.toContain("personal-api-key");
    expect(mocks.admin.mock.calls[0][1]).toBe("sb_secret_server_only");
  });

  it.each([401, 403, 429, 503])("does not store a failed Hevy connection (%i)", async (status) => {
    mocks.fetch.mockResolvedValue(new Response("upstream error", { status }));
    await expect(saveHevyConnection(one, "bad-key")).rejects.toThrow(HevyConnectionError);
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("never falls back to the configured owner's key", async () => {
    mocks.eq.mockReturnValue(query);
    mocks.maybeSingle.mockResolvedValue({ data: null, error: null });
    await expect(loadHevyConnection(two)).rejects.toMatchObject({ status: 409 });
    expect(mocks.eq).toHaveBeenCalledWith("user_id", two);
  });

  it("decrypts only the requested owner's connection", async () => {
    mocks.eq.mockReturnValue(query);
    mocks.maybeSingle.mockResolvedValue({
      data: { encrypted_key: encryptHevyKey(two, "second-key"), revision: two }, error: null,
    });
    expect(await loadHevyConnection(two)).toEqual({ apiKey: "second-key", revision: two });
    expect(mocks.eq).toHaveBeenCalledWith("user_id", two);
  });

  it("removes only the requested owner's stored key", async () => {
    await deleteHevyConnection(two);
    expect(mocks.remove).toHaveBeenCalled();
    expect(mocks.eq).toHaveBeenCalledWith("user_id", two);
  });

  it("fails closed without server-side encryption configuration", async () => {
    vi.stubEnv("HEVY_CREDENTIAL_ENCRYPTION_KEY", "");
    await expect(saveHevyConnection(one, "personal-api-key")).rejects.toMatchObject({ status: 503 });
    expect(mocks.fetch).not.toHaveBeenCalled();
  });
});
