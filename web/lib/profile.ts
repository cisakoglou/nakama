import { z } from "zod";
import { connectionSchema } from "@/lib/hevy-types";

export const GOALS = ["strength", "muscle", "general-fitness"] as const;
export const EXPERIENCE_LEVELS = ["beginner", "intermediate", "experienced"] as const;
export const EQUIPMENT = ["gym", "home", "bodyweight"] as const;

export const GOAL_LABELS: Record<(typeof GOALS)[number], string> = {
  strength: "Build strength",
  muscle: "Build muscle",
  "general-fitness": "Improve general fitness",
};

export const EXPERIENCE_LABELS: Record<(typeof EXPERIENCE_LEVELS)[number], string> = {
  beginner: "New to strength training",
  intermediate: "Some consistent training experience",
  experienced: "Several years of consistent training",
};

export const EQUIPMENT_LABELS: Record<(typeof EQUIPMENT)[number], string> = {
  gym: "A full gym",
  home: "Home equipment",
  bodyweight: "Bodyweight only",
};

export const profileInputSchema = z.object({
  goal: z.enum(GOALS),
  experience: z.enum(EXPERIENCE_LEVELS),
  training_days: z.number().int().min(1).max(7),
  equipment: z.enum(EQUIPMENT),
  units: z.enum(["kg", "lb"]),
}).strict();

export const profileSchema = profileInputSchema.extend({
  user_id: z.string().uuid(),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
});

export const accountSchema = z.object({
  user: z.object({ id: z.string().uuid(), email: z.string().email() }),
  profile: profileSchema.nullable(),
  connection: connectionSchema,
});

export type ProfileInput = z.infer<typeof profileInputSchema>;
export type Profile = z.infer<typeof profileSchema>;
export type Account = z.infer<typeof accountSchema>;
