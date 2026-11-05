"use client";

import { useState, type FormEvent } from "react";
import { z } from "zod";
import { readApiResponse } from "@/lib/api-response";
import {
  EQUIPMENT, EQUIPMENT_LABELS, EXPERIENCE_LABELS, EXPERIENCE_LEVELS, GOALS, GOAL_LABELS,
  profileInputSchema, profileSchema, type Profile,
} from "@/lib/profile";

export function ProfileForm({ profile, onSaved, onCancel }: {
  profile: Profile | null; onSaved: () => void; onCancel?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const parsed = profileInputSchema.safeParse({
      goal: fields.get("goal"), experience: fields.get("experience"),
      training_days: Number(fields.get("training_days")),
      equipment: fields.get("equipment"), units: fields.get("units"),
    });
    if (!parsed.success) {
      setError("Choose a value for each preference, including one to seven training days.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/profile", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
      });
      await readApiResponse(response, z.object({ profile: profileSchema }));
      onSaved();
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      setError(error.message);
    } finally {
      setBusy(false);
    }
  }

  const inputClass = "mt-2 w-full rounded-xl border border-line bg-canvas px-3 py-3 text-base focus:outline-none focus:ring-2 focus:ring-brand/40";

  return (
    <form onSubmit={save} className="mt-4">
      <h1 className="text-3xl font-semibold tracking-tight">{profile ? "Edit your preferences" : "Make Nakama yours"}</h1>
      <p className="mt-3 text-sm leading-6 text-ink-muted">
        These preferences are saved privately to your account. You can change them later.
        No chat history, workouts, or Hevy credentials are saved in this step.
      </p>
      <fieldset disabled={busy} className="mt-6 space-y-4">
        <div>
          <label htmlFor="goal" className="text-sm font-medium">Your main goal</label>
          <select id="goal" name="goal" defaultValue={profile?.goal ?? ""} required className={inputClass}>
            <option value="" disabled>Choose your goal</option>
            {GOALS.map((goal) => <option key={goal} value={goal}>{GOAL_LABELS[goal]}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="experience" className="text-sm font-medium">Training experience</label>
          <select id="experience" name="experience" defaultValue={profile?.experience ?? ""} required className={inputClass}>
            <option value="" disabled>Choose your experience</option>
            {EXPERIENCE_LEVELS.map((level) => <option key={level} value={level}>{EXPERIENCE_LABELS[level]}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="training-days" className="text-sm font-medium">Training days per week</label>
          <input
            id="training-days" name="training_days" type="number" min={1} max={7} step={1}
            defaultValue={profile?.training_days ?? ""} required className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="equipment" className="text-sm font-medium">Available equipment</label>
          <select id="equipment" name="equipment" defaultValue={profile?.equipment ?? ""} required className={inputClass}>
            <option value="" disabled>Choose your equipment</option>
            {EQUIPMENT.map((equipment) => <option key={equipment} value={equipment}>{EQUIPMENT_LABELS[equipment]}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="units" className="text-sm font-medium">Weight units</label>
          <select id="units" name="units" defaultValue={profile?.units ?? ""} required className={inputClass}>
            <option value="" disabled>Choose your units</option>
            <option value="kg">Kilograms (kg)</option>
            <option value="lb">Pounds (lb)</option>
          </select>
        </div>
        <button
          type="submit"
          className="w-full rounded-xl bg-brand px-4 py-3 text-sm font-semibold hover:bg-brand-hover disabled:opacity-50"
        >{busy ? "Saving..." : "Save preferences"}</button>
        {onCancel && <button type="button" onClick={onCancel} className="block min-h-11 text-sm underline underline-offset-4">Cancel</button>}
      </fieldset>
      {error && <p role="alert" className="mt-4 text-sm text-red-700">{error}</p>}
    </form>
  );
}
