import { createAnthropic } from "@ai-sdk/anthropic";
import { convertToModelMessages, jsonSchema, stepCountIs, streamText, tool, validateUIMessages } from "ai";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireBetaUser } from "@/lib/auth";
import { loadHevyConnection, HevyConnectionError } from "@/lib/hevy-connection";
import { connectionSchema } from "@/lib/hevy-types";
import { profileSchema } from "@/lib/profile";
import { coachingPrompt } from "@/lib/coaching";
import { createUserMcp } from "@/lib/user-mcp";
import { registerChat } from "@/lib/chat-lifecycle";
import { getAppOrigin } from "@/lib/app-origin";

export const maxDuration = 120;
export const runtime = "nodejs";

const allowedTools = new Set([
  "get-workouts", "get-workout", "get-workout-count", "search-exercise-templates",
  "get-exercise-templates", "get-exercise-template", "get-exercise-history",
  "get-routines", "get-routine", "create-routine", "update-routine", "create-workout",
]);
const writes = new Set(["create-routine", "update-routine", "create-workout"]);
const inputSchema = z.object({
  messages: z.array(z.object({
    id: z.string().min(1).max(128),
    role: z.enum(["user", "assistant"]),
    parts: z.array(z.unknown()).min(1).max(100),
  }).passthrough()).min(1).max(40),
}).strict();

export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== getAppOrigin(request)) {
    return NextResponse.json({ error: "This request must come from Nakama." }, { status: 403 });
  }
  const access = await requireBetaUser(request);
  if (!access.ok) return access.response;
  if (!process.env.ANTHROPIC_API_KEY) {
    return access.session.json({ error: "Coaching is not configured. Please contact the beta owner." }, 503);
  }
  const text = await request.text();
  if (Buffer.byteLength(text) > 128 * 1024) {
    return access.session.json({ error: "This conversation is too long. Start a new chat." }, 413);
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return access.session.json({ error: "Send a valid conversation." }, 400);
  }
  const parsed = inputSchema.safeParse(body);
  if (!parsed.success) return access.session.json({ error: "Send a valid conversation of at most 40 messages." }, 400);
  const { data: profile, error } = await access.session.client.from("profiles")
    .select("*").eq("user_id", access.user.id).maybeSingle();
  if (error) {
    console.error("Unable to load coaching preferences", { code: error.code });
    return access.session.json({ error: "Your training preferences could not be loaded." }, 503);
  }
  const preferences = profileSchema.safeParse(profile);
  if (!preferences.success) return access.session.json({ error: "Complete your training preferences first." }, 409);

  let release = () => {};
  let closeMcp = async () => {};
  try {
    const connection = await loadHevyConnection(access.user.id);
    const active = registerChat(access.user.id);
    release = active.release;
    const signal = AbortSignal.any([request.signal, active.controller.signal, AbortSignal.timeout(120_000)]);
    const mcp = await createUserMcp(connection.apiKey, signal);
    closeMcp = mcp.close;
    async function close() { await mcp.close(); active.release(); }
    const tools = Object.fromEntries(mcp.tools.filter((entry) => allowedTools.has(entry.name)).map((entry) => [
      entry.name,
      tool<unknown, unknown>({
        description: entry.description ?? entry.name,
        inputSchema: jsonSchema<unknown>(entry.inputSchema),
        needsApproval: writes.has(entry.name),
        execute: async (args) => {
          signal.throwIfAborted();
          const status = await access.session.client.rpc("hevy_connection_status");
          const current = connectionSchema.safeParse(status.data);
          if (status.error || !current.success || !current.data.connected || current.data.revision !== connection.revision) {
            throw new HevyConnectionError(409, "Your Hevy connection changed. Reconnect or start a new chat.");
          }
          const result = await mcp.client.callTool({
            name: entry.name, arguments: z.record(z.unknown()).parse(args),
          }, undefined, { signal });
          if (result.isError) throw new HevyConnectionError(502, "A Hevy operation failed. Check your connection; do not blindly retry writes.");
          const content = z.array(z.object({ type: z.string(), text: z.string().optional() })).parse(result.content);
          return content.filter((part) => part.type === "text").map((part) => part.text ?? "").join("\n");
        },
      }),
    ]));
    let messages;
    try {
      messages = await validateUIMessages({ messages: parsed.data.messages, tools });
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      await close();
      return access.session.json({ error: "This conversation is invalid. Start a new chat." }, 400);
    }
    const result = streamText({
      model: createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY })("claude-haiku-4-5-20251001"),
      system: coachingPrompt(preferences.data),
      messages: await convertToModelMessages(messages),
      tools, stopWhen: stepCountIs(8), maxOutputTokens: 1500, abortSignal: signal,
      onFinish: close, onAbort: close,
      onError: async () => { console.error("Coaching stream failed"); await close(); },
    });
    const response = result.toUIMessageStreamResponse({
      onError: () => "Coaching stopped. Check your Hevy connection and try again; do not repeat an uncertain write.",
    });
    if (!response.body) { await close(); throw new Error("Coaching stream body is missing"); }
    const reader = response.body.getReader();
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const next = await reader.read();
          if (next.done) { await close(); controller.close(); }
          else controller.enqueue(next.value);
        } catch (error) { await close(); controller.error(error); }
      },
      async cancel() {
        active.controller.abort();
        try { await reader.cancel(); } finally { await close(); }
      },
    });
    return access.session.respond(new Response(stream, { headers: response.headers }));
  } catch (error) {
    await closeMcp();
    release();
    if (!(error instanceof HevyConnectionError)) throw error;
    return access.session.json({ error: error.message }, error.status);
  }
}
