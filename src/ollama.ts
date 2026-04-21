import OpenAI from "openai";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import * as readline from "readline";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import * as dotenv from "dotenv";

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadTrainerContext(): string {
  const mdPath = path.join(__dirname, "..", "TRAINER.md");
  if (!fs.existsSync(mdPath)) return "";
  return "\n\n---\n## Trainer Configuration (TRAINER.md)\n\n" + fs.readFileSync(mdPath, "utf8");
}

// Default to qwen2.5:14b — best tool-calling model in Ollama as of 2025.
// Smaller option: qwen2.5:7b (~4GB RAM). Fallback: llama3.1:8b
const MODEL = process.env.OLLAMA_MODEL ?? "qwen2.5:14b";
// Use 127.0.0.1 explicitly — "localhost" resolves to ::1 (IPv6) on newer macOS
// which Ollama doesn't listen on by default.
const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://127.0.0.1:11434/v1";

const SYSTEM_PROMPT = `You are a personal fitness trainer with full access to the user's Hevy workout data. Always call tools immediately — never describe what you're about to do, just do it.

## Tool reference

- get-workouts / get-workout — fetch workout history
- get-workout-count — total workout count
- search-exercise-templates — search by name to get exerciseTemplateId (ALWAYS use this before create-routine or create-workout)
- get-exercise-templates — paginated full list (use search instead when you know the name)
- get-exercise-template — fetch ONE exercise by ID (only if you already have the ID)
- get-exercise-history — past sets for a specific exercise (requires exerciseTemplateId)
- get-routines / get-routine — read routines
- create-routine — create a new routine
- update-routine — update existing routine
- create-workout — log a completed workout

## Workflows

### Creating a routine
1. Call search-exercise-templates for EACH exercise to get its exerciseTemplateId.
2. Immediately after collecting all IDs, call create-routine in ONE call with ALL exercises.
3. Do NOT output any text between collecting IDs and calling create-routine.
4. After create-routine succeeds, confirm the routine name to the user.

create-routine requires this exact shape per exercise:
{
  "exerciseTemplateId": "XXXXXXXX",
  "sets": [
    { "type": "normal", "reps": null, "repRange": { "start": 8, "end": 12 } },
    { "type": "normal", "reps": null, "repRange": { "start": 8, "end": 12 } },
    { "type": "normal", "reps": null, "repRange": { "start": 8, "end": 12 } }
  ],
  "restSeconds": 120
}
Always include at least 3 sets. reps must be null (not omitted). repRange start/end are required.

### Checking progress
1. Call search-exercise-templates to get the exerciseTemplateId.
2. Call get-exercise-history with that ID.
3. Identify trend and give a specific next-session target with numbers.

### Logging a workout
1. Search for each exercise to get IDs.
2. Call create-workout with all sets in one call.

## Rules
- Always use kg.
- Never explain steps you're about to take — just call the tools.
- Never ask the user for exercise IDs or template IDs — find them yourself.
- When making recommendations, always reference the user's actual data.
- For create-routine sets, use repRange: {start: N, end: N} and reps: null unless specific reps are known.`;

async function runTrainer() {
  const hevyApiKey = process.env.HEVY_API_KEY;
  if (!hevyApiKey) {
    console.error("Missing HEVY_API_KEY in .env");
    process.exit(1);
  }

  // Connect to hevy-mcp
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

  // Convert MCP tools to OpenAI function-calling format
  const tools: OpenAI.Chat.ChatCompletionTool[] = mcpTools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description ?? "",
      parameters: t.inputSchema as Record<string, unknown>,
    },
  }));

  const ollama = new OpenAI({ baseURL: OLLAMA_URL, apiKey: "ollama" });
  const fullSystem = SYSTEM_PROMPT + loadTrainerContext();
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: fullSystem },
  ];

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string): Promise<string> => new Promise((res) => rl.question(q, res));

  console.log(`🏋️  Hevy Trainer (Ollama / ${MODEL}) — your AI fitness coach`);
  console.log("Type 'quit' to exit\n");

  while (true) {
    const userInput = await ask("You: ");
    if (userInput.trim().toLowerCase() === "quit") break;
    if (!userInput.trim()) continue;

    messages.push({ role: "user", content: userInput });

    // Agentic loop
    while (true) {
      const response = await ollama.chat.completions.create({
        model: MODEL,
        messages,
        tools,
        tool_choice: "auto",
      });

      const choice = response.choices[0];
      const assistantMsg = choice.message;
      messages.push(assistantMsg);

      if (assistantMsg.content) {
        console.log(`\nTrainer: ${assistantMsg.content}\n`);
      }

      if (choice.finish_reason !== "tool_calls" || !assistantMsg.tool_calls?.length) {
        break;
      }

      // Execute all tool calls and collect results
      for (const toolCall of assistantMsg.tool_calls) {
        process.stdout.write(`  [${toolCall.function.name}] `);
        let resultContent: string;
        try {
          const args = JSON.parse(toolCall.function.arguments || "{}") as Record<string, unknown>;
          const result = await mcp.callTool({ name: toolCall.function.name, arguments: args });
          resultContent = (result.content as Array<{ type: string; text?: string }>)
            .filter((c) => c.type === "text")
            .map((c) => c.text ?? "")
            .join("\n");
          // MCP errors come back as content rather than thrown exceptions
          if (result.isError) {
            console.log(`✗ ERROR: ${resultContent.slice(0, 120)}`);
          } else {
            console.log("✓");
          }
        } catch (err) {
          resultContent = `Error: ${err instanceof Error ? err.message : String(err)}`;
          console.log(`✗ ${resultContent.slice(0, 120)}`);
        }

        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          content: resultContent,
        });
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
