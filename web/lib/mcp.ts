import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";

// Persist across hot reloads in dev and across requests in prod
declare global {
  // eslint-disable-next-line no-var
  var _mcpClient: Client | undefined;
  var _mcpTools: Tool[] | undefined;
}

async function initMcp(): Promise<{ client: Client; tools: Tool[] }> {
  const transport = new StdioClientTransport({
    command: "npx",
    args: ["-y", "hevy-mcp"],
    env: { ...process.env, HEVY_API_KEY: process.env.HEVY_API_KEY! },
  });

  const client = new Client({ name: "hevy-trainer-web", version: "1.0.0" });
  await client.connect(transport);
  const { tools } = await client.listTools();
  return { client, tools };
}

export async function getMcp(): Promise<{ client: Client; tools: Tool[] }> {
  if (global._mcpClient && global._mcpTools) {
    return { client: global._mcpClient, tools: global._mcpTools };
  }
  const { client, tools } = await initMcp();
  global._mcpClient = client;
  global._mcpTools = tools;
  return { client, tools };
}
