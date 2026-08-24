// export-records — server-side, access-controlled, audit-logged exports
// (Task 5 of the NDIS-compliance plan; brief in
// .superpowers/sdd/2026-08-24-ndis-compliance-workflow/task-5-brief.md).
//
// WHY SERVER-SIDE: client-side exports (the old notesToCsv path) bypass
// entitlement/role checks entirely and leave no audit trail. This function
// is the export path: it verifies the caller's org entitlement
// (organisations.entitlements), gates the export roles, checks per-client
// kinds against the caller's actual client connections, reads all data
// through the CALLER's JWT (so RLS still applies — nothing is escalated),
// and records every export in companion.export_log (migration 088).
//
// Access-control summary (everything fails closed):
//   1. Entitlement — organisations.entitlements must include 'ndis_exports'.
//      Read directly via the USER client, NOT org_has_feature(): that
//      helper's my_org_id() derives from the request's auth context, which
//      the service-role admin client does not carry. (Same trap as
//      invite-member's entitlement backstop, which reads the entitlements
//      array directly for the same reason.)
//   2. Role gate — the exact union of roles whose pages render the export
//      button today (grep notesToCsv / ndis_exports in src): coordinator,
//      support_worker, trusted_support_worker, family. Recipients never see
//      the button (FamilyDashboard gates the section on !isRecipient) and
//      therapists have no page that renders it.
//   3. Per-client kinds (participant_record, goal_progress,
//      medication_record) need a client_id the caller is genuinely connected
//      to: coordinator -> client_ids_for_org(), family ->
//      client_ids_for_family(), worker roles -> client_ids_for_worker().
//      These SECURITY DEFINER RPCs resolve auth.uid() from the caller's JWT
//      via the user client. The data reads are then scoped to that client.
//   4. Register/claim kinds (incident_register,
//      restrictive_practices_register, claim_summary) are org-wide; no
//      client_id (the audit row writes NULL). RLS on the user client still
//      limits what each role can actually read — a family member's
//      org-wide query returns only rows their RLS allows.
//   5. The export_log insert runs as service_role (088 revokes
//      insert/update/delete from anon/authenticated) and is best-effort:
//      if 088 has not been applied to the DB yet, the export still
//      succeeds and the failure is logged here — a short unaudited window
//      is accepted rather than bricking day-time exports.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// 088's check lists — validated BEFORE any data read (see handler).
const KINDS = [
  'participant_record',
  'goal_progress',
  'medication_record',
  'incident_register',
  'restrictive_practices_register',
  'claim_summary',
] as const
type ExportKind = (typeof KINDS)[number]

const FORMATS = ['csv', 'pdf'] as const
type ExportFormat = (typeof FORMATS)[number]

const CLIENT_SCOPED_KINDS = new Set<string>(['participant_record', 'goal_progress', 'medication_record'])

const EXPORT_ROLES = new Set(['coordinator', 'support_worker', 'trusted_support_worker', 'family'])

const ENTITLEMENT_KEY = 'ndis_exports'

// ─────────────────────────────────────────────────────────────
// Column layouts. participant_record mirrors the old client-side
// notesToCsv() exactly (same headers, same cell values) so the CSV UX does
// not regress. widths are relative fractions of the usable PDF width.
// ─────────────────────────────────────────────────────────────

const COLUMNS: Record<ExportKind, { header: string; width: number }[]> = {
  participant_record: [
    { header: 'Date', width: 1.1 },
    { header: 'Title', width: 1.2 },
    { header: 'Mood before', width: 0.7 },
    { header: 'Mood after', width: 0.7 },
    { header: 'Antecedent', width: 1.2 },
    { header: 'Behaviour', width: 1.2 },
    { header: 'Response', width: 1.2 },
    { header: 'Flagged for review', width: 0.8 },
  ],
  goal_progress: [
    { header: 'Date', width: 1.0 },
    { header: 'Goal', width: 1.6 },
    { header: 'Rating', width: 0.8 },
    { header: 'Notes', width: 1.8 },
    { header: 'Recorded by', width: 1.0 },
  ],
  medication_record: [
    { header: 'Date administered', width: 1.1 },
    { header: 'Medication', width: 1.2 },
    { header: 'Status', width: 0.7 },
    { header: 'Note', width: 1.6 },
    { header: 'Administered by', width: 1.1 },
  ],
  incident_register: [
    { header: 'Date', width: 1.0 },
    { header: 'Participant', width: 1.1 },
    { header: 'Severity', width: 0.6 },
    { header: 'Category', width: 0.7 },
    { header: 'Status', width: 0.6 },
    { header: 'Description', width: 1.5 },
    { header: 'Immediate action', width: 1.2 },
    { header: 'Resolution notes', width: 1.2 },
  ],
  restrictive_practices_register: [
    { header: 'Started', width: 0.9 },
    { header: 'Participant', width: 1.1 },
    { header: 'Type', width: 0.8 },
    { header: 'Authorised', width: 0.7 },
    { header: 'Authorisation reference', width: 1.3 },
    { header: 'Ended', width: 0.9 },
    { header: 'Notes', width: 1.4 },
  ],
  claim_summary: [
    { header: 'Date', width: 0.9 },
    { header: 'Participant', width: 1.2 },
    { header: 'Service', width: 1.6 },
    { header: 'Category', width: 0.8 },
    { header: 'Completed by', width: 1.1 },
  ],
}

const KIND_TITLE: Record<ExportKind, string> = {
  participant_record: 'Behaviour notes',
  goal_progress: 'Goal progress',
  medication_record: 'Medication record',
  incident_register: 'Incident register',
  restrictive_practices_register: 'Restrictive practices register',
  claim_summary: 'Claim summary',
}

// ── Row fetch per kind (all reads via the caller's user client) ──────────

async function namesById(
  userClient: ReturnType<typeof createClient>,
  table: string,
  ids: string[],
  nameColumn = 'full_name',
): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  if (!ids.length) return map
  const { data, error } = await userClient.from(table).select(`id, ${nameColumn}`).in('id', ids)
  if (error) throw new Error(`Could not read ${table}: ${error.message}`)
  for (const row of data ?? []) {
    if (row?.id && typeof row[nameColumn] === 'string') map.set(row.id, row[nameColumn] as string)
  }
  return map
}

async function participantName(userClient: ReturnType<typeof createClient>, clientId: string): Promise<string | null> {
  const { data } = await userClient.from('clients').select('full_name').eq('id', clientId).maybeSingle()
  return typeof (data as { full_name?: unknown } | null)?.full_name === 'string'
    ? (data as { full_name: string }).full_name
    : null
}

async function fetchRows(
  kind: ExportKind,
  userClient: ReturnType<typeof createClient>,
  orgId: string,
  clientId: string | null,
): Promise<{ rows: string[][]; participantName: string | null }> {
  switch (kind) {
    case 'participant_record': {
      const { data: notes, error } = await userClient
        .from('behaviour_notes')
        .select('*')
        .eq('client_id', clientId)
        .order('occurred_at', { ascending: false })
      if (error) throw new Error(`Could not read behaviour notes: ${error.message}`)
      const rows = (notes ?? []).map((n) => [
        fmtDate(n.occurred_at), n.title ?? '',
        n.mood_before != null ? String(n.mood_before) : '',
        n.mood_after != null ? String(n.mood_after) : '',
        n.antecedent ?? '', n.behaviour ?? '', n.response ?? '',
        n.flagged_for_review ? 'Yes' : 'No',
      ])
      return { rows, participantName: await participantName(userClient, clientId!) }
    }

    case 'goal_progress': {
      const { data: records, error } = await userClient
        .from('goal_progress_records')
        .select('*')
        .eq('client_id', clientId)
        .order('occurred_at', { ascending: false })
      if (error) throw new Error(`Could not read goal progress: ${error.message}`)
      const { data: goals, error: goalsErr } = await userClient
        .from('participant_goals')
        .select('id, title')
        .eq('client_id', clientId)
      if (goalsErr) throw new Error(`Could not read goals: ${goalsErr.message}`)
      const goalTitles = new Map<string, string>((goals ?? []).map((g) => [g.id, g.title ?? '']))
      const authorIds = [...new Set((records ?? []).map((r) => r.author_id as string))]
      const authors = await namesById(userClient, 'profiles', authorIds)
      const rows = (records ?? []).map((r) => [
        fmtDate(r.occurred_at),
        goalTitles.get(r.goal_id) ?? '',
        r.rating ?? '',
        r.notes ?? '',
        authors.get(r.author_id) ?? '',
      ])
      return { rows, participantName: await participantName(userClient, clientId!) }
    }

    case 'medication_record': {
      const { data: logs, error } = await userClient
        .from('medication_logs')
        .select('*')
        .eq('client_id', clientId)
        .order('administered_at', { ascending: false })
      if (error) throw new Error(`Could not read medication records: ${error.message}`)
      const medIds = [...new Set((logs ?? []).map((l) => l.medication_id as string))]
      const meds = await namesById(userClient, 'medications', medIds, 'name')
      const adminIds = [...new Set((logs ?? []).map((l) => l.administered_by as string))]
      const admins = await namesById(userClient, 'profiles', adminIds)
      const rows = (logs ?? []).map((l) => [
        fmtDate(l.administered_at),
        meds.get(l.medication_id) ?? '',
        l.status ?? '',
        l.note ?? '',
        admins.get(l.administered_by) ?? '',
      ])
      return { rows, participantName: await participantName(userClient, clientId!) }
    }

    case 'incident_register': {
      const { data: incidents, error } = await userClient
        .from('incidents')
        .select('*')
        .eq('org_id', orgId)
        .order('occurred_at', { ascending: false })
      if (error) throw new Error(`Could not read incidents: ${error.message}`)
      const clientIds = [...new Set((incidents ?? []).map((i) => i.client_id as string))]
      const clients = await namesById(userClient, 'clients', clientIds)
      const rows = (incidents ?? []).map((i) => [
        fmtDate(i.occurred_at),
        clients.get(i.client_id) ?? '',
        i.severity ?? '', i.category ?? '', i.status ?? '',
        i.description ?? '', i.immediate_action ?? '', i.resolution_notes ?? '',
      ])
      return { rows, participantName: null }
    }

    case 'restrictive_practices_register': {
      const { data: practices, error } = await userClient
        .from('restrictive_practices')
        .select('*')
        .eq('org_id', orgId)
        .order('started_at', { ascending: false })
      if (error) throw new Error(`Could not read restrictive practices: ${error.message}`)
      const clientIds = [...new Set((practices ?? []).map((p) => p.client_id as string))]
      const clients = await namesById(userClient, 'clients', clientIds)
      const rows = (practices ?? []).map((p) => [
        fmtDate(p.started_at),
        clients.get(p.client_id) ?? '',
        p.type ?? '',
        p.authorised ? 'Yes' : 'No',
        p.authorisation_reference ?? '',
        p.ended_at ? fmtDate(p.ended_at) : '',
        p.notes ?? '',
      ])
      return { rows, participantName: null }
    }

    case 'claim_summary': {
      // There is no invoicing/claims table in the schema (verified: grep
      // 'claim' across supabase/migrations only hits plans/landing copy), so
      // the closest claimable-service record is delivered services: schedule
      // item completions joined to their schedule item (title/category).
      const { data: completions, error } = await userClient
        .from('schedule_item_completions')
        .select('*')
        .eq('org_id', orgId)
        .order('occurrence_date', { ascending: false })
      if (error) throw new Error(`Could not read service completions: ${error.message}`)
      const itemIds = [...new Set((completions ?? []).map((c) => c.schedule_item_id as string))]
      const itemMap = new Map<string, { title: string; category: string }>()
      if (itemIds.length) {
        const { data: items, error: itemsErr } = await userClient
          .from('schedule_items')
          .select('id, title, category')
          .in('id', itemIds)
        if (itemsErr) throw new Error(`Could not read schedule items: ${itemsErr.message}`)
        for (const item of items ?? []) itemMap.set(item.id, { title: item.title ?? '', category: item.category ?? '' })
      }
      const clientIds = [...new Set((completions ?? []).map((c) => c.client_id as string))]
      const clients = await namesById(userClient, 'clients', clientIds)
      const workerIds = [...new Set((completions ?? []).map((c) => c.completed_by as string))]
      const workers = await namesById(userClient, 'profiles', workerIds)
      const rows = (completions ?? []).map((c) => [
        fmtDateOnly(c.occurrence_date),
        clients.get(c.client_id) ?? '',
        itemMap.get(c.schedule_item_id)?.title ?? '',
        itemMap.get(c.schedule_item_id)?.category ?? '',
        workers.get(c.completed_by) ?? '',
      ])
      return { rows, participantName: null }
    }
  }
}

// ── Formatting helpers ────────────────────────────────────────

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return String(iso)
  // Server-side we cannot know the caller's timezone; format in UTC.
  return d.toLocaleString('en-AU', {
    timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

function fmtDateOnly(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return String(iso)
  return d.toLocaleDateString('en-AU', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' })
}

function toCsv(columns: { header: string }[], rows: string[][]): string {
  // Mirrors the old notesToCsv() escaping exactly: every field quoted,
  // embedded quotes doubled.
  const cell = (v: string) => `"${String(v).replace(/"/g, '""')}"`
  const header = columns.map((c) => cell(c.header)).join(',')
  const body = rows.map((r) => r.map(cell).join(','))
  return [header, ...body].join('\n')
}

function exportFilename(kind: ExportKind, format: ExportFormat, participantName: string | null): string {
  const slug = (s: string) => s.toLowerCase().replace(/\s+/g, '-')
  const p = participantName ? `-${slug(participantName)}` : ''
  const base: Record<ExportKind, string> = {
    participant_record: `behaviour-notes${p}`,
    goal_progress: `goal-progress${p}`,
    medication_record: `medication-record${p}`,
    incident_register: 'incident-register',
    restrictive_practices_register: 'restrictive-practices-register',
    claim_summary: 'claim-summary',
  }
  return `${base[kind]}.${format}`
}

// ─────────────────────────────────────────────────────────────
// Minimal hand-rolled PDF writer (PDF 1.4, A4 landscape, base-14
// Helvetica — never embedded, no dependencies). Every string is
// sanitised to printable ASCII / Latin-1 before escaping, so the
// whole file is ASCII and the xref byte offsets are exact string
// lengths. Opens in any PDF viewer.
// ─────────────────────────────────────────────────────────────

const PAGE_W = 841.89
const PAGE_H = 595.28
const PDF_MARGIN = 36
const ROW_H = 15
const TITLE_SIZE = 13
const SUBTITLE_SIZE = 9
const HEADER_SIZE = 8.5
const BODY_SIZE = 8.5
const ROWS_PER_PAGE = 30

function pdfSanitize(s: string): string {
  let out = ''
  for (const ch of String(s)) {
    const c = ch.codePointAt(0) ?? 0
    if (c === 10 || c === 13 || c === 9) out += ' '
    else if (c === 0x2018 || c === 0x2019 || c === 0x02bc) out += "'"
    else if (c === 0x201c || c === 0x201d) out += '"'
    else if (c === 0x2013 || c === 0x2014) out += '-'
    else if (c === 0x2026) out += '...'
    else if (c >= 32 && c <= 126) out += ch
    else if (c >= 161 && c <= 255) out += ch
    else out += '?'
  }
  return out
}

function pdfEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
}

function pdfTextWidth(s: string, size: number): number {
  let units = 0
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0
    if (c === 32) units += 0.28
    else if (c === 119 || c === 109) units += 0.65 // w m
    else if (c === 87 || c === 77) units += 0.72 // W M
    else if ('ilIjtf.,;\':|!'.includes(ch)) units += 0.24
    else units += 0.5
  }
  return units * size
}

function pdfFit(text: string, maxWidth: number, size: number): string {
  const s = pdfSanitize(text)
  if (pdfTextWidth(s, size) <= maxWidth) return s
  let out = ''
  for (const ch of s) {
    if (pdfTextWidth(out + ch, size) > maxWidth) break
    out += ch
  }
  return out.length ? out + '...' : '...'
}

function contentStream(
  title: string,
  subtitle: string,
  headers: string[],
  colWidths: number[],
  rows: string[][],
  pageIndex: number,
): string {
  const ops: string[] = []
  const usable = PAGE_W - 2 * PDF_MARGIN
  const total = colWidths.reduce((a, b) => a + b, 0) || 1
  const xs: number[] = []
  let acc = PDF_MARGIN
  for (const w of colWidths) {
    xs.push(acc)
    acc += (usable * w) / total
  }
  const colW = (c: number) => xs[c + 1] !== undefined ? xs[c + 1] - xs[c] : usable - xs[c] + PDF_MARGIN

  const num = (n: number) => (Math.round(n * 100) / 100).toString()

  let y: number
  if (pageIndex === 0) {
    y = PAGE_H - PDF_MARGIN - 58
    ops.push(`BT /F2 ${TITLE_SIZE} Tf 1 0 0 1 ${PDF_MARGIN} ${num(y + 13)} Tm (${pdfEscape(pdfSanitize(title))}) Tj ET`)
    ops.push(`BT /F1 ${SUBTITLE_SIZE} Tf 1 0 0 1 ${PDF_MARGIN} ${num(y)} Tm (${pdfEscape(pdfSanitize(subtitle))}) Tj ET`)
    y -= 24
  } else {
    y = PAGE_H - PDF_MARGIN - 14
  }

  for (let c = 0; c < headers.length; c++) {
    ops.push(`BT /F2 ${HEADER_SIZE} Tf 1 0 0 1 ${num(xs[c])} ${num(y)} Tm (${pdfEscape(pdfFit(headers[c], colW(c) - 6, HEADER_SIZE))}) Tj ET`)
  }
  y -= ROW_H

  for (const row of rows) {
    for (let c = 0; c < row.length; c++) {
      ops.push(`BT /F1 ${BODY_SIZE} Tf 1 0 0 1 ${num(xs[c])} ${num(y)} Tm (${pdfEscape(pdfFit(row[c], colW(c) - 6, BODY_SIZE))}) Tj ET`)
    }
    y -= ROW_H
  }
  return ops.join('\n')
}

function buildPdf(
  title: string,
  subtitle: string,
  headers: string[],
  colWidths: number[],
  dataRows: string[][],
): string {
  const pages: string[][][] = []
  for (let i = 0; i < dataRows.length; i += ROWS_PER_PAGE) pages.push(dataRows.slice(i, i + ROWS_PER_PAGE))
  if (!pages.length) pages.push([])
  const N = pages.length

  const streams = pages.map((rows, i) => contentStream(title, subtitle, headers, colWidths, rows, i))

  const parts: string[] = []
  let offset = 0
  const emit = (s: string) => {
    parts.push(s)
    offset += s.length
  }
  const pad10 = (n: number) => String(n).padStart(10, '0')

  emit('%PDF-1.4\n')
  const catalogOff = offset
  emit('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n')
  const pagesOff = offset
  emit(`2 0 obj\n<< /Type /Pages /Kids [${pages.map((_, i) => `${3 + i} 0 R`).join(' ')}] /Count ${N} >>\nendobj\n`)

  const pageOffs: number[] = []
  for (let i = 0; i < N; i++) {
    pageOffs.push(offset)
    emit(
      `${3 + i} 0 obj\n` +
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] ` +
      `/Resources << /Font << /F1 ${3 + 2 * N} 0 R /F2 ${4 + 2 * N} 0 R >> >> ` +
      `/Contents ${3 + N + i} 0 R >>\nendobj\n`,
    )
  }

  const streamOffs: number[] = []
  for (let i = 0; i < N; i++) {
    streamOffs.push(offset)
    emit(`${3 + N + i} 0 obj\n<< /Length ${streams[i].length} >>\nstream\n${streams[i]}\nendstream\nendobj\n`)
  }

  const font1Off = offset
  emit(`${3 + 2 * N} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n`)
  const font2Off = offset
  emit(`${4 + 2 * N} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj\n`)

  const xrefOff = offset
  const M = 4 + 2 * N
  let xref = `xref\n0 ${M + 1}\n0000000000 65535 f \n`
  xref += pad10(catalogOff) + ' 00000 n \n'
  xref += pad10(pagesOff) + ' 00000 n \n'
  for (const o of pageOffs) xref += pad10(o) + ' 00000 n \n'
  for (const o of streamOffs) xref += pad10(o) + ' 00000 n \n'
  xref += pad10(font1Off) + ' 00000 n \n'
  xref += pad10(font2Off) + ' 00000 n \n'
  emit(xref)
  emit(`trailer\n<< /Size ${M + 1} /Root 1 0 R >>\nstartxref\n${xrefOff}\n%%EOF\n`)

  return parts.join('')
}

// ── Deno.serve entrypoint ─────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const json = (body: unknown) =>
    new Response(JSON.stringify(body), { headers: { ...cors, 'Content-Type': 'application/json' } })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ ok: false, error: 'Unauthorized' })

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    const userClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: authHeader } },
      db: { schema: 'companion' },
    })
    const { data: { user } } = await userClient.auth.getUser()
    if (!user) return json({ ok: false, error: 'Unauthorized' })

    let body: { kind?: unknown; format?: unknown; client_id?: unknown }
    try {
      body = await req.json()
    } catch {
      return json({ ok: false, error: 'Invalid request body' })
    }

    // Ruling 4: validate against 088's check lists BEFORE any data read.
    if (!KINDS.includes(body.kind as ExportKind)) {
      return json({ ok: false, error: `Unknown export kind: ${String(body.kind)}` })
    }
    if (!FORMATS.includes(body.format as ExportFormat)) {
      return json({ ok: false, error: `Unknown export format: ${String(body.format)}` })
    }
    const kind = body.kind as ExportKind
    const format = body.format as ExportFormat

    const isClientScoped = CLIENT_SCOPED_KINDS.has(kind)
    const clientId = typeof body.client_id === 'string' && body.client_id ? body.client_id : null
    if (isClientScoped && !clientId) {
      return json({ ok: false, error: 'client_id is required for this export kind' })
    }

    // Caller's org + role (user client — RLS allows reading your own row).
    const { data: profile, error: profileErr } = await userClient
      .from('profiles')
      .select('org_id, role')
      .eq('id', user.id)
      .maybeSingle()
    if (profileErr || !profile?.org_id) {
      return json({ ok: false, error: 'Could not identify your organisation' })
    }

    // Ruling 3(i): entitlement — read organisations.entitlements directly
    // with the USER client (NOT org_has_feature(), whose my_org_id() comes
    // from the auth context — and NOT the admin client, which has none).
    // Fail closed on any read problem or a missing key.
    const { data: orgRow, error: orgErr } = await userClient
      .from('organisations')
      .select('entitlements')
      .eq('id', profile.org_id)
      .maybeSingle()
    if (orgErr || !orgRow) {
      return json({ ok: false, error: 'Could not read your organisation' })
    }
    const entitlements = orgRow.entitlements
    if (!Array.isArray(entitlements) || !entitlements.includes(ENTITLEMENT_KEY)) {
      return json({ ok: false, error: `Your organisation's plan does not include '${ENTITLEMENT_KEY}' (required for exports)` })
    }

    // Ruling 3(ii): role gate — the exact union of roles the current
    // export buttons show for (see header comment).
    if (!EXPORT_ROLES.has(profile.role)) {
      return json({ ok: false, error: `Exports are not available for your role (${profile.role})` })
    }

    // Ruling 3(iii): per-client kinds — caller must be genuinely connected
    // to this client. The membership RPCs are SECURITY DEFINER and resolve
    // auth.uid() from the caller's JWT via the user client.
    if (isClientScoped) {
      const rpcName = profile.role === 'coordinator'
        ? 'client_ids_for_org'
        : profile.role === 'family'
          ? 'client_ids_for_family'
          : 'client_ids_for_worker'
      const { data: ids, error: rpcErr } = await userClient.rpc(rpcName)
      if (rpcErr) return json({ ok: false, error: `Could not verify client access: ${rpcErr.message}` })
      if (!Array.isArray(ids) || !ids.includes(clientId!)) {
        return json({ ok: false, error: "You're not connected to that participant" })
      }
    }

    // Data read — user client only, so RLS still applies; nothing is
    // escalated relative to what the caller can already see in the app.
    const { rows, participantName } = await fetchRows(kind, userClient, profile.org_id, clientId)

    const columns = COLUMNS[kind]
    let content: string
    let encoding: string | undefined
    if (format === 'csv') {
      content = toCsv(columns, rows)
    } else {
      const subtitle = `Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`
      content = btoa(buildPdf(KIND_TITLE[kind], subtitle, columns.map((c) => c.header), columns.map((c) => c.width), rows))
      encoding = 'base64'
    }

    // Ruling 5: audit write is best-effort. 088 revokes insert from
    // anon/authenticated, so this runs as service_role; if the table does
    // not exist yet (migration not applied) we log and still return the
    // export — a short unaudited window beats bricking day-time exports.
    try {
      const admin = createClient(supabaseUrl, serviceKey, { db: { schema: 'companion' } })
      const { error: auditErr } = await admin.from('export_log').insert({
        org_id: profile.org_id,
        actor_id: user.id,
        client_id: isClientScoped ? clientId : null,
        kind,
        format,
      })
      if (auditErr) console.error('[export-records] export_log insert failed (export still returned):', auditErr.message)
    } catch (auditErr) {
      console.error('[export-records] export_log insert threw (export still returned):', (auditErr as Error).message)
    }

    return json({ ok: true, filename: exportFilename(kind, format, participantName), content, encoding })

  } catch (e) {
    return json({ ok: false, error: (e as Error).message })
  }
})
