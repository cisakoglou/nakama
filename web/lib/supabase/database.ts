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

export type HevyConnectionRow = {
  user_id: string; encrypted_key: string | null; revision: string; updated_at: string;
  credential_method: "api_key" | "oauth"; encrypted_oauth: string | null;
  hevy_user_id: string | null; hevy_username: string | null; access_expires_at: string | null;
  oauth_status: "active" | "reconnect_required"; token_version: number;
  refresh_attempt_id: string | null; refresh_started_at: string | null;
};

type RefreshOwner = { p_user_id: string; p_revision: string; p_token_version: number; p_attempt_id: string };

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
        Row: HevyConnectionRow;
        Insert: Pick<HevyConnectionRow, "user_id" | "revision"> & Partial<Omit<HevyConnectionRow, "user_id" | "revision">>;
        Update: Partial<Omit<HevyConnectionRow, "user_id">>;
        Relationships: [];
      };
      hevy_oauth_states: {
        Row: {
          user_id: string; state_hash: string; browser_hash: string; expected_revision: string | null;
          expires_at: string; consumed_at: string | null;
        };
        Insert: { user_id: string; state_hash: string; browser_hash: string; expected_revision?: string | null };
        Update: { consumed_at?: string };
        Relationships: [];
      };
      hevy_webhook_tokens: {
        Row: { user_id: string; token_hash: string; connection_revision: string; created_at: string };
        Insert: { user_id: string; token_hash: string; connection_revision: string; created_at?: string };
        Update: { token_hash?: string; connection_revision?: string; created_at?: string };
        Relationships: [];
      };
      push_subscriptions: {
        Row: {
          id: string; user_id: string; endpoint: string; p256dh: string; auth: string;
          created_at: string; last_success_at: string | null; failure_count: number;
        };
        Insert: { user_id: string; endpoint: string; p256dh: string; auth: string; created_at?: string; failure_count?: number };
        Update: {
          user_id?: string; p256dh?: string; auth?: string; created_at?: string;
          last_success_at?: string | null; failure_count?: number;
        };
        Relationships: [];
      };
      workout_reports: {
        Row: WorkoutReportRow;
        Insert: { user_id: string; workout_id: string; connection_revision: string; available_at?: string };
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
      save_hevy_api_key: {
        Args: { p_user_id: string; p_encrypted_key: string; p_revision: string };
        Returns: unknown;
      };
      disconnect_hevy: { Args: { p_user_id: string }; Returns: undefined };
      begin_hevy_oauth: {
        Args: { p_user_id: string; p_state_hash: string; p_browser_hash: string };
        Returns: string;
      };
      consume_hevy_oauth_state: {
        Args: { p_user_id: string; p_state_hash: string; p_browser_hash: string };
        Returns: boolean;
      };
      complete_hevy_oauth: {
        Args: {
          p_user_id: string; p_state_hash: string; p_hevy_user_id: string;
          p_username: string; p_encrypted_oauth: string; p_expires_at: string;
        };
        Returns: string;
      };
      claim_hevy_oauth_refresh: { Args: RefreshOwner; Returns: string };
      finish_hevy_oauth_refresh: {
        Args: RefreshOwner & { p_encrypted_oauth: string; p_expires_at: string };
        Returns: boolean;
      };
      fail_hevy_oauth_refresh: { Args: RefreshOwner & { p_retryable: boolean }; Returns: boolean };
      reserve_hevy_request: { Args: Record<string, never>; Returns: number };
      reject_hevy_oauth_token: {
        Args: { p_user_id: string; p_revision: string; p_token_version: number };
        Returns: undefined;
      };
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
