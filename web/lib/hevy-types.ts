import { z } from "zod";

export const connectionSchema = z.discriminatedUnion("connected", [
  z.object({ connected: z.literal(false) }),
  z.object({
    connected: z.literal(true),
    revision: z.string().uuid(),
    connected_at: z.string().datetime({ offset: true }),
  }),
]);

export const hevyKeySchema = z.object({
  api_key: z.string().trim().min(1).max(512).regex(/^[^\s\x00-\x1f\x7f]+$/),
}).strict();

export type HevyConnection = z.infer<typeof connectionSchema>;
