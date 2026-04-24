-- D1 migration for the hosted checklist app.
--
-- The data model is intentionally small for v1:
-- - one active checklist
-- - finished items retained as history
-- - one level of child checklist items
-- - stable sort_order values for both top-level and child rows

CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  details TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'finished')),
  sort_order INTEGER NOT NULL,
  parent_id INTEGER REFERENCES items(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_items_status_parent_sort
  ON items(status, parent_id, sort_order);

CREATE INDEX IF NOT EXISTS idx_items_parent
  ON items(parent_id);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO settings (key, value)
VALUES ('active_list_name', 'Today');
