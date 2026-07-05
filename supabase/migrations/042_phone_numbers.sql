-- ─────────────────────────────────────────────────────────────
-- 042 · Capture mobile numbers, for text-message invites
--
-- No SMS provider is wired up — sending real SMS/iMessage from a
-- server isn't something Apple exposes an API for outside of the
-- heavyweight, business-verified "Messages for Business" program.
-- Instead, a captured phone number powers a "Text invite" button
-- that opens the *inviter's own* Messages app with the invite link
-- pre-filled (an `sms:` link) — no account, no cost, they just tap
-- Send from their own phone.
-- ─────────────────────────────────────────────────────────────

alter table profiles add column if not exists phone text;
alter table invites  add column if not exists phone text;
