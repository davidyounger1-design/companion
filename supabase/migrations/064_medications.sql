-- ─────────────────────────────────────────────────────────────
-- 064 · Medications & medication administration log (idempotent)
--
-- Two tables for medication tracking per participant:
--   companion.medications      — prescription list (what they take)
--   companion.medication_logs  — administration record / MAR (when given)
--
-- Visibility: recipient, their family, and org coordinator can see
-- medications and logs; workers see only assigned clients.  The
-- medication list is managed by coordinator/family only; any team
-- member (including workers) can log an administration.
--
-- Every table reference is schema-qualified because a bare name in a
-- migration resolves against the SQL editor's search_path (public),
-- not companion.
-- ─────────────────────────────────────────────────────────────

create table if not exists companion.medications (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references companion.organisations(id) on delete cascade,
  client_id     uuid not null references companion.clients(id) on delete cascade,
  name          text not null,
  dosage        text,
  frequency     text not null,
  instructions  text,
  route         text,
  prescriber    text,
  active        boolean not null default true,
  created_by    uuid not null references companion.profiles(id),
  created_at    timestamptz not null default now()
);

alter table companion.medications enable row level security;

drop policy if exists "can view medications for own client"       on companion.medications;
drop policy if exists "family/coordinator can insert medications" on companion.medications;
drop policy if exists "family/coordinator can update medications" on companion.medications;
drop policy if exists "family/coordinator can delete medications" on companion.medications;

create policy "can view medications for own client"
  on companion.medications for select
  using (
    client_id in (select public.client_ids_for_recipient())
    or client_id in (select public.client_ids_for_family())
    or client_id in (select public.client_ids_for_org())
    or (org_id = public.my_org_id() and public.my_role() = 'coordinator')
  );

create policy "family/coordinator can insert medications"
  on companion.medications for insert
  with check (
    created_by = auth.uid()
    and org_id = public.my_org_id()
    and (
      (public.my_role() = 'coordinator' and client_id in (select public.client_ids_for_org()))
      or (public.my_role() = 'family' and client_id in (select public.client_ids_for_family()))
    )
  );

create policy "family/coordinator can update medications"
  on companion.medications for update
  using (
    (public.my_role() = 'coordinator' and org_id = public.my_org_id())
    or (public.my_role() = 'family' and client_id in (select public.client_ids_for_family()))
  );

create policy "family/coordinator can delete medications"
  on companion.medications for delete
  using (
    (public.my_role() = 'coordinator' and org_id = public.my_org_id())
    or (public.my_role() = 'family' and client_id in (select public.client_ids_for_family()))
  );

grant select, insert, update, delete on table companion.medications to anon, authenticated;

-- ─── medication_logs ──────────────────────────────────────────

create table if not exists companion.medication_logs (
  id              uuid primary key default gen_random_uuid(),
  medication_id   uuid not null references companion.medications(id) on delete cascade,
  client_id       uuid not null references companion.clients(id) on delete cascade,
  org_id          uuid not null references companion.organisations(id) on delete cascade,
  administered_by uuid not null references companion.profiles(id),
  administered_at timestamptz not null default now(),
  status          text not null default 'taken',
  note            text,
  created_at      timestamptz not null default now()
);

alter table companion.medication_logs enable row level security;

drop policy if exists "can view medication logs for own client"        on companion.medication_logs;
drop policy if exists "team members can insert medication logs"        on companion.medication_logs;
drop policy if exists "author/coordinator can update medication logs"  on companion.medication_logs;
drop policy if exists "author/coordinator can delete medication logs"  on companion.medication_logs;

create policy "can view medication logs for own client"
  on companion.medication_logs for select
  using (
    client_id in (select public.client_ids_for_recipient())
    or client_id in (select public.client_ids_for_family())
    or client_id in (select public.client_ids_for_org())
    or (org_id = public.my_org_id() and public.my_role() = 'coordinator')
  );

create policy "team members can insert medication logs"
  on companion.medication_logs for insert
  with check (
    administered_by = auth.uid()
    and org_id = public.my_org_id()
    and client_id in (select public.client_ids_for_org())
  );

create policy "author/coordinator can update medication logs"
  on companion.medication_logs for update
  using (
    (administered_by = auth.uid())
    or (public.my_role() = 'coordinator' and org_id = public.my_org_id())
  );

create policy "author/coordinator can delete medication logs"
  on companion.medication_logs for delete
  using (
    (administered_by = auth.uid())
    or (public.my_role() = 'coordinator' and org_id = public.my_org_id())
  );

grant select, insert, update, delete on table companion.medication_logs to anon, authenticated;
