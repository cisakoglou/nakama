import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const mocks = vi.hoisted(() => ({
  getMcp: vi.fn(),
  streamText: vi.fn(),
}));

vi.mock("@/lib/mcp", () => ({ getMcp: mocks.getMcp }));
vi.mock("@/lib/system-prompt", () => ({ SYSTEM_PROMPT: "Test coaching instructions" }));
vi.mock("ai", () => ({
  jsonSchema: vi.fn(),
  streamText: mocks.streamText,
  tool: vi.fn(),
}));

function request(password?: string, body = "not JSON") {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: password === undefined ? {} : { "x-app-password": password },
    body,
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("APP_PASSWORD", "test-app-password");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/chat authentication", () => {
  it.each([undefined, ""])("rejects unconfigured authentication (%j)", async (password) => {
    vi.stubEnv("APP_PASSWORD", password);

    const response = await POST(request("test-app-password"));

    expect(response.status).toBe(503);
    expect(await response.text()).toContain("authentication is not configured");
    expect(mocks.getMcp).not.toHaveBeenCalled();
    expect(mocks.streamText).not.toHaveBeenCalled();
  });

  it.each([undefined, "incorrect-password"])("rejects invalid credentials (%j)", async (password) => {
    const response = await POST(request(password));

    expect(response.status).toBe(401);
    expect(await response.text()).toBe("Unauthorized");
    expect(mocks.getMcp).not.toHaveBeenCalled();
    expect(mocks.streamText).not.toHaveBeenCalled();
  });

  it("preserves authenticated chat streaming", async () => {
    const messages = [{ role: "user", content: "How has my squat progressed?" }];
    const streamResponse = new Response("streamed reply");
    mocks.getMcp.mockResolvedValue({ client: { callTool: vi.fn() }, tools: [] });
    mocks.streamText.mockReturnValue({
      toDataStreamResponse: () => streamResponse,
    });

    const response = await POST(request("test-app-password", JSON.stringify({ messages })));

    expect(response).toBe(streamResponse);
    expect(await response.text()).toBe("streamed reply");
    expect(mocks.getMcp).toHaveBeenCalledOnce();
    expect(mocks.streamText).toHaveBeenCalledOnce();
    expect(mocks.streamText).toHaveBeenCalledWith(expect.objectContaining({ messages }));
  });
});
