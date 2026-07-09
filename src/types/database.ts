type Json = string | number | boolean | null | { [key: string]: Json } | Json[]

// ─── Domain types ────────────────────────────────────────────────────────────

export type Role = 'coordinator' | 'support_worker' | 'trusted_support_worker' | 'family' | 'therapist' | 'recipient'
export type OrgType = 'family' | 'provider'
export type LogType = 'meal' | 'activity' | 'mood' | 'note' | 'photo'
export type CircleStatus = 'proposed' | 'pending_approval' | 'in_circle' | 'removed'
export type DecisionMakerKind = 'self' | 'guardian' | 'nominee'
export type BillingStatus = 'trial' | 'active' | 'past_due' | 'cancelled'
export type InviteStatus = 'pending' | 'accepted' | 'expired'
export type AccessAction = 'view' | 'share' | 'revoke'
export type ScheduleCategory = 'therapy' | 'meal' | 'activity' | 'personal_care' | 'social' | 'appointment' | 'transport' | 'other'
export type ScheduleRecurrence = 'once' | 'weekly'
export type IncidentSeverity = 'low' | 'medium' | 'high' | 'critical'
export type IncidentCategory = 'injury' | 'behaviour' | 'medication' | 'property' | 'near_miss' | 'complaint' | 'other'
export type IncidentStatus = 'open' | 'escalated' | 'resolved'
export type GoalStatus = 'active' | 'achieved' | 'discontinued'
export type MeteredAxis = 'workers' | 'participants'
export type ProgressRating = 'regressed' | 'no_change' | 'some_progress' | 'good_progress' | 'achieved'

// ─── Supabase Database schema type ───────────────────────────────────────────
// Structured to match Supabase's generated type format so `createClient<Database>` resolves correctly.

export interface Database {
  public: {
    Tables: {
      organisations: {
        Row: {
          id: string
          name: string
          abn: string | null
          ndis_reg: string | null
          state: string | null
          services: string[]
          myappbuddy_subscription_id: string | null
          myappbuddy_account_id: string | null
          plan: string
          billing_status: BillingStatus
          org_type: OrgType
          seats: number | null
          metered_axis: MeteredAxis | null
          owner_id: string | null
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          abn?: string | null
          ndis_reg?: string | null
          state?: string | null
          services?: string[]
          myappbuddy_subscription_id?: string | null
          myappbuddy_account_id?: string | null
          plan?: string
          billing_status?: BillingStatus
          org_type?: OrgType
          seats?: number | null
          metered_axis?: MeteredAxis | null
          owner_id?: string | null
          created_at?: string
        }
        Update: {
          name?: string
          abn?: string | null
          ndis_reg?: string | null
          state?: string | null
          services?: string[]
          myappbuddy_subscription_id?: string | null
          myappbuddy_account_id?: string | null
          plan?: string
          billing_status?: BillingStatus
          org_type?: OrgType
          seats?: number | null
          metered_axis?: MeteredAxis | null
          owner_id?: string | null
        }
        Relationships: []
      }
      profiles: {
        Row: {
          id: string
          full_name: string
          role: Role
          org_id: string | null
          phone: string | null
          created_at: string
        }
        Insert: {
          id: string
          full_name: string
          role: Role
          org_id?: string | null
          phone?: string | null
          created_at?: string
        }
        Update: {
          full_name?: string
          role?: Role
          org_id?: string | null
          phone?: string | null
        }
        Relationships: []
      }
      clients: {
        Row: {
          id: string
          org_id: string
          full_name: string
          setting: string | null
          dob: string | null
          about: { loves?: string; calming?: string; comms?: string }
          decision_maker_id: string | null
          decision_maker_kind: DecisionMakerKind | null
          goals: Array<{ id: string; title: string; description?: string }>
          active: boolean
          recipient_profile_id: string | null
          created_at: string
        }
        Insert: {
          id?: string
          org_id: string
          full_name: string
          setting?: string | null
          dob?: string | null
          about?: { loves?: string; calming?: string; comms?: string }
          decision_maker_id?: string | null
          decision_maker_kind?: DecisionMakerKind | null
          goals?: Array<{ id: string; title: string; description?: string }>
          active?: boolean
          recipient_profile_id?: string | null
          created_at?: string
        }
        Update: {
          org_id?: string
          full_name?: string
          setting?: string | null
          dob?: string | null
          about?: { loves?: string; calming?: string; comms?: string }
          decision_maker_id?: string | null
          decision_maker_kind?: DecisionMakerKind | null
          goals?: Array<{ id: string; title: string; description?: string }>
          active?: boolean
          recipient_profile_id?: string | null
        }
        Relationships: []
      }
      client_feedback: {
        Row: {
          id: string
          client_id: string
          org_id: string
          author_id: string
          body: string
          created_at: string
        }
        Insert: {
          id?: string
          client_id: string
          org_id: string
          author_id: string
          body: string
          created_at?: string
        }
        Update: { body?: string }
        Relationships: []
      }
      recipient_moods: {
        Row: {
          id: string
          client_id: string
          org_id: string
          author_id: string
          mood_score: number
          note: string | null
          created_at: string
        }
        Insert: {
          id?: string
          client_id: string
          org_id: string
          author_id: string
          mood_score: number
          note?: string | null
          created_at?: string
        }
        Update: { note?: string | null }
        Relationships: []
      }
      log_entry_comments: {
        Row: {
          id: string
          entry_id: string
          client_id: string
          org_id: string
          author_id: string
          body: string
          created_at: string
        }
        Insert: {
          id?: string
          entry_id: string
          client_id: string
          org_id: string
          author_id: string
          body: string
          created_at?: string
        }
        Update: { body?: string }
        Relationships: []
      }
      client_feedback_comments: {
        Row: {
          id: string
          feedback_id: string
          client_id: string
          org_id: string
          author_id: string
          body: string
          created_at: string
        }
        Insert: {
          id?: string
          feedback_id: string
          client_id: string
          org_id: string
          author_id: string
          body: string
          created_at?: string
        }
        Update: { body?: string }
        Relationships: []
      }
      log_entry_reactions: {
        Row: {
          id: string
          entry_id: string
          author_id: string
          reaction: 'thumbs_up' | 'heart'
          created_at: string
        }
        Insert: {
          id?: string
          entry_id: string
          author_id: string
          reaction: 'thumbs_up' | 'heart'
          created_at?: string
        }
        Update: Record<string, never>
        Relationships: []
      }
      client_workers: {
        Row: { client_id: string; worker_id: string; status?: string }
        Insert: { client_id: string; worker_id: string; status?: string }
        Update: { client_id?: string; worker_id?: string; status?: string }
        Relationships: []
      }
      client_family: {
        Row: { client_id: string; family_id: string; relationship: string | null; status: 'invited' | 'active' }
        Insert: { client_id: string; family_id: string; relationship?: string | null; status?: 'invited' | 'active' }
        Update: { relationship?: string | null; status?: 'invited' | 'active' }
        Relationships: []
      }
      client_circle: {
        Row: {
          id: string
          client_id: string
          therapist_id: string
          status: CircleStatus
          proposed_by: string | null
          approved_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          client_id: string
          therapist_id: string
          status?: CircleStatus
          proposed_by?: string | null
          approved_by?: string | null
          created_at?: string
        }
        Update: { status?: CircleStatus; approved_by?: string | null }
        Relationships: []
      }
      log_entries: {
        Row: {
          id: string
          client_id: string
          org_id: string
          author_id: string
          type: LogType
          label: string
          occurred_at: string
          photo_path: string | null
          mood_score: number | null
          ai_source: string | null
          ai_reason: string | null
          created_at: string
        }
        Insert: {
          id?: string
          client_id: string
          org_id: string
          author_id: string
          type: LogType
          label: string
          occurred_at?: string
          photo_path?: string | null
          mood_score?: number | null
          ai_source?: string | null
          ai_reason?: string | null
          created_at?: string
        }
        Update: { label?: string; type?: LogType; mood_score?: number | null; flagged?: boolean; ai_source?: string | null; ai_reason?: string | null }
        Relationships: []
      }
      notices: {
        Row: {
          id: string
          org_id: string
          client_id: string
          author_id: string | null
          body: string
          created_at: string
        }
        Insert: {
          id?: string
          org_id: string
          client_id: string
          author_id?: string | null
          body: string
          created_at?: string
        }
        Update: { body?: string }
        Relationships: []
      }
      behaviour_notes: {
        Row: {
          id: string
          client_id: string
          org_id: string
          author_id: string
          title: string
          mood_before: number | null
          mood_after: number | null
          antecedent: string | null
          behaviour: string | null
          response: string | null
          flagged_for_review: boolean
          ai_source: string | null
          ai_reason: string | null
          occurred_at: string
          created_at: string
        }
        Insert: {
          id?: string
          client_id: string
          org_id: string
          author_id: string
          title: string
          mood_before?: number | null
          mood_after?: number | null
          antecedent?: string | null
          behaviour?: string | null
          response?: string | null
          flagged_for_review?: boolean
          ai_source?: string | null
          ai_reason?: string | null
          occurred_at?: string
          created_at?: string
        }
        Update: {
          title?: string
          mood_before?: number | null
          mood_after?: number | null
          antecedent?: string | null
          behaviour?: string | null
          response?: string | null
          flagged_for_review?: boolean
          ai_source?: string | null
          ai_reason?: string | null
        }
        Relationships: []
      }
      note_shares: {
        Row: {
          id: string
          note_id: string
          therapist_id: string
          shared_by: string
          created_at: string
          revoked_at: string | null
        }
        Insert: {
          id?: string
          note_id: string
          therapist_id: string
          shared_by: string
          created_at?: string
          revoked_at?: string | null
        }
        Update: { revoked_at?: string | null }
        Relationships: []
      }
      access_log: {
        Row: { id: string; actor_id: string; note_id: string; action: AccessAction; created_at: string }
        Insert: { id?: string; actor_id: string; note_id: string; action: AccessAction; created_at?: string }
        Update: Record<string, never>
        Relationships: []
      }
      messages: {
        Row: { id: string; client_id: string | null; org_id: string; sender_id: string; recipient_id: string | null; body: string; created_at: string }
        Insert: { id?: string; client_id?: string | null; org_id: string; sender_id: string; recipient_id?: string | null; body: string; created_at?: string }
        Update: { body?: string }
        Relationships: []
      }
      participant_goals: {
        Row: {
          id: string
          org_id: string
          client_id: string
          title: string
          description: string | null
          target_date: string | null
          status: GoalStatus
          created_by: string | null
          created_at: string
        }
        Insert: {
          id?: string
          org_id: string
          client_id: string
          title: string
          description?: string | null
          target_date?: string | null
          status?: GoalStatus
          created_by?: string | null
          created_at?: string
        }
        Update: {
          title?: string
          description?: string | null
          target_date?: string | null
          status?: GoalStatus
        }
        Relationships: []
      }
      goal_progress_records: {
        Row: {
          id: string
          goal_id: string
          client_id: string
          org_id: string
          author_id: string
          occurred_at: string
          rating: ProgressRating
          notes: string
          created_at: string
        }
        Insert: {
          id?: string
          goal_id: string
          client_id: string
          org_id: string
          author_id: string
          occurred_at?: string
          rating: ProgressRating
          notes: string
          created_at?: string
        }
        Update: Record<string, never>
        Relationships: []
      }
      incidents: {
        Row: {
          id: string
          org_id: string
          client_id: string
          author_id: string
          occurred_at: string
          severity: IncidentSeverity
          category: IncidentCategory
          description: string
          immediate_action: string | null
          status: IncidentStatus
          escalated_at: string | null
          escalated_by: string | null
          resolved_at: string | null
          resolved_by: string | null
          resolution_notes: string | null
          created_at: string
        }
        Insert: {
          id?: string
          org_id: string
          client_id: string
          author_id: string
          occurred_at?: string
          severity: IncidentSeverity
          category: IncidentCategory
          description: string
          immediate_action?: string | null
          status?: IncidentStatus
          escalated_at?: string | null
          escalated_by?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          resolution_notes?: string | null
          created_at?: string
        }
        Update: {
          status?: IncidentStatus
          escalated_at?: string | null
          escalated_by?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          resolution_notes?: string | null
        }
        Relationships: []
      }
      invites: {
        Row: {
          id: string
          org_id: string
          email: string
          role: Role
          client_id: string | null
          token: string
          status: InviteStatus
          phone: string | null
          name: string | null
          expires_at: string
          created_at: string
        }
        Insert: {
          id?: string
          org_id: string
          email: string
          role: Role
          client_id?: string | null
          token?: string
          status?: InviteStatus
          phone?: string | null
          name?: string | null
          expires_at?: string
          created_at?: string
        }
        Update: { status?: InviteStatus }
        Relationships: []
      }
      demo_requests: {
        Row: {
          id: string
          name: string
          email: string
          org_name: string | null
          message: string | null
          created_at: string
        }
        Insert: {
          id?: string
          name: string
          email: string
          org_name?: string | null
          message?: string | null
          created_at?: string
        }
        Update: Record<string, never>
        Relationships: []
      }
      schedule_items: {
        Row: {
          id: string
          org_id: string
          client_id: string
          created_by: string
          title: string
          description: string | null
          category: ScheduleCategory
          start_time: string
          end_time: string | null
          recurrence: ScheduleRecurrence
          specific_date: string | null
          days_of_week: number[] | null
          active: boolean
          url: string | null
          created_at: string
        }
        Insert: {
          id?: string
          org_id: string
          client_id: string
          created_by: string
          title: string
          description?: string | null
          category?: ScheduleCategory
          start_time: string
          end_time?: string | null
          recurrence: ScheduleRecurrence
          specific_date?: string | null
          days_of_week?: number[] | null
          active?: boolean
          url?: string | null
          created_at?: string
        }
        Update: {
          title?: string
          description?: string | null
          category?: ScheduleCategory
          start_time?: string
          end_time?: string | null
          recurrence?: ScheduleRecurrence
          specific_date?: string | null
          days_of_week?: number[] | null
          active?: boolean
          url?: string | null
        }
        Relationships: []
      }
      schedule_item_notes: {
        Row: {
          id: string
          schedule_item_id: string
          occurrence_date: string
          org_id: string
          client_id: string
          author_id: string
          body: string
          created_at: string
        }
        Insert: {
          id?: string
          schedule_item_id: string
          occurrence_date: string
          org_id: string
          client_id: string
          author_id: string
          body: string
          created_at?: string
        }
        Update: { body?: string }
        Relationships: []
      }
      schedule_item_completions: {
        Row: {
          id: string
          schedule_item_id: string
          occurrence_date: string
          org_id: string
          client_id: string
          completed_by: string
          created_at: string
        }
        Insert: {
          id?: string
          schedule_item_id: string
          occurrence_date: string
          org_id: string
          client_id: string
          completed_by: string
          created_at?: string
        }
        Update: Record<string, never>
        Relationships: []
      }
      schedule_item_skips: {
        Row: {
          id: string
          schedule_item_id: string
          occurrence_date: string
          org_id: string
          client_id: string
          created_by: string
          created_at: string
        }
        Insert: {
          id?: string
          schedule_item_id: string
          occurrence_date: string
          org_id: string
          client_id: string
          created_by: string
          created_at?: string
        }
        Update: Record<string, never>
        Relationships: []
      }
      active_timers: {
        Row: {
          id: string
          client_id: string
          org_id: string
          created_by: string
          label: string
          ends_at: string
          created_at: string
        }
        Insert: {
          id?: string
          client_id: string
          org_id: string
          created_by: string
          label: string
          ends_at: string
          created_at?: string
        }
        Update: {
          label?: string
          ends_at?: string
        }
        Relationships: []
      }
      timer_alerts: {
        Row: {
          id: string
          user_id: string
          org_id: string
          label: string
          fires_at: string
          created_at: string
        }
        Insert: {
          id?: string
          user_id: string
          org_id: string
          label: string
          fires_at: string
          created_at?: string
        }
        Update: Record<string, never>
        Relationships: []
      }
      org_settings: {
        Row: {
          id: string
          org_id: string
          theme: Record<string, string>
          digest_send_time: string
          locale: string
          feature_flags: Record<string, boolean>
          retention_preferences: Record<string, unknown>
          permissions: Record<string, unknown>
          created_at: string
        }
        Insert: {
          id?: string
          org_id: string
          theme?: Record<string, string>
          digest_send_time?: string
          locale?: string
          feature_flags?: Record<string, boolean>
          permissions?: Record<string, unknown>
          retention_preferences?: Record<string, unknown>
          created_at?: string
        }
        Update: {
          theme?: Record<string, string>
          digest_send_time?: string
          locale?: string
          feature_flags?: Record<string, boolean>
          retention_preferences?: Record<string, unknown>
          permissions?: Record<string, unknown>
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      lookup_invite: {
        Args: { p_token: string }
        Returns: Array<{
          org_id: string; org_name: string; email: string
          role: string; expires_at: string; status: string
        }>
      }
      accept_invite: {
        Args: { p_token: string }
        Returns: Json
      }
      setup_family_org: {
        Args: { p_participant_name: string }
        Returns: Json
      }
      create_organisation: {
        Args: { p_name: string; p_state: string; p_services: string[] }
        Returns: string
      }
      promote_member: {
        Args: { p_user_id: string; p_new_role: string }
        Returns: Json
      }
      demote_member: {
        Args: { p_user_id: string }
        Returns: Json
      }
      remove_member: {
        Args: { p_user_id: string }
        Returns: Json
      }
      get_org_members: {
        Args: Record<string, never>
        Returns: Array<{ id: string; full_name: string; role: string; email: string; phone: string | null }>
      }
      update_member: {
        Args: { p_user_id: string; p_full_name: string; p_phone: string | null }
        Returns: Json
      }
      check_pending_invite: {
        Args: { p_email: string }
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
}

// ─── Convenience row type aliases ─────────────────────────────────────────────

type Tables = Database['public']['Tables']
export type Organisation = Tables['organisations']['Row']
export type Profile      = Tables['profiles']['Row']
export type Client       = Tables['clients']['Row']
export type ClientWorker = Tables['client_workers']['Row']
export type ClientFamily = Tables['client_family']['Row']
export type ClientCircle = Tables['client_circle']['Row']
export type LogEntry     = Tables['log_entries']['Row']
export type BehaviourNote = Tables['behaviour_notes']['Row']
export type NoteShare    = Tables['note_shares']['Row']
export type AccessLog    = Tables['access_log']['Row']
export type Incident     = Tables['incidents']['Row']
export type Invite       = Tables['invites']['Row']
export type OrgSettings  = Tables['org_settings']['Row']
export type Notice       = Tables['notices']['Row']
export type Message      = Tables['messages']['Row']
export type ClientFeedback = Tables['client_feedback']['Row']
export type RecipientMood = Tables['recipient_moods']['Row']
export type LogEntryComment = Tables['log_entry_comments']['Row']
export type LogEntryReaction = Tables['log_entry_reactions']['Row']
export type ClientFeedbackComment = Tables['client_feedback_comments']['Row']
export type ScheduleItem = Tables['schedule_items']['Row']
export type ScheduleItemNote = Tables['schedule_item_notes']['Row']
export type ScheduleItemCompletion = Tables['schedule_item_completions']['Row']
export type ScheduleItemSkip = Tables['schedule_item_skips']['Row']
export type TimerAlert = Tables['timer_alerts']['Row']
export type ActiveTimer = Tables['active_timers']['Row']
