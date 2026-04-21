import { anthropic } from "@ai-sdk/anthropic";
import { jsonSchema, streamText, tool } from "ai";
import { getMcp } from "@/lib/mcp";
import { SYSTEM_PROMPT } from "@/lib/system-prompt";

export const maxDuration = 120;

export async function POST(req: Request) {
  const appPassword = process.env.APP_PASSWORD;
  if (appPassword) {
    const auth = req.headers.get("x-app-password");
    if (auth !== appPassword) {
      return new Response("Unauthorized", { status: 401 });
    }
  }

  const { messages } = await req.json();

  const { client: mcp, tools: mcpTools } = await getMcp();

  const tools = Object.fromEntries(
    mcpTools.map((t) => [
      t.name,
      tool({
        description: t.description ?? "",
        parameters: jsonSchema(t.inputSchema as Record<string, unknown>),
        execute: async (args) => {
          const result = await mcp.callTool({
            name: t.name,
            arguments: args as Record<string, unknown>,
          });
          const text = (result.content as Array<{ type: string; text?: string }>)
            .filter((c) => c.type === "text")
            .map((c) => c.text ?? "")
            .join("\n");
          if (result.isError) throw new Error(text);
          return text;
        },
      }),
    ])
  );

  const result = streamText({
    model: anthropic("claude-haiku-4-5-20251001"),
    system: SYSTEM_PROMPT,
    messages,
    tools,
    maxSteps: 15,
  });

  return result.toDataStreamResponse();
}
