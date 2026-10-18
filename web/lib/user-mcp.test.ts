import { beforeEach, expect, it, vi } from "vitest";
import { createUserMcp } from "./user-mcp";

const mocks = vi.hoisted(() => ({ Client: vi.fn(), Transport: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({ Client: mocks.Client }));
vi.mock("@modelcontextprotocol/sdk/client/stdio.js", () => ({ StdioClientTransport: mocks.Transport }));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.Client.mockImplementation(function () {
    return { connect: vi.fn().mockResolvedValue(undefined), listTools: vi.fn().mockResolvedValue({ tools: [] }), close: vi.fn().mockResolvedValue(undefined) };
  });
  mocks.Transport.mockImplementation(function () { return { stderr: { on: vi.fn() } }; });
});

it("uses separate MCP clients and does not inherit provider/admin secrets or telemetry", async () => {
  const first = await createUserMcp("first-key", new AbortController().signal);
  const second = await createUserMcp("second-key", new AbortController().signal);
  expect(first.client).not.toBe(second.client);
  expect(mocks.Transport.mock.calls[0][0].env).toEqual({
    HEVY_API_KEY: "first-key", HEVY_MCP_TELEMETRY: "0", NODE_ENV: "production",
  });
  expect(mocks.Transport.mock.calls[1][0].env.HEVY_API_KEY).toBe("second-key");
  expect(mocks.Transport.mock.calls[0][0].args[0]).toContain("node_modules/hevy-mcp/dist/cli.mjs");
  await first.close();
  await second.close();
});

it("closes the MCP client on cancellation", async () => {
  const controller = new AbortController();
  const mcp = await createUserMcp("first-key", controller.signal);
  controller.abort();
  expect(mcp.client.close).toHaveBeenCalled();
});
