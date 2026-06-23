export type Role = 'coordinator' | 'support_worker' | 'family' | 'therapist'
export type LogType = 'meal' | 'activity' | 'mood' | 'photo'
export type NoteShareStatus = 'proposed' | 'pending_approval' | 'in_circle' | 'removed'
export type DecisionMakerKind = 'self' | 'guardian' | 'nominee'
export type BillingStatus = 'trial' | 'active' | 'past_due' | 'cancelled'
export type InviteStatus = 'pending' | 'accepted' | 'expired'
export type AccessAction = 'view' | 'share' | 'revoke'

export interface Organisation {
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
  created_at: string
}

export interface Profile {
  id: string
  full_name: string
  role: Role
  org_id: string | null
  created_at: string
}

export interface Client {
  id: string
  org_id: string
  full_name: string
  setting: string | null
  dob: string | null
  about: {
    loves?: string
    calming?: string
    comms?: string
  }
  decision_maker_id: string | null
  decision_maker_kind: DecisionMakerKind | null
  goals: Array<{ id: string; title: string; description?: string }>
  active: boolean
  created_at: string
}

export interface ClientWorker {
  client_id: string
  worker_id: string
}

export interface ClientFamily {
  client_id: string
  family_id: string
  relationship: string | null
  status: 'invited' | 'active'
}

export interface ClientCircle {
  id: string
  client_id: string
  therapist_id: string
  status: NoteShareStatus
  proposed_by: string | null
  approved_by: string | null
  created_at: string
}

export interface LogEntry {
  id: string
  client_id: string
  org_id: string
  author_id: string
  type: LogType
  label: string
  occurred_at: string
  photo_path: string | null
  created_at: string
}

export interface BehaviourNote {
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
  occurred_at: string
  created_at: string
}

export interface NoteShare {
  id: string
  note_id: string
  therapist_id: string
  shared_by: string
  created_at: string
  revoked_at: string | null
}

export interface AccessLog {
  id: string
  actor_id: string
  note_id: string
  action: AccessAction
  created_at: string
}

export interface Message {
  id: string
  client_id: string
  org_id: string
  sender_id: string
  body: string
  created_at: string
}

export interface Invite {
  id: string
  org_id: string
  email: string
  role: Role
  client_id: string | null
  token: string
  status: InviteStatus
  expires_at: string
  created_at: string
}

export interface OrgSettings {
  id: string
  org_id: string
  theme: {
    logo_url?: string
    primary?: string
    accent?: string
    font_display?: string
    font_ui?: string
  }
  digest_send_time: string
  locale: string
  feature_flags: Record<string, boolean>
  retention_preferences: Record<string, unknown>
  created_at: string
}

// Supabase Database type shape for the typed client
export interface Database {
  public: {
    Tables: {
      organisations: { Row: Organisation; Insert: Omit<Organisation, 'id' | 'created_at'>; Update: Partial<Organisation> }
      profiles: { Row: Profile; Insert: Omit<Profile, 'created_at'>; Update: Partial<Profile> }
      clients: { Row: Client; Insert: Omit<Client, 'id' | 'created_at'>; Update: Partial<Client> }
      client_workers: { Row: ClientWorker; Insert: ClientWorker; Update: Partial<ClientWorker> }
      client_family: { Row: ClientFamily; Insert: ClientFamily; Update: Partial<ClientFamily> }
      client_circle: { Row: ClientCircle; Insert: Omit<ClientCircle, 'id' | 'created_at'>; Update: Partial<ClientCircle> }
      log_entries: { Row: LogEntry; Insert: Omit<LogEntry, 'id' | 'created_at'>; Update: Partial<LogEntry> }
      behaviour_notes: { Row: BehaviourNote; Insert: Omit<BehaviourNote, 'id' | 'created_at'>; Update: Partial<BehaviourNote> }
      note_shares: { Row: NoteShare; Insert: Omit<NoteShare, 'id' | 'created_at'>; Update: Partial<NoteShare> }
      access_log: { Row: AccessLog; Insert: Omit<AccessLog, 'id' | 'created_at'>; Update: Partial<AccessLog> }
      messages: { Row: Message; Insert: Omit<Message, 'id' | 'created_at'>; Update: Partial<Message> }
      invites: { Row: Invite; Insert: Omit<Invite, 'id' | 'created_at'>; Update: Partial<Invite> }
      org_settings: { Row: OrgSettings; Insert: Omit<OrgSettings, 'id' | 'created_at'>; Update: Partial<OrgSettings> }
    }
  }
}
