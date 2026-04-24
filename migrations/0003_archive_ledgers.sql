-- Adds reversible ledger archival.
--
-- `archived_at` keeps old ledgers out of the normal UI and CLI list without
-- destroying their checklist items. Hard delete is still available through the
-- API when a ledger and all of its items should be removed permanently.

ALTER TABLE ledgers ADD COLUMN archived_at TEXT;

CREATE INDEX IF NOT EXISTS idx_ledgers_archived_id
  ON ledgers(archived_at, id);
