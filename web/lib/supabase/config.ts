export class SupabaseConfigurationError extends Error {}

export function getSupabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !key) {
    throw new SupabaseConfigurationError(
      "Sign-in is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY."
    );
  }
  if (!key.startsWith("sb_publishable_")) {
    throw new SupabaseConfigurationError(
      "Use the Supabase publishable key, not a secret or legacy key."
    );
  }

  return { url, key };
}
