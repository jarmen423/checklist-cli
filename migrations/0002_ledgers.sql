-- Adds multiple ledgers while preserving all existing checklist items.
--
-- Existing rows are assigned to ledger 1, named "Today". New items must carry
-- a ledger_id so UI and CLI operations never accidentally cross ledger
-- boundaries.

CREATE TABLE IF NOT EXISTS ledgers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO ledgers (id, name)
VALUES (1, 'Today');

ALTER TABLE items ADD COLUMN ledger_id INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_items_ledger_status_parent_sort
  ON items(ledger_id, status, parent_id, sort_order);

INSERT OR REPLACE INTO settings (key, value, updated_at)
VALUES ('active_ledger_id', '1', CURRENT_TIMESTAMP);
