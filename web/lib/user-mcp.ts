import "server-only";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { HevyConnectionError } from "@/lib/hevy-connection";

export async function createUserMcp(apiKey: string, signal: AbortSignal) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.join(process.cwd(), "node_modules/hevy-mcp/dist/cli.mjs")],
    env: { HEVY_API_KEY: apiKey, HEVY_MCP_TELEMETRY: "0", NODE_ENV: "production" },
    stderr: "pipe",
  });
  const client = new Client({ name: "nakama", version: "1.0.0" });
  let closed = false;
  async function close() {
    if (closed) return;
    closed = true;
    signal.removeEventListener("abort", onAbort);
    try {
      await client.close();
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      console.error("Hevy MCP session cleanup failed", { name: error.name });
    }
  }
  const onAbort = () => { void close(); };
  signal.addEventListener("abort", onAbort, { once: true });
  try {
    signal.throwIfAborted();
    await client.connect(transport);
    transport.stderr?.on("data", () => {});
    signal.throwIfAborted();
    const { tools } = await client.listTools(undefined, { signal });
    return { client, tools, close };
  } catch (error) {
    await close();
    if (!(error instanceof Error)) throw error;
    console.error("Hevy MCP session initialization failed", { name: error.name });
    throw new HevyConnectionError(502, "Hevy tools could not be started. Please try again.");
  }
}
