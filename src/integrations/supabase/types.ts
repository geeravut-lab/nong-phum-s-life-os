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
      chat_messages: {
        Row: {
          action: Json | null
          content: string
          created_at: string
          id: string
          role: string
          user_id: string
        }
        Insert: {
          action?: Json | null
          content: string
          created_at?: string
          id?: string
          role: string
          user_id: string
        }
        Update: {
          action?: Json | null
          content?: string
          created_at?: string
          id?: string
          role?: string
          user_id?: string
        }
        Relationships: []
      }
      documents: {
        Row: {
          amount: number | null
          category: string
          counterparty: string | null
          created_at: string
          doc_date: string | null
          due_date: string | null
          extracted: Json
          family_id: string | null
          id: string
          is_shared: boolean
          mime_type: string | null
          status: string
          storage_path: string | null
          summary: string | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          amount?: number | null
          category?: string
          counterparty?: string | null
          created_at?: string
          doc_date?: string | null
          due_date?: string | null
          extracted?: Json
          family_id?: string | null
          id?: string
          is_shared?: boolean
          mime_type?: string | null
          status?: string
          storage_path?: string | null
          summary?: string | null
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number | null
          category?: string
          counterparty?: string | null
          created_at?: string
          doc_date?: string | null
          due_date?: string | null
          extracted?: Json
          family_id?: string | null
          id?: string
          is_shared?: boolean
          mime_type?: string | null
          status?: string
          storage_path?: string | null
          summary?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "documents_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      expenses: {
        Row: {
          amount: number
          category: string
          created_at: string
          due_date: string | null
          family_id: string | null
          id: string
          is_shared: boolean
          note: string | null
          source_document_id: string | null
          spent_on: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          amount?: number
          category?: string
          created_at?: string
          due_date?: string | null
          family_id?: string | null
          id?: string
          is_shared?: boolean
          note?: string | null
          source_document_id?: string | null
          spent_on?: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number
          category?: string
          created_at?: string
          due_date?: string | null
          family_id?: string | null
          id?: string
          is_shared?: boolean
          note?: string | null
          source_document_id?: string | null
          spent_on?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "expenses_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "expenses_source_document_id_fkey"
            columns: ["source_document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      families: {
        Row: {
          created_at: string
          id: string
          invite_code: string
          name: string
          owner_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          invite_code?: string
          name: string
          owner_id: string
        }
        Update: {
          created_at?: string
          id?: string
          invite_code?: string
          name?: string
          owner_id?: string
        }
        Relationships: []
      }
      family_members: {
        Row: {
          created_at: string
          display_name: string | null
          family_id: string
          id: string
          member_role: string
          user_id: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          family_id: string
          id?: string
          member_role?: string
          user_id: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          family_id?: string
          id?: string
          member_role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "family_members_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
        ]
      }
      helper_profiles: {
        Row: {
          area: string | null
          available_from: string | null
          available_to: string | null
          bio: string | null
          created_at: string
          display_name: string
          hourly_rate: number | null
          id: string
          is_active: boolean
          is_verified: boolean
          jobs_done: number
          lat: number | null
          lng: number | null
          rating: number
          skills: string[]
          updated_at: string
          user_id: string
        }
        Insert: {
          area?: string | null
          available_from?: string | null
          available_to?: string | null
          bio?: string | null
          created_at?: string
          display_name: string
          hourly_rate?: number | null
          id?: string
          is_active?: boolean
          is_verified?: boolean
          jobs_done?: number
          lat?: number | null
          lng?: number | null
          rating?: number
          skills?: string[]
          updated_at?: string
          user_id: string
        }
        Update: {
          area?: string | null
          available_from?: string | null
          available_to?: string | null
          bio?: string | null
          created_at?: string
          display_name?: string
          hourly_rate?: number | null
          id?: string
          is_active?: boolean
          is_verified?: boolean
          jobs_done?: number
          lat?: number | null
          lng?: number | null
          rating?: number
          skills?: string[]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      incomes: {
        Row: {
          amount: number
          category: string
          created_at: string
          family_id: string | null
          id: string
          is_shared: boolean
          note: string | null
          received_on: string
          source_document_id: string | null
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          amount?: number
          category?: string
          created_at?: string
          family_id?: string | null
          id?: string
          is_shared?: boolean
          note?: string | null
          received_on?: string
          source_document_id?: string | null
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          amount?: number
          category?: string
          created_at?: string
          family_id?: string | null
          id?: string
          is_shared?: boolean
          note?: string | null
          received_on?: string
          source_document_id?: string | null
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "incomes_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "incomes_source_document_id_fkey"
            columns: ["source_document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      job_offers: {
        Row: {
          created_at: string
          helper_id: string
          helper_user_id: string
          id: string
          job_id: string
          match_score: number | null
          message: string | null
          price: number | null
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          helper_id: string
          helper_user_id: string
          id?: string
          job_id: string
          match_score?: number | null
          message?: string | null
          price?: number | null
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          helper_id?: string
          helper_user_id?: string
          id?: string
          job_id?: string
          match_score?: number | null
          message?: string | null
          price?: number | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_offers_helper_id_fkey"
            columns: ["helper_id"]
            isOneToOne: false
            referencedRelation: "helper_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_offers_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      job_reviews: {
        Row: {
          comment: string | null
          created_at: string
          helper_id: string
          id: string
          job_id: string
          rating: number
          reviewer_id: string
        }
        Insert: {
          comment?: string | null
          created_at?: string
          helper_id: string
          id?: string
          job_id: string
          rating?: number
          reviewer_id: string
        }
        Update: {
          comment?: string | null
          created_at?: string
          helper_id?: string
          id?: string
          job_id?: string
          rating?: number
          reviewer_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "job_reviews_helper_id_fkey"
            columns: ["helper_id"]
            isOneToOne: false
            referencedRelation: "helper_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_reviews_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      jobs: {
        Row: {
          agreed_price: number | null
          ai_extract: Json
          assigned_helper_id: string | null
          budget_max: number | null
          budget_min: number | null
          category: string
          created_at: string
          description: string | null
          id: string
          lat: number | null
          lng: number | null
          location_text: string | null
          platform_fee: number | null
          scheduled_at: string | null
          status: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          agreed_price?: number | null
          ai_extract?: Json
          assigned_helper_id?: string | null
          budget_max?: number | null
          budget_min?: number | null
          category?: string
          created_at?: string
          description?: string | null
          id?: string
          lat?: number | null
          lng?: number | null
          location_text?: string | null
          platform_fee?: number | null
          scheduled_at?: string | null
          status?: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          agreed_price?: number | null
          ai_extract?: Json
          assigned_helper_id?: string | null
          budget_max?: number | null
          budget_min?: number | null
          category?: string
          created_at?: string
          description?: string | null
          id?: string
          lat?: number | null
          lng?: number | null
          location_text?: string | null
          platform_fee?: number | null
          scheduled_at?: string | null
          status?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "jobs_assigned_helper_id_fkey"
            columns: ["assigned_helper_id"]
            isOneToOne: false
            referencedRelation: "helper_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      platform_settings: {
        Row: {
          commission_rate: number
          created_at: string
          id: boolean
          revenue_mode: string
          service_fee: number
          updated_at: string
        }
        Insert: {
          commission_rate?: number
          created_at?: string
          id?: boolean
          revenue_mode?: string
          service_fee?: number
          updated_at?: string
        }
        Update: {
          commission_rate?: number
          created_at?: string
          id?: boolean
          revenue_mode?: string
          service_fee?: number
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          id: string
          language: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          id: string
          language?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          id?: string
          language?: string
          updated_at?: string
        }
        Relationships: []
      }
      reminders: {
        Row: {
          created_at: string
          due_at: string | null
          family_id: string | null
          id: string
          is_shared: boolean
          notes: string | null
          priority: string
          recurrence: string
          source_document_id: string | null
          status: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          due_at?: string | null
          family_id?: string | null
          id?: string
          is_shared?: boolean
          notes?: string | null
          priority?: string
          recurrence?: string
          source_document_id?: string | null
          status?: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          due_at?: string | null
          family_id?: string | null
          id?: string
          is_shared?: boolean
          notes?: string | null
          priority?: string
          recurrence?: string
          source_document_id?: string | null
          status?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reminders_family_id_fkey"
            columns: ["family_id"]
            isOneToOne: false
            referencedRelation: "families"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reminders_source_document_id_fkey"
            columns: ["source_document_id"]
            isOneToOne: false
            referencedRelation: "documents"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_family_member: {
        Args: { _family_id: string; _user_id: string }
        Returns: boolean
      }
    }
    Enums: {
      app_role: "admin" | "member"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
      app_role: ["admin", "member"],
    },
  },
} as const
