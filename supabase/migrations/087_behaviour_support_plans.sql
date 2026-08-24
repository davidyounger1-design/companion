-- 087_behaviour_support_plans.sql — behaviour support plans register
--
-- GAP-REPORT-HANDOFF §2c: one row per uploaded BSP document per participant,
-- with a Storage file reference (mirrors the log_entries photo_path pattern:
-- client uploads to a private bucket, the row stores the object key) and a
-- review-due date. The restrictive_practices → BSP FK is added HERE (plan
-- ordering ruling: 086 deliberately ships without it).
--
-- The bsp-documents bucket itself is dashboard-managed (bucket + storage
-- policies are not in SQL migrations — journal-photos was created the same
-- way; see morning handoff). Documents must NOT go in journal-photos: that
-- pipeline encrypts per-org photo keys (018) and thumbnails (061), which
-- would corrupt PDFs/Word files.
--
-- Access mirrors 053_incidents.sql / 086's policy shape (workers assigned to
-- the client can view, coordinators manage, decision makers view).
-- Edits (e.g. review_due) are audited by 084's fn_record_revision().

create table if not exists companion.behaviour_support_plans (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references companion.organisations(id) on delete cascade,
  client_id   uuid not null references companion.clients(id)       on delete cascade,
  uploaded_by uuid not null references companion.profiles(id)      on delete restrict,
  file_path   text not null, -- object key in the bsp-documents Storage bucket
  file_name   text not null, -- original filename for display
  review_due  date,
  created_at  timestamptz not null default now()
);

create index if not exists behaviour_support_plans_client_idx
  on companion.behaviour_support_plans (client_id, created_at desc);
create index if not exists behaviour_support_plans_org_idx
  on companion.behaviour_support_plans (org_id);

alter table companion.behaviour_support_plans enable row level security;

drop policy if exists "workers can view behaviour support plans"        on companion.behaviour_support_plans;
drop policy if exists "coordinators can manage behaviour support plans" on companion.behaviour_support_plans;
drop policy if exists "decision_maker can view behaviour support plans" on companion.behaviour_support_plans;

create policy "workers can view behaviour support plans"
  on companion.behaviour_support_plans for select
  using (
    client_id in (select public.client_ids_for_worker())
  );

create policy "coordinators can manage behaviour support plans"
  on companion.behaviour_support_plans for all
  using (
    org_id in (select org_id from companion.profiles where id = auth.uid() and role = 'coordinator')
  );

create policy "decision_maker can view behaviour support plans"
  on companion.behaviour_support_plans for select
  using (
    client_id in (select id from companion.clients where decision_maker_id = auth.uid())
  );

-- Link from the restrictive practices register (added here so 086 needed no
-- forward reference; SET NULL so a removed plan never orphans a register row
-- from the wrong direction).
alter table companion.restrictive_practices
  add column if not exists bsp_id uuid
  references companion.behaviour_support_plans(id) on delete set null;

create index if not exists restrictive_practices_bsp_idx
  on companion.restrictive_practices (bsp_id);

-- Audit trail (084): snapshot OLD rows on every edit.
drop trigger if exists trg_behaviour_support_plans_revision on companion.behaviour_support_plans;
create trigger trg_behaviour_support_plans_revision
  before update on companion.behaviour_support_plans
  for each row execute function companion.fn_record_revision();
