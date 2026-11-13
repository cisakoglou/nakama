import type { Profile, ProfileInput } from "@/lib/profile";
import type { Conversation } from "@/lib/conversation-types";

export type WorkoutReportRow = {
  user_id: string;
  workout_id: string;
  connection_revision: string;
  status: "queued" | "processing" | "delivered" | "failed" | "skipped";
  attempts: number;
  available_at: string;
  conversation_id: string;
  last_error: string | null;
  claimed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type Database = {
  public: {
    Tables: {
      chat_conversations: {
        Row: Conversation;
        Insert: { user_id: string; title?: string; id?: string; messages?: Conversation["messages"] };
        Update: Partial<Omit<Conversation, "id" | "user_id" | "created_at">>;
        Relationships: [];
      };
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
      hevy_webhook_tokens: {
        Row: { user_id: string; token_hash: string; connection_revision: string; created_at: string };
        Insert: { user_id: string; token_hash: string; connection_revision: string; created_at?: string };
        Update: { token_hash?: string; connection_revision?: string; created_at?: string };
        Relationships: [];
      };
      workout_reports: {
        Row: WorkoutReportRow;
        Insert: { user_id: string; workout_id: string; connection_revision: string };
        Update: {
          status?: WorkoutReportRow["status"]; last_error?: string | null; available_at?: string; updated_at?: string;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      has_beta_access: { Args: Record<string, never>; Returns: boolean };
      hevy_connection_status: { Args: Record<string, never>; Returns: unknown };
      hevy_webhook_owner: {
        Args: { p_token_hash: string };
        Returns: { user_id: string; connection_revision: string }[];
      };
      claim_next_workout_report: {
        Args: { p_max_attempts: number };
        Returns: {
          user_id: string; workout_id: string; connection_revision: string; conversation_id: string; attempts: number;
        }[];
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
