-- Messages are now org-wide (any member to any member), not scoped to a single
-- client. The client_id column is kept for historical messages but is no longer
-- required on new inserts.
ALTER TABLE messages ALTER COLUMN client_id DROP NOT NULL;
