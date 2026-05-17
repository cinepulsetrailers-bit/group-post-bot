export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      bridge_config: {
        Row: {
          base_url: string
          shared_secret: string
          updated_at: string
          user_id: string
          webhook_secret: string
        }
        Insert: {
          base_url?: string
          shared_secret?: string
          updated_at?: string
          user_id: string
          webhook_secret?: string
        }
        Update: {
          base_url?: string
          shared_secret?: string
          updated_at?: string
          user_id?: string
          webhook_secret?: string
        }
        Relationships: []
      }
      groups: {
        Row: {
          id: string
          is_selected: boolean
          synced_at: string
          tg_chat_id: number
          title: string
          user_id: string
          username: string | null
        }
        Insert: {
          id?: string
          is_selected?: boolean
          synced_at?: string
          tg_chat_id: number
          title: string
          user_id: string
          username?: string | null
        }
        Update: {
          id?: string
          is_selected?: boolean
          synced_at?: string
          tg_chat_id?: number
          title?: string
          user_id?: string
          username?: string | null
        }
        Relationships: []
      }
      messages: {
        Row: {
          chat_title: string | null
          created_at: string
          direction: string
          from_id: number | null
          from_name: string | null
          id: string
          media_url: string | null
          read_at: string | null
          reply_to_tg_id: number | null
          text: string | null
          tg_chat_id: number
          tg_message_id: number
          user_id: string
        }
        Insert: {
          chat_title?: string | null
          created_at?: string
          direction: string
          from_id?: number | null
          from_name?: string | null
          id?: string
          media_url?: string | null
          read_at?: string | null
          reply_to_tg_id?: number | null
          text?: string | null
          tg_chat_id: number
          tg_message_id: number
          user_id: string
        }
        Update: {
          chat_title?: string | null
          created_at?: string
          direction?: string
          from_id?: number | null
          from_name?: string | null
          id?: string
          media_url?: string | null
          read_at?: string | null
          reply_to_tg_id?: number | null
          text?: string | null
          tg_chat_id?: number
          tg_message_id?: number
          user_id?: string
        }
        Relationships: []
      }
      post_targets: {
        Row: {
          error: string | null
          group_id: string
          id: string
          post_id: string
          sent_at: string | null
          status: string
          tg_chat_id: number
          tg_message_id: number | null
          user_id: string
        }
        Insert: {
          error?: string | null
          group_id: string
          id?: string
          post_id: string
          sent_at?: string | null
          status?: string
          tg_chat_id: number
          tg_message_id?: number | null
          user_id: string
        }
        Update: {
          error?: string | null
          group_id?: string
          id?: string
          post_id?: string
          sent_at?: string | null
          status?: string
          tg_chat_id?: number
          tg_message_id?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_targets_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_targets_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
        ]
      }
      posts: {
        Row: {
          body: string
          created_at: string
          id: string
          media_type: string | null
          media_url: string | null
          scheduled_at: string | null
          sent_at: string | null
          status: Database["public"]["Enums"]["post_status"]
          user_id: string
        }
        Insert: {
          body?: string
          created_at?: string
          id?: string
          media_type?: string | null
          media_url?: string | null
          scheduled_at?: string | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["post_status"]
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          media_type?: string | null
          media_url?: string | null
          scheduled_at?: string | null
          sent_at?: string | null
          status?: Database["public"]["Enums"]["post_status"]
          user_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          id: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          id: string
        }
        Update: {
          created_at?: string
          email?: string | null
          id?: string
        }
        Relationships: []
      }
      reactions: {
        Row: {
          action: string
          chat_title: string | null
          created_at: string
          emoji: string
          from_id: number | null
          from_name: string | null
          id: string
          tg_chat_id: number
          tg_message_id: number
          user_id: string
        }
        Insert: {
          action?: string
          chat_title?: string | null
          created_at?: string
          emoji: string
          from_id?: number | null
          from_name?: string | null
          id?: string
          tg_chat_id: number
          tg_message_id: number
          user_id: string
        }
        Update: {
          action?: string
          chat_title?: string | null
          created_at?: string
          emoji?: string
          from_id?: number | null
          from_name?: string | null
          id?: string
          tg_chat_id?: number
          tg_message_id?: number
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      post_status: "draft" | "queued" | "sending" | "sent" | "failed"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      post_status: ["draft", "queued", "sending", "sent", "failed"],
    },
  },
} as const
