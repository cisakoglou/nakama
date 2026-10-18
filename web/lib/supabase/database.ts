import type { Profile, ProfileInput } from "@/lib/profile";

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: Profile;
        Insert: ProfileInput & {
          user_id: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<ProfileInput>;
        Relationships: [];
      };
      hevy_connections: {
        Row: { user_id: string; encrypted_key: string; revision: string; updated_at: string };
        Insert: { user_id: string; encrypted_key: string; revision: string; updated_at: string };
        Update: { encrypted_key?: string; revision?: string; updated_at?: string };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      has_beta_access: { Args: Record<string, never>; Returns: boolean };
      hevy_connection_status: { Args: Record<string, never>; Returns: unknown };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
