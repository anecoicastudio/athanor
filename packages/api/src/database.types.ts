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
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      dream_milestones: {
        Row: {
          body: string
          created_at: string
          deleted_at: string | null
          dream_id: string
          id: string
          position: number
          status: Database["public"]["Enums"]["milestone_status"]
          updated_at: string
        }
        Insert: {
          body: string
          created_at?: string
          deleted_at?: string | null
          dream_id: string
          id?: string
          position?: number
          status?: Database["public"]["Enums"]["milestone_status"]
          updated_at?: string
        }
        Update: {
          body?: string
          created_at?: string
          deleted_at?: string | null
          dream_id?: string
          id?: string
          position?: number
          status?: Database["public"]["Enums"]["milestone_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dream_milestones_dream_id_fkey"
            columns: ["dream_id"]
            isOneToOne: false
            referencedRelation: "dreams"
            referencedColumns: ["id"]
          },
        ]
      }
      dreams: {
        Row: {
          created_at: string
          deleted_at: string | null
          id: string
          profile_id: string
          status: string
          text: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          profile_id: string
          status?: string
          text: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          profile_id?: string
          status?: string
          text?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "dreams_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      email_waitlist: {
        Row: {
          created_at: string
          email: string
          id: string
          locale: string
          source: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          locale?: string
          source?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          locale?: string
          source?: string | null
        }
        Relationships: []
      }
      milestone_helps: {
        Row: {
          created_at: string
          deleted_at: string | null
          helper_id: string
          id: string
          link: string | null
          message: string | null
          milestone_id: string
          status: Database["public"]["Enums"]["help_status"]
          type: Database["public"]["Enums"]["help_type"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          helper_id: string
          id?: string
          link?: string | null
          message?: string | null
          milestone_id: string
          status?: Database["public"]["Enums"]["help_status"]
          type: Database["public"]["Enums"]["help_type"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          helper_id?: string
          id?: string
          link?: string | null
          message?: string | null
          milestone_id?: string
          status?: Database["public"]["Enums"]["help_status"]
          type?: Database["public"]["Enums"]["help_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "milestone_helps_helper_id_fkey"
            columns: ["helper_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "milestone_helps_milestone_id_fkey"
            columns: ["milestone_id"]
            isOneToOne: false
            referencedRelation: "dream_milestones"
            referencedColumns: ["id"]
          },
        ]
      }
      moments: {
        Row: {
          caption: string | null
          created_at: string
          deleted_at: string | null
          duration_s: number | null
          height: number | null
          id: string
          kind: Database["public"]["Enums"]["moment_kind"]
          media_path: string
          owner_id: string
          thumb_path: string | null
          updated_at: string
          width: number | null
        }
        Insert: {
          caption?: string | null
          created_at?: string
          deleted_at?: string | null
          duration_s?: number | null
          height?: number | null
          id?: string
          kind: Database["public"]["Enums"]["moment_kind"]
          media_path: string
          owner_id: string
          thumb_path?: string | null
          updated_at?: string
          width?: number | null
        }
        Update: {
          caption?: string | null
          created_at?: string
          deleted_at?: string | null
          duration_s?: number | null
          height?: number | null
          id?: string
          kind?: Database["public"]["Enums"]["moment_kind"]
          media_path?: string
          owner_id?: string
          thumb_path?: string | null
          updated_at?: string
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "moments_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      post_comments: {
        Row: {
          author_id: string
          body: string
          created_at: string
          deleted_at: string | null
          id: string
          parent_id: string | null
          post_id: string
          updated_at: string
        }
        Insert: {
          author_id: string
          body: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          parent_id?: string | null
          post_id: string
          updated_at?: string
        }
        Update: {
          author_id?: string
          body?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          parent_id?: string | null
          post_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_comments_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_comments_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "post_comments"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_comments_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
        ]
      }
      post_media: {
        Row: {
          created_at: string
          duration_s: number | null
          height: number | null
          id: string
          kind: Database["public"]["Enums"]["media_kind"]
          position: number
          post_id: string
          storage_path: string
          updated_at: string
          width: number | null
        }
        Insert: {
          created_at?: string
          duration_s?: number | null
          height?: number | null
          id?: string
          kind: Database["public"]["Enums"]["media_kind"]
          position?: number
          post_id: string
          storage_path: string
          updated_at?: string
          width?: number | null
        }
        Update: {
          created_at?: string
          duration_s?: number | null
          height?: number | null
          id?: string
          kind?: Database["public"]["Enums"]["media_kind"]
          position?: number
          post_id?: string
          storage_path?: string
          updated_at?: string
          width?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "post_media_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
        ]
      }
      post_reactions: {
        Row: {
          created_at: string
          id: string
          person_id: string
          post_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          person_id: string
          post_id: string
        }
        Update: {
          created_at?: string
          id?: string
          person_id?: string
          post_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "post_reactions_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "post_reactions_post_id_fkey"
            columns: ["post_id"]
            isOneToOne: false
            referencedRelation: "posts"
            referencedColumns: ["id"]
          },
        ]
      }
      posts: {
        Row: {
          author_id: string
          body: string
          category: Database["public"]["Enums"]["post_category"]
          created_at: string
          deleted_at: string | null
          id: string
          is_step: boolean
          tags: string[]
          type: Database["public"]["Enums"]["post_type"]
          updated_at: string
        }
        Insert: {
          author_id: string
          body: string
          category: Database["public"]["Enums"]["post_category"]
          created_at?: string
          deleted_at?: string | null
          id?: string
          is_step?: boolean
          tags?: string[]
          type?: Database["public"]["Enums"]["post_type"]
          updated_at?: string
        }
        Update: {
          author_id?: string
          body?: string
          category?: Database["public"]["Enums"]["post_category"]
          created_at?: string
          deleted_at?: string | null
          id?: string
          is_step?: boolean
          tags?: string[]
          type?: Database["public"]["Enums"]["post_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "posts_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          bio: string | null
          created_at: string
          handle: string | null
          id: string
          identity_tags: string[]
          locale: string
          seeking: string[]
          updated_at: string
          visibility: Json
        }
        Insert: {
          bio?: string | null
          created_at?: string
          handle?: string | null
          id: string
          identity_tags?: string[]
          locale?: string
          seeking?: string[]
          updated_at?: string
          visibility?: Json
        }
        Update: {
          bio?: string | null
          created_at?: string
          handle?: string | null
          id?: string
          identity_tags?: string[]
          locale?: string
          seeking?: string[]
          updated_at?: string
          visibility?: Json
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      confirm_milestone_help: {
        Args: { p_help_id: string }
        Returns: undefined
      }
      owns_dream: { Args: { p_dream_id: string }; Returns: boolean }
      owns_help_milestone: {
        Args: { p_milestone_id: string }
        Returns: boolean
      }
      post_reaction_count: { Args: { p_post_id: string }; Returns: number }
    }
    Enums: {
      help_status: "offered" | "accepted" | "declined" | "completed"
      help_type: "skill" | "connection" | "opportunity"
      media_kind: "image" | "video" | "audio"
      milestone_status: "open" | "in_progress" | "done"
      moment_kind: "photo" | "video"
      post_category: "business" | "human" | "creative" | "evolution"
      post_type: "text" | "image" | "video" | "audio"
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      help_status: ["offered", "accepted", "declined", "completed"],
      help_type: ["skill", "connection", "opportunity"],
      media_kind: ["image", "video", "audio"],
      milestone_status: ["open", "in_progress", "done"],
      moment_kind: ["photo", "video"],
      post_category: ["business", "human", "creative", "evolution"],
      post_type: ["text", "image", "video", "audio"],
    },
  },
} as const
