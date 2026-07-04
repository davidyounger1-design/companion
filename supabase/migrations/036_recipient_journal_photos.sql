-- ─────────────────────────────────────────────────────────────
-- 036 · Recipients can view their own journal photos   (idempotent)
--
-- The journal-photos storage bucket got RLS policies for family/
-- coordinator (011) and support workers (012) — both written before
-- the recipient role existed (026). Recipients could already see
-- their journal entries (030), but never got a matching storage
-- policy, so the photo file itself was silently denied — the app
-- spins forever waiting for a download that never arrives.
--
-- Path convention (see AddEntry.tsx): {org_id}/{client_id}/{uploader_user_id}/{uuid}.{ext}
-- Scope by client_id (segment 2), not uploader, so a recipient sees
-- photos in their own journal regardless of who logged the entry —
-- same breadth as the family/coordinator policy.
-- ─────────────────────────────────────────────────────────────

drop policy if exists "recipient can view own journal photos" on storage.objects;

create policy "recipient can view own journal photos"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'journal-photos'
    and public.my_role() = 'recipient'
    and (string_to_array(name, '/'))[2]::uuid in (select public.client_ids_for_recipient())
  );
