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
    PostgrestVersion: "14.15"
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
      athanor_days_interest: {
        Row: {
          created_at: string
          edition: string | null
          id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          edition?: string | null
          id?: string
          user_id: string
        }
        Update: {
          created_at?: string
          edition?: string | null
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "athanor_days_interest_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "entitlements"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "athanor_days_interest_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor_id: string
          created_at: string
          id: string
          penalty_points: number | null
          reason: string | null
          report_id: string
        }
        Insert: {
          action: string
          actor_id: string
          created_at?: string
          id?: string
          penalty_points?: number | null
          reason?: string | null
          report_id: string
        }
        Update: {
          action?: string
          actor_id?: string
          created_at?: string
          id?: string
          penalty_points?: number | null
          reason?: string | null
          report_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "entitlements"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "audit_log_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_log_report_id_fkey"
            columns: ["report_id"]
            isOneToOne: false
            referencedRelation: "reports"
            referencedColumns: ["id"]
          },
        ]
      }
      aura_events: {
        Row: {
          counterparty_id: string | null
          created_at: string
          id: string
          points: number
          profile_id: string
          reason: Json | null
          ref_id: string | null
          type: string
        }
        Insert: {
          counterparty_id?: string | null
          created_at?: string
          id?: string
          points: number
          profile_id: string
          reason?: Json | null
          ref_id?: string | null
          type: string
        }
        Update: {
          counterparty_id?: string | null
          created_at?: string
          id?: string
          points?: number
          profile_id?: string
          reason?: Json | null
          ref_id?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "aura_events_counterparty_id_fkey"
            columns: ["counterparty_id"]
            isOneToOne: false
            referencedRelation: "entitlements"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "aura_events_counterparty_id_fkey"
            columns: ["counterparty_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "aura_events_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "entitlements"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "aura_events_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      aura_scores: {
        Row: {
          breakdown: Json
          computed_at: string
          last_qualifying_action_at: string | null
          peak_score: number
          profile_id: string
          score: number
        }
        Insert: {
          breakdown?: Json
          computed_at?: string
          last_qualifying_action_at?: string | null
          peak_score?: number
          profile_id: string
          score?: number
        }
        Update: {
          breakdown?: Json
          computed_at?: string
          last_qualifying_action_at?: string | null
          peak_score?: number
          profile_id?: string
          score?: number
        }
        Relationships: [
          {
            foreignKeyName: "aura_scores_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "entitlements"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "aura_scores_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      blocks: {
        Row: {
          blocked_id: string
          blocker_id: string
          created_at: string
          id: string
        }
        Insert: {
          blocked_id: string
          blocker_id?: string
          created_at?: string
          id?: string
        }
        Update: {
          blocked_id?: string
          blocker_id?: string
          created_at?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "blocks_blocked_id_fkey"
            columns: ["blocked_id"]
            isOneToOne: false
            referencedRelation: "entitlements"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "blocks_blocked_id_fkey"
            columns: ["blocked_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "blocks_blocker_id_fkey"
            columns: ["blocker_id"]
            isOneToOne: false
            referencedRelation: "entitlements"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "blocks_blocker_id_fkey"
            columns: ["blocker_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      candidacy_votes: {
        Row: {
          candidacy_id: string
          created_at: string
          edition_id: string
          id: string
          voter_id: string
          weight: number
        }
        Insert: {
          candidacy_id: string
          created_at?: string
          edition_id: string
          id?: string
          voter_id: string
          weight?: number
        }
        Update: {
          candidacy_id?: string
          created_at?: string
          edition_id?: string
          id?: string
          voter_id?: string
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "candidacy_votes_candidacy_id_fkey"
            columns: ["candidacy_id"]
            isOneToOne: false
            referencedRelation: "dream_candidacies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "candidacy_votes_candidacy_id_fkey"
            columns: ["candidacy_id"]
            isOneToOne: false
            referencedRelation: "fund_candidate_cards"
            referencedColumns: ["candidacy_id"]
          },
          {
            foreignKeyName: "candidacy_votes_edition_id_fkey"
            columns: ["edition_id"]
            isOneToOne: false
            referencedRelation: "fund_editions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "candidacy_votes_voter_id_fkey"
            columns: ["voter_id"]
            isOneToOne: false
            referencedRelation: "entitlements"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "candidacy_votes_voter_id_fkey"
            columns: ["voter_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      circle_memberships: {
        Row: {
          created_at: string
          current_period_end: string | null
          founding_member: boolean
          id: string
          plan: string
          profile_id: string
          status: string
          stripe_customer_id: string
          stripe_subscription_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          current_period_end?: string | null
          founding_member?: boolean
          id?: string
          plan: string
          profile_id: string
          status: string
          stripe_customer_id: string
          stripe_subscription_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          current_period_end?: string | null
          founding_member?: boolean
          id?: string
          plan?: string
          profile_id?: string
          status?: string
          stripe_customer_id?: string
          stripe_subscription_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "circle_memberships_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "entitlements"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "circle_memberships_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      connection_requests: {
        Row: {
          addressee_id: string
          created_at: string
          id: string
          requester_id: string
          responded_at: string | null
          status: Database["public"]["Enums"]["connection_status"]
          updated_at: string
        }
        Insert: {
          addressee_id: string
          created_at?: string
          id?: string
          requester_id: string
          responded_at?: string | null
          status?: Database["public"]["Enums"]["connection_status"]
          updated_at?: string
        }
        Update: {
          addressee_id?: string
          created_at?: string
          id?: string
          requester_id?: string
          responded_at?: string | null
          status?: Database["public"]["Enums"]["connection_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "connection_requests_addressee_id_fkey"
            columns: ["addressee_id"]
            isOneToOne: false
            referencedRelation: "entitlements"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "connection_requests_addressee_id_fkey"
            columns: ["addressee_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "connection_requests_requester_id_fkey"
            columns: ["requester_id"]
            isOneToOne: false
            referencedRelation: "entitlements"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "connection_requests_requester_id_fkey"
            columns: ["requester_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      connections: {
        Row: {
          created_at: string
          id: string
          profile_a: string
          profile_b: string
          source_request_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          profile_a: string
          profile_b: string
          source_request_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          profile_a?: string
          profile_b?: string
          source_request_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "connections_profile_a_fkey"
            columns: ["profile_a"]
            isOneToOne: false
            referencedRelation: "entitlements"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "connections_profile_a_fkey"
            columns: ["profile_a"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "connections_profile_b_fkey"
            columns: ["profile_b"]
            isOneToOne: false
            referencedRelation: "entitlements"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "connections_profile_b_fkey"
            columns: ["profile_b"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "connections_source_request_id_fkey"
            columns: ["source_request_id"]
            isOneToOne: false
            referencedRelation: "connection_requests"
            referencedColumns: ["id"]
          },
        ]
      }
      consent: {
        Row: {
          created_at: string
          granted: boolean
          granted_at: string
          id: string
          kind: string
          profile_id: string
          source: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          granted: boolean
          granted_at?: string
          id?: string
          kind: string
          profile_id: string
          source: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          granted?: boolean
          granted_at?: string
          id?: string
          kind?: string
          profile_id?: string
          source?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "consent_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "entitlements"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "consent_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      conversations: {
        Row: {
          created_at: string
          created_from: Database["public"]["Enums"]["conversation_source"]
          id: string
          last_message_at: string
          last_message_preview: string | null
          participant_a: string
          participant_b: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_from?: Database["public"]["Enums"]["conversation_source"]
          id?: string
          last_message_at?: string
          last_message_preview?: string | null
          participant_a: string
          participant_b: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_from?: Database["public"]["Enums"]["conversation_source"]
          id?: string
          last_message_at?: string
          last_message_preview?: string | null
          participant_a?: string
          participant_b?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversations_participant_a_fkey"
            columns: ["participant_a"]
            isOneToOne: false
            referencedRelation: "entitlements"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "conversations_participant_a_fkey"
            columns: ["participant_a"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversations_participant_b_fkey"
            columns: ["participant_b"]
            isOneToOne: false
            referencedRelation: "entitlements"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "conversations_participant_b_fkey"
            columns: ["participant_b"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      dream_candidacies: {
        Row: {
          category: string | null
          city: string | null
          created_at: string
          deleted_at: string | null
          edition_id: string
          goal: string
          id: string
          impact: string
          plan: string
          profile_id: string
          status: string
          story: string
          thumb_path: string | null
          updated_at: string
          video_url: string
        }
        Insert: {
          category?: string | null
          city?: string | null
          created_at?: string
          deleted_at?: string | null
          edition_id: string
          goal: string
          id?: string
          impact: string
          plan: string
          profile_id: string
          status?: string
          story: string
          thumb_path?: string | null
          updated_at?: string
          video_url: string
        }
        Update: {
          category?: string | null
          city?: string | null
          created_at?: string
          deleted_at?: string | null
          edition_id?: string
          goal?: string
          id?: string
          impact?: string
          plan?: string
          profile_id?: string
          status?: string
          story?: string
          thumb_path?: string | null
          updated_at?: string
          video_url?: string
        }
        Relationships: [
          {
            foreignKeyName: "dream_candidacies_edition_id_fkey"
            columns: ["edition_id"]
            isOneToOne: false
            referencedRelation: "fund_editions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dream_candidacies_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "entitlements"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "dream_candidacies_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
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
            referencedRelation: "entitlements"
            referencedColumns: ["profile_id"]
          },
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
      event_attendance: {
        Row: {
          checked_in_at: string
          created_at: string
          event_id: string
          id: string
          scanned_by: string
          ticket_id: string
        }
        Insert: {
          checked_in_at?: string
          created_at?: string
          event_id: string
          id?: string
          scanned_by: string
          ticket_id: string
        }
        Update: {
          checked_in_at?: string
          created_at?: string
          event_id?: string
          id?: string
          scanned_by?: string
          ticket_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_attendance_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_attendance_scanned_by_fkey"
            columns: ["scanned_by"]
            isOneToOne: false
            referencedRelation: "entitlements"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "event_attendance_scanned_by_fkey"
            columns: ["scanned_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_attendance_ticket_id_fkey"
            columns: ["ticket_id"]
            isOneToOne: true
            referencedRelation: "event_tickets"
            referencedColumns: ["id"]
          },
        ]
      }
      event_live_stats: {
        Row: {
          event_id: string
          is_live: boolean
          updated_at: string
        }
        Insert: {
          event_id: string
          is_live?: boolean
          updated_at?: string
        }
        Update: {
          event_id?: string
          is_live?: boolean
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_live_stats_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: true
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
        ]
      }
      event_tickets: {
        Row: {
          created_at: string
          event_id: string
          expires_at: string | null
          id: string
          qr_token: string | null
          status: string
          stripe_payment_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          event_id: string
          expires_at?: string | null
          id?: string
          qr_token?: string | null
          status?: string
          stripe_payment_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          event_id?: string
          expires_at?: string | null
          id?: string
          qr_token?: string | null
          status?: string
          stripe_payment_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "event_tickets_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "event_tickets_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "entitlements"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "event_tickets_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          capacity: number | null
          category: Database["public"]["Enums"]["event_category"]
          city: string | null
          cover_url: string | null
          created_at: string
          currency: string
          deleted_at: string | null
          ends_at: string | null
          fee_pct: number
          geo: unknown
          id: string
          is_athanor_day: boolean
          is_kairos_day: boolean
          is_online: boolean
          live_ended_at: string | null
          live_started_at: string | null
          organizer_id: string
          price_cents: number
          starts_at: string
          stream_url: string | null
          title: string
          updated_at: string
          venue: string | null
        }
        Insert: {
          capacity?: number | null
          category: Database["public"]["Enums"]["event_category"]
          city?: string | null
          cover_url?: string | null
          created_at?: string
          currency?: string
          deleted_at?: string | null
          ends_at?: string | null
          fee_pct?: number
          geo?: unknown
          id?: string
          is_athanor_day?: boolean
          is_kairos_day?: boolean
          is_online?: boolean
          live_ended_at?: string | null
          live_started_at?: string | null
          organizer_id: string
          price_cents?: number
          starts_at: string
          stream_url?: string | null
          title: string
          updated_at?: string
          venue?: string | null
        }
        Update: {
          capacity?: number | null
          category?: Database["public"]["Enums"]["event_category"]
          city?: string | null
          cover_url?: string | null
          created_at?: string
          currency?: string
          deleted_at?: string | null
          ends_at?: string | null
          fee_pct?: number
          geo?: unknown
          id?: string
          is_athanor_day?: boolean
          is_kairos_day?: boolean
          is_online?: boolean
          live_ended_at?: string | null
          live_started_at?: string | null
          organizer_id?: string
          price_cents?: number
          starts_at?: string
          stream_url?: string | null
          title?: string
          updated_at?: string
          venue?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "events_organizer_id_fkey"
            columns: ["organizer_id"]
            isOneToOne: false
            referencedRelation: "entitlements"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "events_organizer_id_fkey"
            columns: ["organizer_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      favor_offers: {
        Row: {
          actor_id: string
          created_at: string
          deleted_at: string | null
          id: string
          need: string
          need_milestone_id: string | null
          target_id: string
          updated_at: string
        }
        Insert: {
          actor_id: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          need: string
          need_milestone_id?: string | null
          target_id: string
          updated_at?: string
        }
        Update: {
          actor_id?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          need?: string
          need_milestone_id?: string | null
          target_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "favor_offers_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "entitlements"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "favor_offers_actor_id_fkey"
            columns: ["actor_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "favor_offers_need_milestone_id_fkey"
            columns: ["need_milestone_id"]
            isOneToOne: false
            referencedRelation: "dream_milestones"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "favor_offers_need_milestone_id_fkey"
            columns: ["need_milestone_id"]
            isOneToOne: false
            referencedRelation: "favor_needs"
            referencedColumns: ["need_milestone_id"]
          },
          {
            foreignKeyName: "favor_offers_target_id_fkey"
            columns: ["target_id"]
            isOneToOne: false
            referencedRelation: "entitlements"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "favor_offers_target_id_fkey"
            columns: ["target_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      fund_aggregates: {
        Row: {
          contributor_count: number
          edition_id: string
          raised_cents: number
          updated_at: string
        }
        Insert: {
          contributor_count?: number
          edition_id: string
          raised_cents?: number
          updated_at?: string
        }
        Update: {
          contributor_count?: number
          edition_id?: string
          raised_cents?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fund_aggregates_edition_id_fkey"
            columns: ["edition_id"]
            isOneToOne: true
            referencedRelation: "fund_editions"
            referencedColumns: ["id"]
          },
        ]
      }
      fund_contributions: {
        Row: {
          amount_cents: number
          created_at: string
          currency: string
          edition_id: string
          id: string
          profile_id: string | null
          status: string
          stripe_checkout_session_id: string
          stripe_payment_intent_id: string | null
          updated_at: string
        }
        Insert: {
          amount_cents: number
          created_at?: string
          currency?: string
          edition_id: string
          id?: string
          profile_id?: string | null
          status?: string
          stripe_checkout_session_id: string
          stripe_payment_intent_id?: string | null
          updated_at?: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          currency?: string
          edition_id?: string
          id?: string
          profile_id?: string | null
          status?: string
          stripe_checkout_session_id?: string
          stripe_payment_intent_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "fund_contributions_edition_id_fkey"
            columns: ["edition_id"]
            isOneToOne: false
            referencedRelation: "fund_editions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fund_contributions_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "entitlements"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "fund_contributions_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      fund_editions: {
        Row: {
          candidacy_window_open: boolean
          contributions_enabled: boolean
          created_at: string
          goal_cents: number
          id: string
          phase: string
          target_at: string
          updated_at: string
          winner_candidacy_id: string | null
          year: number
        }
        Insert: {
          candidacy_window_open?: boolean
          contributions_enabled?: boolean
          created_at?: string
          goal_cents: number
          id?: string
          phase?: string
          target_at: string
          updated_at?: string
          winner_candidacy_id?: string | null
          year: number
        }
        Update: {
          candidacy_window_open?: boolean
          contributions_enabled?: boolean
          created_at?: string
          goal_cents?: number
          id?: string
          phase?: string
          target_at?: string
          updated_at?: string
          winner_candidacy_id?: string | null
          year?: number
        }
        Relationships: [
          {
            foreignKeyName: "fund_editions_winner_candidacy_fk"
            columns: ["winner_candidacy_id"]
            isOneToOne: false
            referencedRelation: "dream_candidacies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fund_editions_winner_candidacy_fk"
            columns: ["winner_candidacy_id"]
            isOneToOne: false
            referencedRelation: "fund_candidate_cards"
            referencedColumns: ["candidacy_id"]
          },
        ]
      }
      gdpr_erasure_requests: {
        Row: {
          created_at: string
          id: string
          profile_id: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          profile_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          profile_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "gdpr_erasure_requests_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "entitlements"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "gdpr_erasure_requests_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      gdpr_export_jobs: {
        Row: {
          created_at: string
          download_url: string | null
          expires_at: string | null
          id: string
          profile_id: string
          status: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          download_url?: string | null
          expires_at?: string | null
          id?: string
          profile_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          download_url?: string | null
          expires_at?: string | null
          id?: string
          profile_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "gdpr_export_jobs_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "entitlements"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "gdpr_export_jobs_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      invites: {
        Row: {
          activated_at: string | null
          code: string
          created_at: string
          id: string
          invitee_id: string | null
          inviter_id: string
          updated_at: string
        }
        Insert: {
          activated_at?: string | null
          code: string
          created_at?: string
          id?: string
          invitee_id?: string | null
          inviter_id: string
          updated_at?: string
        }
        Update: {
          activated_at?: string | null
          code?: string
          created_at?: string
          id?: string
          invitee_id?: string | null
          inviter_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "invites_code_fkey"
            columns: ["code"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["referral_code"]
          },
          {
            foreignKeyName: "invites_invitee_id_fkey"
            columns: ["invitee_id"]
            isOneToOne: true
            referencedRelation: "entitlements"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "invites_invitee_id_fkey"
            columns: ["invitee_id"]
            isOneToOne: true
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invites_inviter_id_fkey"
            columns: ["inviter_id"]
            isOneToOne: false
            referencedRelation: "entitlements"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "invites_inviter_id_fkey"
            columns: ["inviter_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          body: string | null
          conversation_id: string
          created_at: string
          deleted_at: string | null
          id: string
          kind: Database["public"]["Enums"]["message_kind"]
          media_url: string | null
          prompt_key: string | null
          sender_id: string | null
        }
        Insert: {
          body?: string | null
          conversation_id: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["message_kind"]
          media_url?: string | null
          prompt_key?: string | null
          sender_id?: string | null
        }
        Update: {
          body?: string | null
          conversation_id?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["message_kind"]
          media_url?: string | null
          prompt_key?: string | null
          sender_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "entitlements"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "messages_sender_id_fkey"
            columns: ["sender_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
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
            referencedRelation: "entitlements"
            referencedColumns: ["profile_id"]
          },
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
          {
            foreignKeyName: "milestone_helps_milestone_id_fkey"
            columns: ["milestone_id"]
            isOneToOne: false
            referencedRelation: "favor_needs"
            referencedColumns: ["need_milestone_id"]
          },
        ]
      }
      momento_proposals: {
        Row: {
          affinity: number
          candidate_id: string
          created_at: string
          daily_rank: number
          id: string
          passed_until: string | null
          proposed_on: string
          reasons: string[]
          status: Database["public"]["Enums"]["momento_status"]
          updated_at: string
          user_id: string
        }
        Insert: {
          affinity?: number
          candidate_id: string
          created_at?: string
          daily_rank?: number
          id?: string
          passed_until?: string | null
          proposed_on?: string
          reasons?: string[]
          status?: Database["public"]["Enums"]["momento_status"]
          updated_at?: string
          user_id: string
        }
        Update: {
          affinity?: number
          candidate_id?: string
          created_at?: string
          daily_rank?: number
          id?: string
          passed_until?: string | null
          proposed_on?: string
          reasons?: string[]
          status?: Database["public"]["Enums"]["momento_status"]
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "momento_proposals_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "entitlements"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "momento_proposals_candidate_id_fkey"
            columns: ["candidate_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "momento_proposals_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "entitlements"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "momento_proposals_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
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
            referencedRelation: "entitlements"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "moments_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notification_preferences: {
        Row: {
          channel: string
          created_at: string
          enabled: boolean
          id: string
          profile_id: string
          type: string
          updated_at: string
        }
        Insert: {
          channel: string
          created_at?: string
          enabled?: boolean
          id?: string
          profile_id: string
          type: string
          updated_at?: string
        }
        Update: {
          channel?: string
          created_at?: string
          enabled?: boolean
          id?: string
          profile_id?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "notification_preferences_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "entitlements"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "notification_preferences_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      notifications: {
        Row: {
          created_at: string
          entity_ref: Json | null
          id: string
          params: Json
          read_at: string | null
          recipient_id: string
          template_key: string
          type: string
        }
        Insert: {
          created_at?: string
          entity_ref?: Json | null
          id?: string
          params?: Json
          read_at?: string | null
          recipient_id: string
          template_key: string
          type: string
        }
        Update: {
          created_at?: string
          entity_ref?: Json | null
          id?: string
          params?: Json
          read_at?: string | null
          recipient_id?: string
          template_key?: string
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "notifications_recipient_id_fkey"
            columns: ["recipient_id"]
            isOneToOne: false
            referencedRelation: "entitlements"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "notifications_recipient_id_fkey"
            columns: ["recipient_id"]
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
            referencedRelation: "entitlements"
            referencedColumns: ["profile_id"]
          },
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
          thumb_path: string | null
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
          thumb_path?: string | null
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
          thumb_path?: string | null
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
            referencedRelation: "entitlements"
            referencedColumns: ["profile_id"]
          },
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
            referencedRelation: "entitlements"
            referencedColumns: ["profile_id"]
          },
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
          avatar_path: string | null
          banned_at: string | null
          bio: string | null
          city: string | null
          city_geohash: string | null
          created_at: string
          display_name: string | null
          founding_member: boolean
          handle: string | null
          id: string
          identity_tags: string[]
          identity_verified: boolean
          locale: string
          mission: string | null
          profession: string | null
          push_enabled: boolean
          referral_code: string | null
          seeking: string[]
          skills: string[] | null
          suspended_until: string | null
          updated_at: string
          visibility: Json
        }
        Insert: {
          avatar_path?: string | null
          banned_at?: string | null
          bio?: string | null
          city?: string | null
          city_geohash?: string | null
          created_at?: string
          display_name?: string | null
          founding_member?: boolean
          handle?: string | null
          id: string
          identity_tags?: string[]
          identity_verified?: boolean
          locale?: string
          mission?: string | null
          profession?: string | null
          push_enabled?: boolean
          referral_code?: string | null
          seeking?: string[]
          skills?: string[] | null
          suspended_until?: string | null
          updated_at?: string
          visibility?: Json
        }
        Update: {
          avatar_path?: string | null
          banned_at?: string | null
          bio?: string | null
          city?: string | null
          city_geohash?: string | null
          created_at?: string
          display_name?: string | null
          founding_member?: boolean
          handle?: string | null
          id?: string
          identity_tags?: string[]
          identity_verified?: boolean
          locale?: string
          mission?: string | null
          profession?: string | null
          push_enabled?: boolean
          referral_code?: string | null
          seeking?: string[]
          skills?: string[] | null
          suspended_until?: string | null
          updated_at?: string
          visibility?: Json
        }
        Relationships: []
      }
      projects: {
        Row: {
          author_id: string
          category: Database["public"]["Enums"]["project_category"]
          created_at: string
          deleted_at: string | null
          description: string
          id: string
          status: Database["public"]["Enums"]["project_status"]
          terms: string | null
          title: string
          updated_at: string
        }
        Insert: {
          author_id: string
          category: Database["public"]["Enums"]["project_category"]
          created_at?: string
          deleted_at?: string | null
          description?: string
          id?: string
          status?: Database["public"]["Enums"]["project_status"]
          terms?: string | null
          title: string
          updated_at?: string
        }
        Update: {
          author_id?: string
          category?: Database["public"]["Enums"]["project_category"]
          created_at?: string
          deleted_at?: string | null
          description?: string
          id?: string
          status?: Database["public"]["Enums"]["project_status"]
          terms?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "entitlements"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "projects_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      push_receipts: {
        Row: {
          created_at: string
          id: string
          profile_id: string
          receipt_id: string
          token: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          profile_id: string
          receipt_id: string
          token: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          profile_id?: string
          receipt_id?: string
          token?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_receipts_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "entitlements"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "push_receipts_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      push_tokens: {
        Row: {
          created_at: string
          device_id: string | null
          id: string
          platform: string
          profile_id: string
          token: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          device_id?: string | null
          id?: string
          platform: string
          profile_id: string
          token: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          device_id?: string | null
          id?: string
          platform?: string
          profile_id?: string
          token?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "push_tokens_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "entitlements"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "push_tokens_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      remote_config: {
        Row: {
          key: string
          updated_at: string
          value: Json
        }
        Insert: {
          key: string
          updated_at?: string
          value: Json
        }
        Update: {
          key?: string
          updated_at?: string
          value?: Json
        }
        Relationships: []
      }
      reports: {
        Row: {
          category: string
          created_at: string
          id: string
          note: string | null
          reporter_id: string
          resolution: string | null
          reviewed_by: string | null
          status: string
          target_id: string | null
          target_type: string
          updated_at: string
        }
        Insert: {
          category: string
          created_at?: string
          id?: string
          note?: string | null
          reporter_id?: string
          resolution?: string | null
          reviewed_by?: string | null
          status?: string
          target_id?: string | null
          target_type: string
          updated_at?: string
        }
        Update: {
          category?: string
          created_at?: string
          id?: string
          note?: string | null
          reporter_id?: string
          resolution?: string | null
          reviewed_by?: string | null
          status?: string
          target_id?: string | null
          target_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "reports_reporter_id_fkey"
            columns: ["reporter_id"]
            isOneToOne: false
            referencedRelation: "entitlements"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "reports_reporter_id_fkey"
            columns: ["reporter_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "reports_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "entitlements"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "reports_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      rsvps: {
        Row: {
          created_at: string
          event_id: string
          id: string
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          event_id: string
          id?: string
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          event_id?: string
          id?: string
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "rsvps_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rsvps_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "entitlements"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "rsvps_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      stars: {
        Row: {
          created_at: string
          granted_at: string | null
          id: string
          profile_id: string
          progress: Json
          star_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          granted_at?: string | null
          id?: string
          profile_id: string
          progress?: Json
          star_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          granted_at?: string | null
          id?: string
          profile_id?: string
          progress?: Json
          star_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stars_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "entitlements"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "stars_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      story_reactions: {
        Row: {
          created_at: string
          id: string
          person_id: string
          segment_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          person_id: string
          segment_id: string
        }
        Update: {
          created_at?: string
          id?: string
          person_id?: string
          segment_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "story_reactions_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "entitlements"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "story_reactions_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "story_reactions_segment_id_fkey"
            columns: ["segment_id"]
            isOneToOne: false
            referencedRelation: "story_segments"
            referencedColumns: ["id"]
          },
        ]
      }
      story_segments: {
        Row: {
          author_id: string
          caption: string | null
          created_at: string
          deleted_at: string | null
          duration_s: number | null
          expires_at: string
          id: string
          is_step: boolean
          kind: Database["public"]["Enums"]["story_kind"]
          pinned: boolean
          storage_path: string
          updated_at: string
        }
        Insert: {
          author_id: string
          caption?: string | null
          created_at?: string
          deleted_at?: string | null
          duration_s?: number | null
          expires_at?: string
          id?: string
          is_step?: boolean
          kind: Database["public"]["Enums"]["story_kind"]
          pinned?: boolean
          storage_path: string
          updated_at?: string
        }
        Update: {
          author_id?: string
          caption?: string | null
          created_at?: string
          deleted_at?: string | null
          duration_s?: number | null
          expires_at?: string
          id?: string
          is_step?: boolean
          kind?: Database["public"]["Enums"]["story_kind"]
          pinned?: boolean
          storage_path?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "story_segments_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "entitlements"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "story_segments_author_id_fkey"
            columns: ["author_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      stripe_webhook_events: {
        Row: {
          claimed_at: string | null
          event_id: string
          payload: Json
          processed_at: string | null
          received_at: string
          type: string
        }
        Insert: {
          claimed_at?: string | null
          event_id: string
          payload: Json
          processed_at?: string | null
          received_at?: string
          type: string
        }
        Update: {
          claimed_at?: string | null
          event_id?: string
          payload?: Json
          processed_at?: string | null
          received_at?: string
          type?: string
        }
        Relationships: []
      }
      verifications: {
        Row: {
          created_at: string
          id: string
          profile_id: string
          status: string
          stripe_session_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          profile_id: string
          status?: string
          stripe_session_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          profile_id?: string
          status?: string
          stripe_session_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "verifications_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "entitlements"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "verifications_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      entitlements: {
        Row: {
          advanced_filters: boolean | null
          analytics: boolean | null
          founding: boolean | null
          is_member: boolean | null
          market_reduced_fee: boolean | null
          plan: string | null
          premium_events: boolean | null
          profile_id: string | null
          status: string | null
        }
        Relationships: []
      }
      favor_needs: {
        Row: {
          need: string | null
          need_created_at: string | null
          need_milestone_id: string | null
          target_avatar_path: string | null
          target_display_name: string | null
          target_handle: string | null
          target_id: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dreams_profile_id_fkey"
            columns: ["target_id"]
            isOneToOne: false
            referencedRelation: "entitlements"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "dreams_profile_id_fkey"
            columns: ["target_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      fund_candidate_cards: {
        Row: {
          candidacy_id: string | null
          category: string | null
          city: string | null
          created_at: string | null
          edition_id: string | null
          handle: string | null
          profile_id: string | null
          status: string | null
          thumb_path: string | null
          title: string | null
          video_url: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dream_candidacies_edition_id_fkey"
            columns: ["edition_id"]
            isOneToOne: false
            referencedRelation: "fund_editions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "dream_candidacies_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "entitlements"
            referencedColumns: ["profile_id"]
          },
          {
            foreignKeyName: "dream_candidacies_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      accept_momento: { Args: { p_proposal_id: string }; Returns: Json }
      admin_list_waitlist: {
        Args: { p_limit?: number }
        Returns: {
          created_at: string
          email: string
          locale: string
          source: string
        }[]
      }
      admin_waitlist_count: { Args: never; Returns: number }
      broadcast_aura_celebration: {
        Args: {
          p_new_stars?: string[]
          p_profile_id: string
          p_tier_up?: string
        }
        Returns: undefined
      }
      candidacy_tally: {
        Args: { p_edition_id: string }
        Returns: {
          candidacy_id: string
          vote_count: number
          weighted_total: number
        }[]
      }
      cast_vote: {
        Args: { p_candidacy_id: string; p_edition_id: string }
        Returns: undefined
      }
      claim_event_seat: { Args: { p_event_id: string }; Returns: string }
      confirm_milestone_help: {
        Args: { p_help_id: string }
        Returns: undefined
      }
      create_conversation_pair: {
        Args: {
          p1: string
          p2: string
          src: Database["public"]["Enums"]["conversation_source"]
        }
        Returns: string
      }
      create_event: {
        Args: {
          p_capacity?: number
          p_category: Database["public"]["Enums"]["event_category"]
          p_city?: string
          p_currency?: string
          p_ends_at?: string
          p_is_online: boolean
          p_lat?: number
          p_long?: number
          p_price_cents?: number
          p_starts_at: string
          p_stream_url?: string
          p_title: string
          p_venue?: string
        }
        Returns: string
      }
      enqueue_push: {
        Args: {
          p_entity_ref: string
          p_params: Json
          p_recipient: string
          p_template_key: string
          p_type: string
        }
        Returns: undefined
      }
      ensure_referral_code: { Args: never; Returns: string }
      event_seats_taken: { Args: { p_event_id: string }; Returns: number }
      events_nearby: {
        Args: {
          cursor_dist?: number
          cursor_id?: string
          lat: number
          long: number
          page_size?: number
          radius_m?: number
        }
        Returns: {
          category: Database["public"]["Enums"]["event_category"]
          city: string
          dist_meters: number
          id: string
          starts_at: string
          title: string
          venue: string
        }[]
      }
      expire_momento_proposals: { Args: never; Returns: number }
      f_profile_search: {
        Args: {
          p_bio: string
          p_handle: string
          p_seeking: string[]
          p_tags: string[]
        }
        Returns: string
      }
      f_unaccent: { Args: { "": string }; Returns: string }
      fund_edition_open: { Args: never; Returns: boolean }
      get_momenti_deck: {
        Args: never
        Returns: {
          avatar_path: string
          candidate_id: string
          city_near: string[]
          display_name: string
          dream_text: string
          handle: string
          mutual_activity: string[]
          offer_hit: string[]
          proposal_id: string
          reason_kind: string
          seek_hit: string[]
          shared: string[]
          skills_shared: string[]
        }[]
      }
      get_momenti_suggestion: {
        Args: { p_exclude?: string[] }
        Returns: {
          avatar_path: string
          candidate_id: string
          display_name: string
          dream_text: string
          handle: string
        }[]
      }
      get_or_create_conversation: { Args: { peer_id: string }; Returns: string }
      get_own_profile: {
        Args: never
        Returns: {
          avatar_path: string | null
          banned_at: string | null
          bio: string | null
          city: string | null
          city_geohash: string | null
          created_at: string
          display_name: string | null
          founding_member: boolean
          handle: string | null
          id: string
          identity_tags: string[]
          identity_verified: boolean
          locale: string
          mission: string | null
          profession: string | null
          push_enabled: boolean
          referral_code: string | null
          seeking: string[]
          skills: string[] | null
          suspended_until: string | null
          updated_at: string
          visibility: Json
        }[]
        SetofOptions: {
          from: "*"
          to: "profiles"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      get_person_profile: {
        Args: { p_profile_id: string }
        Returns: {
          avatar_path: string
          bio: string
          city: string
          display_name: string
          founding_member: boolean
          handle: string
          id: string
          identity_tags: string[]
          identity_verified: boolean
          mission: string
          profession: string
          seeking: string[]
          skills: string[]
        }[]
      }
      inject_ice_breakers: { Args: { conv_id: string }; Returns: undefined }
      invoke_push_receipt_sweep: { Args: never; Returns: undefined }
      invoke_score_engine_decay: { Args: never; Returns: undefined }
      is_identity_verified: { Args: { uid: string }; Returns: boolean }
      live_window_sweep: { Args: never; Returns: undefined }
      owns_dream: { Args: { p_dream_id: string }; Returns: boolean }
      owns_help_milestone: {
        Args: { p_milestone_id: string }
        Returns: boolean
      }
      post_reaction_count: { Args: { p_post_id: string }; Returns: number }
      profile_stat_counts: {
        Args: { p_profile_id: string }
        Returns: {
          collabs_count: number
          events_count: number
        }[]
      }
      recompute_fund_aggregate: {
        Args: { p_edition_id: string }
        Returns: undefined
      }
      release_event_seat: { Args: { p_event_id: string }; Returns: undefined }
      resolve_report: {
        Args: {
          p_action: string
          p_penalty_points?: number
          p_report_id: string
          p_resolution: string
          p_severity?: string
          p_status: string
          p_suspend_until?: string
        }
        Returns: undefined
      }
      respond_to_connection: {
        Args: { p_accept: boolean; p_request_id: string }
        Returns: undefined
      }
      run_momenti_matcher: { Args: never; Returns: number }
      search_all: {
        Args: {
          cursor_id?: string
          cursor_rank?: number
          f_aura_min?: number
          f_city?: string
          f_star?: string
          page_size?: number
          q: string
          scope?: string
        }
        Returns: {
          avatar_path: string
          display_name: string
          entity_type: string
          id: string
          rank: number
          subtitle: string
          title: string
        }[]
      }
      search_connections: {
        Args: {
          p_cursor_created_at?: string
          p_cursor_id?: string
          p_limit?: number
          p_query?: string
        }
        Returns: {
          connection_id: string
          created_at: string
          peer_avatar_path: string
          peer_display_name: string
          peer_handle: string
          peer_id: string
        }[]
      }
      staging_refresh_world: { Args: never; Returns: Json }
      story_reaction_count: { Args: { p_segment_id: string }; Returns: number }
    }
    Enums: {
      connection_status: "pending" | "accepted" | "declined"
      conversation_source: "momento" | "direct"
      event_category:
        | "business"
        | "networking"
        | "spiritualita"
        | "formazione"
        | "musica"
        | "arte"
        | "benessere"
        | "creativi"
        | "evoluzione"
      help_status: "offered" | "accepted" | "declined" | "completed"
      help_type: "skill" | "connection" | "opportunity"
      media_kind: "image" | "video" | "audio"
      message_kind: "user" | "system" | "prompt"
      milestone_status: "open" | "in_progress" | "done"
      moment_kind: "photo" | "video"
      momento_status: "pending" | "accepted" | "passed"
      post_category: "business" | "human" | "creative" | "evolution"
      post_type: "text" | "image" | "video" | "audio"
      project_category:
        | "startup"
        | "artistic"
        | "business"
        | "scientific"
        | "volunteer"
      project_status: "open" | "closed"
      story_kind: "photo" | "video"
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
      connection_status: ["pending", "accepted", "declined"],
      conversation_source: ["momento", "direct"],
      event_category: [
        "business",
        "networking",
        "spiritualita",
        "formazione",
        "musica",
        "arte",
        "benessere",
        "creativi",
        "evoluzione",
      ],
      help_status: ["offered", "accepted", "declined", "completed"],
      help_type: ["skill", "connection", "opportunity"],
      media_kind: ["image", "video", "audio"],
      message_kind: ["user", "system", "prompt"],
      milestone_status: ["open", "in_progress", "done"],
      moment_kind: ["photo", "video"],
      momento_status: ["pending", "accepted", "passed"],
      post_category: ["business", "human", "creative", "evolution"],
      post_type: ["text", "image", "video", "audio"],
      project_category: [
        "startup",
        "artistic",
        "business",
        "scientific",
        "volunteer",
      ],
      project_status: ["open", "closed"],
      story_kind: ["photo", "video"],
    },
  },
} as const
