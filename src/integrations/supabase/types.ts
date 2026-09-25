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
      is_job_party: { Args: { p_job_id: string; p_uid: string }; Returns: boolean }
      is_blocked_by: { Args: { p_viewer: string; p_other: string }; Returns: boolean }
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

      app_notifications: {
        Row: {
          body: string
          created_at: string
          href: string | null
          id: string
          kind: string
          read_at: string | null
          ref_id: string | null
          ref_table: string | null
          title: string
          user_id: string
        }
        Insert: {
          body?: string
          created_at?: string
          href?: string | null
          id?: string
          kind?: string
          read_at?: string | null
          ref_id?: string | null
          ref_table?: string | null
          title?: string
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          href?: string | null
          id?: string
          kind?: string
          read_at?: string | null
          ref_id?: string | null
          ref_table?: string | null
          title?: string
          user_id?: string
        }
        Relationships: []
      }
      account_deletions: {
        Row: {
          aivora_user_id: string | null
          deleted_at: string
          display_name: string | null
          email: string | null
          id: string
          removed: Json
          requested_by: string
          user_id: string
        }
        Insert: {
          aivora_user_id?: string | null
          deleted_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
          removed?: Json
          requested_by?: string
          user_id: string
        }
        Update: {
          aivora_user_id?: string | null
          deleted_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
          removed?: Json
          requested_by?: string
          user_id?: string
        }
        Relationships: []
      }
      ai_events: {
        Row: {
          created_at: string
          error_code: string | null
          id: string
          message: string | null
          provider: string
          status: string
          task: string
        }
        Insert: {
          created_at?: string
          error_code?: string | null
          id?: string
          message?: string | null
          provider: string
          status: string
          task: string
        }
        Update: {
          created_at?: string
          error_code?: string | null
          id?: string
          message?: string | null
          provider?: string
          status?: string
          task?: string
        }
        Relationships: []
      }
      ai_settings: {
        Row: {
          default_provider: string | null
          fallback_provider: string | null
          id: boolean
          model_overrides: Json
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          default_provider?: string | null
          fallback_provider?: string | null
          id?: boolean
          model_overrides?: Json
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          default_provider?: string | null
          fallback_provider?: string | null
          id?: boolean
          model_overrides?: Json
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      aivora_links: {
        Row: {
          aivora_user_id: string
          created_at: string
          user_id: string
        }
        Insert: {
          aivora_user_id: string
          created_at?: string
          user_id: string
        }
        Update: {
          aivora_user_id?: string
          created_at?: string
          user_id?: string
        }
        Relationships: []
      }
      benefit_profiles: {
        Row: {
          birth_year: number | null
          created_at: string
          groups: string[]
          has_social_security: boolean
          has_welfare_card: boolean
          household_size: number | null
          id: string
          monthly_income: number | null
          occupation: string | null
          province: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          birth_year?: number | null
          created_at?: string
          groups?: string[]
          has_social_security?: boolean
          has_welfare_card?: boolean
          household_size?: number | null
          id?: string
          monthly_income?: number | null
          occupation?: string | null
          province?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          birth_year?: number | null
          created_at?: string
          groups?: string[]
          has_social_security?: boolean
          has_welfare_card?: boolean
          household_size?: number | null
          id?: string
          monthly_income?: number | null
          occupation?: string | null
          province?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      benefits: {
        Row: {
          category: string
          deadline_day: number | null
          deadline_month: number | null
          deadline_note: string | null
          source_name: string | null
          verified_at: string | null
          created_at: string
          eligibility: Json
          est_value: number | null
          how_to: string
          id: string
          is_active: boolean
          link: string | null
          provider: string
          slug: string
          summary: string
          title: string
          title_en: string | null
          updated_at: string
        }
        Insert: {
          category?: string
          created_at?: string
          eligibility?: Json
          est_value?: number | null
          how_to?: string
          id?: string
          is_active?: boolean
          link?: string | null
          provider?: string
          slug: string
          summary?: string
          title: string
          title_en?: string | null
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          eligibility?: Json
          est_value?: number | null
          how_to?: string
          id?: string
          is_active?: boolean
          link?: string | null
          provider?: string
          slug?: string
          summary?: string
          title?: string
          title_en?: string | null
          updated_at?: string
        }
        Relationships: []
      }
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
      cron_ticks: {
        Row: {
          error: string | null
          finished_at: string | null
          job: string
          started_at: string
          summary: Json | null
          tick: string
        }
        Insert: {
          error?: string | null
          finished_at?: string | null
          job: string
          started_at?: string
          summary?: Json | null
          tick: string
        }
        Update: {
          error?: string | null
          finished_at?: string | null
          job?: string
          started_at?: string
          summary?: Json | null
          tick?: string
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
          kind: string
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
          kind?: string
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
          kind?: string
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
      donation_settings: {
        Row: {
          enabled: boolean
          id: boolean
          promptpay_id: string | null
          purpose: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          enabled?: boolean
          id?: boolean
          promptpay_id?: string | null
          purpose?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          enabled?: boolean
          id?: boolean
          promptpay_id?: string | null
          purpose?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      donations: {
        Row: {
          amount_baht: number
          anonymous: boolean
          confirmed_at: string | null
          confirmed_by: string | null
          created_at: string
          display_name: string | null
          email: string | null
          id: string
          promptpay_id: string
          ref: string | null
          status: string
          user_id: string
        }
        Insert: {
          amount_baht: number
          anonymous?: boolean
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
          promptpay_id: string
          ref?: string | null
          status?: string
          user_id: string
        }
        Update: {
          amount_baht?: number
          anonymous?: boolean
          confirmed_at?: string | null
          confirmed_by?: string | null
          created_at?: string
          display_name?: string | null
          email?: string | null
          id?: string
          promptpay_id?: string
          ref?: string | null
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      expenses: {
        Row: {
          amount: number
          category: string
          community_note: string | null
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
          is_promoted: boolean
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
          is_promoted?: boolean
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
          is_promoted?: boolean
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
          community_note: string | null
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
          eta_hours: number | null
          expires_at: string | null
          helper_id: string
          helper_user_id: string
          id: string
          job_id: string
          match_score: number | null
          message: string | null
          parent_offer_id: string | null
          price: number | null
          reject_reason: string | null
          round: number
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          eta_hours?: number | null
          expires_at?: string | null
          helper_id: string
          helper_user_id: string
          id?: string
          job_id: string
          match_score?: number | null
          message?: string | null
          parent_offer_id?: string | null
          price?: number | null
          reject_reason?: string | null
          round?: number
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          eta_hours?: number | null
          expires_at?: string | null
          helper_id?: string
          helper_user_id?: string
          id?: string
          job_id?: string
          match_score?: number | null
          message?: string | null
          parent_offer_id?: string | null
          price?: number | null
          reject_reason?: string | null
          round?: number
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

      job_payments: {
        Row: {
          amount: number
          cancel_fee_pct: number
          confirmed_by: string | null
          created_at: string
          helper_id: string | null
          id: string
          job_id: string
          notes: string | null
          paid_at: string | null
          payer_id: string
          payer_ref: string | null
          payment_status: string
          payout_paid_at: string | null
          payout_slip_path: string | null
          payout_status: string | null
          platform_fee: number
          promptpay_id: string | null
          provider_amount: number
          released_at: string | null
          service_ended: boolean
          updated_at: string
          verified_at: string | null
        }
        Insert: {
          amount: number
          cancel_fee_pct?: number
          confirmed_by?: string | null
          created_at?: string
          helper_id?: string | null
          id?: string
          job_id: string
          notes?: string | null
          paid_at?: string | null
          payer_id: string
          payer_ref?: string | null
          payment_status?: string
          payout_paid_at?: string | null
          payout_slip_path?: string | null
          payout_status?: string | null
          platform_fee?: number
          promptpay_id?: string | null
          provider_amount?: number
          released_at?: string | null
          service_ended?: boolean
          updated_at?: string
          verified_at?: string | null
        }
        Update: {
          amount?: number
          cancel_fee_pct?: number
          confirmed_by?: string | null
          created_at?: string
          helper_id?: string | null
          id?: string
          job_id?: string
          notes?: string | null
          paid_at?: string | null
          payer_id?: string
          payer_ref?: string | null
          payment_status?: string
          payout_paid_at?: string | null
          payout_slip_path?: string | null
          payout_status?: string | null
          platform_fee?: number
          promptpay_id?: string | null
          provider_amount?: number
          released_at?: string | null
          service_ended?: boolean
          updated_at?: string
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "job_payments_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: true
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "job_payments_helper_id_fkey"
            columns: ["helper_id"]
            isOneToOne: false
            referencedRelation: "helper_profiles"
            referencedColumns: ["id"]
          },
        ]
      }

      job_messages: {
        Row: {
          body: string
          created_at: string
          id: string
          job_id: string
          sender_id: string
        }
        Insert: {
          body: string
          created_at?: string
          id?: string
          job_id: string
          sender_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          job_id?: string
          sender_id?: string
        }
        Relationships: []
      }
      job_evidence: {
        Row: {
          created_at: string
          id: string
          job_id: string
          mime_type: string | null
          note: string | null
          storage_path: string
          title: string
          uploader_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          job_id: string
          mime_type?: string | null
          note?: string | null
          storage_path: string
          title?: string
          uploader_id: string
        }
        Update: {
          created_at?: string
          id?: string
          job_id?: string
          mime_type?: string | null
          note?: string | null
          storage_path?: string
          title?: string
          uploader_id?: string
        }
        Relationships: []
      }
      user_blocks: {
        Row: {
          blocked_id: string
          blocker_id: string
          created_at: string
          id: string
          reason: string | null
        }
        Insert: {
          blocked_id: string
          blocker_id: string
          created_at?: string
          id?: string
          reason?: string | null
        }
        Update: {
          blocked_id?: string
          blocker_id?: string
          created_at?: string
          id?: string
          reason?: string | null
        }
        Relationships: []
      }
      safety_reports: {
        Row: {
          admin_notes: string | null
          created_at: string
          details: string | null
          id: string
          is_emergency: boolean
          job_id: string | null
          reason: string
          reporter_id: string
          status: string
          target_user_id: string | null
          updated_at: string
        }
        Insert: {
          admin_notes?: string | null
          created_at?: string
          details?: string | null
          id?: string
          is_emergency?: boolean
          job_id?: string | null
          reason: string
          reporter_id: string
          status?: string
          target_user_id?: string | null
          updated_at?: string
        }
        Update: {
          admin_notes?: string | null
          created_at?: string
          details?: string | null
          id?: string
          is_emergency?: boolean
          job_id?: string | null
          reason?: string
          reporter_id?: string
          status?: string
          target_user_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      decisions: {
        Row: {
          board: Json
          chosen_option_id: string | null
          context: Json
          created_at: string
          id: string
          outcome: string | null
          outcome_notes: string | null
          question: string
          recommendation: string | null
          status: string
          template: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          board?: Json
          chosen_option_id?: string | null
          context?: Json
          created_at?: string
          id?: string
          outcome?: string | null
          outcome_notes?: string | null
          question: string
          recommendation?: string | null
          status?: string
          template?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          board?: Json
          chosen_option_id?: string | null
          context?: Json
          created_at?: string
          id?: string
          outcome?: string | null
          outcome_notes?: string | null
          question?: string
          recommendation?: string | null
          status?: string
          template?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
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

      local_places: {
        Row: {
          address: string | null
          area: string | null
          category: string
          community_note: string | null
          created_at: string
          description: string
          id: string
          is_active: boolean
          is_promoted: boolean
          is_verified: boolean
          lat: number | null
          lng: number | null
          name: string
          name_en: string | null
          open_hours: Json
          owner_user_id: string | null
          phone: string | null
          price_level: number | null
          rating: number
          review_count: number
          tags: string[]
          updated_at: string
          website: string | null
        }
        Insert: {
          address?: string | null
          area?: string | null
          category?: string
          created_at?: string
          description?: string
          id?: string
          is_active?: boolean
          is_promoted?: boolean
          is_verified?: boolean
          lat?: number | null
          lng?: number | null
          name: string
          name_en?: string | null
          open_hours?: Json
          owner_user_id?: string | null
          phone?: string | null
          price_level?: number | null
          rating?: number
          review_count?: number
          tags?: string[]
          updated_at?: string
          website?: string | null
        }
        Update: {
          address?: string | null
          area?: string | null
          category?: string
          created_at?: string
          description?: string
          id?: string
          is_active?: boolean
          is_promoted?: boolean
          is_verified?: boolean
          lat?: number | null
          lng?: number | null
          name?: string
          name_en?: string | null
          open_hours?: Json
          owner_user_id?: string | null
          phone?: string | null
          price_level?: number | null
          rating?: number
          review_count?: number
          tags?: string[]
          updated_at?: string
          website?: string | null
        }
        Relationships: []
      }
      local_deals: {
        Row: {
          budget_max: number | null
          created_at: string
          description: string
          discount_label: string | null
          ends_at: string | null
          id: string
          is_active: boolean
          place_id: string
          starts_at: string | null
          title: string
          updated_at: string
        }
        Insert: {
          budget_max?: number | null
          created_at?: string
          description?: string
          discount_label?: string | null
          ends_at?: string | null
          id?: string
          is_active?: boolean
          place_id: string
          starts_at?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          budget_max?: number | null
          created_at?: string
          description?: string
          discount_label?: string | null
          ends_at?: string | null
          id?: string
          is_active?: boolean
          place_id?: string
          starts_at?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      place_reviews: {
        Row: {
          comment: string | null
          created_at: string
          id: string
          place_id: string
          rating: number
          user_id: string
        }
        Insert: {
          comment?: string | null
          created_at?: string
          id?: string
          place_id: string
          rating: number
          user_id: string
        }
        Update: {
          comment?: string | null
          created_at?: string
          id?: string
          place_id?: string
          rating?: number
          user_id?: string
        }
        Relationships: []
      }


      legacy_profiles: {
        Row: {
          body_donation: string
          consent_at: string | null
          created_at: string
          display_label: string
          notes: string
          organ_donation: string
          plan_code: string | null
          social_intent: string
          updated_at: string
          user_id: string
        }
        Insert: {
          body_donation?: string
          consent_at?: string | null
          created_at?: string
          display_label?: string
          notes?: string
          organ_donation?: string
          plan_code?: string | null
          social_intent?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          body_donation?: string
          consent_at?: string | null
          created_at?: string
          display_label?: string
          notes?: string
          organ_donation?: string
          plan_code?: string | null
          social_intent?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      legacy_contacts: {
        Row: {
          created_at: string
          email: string | null
          full_name: string
          id: string
          invite_status: string
          invite_token: string | null
          is_verifier: boolean
          line_id: string | null
          linked_user_id: string | null
          personal_message: string
          phone: string | null
          priority: number
          relation: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name: string
          id?: string
          invite_status?: string
          invite_token?: string | null
          is_verifier?: boolean
          line_id?: string | null
          linked_user_id?: string | null
          personal_message?: string
          phone?: string | null
          priority?: number
          relation?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string
          id?: string
          invite_status?: string
          invite_token?: string | null
          is_verifier?: boolean
          line_id?: string | null
          linked_user_id?: string | null
          personal_message?: string
          phone?: string | null
          priority?: number
          relation?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      legacy_assets: {
        Row: {
          beneficiary_hint: string | null
          created_at: string
          details: string
          estimated_value: number | null
          id: string
          is_liability: boolean
          kind: string
          location_hint: string | null
          sort_order: number
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          beneficiary_hint?: string | null
          created_at?: string
          details?: string
          estimated_value?: number | null
          id?: string
          is_liability?: boolean
          kind?: string
          location_hint?: string | null
          sort_order?: number
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          beneficiary_hint?: string | null
          created_at?: string
          details?: string
          estimated_value?: number | null
          id?: string
          is_liability?: boolean
          kind?: string
          location_hint?: string | null
          sort_order?: number
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      legacy_wishes: {
        Row: {
          body: string
          created_at: string
          id: string
          section: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          body?: string
          created_at?: string
          id?: string
          section?: string
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          body?: string
          created_at?: string
          id?: string
          section?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      legacy_checklist: {
        Row: {
          assignee_hint: string | null
          created_at: string
          id: string
          is_done: boolean
          notes: string
          sort_order: number
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          assignee_hint?: string | null
          created_at?: string
          id?: string
          is_done?: boolean
          notes?: string
          sort_order?: number
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          assignee_hint?: string | null
          created_at?: string
          id?: string
          is_done?: boolean
          notes?: string
          sort_order?: number
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }

      post_life_actions: {
        Row: {
          id: string
          case_id: string
          subject_user_id: string
          phase: string
          sort_order: number
          title: string
          description: string
          status: string
          done_at: string | null
          done_by: string | null
          note: string
          created_at: string
          updated_at: string
        }
        Insert: {
          id?: string
          case_id: string
          subject_user_id: string
          phase: string
          sort_order?: number
          title: string
          description?: string
          status?: string
          done_at?: string | null
          done_by?: string | null
          note?: string
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          case_id?: string
          subject_user_id?: string
          phase?: string
          sort_order?: number
          title?: string
          description?: string
          status?: string
          done_at?: string | null
          done_by?: string | null
          note?: string
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }


      death_notify_messages: {
        Row: {
          id: string
          case_id: string
          contact_id: string | null
          contact_name: string
          channel_hint: string
          message_body: string
          memorial_url: string | null
          created_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          case_id: string
          contact_id?: string | null
          contact_name: string
          channel_hint?: string
          message_body: string
          memorial_url?: string | null
          created_by?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          case_id?: string
          contact_id?: string | null
          contact_name?: string
          channel_hint?: string
          message_body?: string
          memorial_url?: string | null
          created_by?: string | null
          created_at?: string
        }
        Relationships: []
      }

      death_cases: {
        Row: {
          admin_notes: string | null
          confirmation_count: number
          confirmed_at: string | null
          created_at: string
          id: string
          rejected_at: string | null
          report_note: string
          reported_by: string | null
          required_confirmations: number
          status: string
          subject_user_id: string
          updated_at: string
        }
        Insert: {
          admin_notes?: string | null
          confirmation_count?: number
          confirmed_at?: string | null
          created_at?: string
          id?: string
          rejected_at?: string | null
          report_note?: string
          reported_by?: string | null
          required_confirmations?: number
          status?: string
          subject_user_id: string
          updated_at?: string
        }
        Update: {
          admin_notes?: string | null
          confirmation_count?: number
          confirmed_at?: string | null
          created_at?: string
          id?: string
          rejected_at?: string | null
          report_note?: string
          reported_by?: string | null
          required_confirmations?: number
          status?: string
          subject_user_id?: string
          updated_at?: string
        }
        Relationships: []
      }
      death_confirmations: {
        Row: {
          case_id: string
          confirmer_name: string
          confirmer_user_id: string
          created_at: string
          decision: string
          id: string
          note: string
        }
        Insert: {
          case_id: string
          confirmer_name?: string
          confirmer_user_id: string
          created_at?: string
          decision: string
          id?: string
          note?: string
        }
        Update: {
          case_id?: string
          confirmer_name?: string
          confirmer_user_id?: string
          created_at?: string
          decision?: string
          id?: string
          note?: string
        }
        Relationships: []
      }
      memorials: {
        Row: {
          cover_url: string | null
          created_at: string
          created_by: string | null
          death_case_id: string | null
          id: string
          is_public: boolean
          schedule_text: string
          share_token: string | null
          story: string
          subject_user_id: string
          title: string
          updated_at: string
          video_url: string | null
        }
        Insert: {
          cover_url?: string | null
          created_at?: string
          created_by?: string | null
          death_case_id?: string | null
          id?: string
          is_public?: boolean
          schedule_text?: string
          share_token?: string | null
          story?: string
          subject_user_id: string
          title?: string
          updated_at?: string
          video_url?: string | null
        }
        Update: {
          cover_url?: string | null
          created_at?: string
          created_by?: string | null
          death_case_id?: string | null
          id?: string
          is_public?: boolean
          schedule_text?: string
          share_token?: string | null
          story?: string
          subject_user_id?: string
          title?: string
          updated_at?: string
          video_url?: string | null
        }
        Relationships: []
      }
      memorial_messages: {
        Row: {
          author_name: string
          body: string
          created_at: string
          created_by: string | null
          id: string
          memorial_id: string
        }
        Insert: {
          author_name: string
          body: string
          created_at?: string
          created_by?: string | null
          id?: string
          memorial_id: string
        }
        Update: {
          author_name?: string
          body?: string
          created_at?: string
          created_by?: string | null
          id?: string
          memorial_id?: string
        }
        Relationships: []
      }
      digital_wreaths: {
        Row: {
          amount: number
          created_at: string
          from_name: string
          id: string
          memorial_id: string
          message: string
          payer_ref: string | null
          payment_status: string
          promptpay_id: string | null
        }
        Insert: {
          amount?: number
          created_at?: string
          from_name: string
          id?: string
          memorial_id: string
          message?: string
          payer_ref?: string | null
          payment_status?: string
          promptpay_id?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          from_name?: string
          id?: string
          memorial_id?: string
          message?: string
          payer_ref?: string | null
          payment_status?: string
          promptpay_id?: string | null
        }
        Relationships: []
      }
      funeral_plans: {
        Row: {
          admin_notes: string | null
          created_at: string
          death_case_id: string | null
          id: string
          input: Json
          packages: Json
          selected_package: string | null
          status: string
          total_budget: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          admin_notes?: string | null
          created_at?: string
          death_case_id?: string | null
          id?: string
          input?: Json
          packages?: Json
          selected_package?: string | null
          status?: string
          total_budget?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          admin_notes?: string | null
          created_at?: string
          death_case_id?: string | null
          id?: string
          input?: Json
          packages?: Json
          selected_package?: string | null
          status?: string
          total_budget?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      funeral_payments: {
        Row: {
          amount: number
          created_at: string
          id: string
          installments: number
          paid_at: string | null
          payer_id: string
          payer_ref: string | null
          payment_status: string
          plan_id: string
          promptpay_id: string | null
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          installments?: number
          paid_at?: string | null
          payer_id: string
          payer_ref?: string | null
          payment_status?: string
          plan_id: string
          promptpay_id?: string | null
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          installments?: number
          paid_at?: string | null
          payer_id?: string
          payer_ref?: string | null
          payment_status?: string
          plan_id?: string
          promptpay_id?: string | null
        }
        Relationships: []
      }
      jobs: {
        Row: {
          agreed_price: number | null
          ai_extract: Json
          assigned_helper_id: string | null
          booked_at: string | null
          booking_notes: string | null
          budget_max: number | null
          budget_min: number | null
          category: string
          community_note: string | null
          created_at: string
          description: string | null
          id: string
          lat: number | null
          lng: number | null
          location_text: string | null
          no_show: boolean
          payment_status: string | null
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
          booked_at?: string | null
          booking_notes?: string | null
          budget_max?: number | null
          budget_min?: number | null
          category?: string
          created_at?: string
          description?: string | null
          id?: string
          lat?: number | null
          lng?: number | null
          location_text?: string | null
          payment_status?: string | null
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
          booked_at?: string | null
          booking_notes?: string | null
          budget_max?: number | null
          budget_min?: number | null
          category?: string
          created_at?: string
          description?: string | null
          id?: string
          lat?: number | null
          lng?: number | null
          location_text?: string | null
          payment_status?: string | null
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
          {
            foreignKeyName: "job_payments_job_id_fkey"
            columns: ["id"]
            isOneToOne: true
            referencedRelation: "job_payments"
            referencedColumns: ["job_id"]
          },
        ]
      }
      line_link_states: {
        Row: {
          created_at: string
          expires_at: string
          state: string
          user_id: string
        }
        Insert: {
          created_at?: string
          expires_at: string
          state: string
          user_id: string
        }
        Update: {
          created_at?: string
          expires_at?: string
          state?: string
          user_id?: string
        }
        Relationships: []
      }
      line_links: {
        Row: {
          blocked_at: string | null
          display_name: string | null
          friend_checked_at: string | null
          is_friend: boolean
          line_user_id: string
          linked_at: string
          picture_url: string | null
          user_id: string
        }
        Insert: {
          blocked_at?: string | null
          display_name?: string | null
          friend_checked_at?: string | null
          is_friend?: boolean
          line_user_id: string
          linked_at?: string
          picture_url?: string | null
          user_id: string
        }
        Update: {
          blocked_at?: string | null
          display_name?: string | null
          friend_checked_at?: string | null
          is_friend?: boolean
          line_user_id?: string
          linked_at?: string
          picture_url?: string | null
          user_id?: string
        }
        Relationships: []
      }
      notification_log: {
        Row: {
          attempts: number
          channel: string
          created_at: string
          digest_date: string | null
          due_at: string | null
          error: string | null
          id: string
          kind: string
          reminder_id: string | null
          reminder_ids: string[]
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          attempts?: number
          channel: string
          created_at?: string
          digest_date?: string | null
          due_at?: string | null
          error?: string | null
          id?: string
          kind: string
          reminder_id?: string | null
          reminder_ids?: string[]
          status: string
          updated_at?: string
          user_id: string
        }
        Update: {
          attempts?: number
          channel?: string
          created_at?: string
          digest_date?: string | null
          due_at?: string | null
          error?: string | null
          id?: string
          kind?: string
          reminder_id?: string | null
          reminder_ids?: string[]
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      notification_settings: {
        Row: {
          id: boolean
          line_digest_hour: number
          line_digest_reserve: number
          line_halt_reason: string | null
          line_halted_until: string | null
          line_monthly_cap: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          id?: boolean
          line_digest_hour?: number
          line_digest_reserve?: number
          line_halt_reason?: string | null
          line_halted_until?: string | null
          line_monthly_cap?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          id?: boolean
          line_digest_hour?: number
          line_digest_reserve?: number
          line_halt_reason?: string | null
          line_halted_until?: string | null
          line_monthly_cap?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      platform_settings: {
        Row: {
          cancel_fee_pct: number
          commission_rate: number
          created_at: string
          escrow_enabled: boolean
          funeral_promptpay_id: string | null
          helpme_promptpay_id: string | null
          id: boolean
          revenue_mode: string
          service_fee: number
          updated_at: string
        }
        Insert: {
          cancel_fee_pct?: number
          commission_rate?: number
          created_at?: string
          escrow_enabled?: boolean
          helpme_promptpay_id?: string | null
          id?: boolean
          revenue_mode?: string
          service_fee?: number
          updated_at?: string
        }
        Update: {
          cancel_fee_pct?: number
          commission_rate?: number
          created_at?: string
          escrow_enabled?: boolean
          helpme_promptpay_id?: string | null
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
          last_completed_at: string | null
          notes: string | null
          notified_at: string | null
          notify_at: string | null
          notify_attempts: number
          notify_error: string | null
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
          last_completed_at?: string | null
          notes?: string | null
          notified_at?: string | null
          notify_at?: string | null
          notify_attempts?: number
          notify_error?: string | null
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
          last_completed_at?: string | null
          notes?: string | null
          notified_at?: string | null
          notify_at?: string | null
          notify_attempts?: number
          notify_error?: string | null
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
      user_benefits: {
        Row: {
          benefit_id: string
          deadline_at: string | null
          notes: string | null
          remind: boolean
          created_at: string
          id: string
          note: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          benefit_id: string
          created_at?: string
          deadline_at?: string | null
          id?: string
          note?: string | null
          notes?: string | null
          remind?: boolean
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          benefit_id?: string
          created_at?: string
          deadline_at?: string | null
          id?: string
          notes?: string | null
          remind?: boolean
          note?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_benefits_benefit_id_fkey"
            columns: ["benefit_id"]
            isOneToOne: false
            referencedRelation: "benefits"
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
      is_job_party: { Args: { p_job_id: string; p_uid: string }; Returns: boolean }
      is_blocked_by: { Args: { p_viewer: string; p_other: string }; Returns: boolean }
      legacy_seed_checklist: { Args: { p_user_id: string }; Returns: number }
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      app_role: ["admin", "member"],
    },
  },
} as const
