-- ─────────────────────────────────────────────────────────────
-- 061 · Photo thumbnails (idempotent)
-- Journal photos are full-resolution, client-side-encrypted files — on a
-- slow connection (reported: iPhone on 4G, 2 bars) the inline journal feed
-- had to fully download and decrypt every full photo just to show a small
-- preview. Adds an optional smaller companion image, generated and
-- encrypted client-side alongside the original, used for the inline
-- preview; the full photo now only downloads when a viewer taps to open it.
-- ─────────────────────────────────────────────────────────────

alter table companion.log_entries add column if not exists photo_thumb_path text;
