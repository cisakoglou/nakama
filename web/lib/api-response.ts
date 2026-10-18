import { z } from "zod";

const errorSchema = z.object({ error: z.string() });

export async function readApiResponse<T>(response: Response, schema: z.ZodType<T>): Promise<T> {
  const body: unknown = await response.json();
  if (!response.ok) {
    const parsed = errorSchema.safeParse(body);
    throw new Error(parsed.success ? parsed.data.error : `Request failed (${response.status}).`);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new Error("Nakama returned an invalid response. Please try again.");
  return parsed.data;
}
