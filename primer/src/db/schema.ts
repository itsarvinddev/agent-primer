// The style-graph schema, inlined so the build is a plain `tsc` (no asset copy).
// Mirrors CodeGraph's patterns: WAL, FTS5 external-content index + triggers,
// schema versioning. The controlled `category` enum is enforced in the store
// layer (SQLite has no enum), not here.

export const SCHEMA_VERSION = 1;

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS primer_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS preferences (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  scope        TEXT NOT NULL DEFAULT 'project',
  category     TEXT NOT NULL,
  statement    TEXT NOT NULL,
  detail       TEXT,
  source       TEXT NOT NULL DEFAULT 'user-stated',
  weight       REAL NOT NULL DEFAULT 1.0,
  status       TEXT NOT NULL DEFAULT 'active',
  language     TEXT,
  framework    TEXT,
  signal_count INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  UNIQUE(category, statement)
);
CREATE INDEX IF NOT EXISTS idx_pref_cat ON preferences(category);
CREATE INDEX IF NOT EXISTS idx_pref_status ON preferences(status);

CREATE TABLE IF NOT EXISTS tags (
  pref_id INTEGER NOT NULL REFERENCES preferences(id) ON DELETE CASCADE,
  tag     TEXT NOT NULL,
  PRIMARY KEY (pref_id, tag)
);
CREATE INDEX IF NOT EXISTS idx_tags_tag ON tags(tag);

CREATE TABLE IF NOT EXISTS pref_edges (
  source_id  INTEGER NOT NULL REFERENCES preferences(id) ON DELETE CASCADE,
  target_id  INTEGER NOT NULL REFERENCES preferences(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (source_id, target_id, kind)
);

CREATE TABLE IF NOT EXISTS signals (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  kind           TEXT NOT NULL DEFAULT 'edit',
  file_path      TEXT NOT NULL,
  language       TEXT,
  excerpt_before TEXT,
  excerpt_after  TEXT,
  agent          TEXT,
  processed      INTEGER NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_signals_processed ON signals(processed);

CREATE VIRTUAL TABLE IF NOT EXISTS preferences_fts USING fts5(
  statement, detail, category,
  content='preferences', content_rowid='id'
);
CREATE TRIGGER IF NOT EXISTS preferences_ai AFTER INSERT ON preferences BEGIN
  INSERT INTO preferences_fts(rowid, statement, detail, category)
  VALUES (new.id, new.statement, new.detail, new.category);
END;
CREATE TRIGGER IF NOT EXISTS preferences_ad AFTER DELETE ON preferences BEGIN
  INSERT INTO preferences_fts(preferences_fts, rowid, statement, detail, category)
  VALUES ('delete', old.id, old.statement, old.detail, old.category);
END;
CREATE TRIGGER IF NOT EXISTS preferences_au AFTER UPDATE ON preferences BEGIN
  INSERT INTO preferences_fts(preferences_fts, rowid, statement, detail, category)
  VALUES ('delete', old.id, old.statement, old.detail, old.category);
  INSERT INTO preferences_fts(rowid, statement, detail, category)
  VALUES (new.id, new.statement, new.detail, new.category);
END;
`;
