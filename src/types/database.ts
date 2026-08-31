type Json = string | number | boolean | null | { [key: string]: Json } | Json[]

// ─── Domain types ────────────────────────────────────────────────────────────

// trusted_support_worker is deprecated — retired as a base role in favour
// of a coordinator-defined support_worker sub-role. Kept in the union
// because live rows can still hold it until the retirement migration's
// gated flip runs, and lookup_invite/get_org_members type `role` as plain
// `string` regardless, so removing it wouldn't type-check any call site
// against real DB values anyway.
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
// NDIS-aligned life-domain categories a goal can sit under — optional, for
// grouping/filtering; not tied to a specific plan's funded support categories.
export type GoalCategory =
  | 'daily_living' | 'health_wellbeing' | 'social_community'
  | 'relationships' | 'home' | 'employment' | 'education' | 'choice_control'
export type MeteredAxis = 'workers' | 'participants'
export type ProgressRating = 'regressed' | 'no_change' | 'some_progress' | 'good_progress' | 'achieved'
export type MedicationRoute = 'oral' | 'topical' | 'inhaled' | 'injected' | 'ophthalmic' | 'otic' | 'nasal' | 'sublingual' | 'transdermal' | 'other'
export type MedicationLogStatus = 'taken' | 'refused' | 'deferred' | 'missed'
export type RestrictivePracticeType = 'chemical' | 'environmental' | 'mechanical' | 'physical' | 'seclusion'

// ─── Supabase Database schema type ───────────────────────────────────────────
// Structured to match Supabase's generated type format so `createClient<Database>` resolves correctly.

export interface Database {
  companion: {
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
          entitlements: string[]
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
          entitlements?: string[]
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
          entitlements?: string[]
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
          sub_role_id: string | null
          created_at: string
        }
        Insert: {
          id: string
          full_name: string
          role: Role
          org_id?: string | null
          phone?: string | null
          sub_role_id?: string | null
          created_at?: string
        }
        Update: {
          full_name?: string
          role?: Role
          org_id?: string | null
          phone?: string | null
          sub_role_id?: string | null
        }
        Relationships: []
      }
      clients: {
        Row: {
          id: string
          org_id: string
          person_id: string
          full_name: string
          setting: string | null
          dob: string | null
          email: string | null
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
          person_id?: string
          full_name: string
          setting?: string | null
          dob?: string | null
          email?: string | null
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
          person_id?: string
          full_name?: string
          setting?: string | null
          dob?: string | null
          email?: string | null
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
          photo_thumb_path: string | null
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
          photo_thumb_path?: string | null
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
          category: GoalCategory | null
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
          category?: GoalCategory | null
          status?: GoalStatus
          created_by?: string | null
          created_at?: string
        }
        Update: {
          title?: string
          description?: string | null
          target_date?: string | null
          category?: GoalCategory | null
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
      restrictive_practices: {
        Row: {
          id: string
          org_id: string
          client_id: string
          recorded_by: string
          type: RestrictivePracticeType
          authorised: boolean
          authorisation_reference: string | null
          started_at: string
          ended_at: string | null
          notes: string | null
          bsp_id: string | null
          created_at: string
        }
        Insert: {
          id?: string
          org_id: string
          client_id: string
          recorded_by: string
          type: RestrictivePracticeType
          authorised?: boolean
          authorisation_reference?: string | null
          started_at?: string
          ended_at?: string | null
          notes?: string | null
          bsp_id?: string | null
          created_at?: string
        }
        Update: Record<string, never>
        Relationships: []
      }
      behaviour_support_plans: {
        Row: {
          id: string
          org_id: string
          client_id: string
          uploaded_by: string
          file_path: string
          file_name: string
          review_due: string | null
          created_at: string
        }
        Insert: {
          id?: string
          org_id: string
          client_id: string
          uploaded_by: string
          file_path: string
          file_name: string
          review_due?: string | null
          created_at?: string
        }
        Update: Record<string, never>
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
          sub_role_id: string | null
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
          sub_role_id?: string | null
          expires_at?: string
          created_at?: string
        }
        Update: { status?: InviteStatus; sub_role_id?: string | null }
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
      day_notes: {
        Row: {
          id: string
          org_id: string
          client_id: string
          note_date: string
          body: string
          created_by: string
          updated_at: string
          created_at: string
        }
        Insert: {
          id?: string
          org_id: string
          client_id: string
          note_date: string
          body: string
          created_by: string
          updated_at?: string
          created_at?: string
        }
        Update: {
          body?: string
          updated_at?: string
        }
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
      medications: {
        Row: {
          id: string
          org_id: string
          client_id: string
          name: string
          dosage: string | null
          frequency: string
          instructions: string | null
          route: MedicationRoute | null
          prescriber: string | null
          active: boolean
          created_by: string
          created_at: string
        }
        Insert: {
          id?: string
          org_id: string
          client_id: string
          name: string
          dosage?: string | null
          frequency: string
          instructions?: string | null
          route?: MedicationRoute | null
          prescriber?: string | null
          active?: boolean
          created_by: string
          created_at?: string
        }
        Update: {
          name?: string
          dosage?: string | null
          frequency?: string
          instructions?: string | null
          route?: MedicationRoute | null
          prescriber?: string | null
          active?: boolean
        }
        Relationships: []
      }
      medication_logs: {
        Row: {
          id: string
          medication_id: string
          client_id: string
          org_id: string
          administered_by: string
          administered_at: string
          status: MedicationLogStatus
          note: string | null
          created_at: string
        }
        Insert: {
          id?: string
          medication_id: string
          client_id: string
          org_id: string
          administered_by: string
          administered_at?: string
          status?: MedicationLogStatus
          note?: string | null
          created_at?: string
        }
        Update: {
          status?: MedicationLogStatus
          note?: string | null
        }
        Relationships: []
      }
      log_entry_photos: {
        Row: {
          id: string
          entry_id: string
          photo_path: string
          photo_thumb_path: string | null
          sort_order: number
          created_at: string
        }
        Insert: {
          id?: string
          entry_id: string
          photo_path: string
          photo_thumb_path?: string | null
          sort_order?: number
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
      base_roles: {
        Row: { role: string; label: string; sub_roles_allowed: boolean; is_transitional: boolean; sort_order: number }
        Insert: { role: string; label: string; sub_roles_allowed?: boolean; is_transitional?: boolean; sort_order?: number }
        Update: { label?: string; sub_roles_allowed?: boolean; is_transitional?: boolean; sort_order?: number }
        Relationships: []
      }
      permission_keys: {
        Row: {
          key: string; label: string; description: string | null
          kind: 'gate' | 'grant'; target_table: string; target_cmd: string
          enforced: boolean; sort_order: number
        }
        Insert: {
          key: string; label: string; description?: string | null
          kind: 'gate' | 'grant'; target_table: string; target_cmd: string
          enforced?: boolean; sort_order?: number
        }
        Update: { label?: string; description?: string | null; enforced?: boolean; sort_order?: number }
        Relationships: []
      }
      role_permission_defaults: {
        Row: { base_role: string; permission_key: string; default_allowed: boolean; max_allowed: boolean }
        Insert: { base_role: string; permission_key: string; default_allowed: boolean; max_allowed: boolean }
        Update: { default_allowed?: boolean; max_allowed?: boolean }
        Relationships: []
      }
      sub_roles: {
        Row: {
          id: string; org_id: string; base_role: string; name: string
          is_default: boolean; archived_at: string | null
          created_by: string | null; created_at: string; updated_at: string
        }
        Insert: {
          id?: string; org_id: string; base_role: string; name: string
          is_default?: boolean; archived_at?: string | null
          created_by?: string | null; created_at?: string; updated_at?: string
        }
        Update: { name?: string; archived_at?: string | null }
        Relationships: []
      }
      sub_role_permissions: {
        Row: { sub_role_id: string; permission_key: string; allowed: boolean }
        Insert: { sub_role_id: string; permission_key: string; allowed: boolean }
        Update: { allowed?: boolean }
        Relationships: []
      }
      profile_orgs: {
        Row: {
          profile_id: string
          org_id: string
          role: string
          sub_role_id: string | null
          joined_at: string
          left_at: string | null
        }
        Insert: {
          profile_id: string
          org_id: string
          role: string
          sub_role_id?: string | null
          joined_at?: string
          left_at?: string | null
        }
        Update: { role?: string; sub_role_id?: string | null; left_at?: string | null }
        Relationships: []
      }
      programs: {
        Row: { id: string; org_id: string; name: string; kind: string; colour: string | null; active: boolean; created_at: string }
        Insert: { id?: string; org_id: string; name: string; kind: string; colour?: string | null; active?: boolean; created_at?: string }
        Update: { name?: string; kind?: string; colour?: string | null; active?: boolean }
        Relationships: []
      }
      program_participants: {
        Row: { program_id: string; participant_id: string; org_id: string; joined_at: string; left_at: string | null }
        Insert: { program_id: string; participant_id: string; org_id: string; joined_at?: string; left_at?: string | null }
        Update: { left_at?: string | null }
        Relationships: []
      }
      program_workers: {
        Row: { program_id: string; worker_id: string; org_id: string; assigned_at: string; removed_at: string | null }
        Insert: { program_id: string; worker_id: string; org_id: string; assigned_at?: string; removed_at?: string | null }
        Update: { removed_at?: string | null }
        Relationships: []
      }
      shifts: {
        Row: {
          id: string; org_id: string; program_id: string; worker_id: string | null
          is_open: boolean; required_skills: string[]; template_id: string | null
          starts_at: string; ends_at: string; status: string
          notes: string | null; override_note: string | null
          created_by: string; created_at: string; updated_at: string | null; deleted_at: string | null
        }
        Insert: {
          id?: string; org_id: string; program_id: string; worker_id?: string | null
          is_open?: boolean; required_skills?: string[]; template_id?: string | null
          starts_at: string; ends_at: string; status?: string
          notes?: string | null; override_note?: string | null
          created_by: string; created_at?: string; updated_at?: string | null; deleted_at?: string | null
        }
        Update: {
          worker_id?: string | null; is_open?: boolean; required_skills?: string[]
          starts_at?: string; ends_at?: string; status?: string
          notes?: string | null; override_note?: string | null
          updated_at?: string | null; deleted_at?: string | null
        }
        Relationships: []
      }
      shift_participants: {
        Row: { shift_id: string; participant_id: string; org_id: string; left_at: string | null }
        Insert: { shift_id: string; participant_id: string; org_id: string; left_at?: string | null }
        Update: { left_at?: string | null }
        Relationships: []
      }
      shift_handovers: {
        Row: { id: string; shift_id: string; author_id: string; body: string | null; nothing_to_hand_over: boolean; created_at: string }
        Insert: { id?: string; shift_id: string; author_id: string; body?: string | null; nothing_to_hand_over?: boolean; created_at?: string }
        Update: Record<string, never>
        Relationships: []
      }
      shift_templates: {
        Row: {
          id: string; org_id: string; program_id: string; worker_id: string
          day_of_week: number; starts_time: string; ends_time: string
          end_date: string | null; participant_ids: string[]; active: boolean; created_at: string
        }
        Insert: {
          id?: string; org_id: string; program_id: string; worker_id: string
          day_of_week: number; starts_time: string; ends_time: string
          end_date?: string | null; participant_ids?: string[]; active?: boolean; created_at?: string
        }
        Update: {
          worker_id?: string; day_of_week?: number; starts_time?: string; ends_time?: string
          end_date?: string | null; participant_ids?: string[]; active?: boolean
        }
        Relationships: []
      }
      worker_availability: {
        Row: { worker_id: string; org_id: string; day_of_week: number; starts_time: string; ends_time: string }
        Insert: { worker_id: string; org_id: string; day_of_week: number; starts_time: string; ends_time: string }
        Update: { starts_time?: string; ends_time?: string }
        Relationships: []
      }
      profile_skills: {
        Row: { profile_id: string; org_id: string; skill: string }
        Insert: { profile_id: string; org_id: string; skill: string }
        Update: Record<string, never>
        Relationships: []
      }
    }
    Views: {
      participants: {
        Row: {
          id: string
          org_id: string
          person_id: string
          setting: string | null
          decision_maker_id: string | null
          decision_maker_kind: string | null
          active: boolean
          created_at: string
          full_name: string
          dob: string | null
          about: { loves?: string; calming?: string; comms?: string }
          recipient_profile_id: string | null
        }
        Relationships: []
      }
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
        Returns: Array<{
          id: string; full_name: string; role: string; email: string; phone: string | null
          sub_role_id: string | null; sub_role_name: string | null
        }>
      }
      update_member: {
        Args: { p_user_id: string; p_full_name: string; p_phone: string | null }
        Returns: Json
      }
      check_pending_invite: {
        Args: { p_email: string }
        Returns: Json
      }
      my_permissions: {
        Args: Record<string, never>
        Returns: Json
      }
      my_invitable_roles: {
        Args: Record<string, never>
        Returns: string[]
      }
      assign_sub_role: {
        Args: { p_user_id: string; p_sub_role_id: string | null }
        Returns: void
      }
      assign_invite_sub_role: {
        Args: { p_invite_id: string; p_sub_role_id: string | null }
        Returns: void
      }
      create_sub_role: {
        Args: { p_base_role: string; p_name: string; p_permissions: Json; p_invitable_roles: string[] }
        Returns: string
      }
      update_sub_role: {
        Args: { p_id: string; p_name: string; p_permissions: Json; p_invitable_roles: string[] }
        Returns: void
      }
      archive_sub_role: {
        Args: { p_id: string; p_archived?: boolean }
        Returns: void
      }
      delete_sub_role: {
        Args: { p_id: string; p_reassign_to: string }
        Returns: void
      }
      generate_person_link_code: {
        Args: { p_client_id: string }
        Returns: Array<{ code: string; expires_at: string }>
      }
      preview_person_link: {
        Args: { p_code: string; p_target_client_id: string }
        Returns: Array<{ first_name: string; last_initial: string; dob: string | null; source_org_name: string }>
      }
      confirm_person_link: {
        Args: { p_code: string; p_target_client_id: string }
        Returns: void
      }
      unlink_person: {
        Args: { p_client_id: string }
        Returns: void
      }
      email_link_candidate_for: {
        Args: { p_client_id: string }
        Returns: Json
      }
      confirm_email_link: {
        Args: { p_target_client_id: string }
        Returns: void
      }
      create_program: {
        Args: { p_name: string; p_kind: string; p_colour?: string | null }
        Returns: string
      }
      update_program: {
        Args: { p_id: string; p_name: string; p_kind: string; p_colour: string | null }
        Returns: void
      }
      archive_program: {
        Args: { p_id: string }
        Returns: void
      }
      assign_participant_to_program: {
        Args: { p_program_id: string; p_participant_id: string }
        Returns: void
      }
      remove_participant_from_program: {
        Args: { p_program_id: string; p_participant_id: string }
        Returns: void
      }
      assign_worker_to_program: {
        Args: { p_program_id: string; p_worker_id: string }
        Returns: void
      }
      remove_worker_from_program: {
        Args: { p_program_id: string; p_worker_id: string }
        Returns: void
      }
      rostering_create_shift: {
        Args: {
          p_program_id: string; p_worker_id: string | null; p_starts_at: string; p_ends_at: string
          p_participant_ids: string[]; p_notes?: string | null; p_override_note?: string | null
        }
        Returns: string
      }
      rostering_update_shift: {
        Args: {
          p_shift_id: string; p_worker_id: string | null; p_starts_at: string; p_ends_at: string
          p_participant_ids: string[]; p_notes?: string | null; p_override_note?: string | null
        }
        Returns: void
      }
      rostering_delete_shift: {
        Args: { p_shift_id: string }
        Returns: void
      }
      rostering_publish_shift: {
        Args: { p_shift_id: string }
        Returns: void
      }
      rostering_cancel_shift: {
        Args: { p_shift_id: string; p_reason: string }
        Returns: void
      }
      rostering_confirm_shift: {
        Args: { p_shift_id: string }
        Returns: void
      }
      rostering_claim_shift: {
        Args: { p_shift_id: string }
        Returns: void
      }
      rostering_start_shift: {
        Args: { p_shift_id: string }
        Returns: void
      }
      rostering_end_shift: {
        Args: { p_shift_id: string; p_handover_body?: string | null; p_nothing_to_hand_over?: boolean }
        Returns: void
      }
      rostering_copy_forward: {
        Args: { p_source_week: string; p_target_week: string }
        Returns: { created: number; skipped: number }
      }
      rostering_week_grid: {
        Args: { p_week_start: string; p_program_id: string }
        Returns: Array<{
          id: string; worker_id: string | null; worker_name: string | null; is_open: boolean; status: string
          starts_at: string; ends_at: string; required_skills: string[]; notes: string | null; template_id: string | null
          participants: Array<{ id: string; full_name: string }> | null
        }>
      }
      rostering_warnings: {
        Args: { p_week_start: string; p_program_id: string }
        Returns: {
          overlaps: Array<{ worker_id: string; shift_a: string; shift_b: string }>
          uncovered: Array<{ participant_id: string; day: string }>
          unconfirmed: Array<{ id: string; starts_at: string }>
        }
      }
      rostering_previous_handover: {
        Args: { p_program_id: string; p_participant_ids: string[]; p_before: string }
        Returns: {
          id: string; shift_id: string; author_id: string; body: string | null
          nothing_to_hand_over: boolean; created_at: string; fallback_no_shared_participants: boolean
        } | null
      }
      rostering_set_availability: {
        Args: { p_days: Array<{ day_of_week: number; starts_time: string; ends_time: string }> }
        Returns: void
      }
      rostering_set_skills: {
        Args: { p_skills: string[] }
        Returns: void
      }
      rostering_create_template: {
        Args: {
          p_program_id: string; p_worker_id: string; p_day_of_week: number
          p_starts_time: string; p_ends_time: string; p_end_date: string | null; p_participant_ids: string[]
        }
        Returns: string
      }
      rostering_update_template: {
        Args: {
          p_id: string; p_worker_id: string; p_day_of_week: number
          p_starts_time: string; p_ends_time: string; p_end_date: string | null; p_participant_ids: string[]
        }
        Returns: void
      }
      rostering_pause_template: {
        Args: { p_id: string; p_active: boolean }
        Returns: void
      }
      rostering_delete_template: {
        Args: { p_id: string }
        Returns: void
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

type Tables = Database['companion']['Tables']
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
export type RestrictivePractice = Tables['restrictive_practices']['Row']
export type BehaviourSupportPlan = Tables['behaviour_support_plans']['Row']
export type Invite       = Tables['invites']['Row']
export type OrgSettings  = Tables['org_settings']['Row']
export type Notice       = Tables['notices']['Row']
export type DayNote      = Tables['day_notes']['Row']
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
export type Medication = Tables['medications']['Row']
export type MedicationLog = Tables['medication_logs']['Row']
export type LogEntryPhoto = Tables['log_entry_photos']['Row']
