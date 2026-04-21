import Anthropic from "@anthropic-ai/sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import * as readline from "readline";
import * as dotenv from "dotenv";

dotenv.config();

const SYSTEM_PROMPT = `You are a personal fitness trainer with full access to the user's Hevy workout app data.

You have tools to:
- Fetch workout history (get-workouts, get-workout-count, get-workout)
- Browse and search exercises (get-exercise-templates, search-exercise-templates)
- Get per-exercise performance history (get-exercise-history)
- Read and create/update routines (get-routines, get-routine, create-routine, update-routine)
- Log new workouts (create-workout)

When asked about progress or next session targets:
1. Fetch the relevant exercise history to see actual weights/reps over time
2. Identify the trend (stalling, progressing, regressing)
3. Give a specific target for next session with reasoning

Always use kg. Be concise and direct — give numbers, not vague advice.
If the user just says hi or asks what you can do, briefly introduce yourself and offer 2-3 concrete things you can help with today.`;

interface ToolCallBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

async function runTrainer() {
  const hevyApiKey = process.env.HEVY_API_KEY;
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;

  if (!hevyApiKey) {
    console.error("Missing HEVY_API_KEY in environment / .env file");
    process.exit(1);
  }
  if (!anthropicApiKey) {
    console.error("Missing ANTHROPIC_API_KEY in environment / .env file");
    process.exit(1);
  }

  // Connect to hevy-mcp via stdio
  const transport = new StdioClientTransport({
    command: "npx",
    args: ["-y", "hevy-mcp"],
    env: { ...process.env, HEVY_API_KEY: hevyApiKey },
  });

  const mcp = new Client({ name: "hevy-trainer", version: "1.0.0" });

  process.stdout.write("Connecting to Hevy...");
  await mcp.connect(transport);
  const { tools: mcpTools } = await mcp.listTools();
  console.log(` ${mcpTools.length} tools loaded.\n`);

  const tools: Anthropic.Tool[] = mcpTools.map((t) => ({
    name: t.name,
    description: t.description ?? "",
    input_schema: t.inputSchema as Anthropic.Tool["input_schema"],
  }));

  const anthropic = new Anthropic({ apiKey: anthropicApiKey });
  const messages: Anthropic.MessageParam[] = [];

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string): Promise<string> => new Promise((res) => rl.question(q, res));

  console.log("🏋️  Hevy Trainer — your AI fitness coach");
  console.log("Type 'quit' to exit\n");

  while (true) {
    const userInput = await ask("You: ");
    if (userInput.trim().toLowerCase() === "quit") break;
    if (!userInput.trim()) continue;

    messages.push({ role: "user", content: userInput });

    // Agentic loop — keep going until end_turn
    while (true) {
      const response = await anthropic.messages.create({
        model: "claude-opus-4-5",
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        tools,
        messages,
      });

      messages.push({ role: "assistant", content: response.content });

      // Print any text blocks
      for (const block of response.content) {
        if (block.type === "text" && block.text) {
          console.log(`\nTrainer: ${block.text}\n`);
        }
      }

      if (response.stop_reason === "end_turn") break;

      if (response.stop_reason === "tool_use") {
        const toolUseBlocks = response.content.filter(
          (b): b is ToolCallBlock => b.type === "tool_use"
        );

        const toolResults: Anthropic.ToolResultBlockParam[] = await Promise.all(
          toolUseBlocks.map(async (block) => {
            process.stdout.write(`  [${block.name}] `);
            try {
              const result = await mcp.callTool({
                name: block.name,
                arguments: block.input,
              });
              const text = (result.content as Array<{ type: string; text?: string }>)
                .filter((c) => c.type === "text")
                .map((c) => c.text ?? "")
                .join("\n");
              console.log("✓");
              return { type: "tool_result" as const, tool_use_id: block.id, content: text };
            } catch (err) {
              console.log("✗");
              return {
                type: "tool_result" as const,
                tool_use_id: block.id,
                content: `Error: ${err instanceof Error ? err.message : String(err)}`,
                is_error: true,
              };
            }
          })
        );

        messages.push({ role: "user", content: toolResults });
      }
    }
  }

  rl.close();
  await mcp.close();
  console.log("Goodbye!");
}

runTrainer().catch((err) => {
  console.error(err);
  process.exit(1);
});
