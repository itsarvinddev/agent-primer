// node:sqlite adapter. Zero native build; WAL + busy_timeout so concurrent agents
// (each a short-lived `primer` invocation) don't deadlock. `init` is a pure no-op
// when the DB already exists, so re-running the installer is byte-stable.

import type { DatabaseSync } from 'node:sqlite';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { PrimerError, nowIso } from '../types.js';
import { SCHEMA_SQL, SCHEMA_VERSION } from './schema.js';

// node:sqlite is a newer builtin that bundlers (vite/vitest) don't auto-externalize.
// Load it via a runtime require (specifier in a variable) so Node resolves it, never
// the bundler. The type comes from the erased type-only import above.
const sqliteSpecifier = 'node:sqlite';
const sqlite = createRequire(import.meta.url)(sqliteSpecifier) as typeof import('node:sqlite');

export type Row = Record<string, unknown>;

function applyPragmas(db: DatabaseSync): void {
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec('PRAGMA foreign_keys = ON;');
}

function schemaVersion(db: DatabaseSync): number {
  try {
    const row = db.prepare("SELECT value FROM primer_meta WHERE key = 'schema_version'").get() as Row | undefined;
    return row ? Number(row.value) : 0;
  } catch {
    return 0; // primer_meta doesn't exist yet
  }
}

export function setMeta(db: DatabaseSync, key: string, value: string): void {
  db.prepare('INSERT INTO primer_meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(
    key,
    value,
  );
}

export function getMeta(db: DatabaseSync, key: string): string | null {
  const row = db.prepare('SELECT value FROM primer_meta WHERE key = ?').get(key) as Row | undefined;
  return row ? String(row.value) : null;
}

/** Create schema on a fresh DB; no-op (no writes) once current. */
function ensureSchema(db: DatabaseSync): void {
  const v = schemaVersion(db);
  if (v >= SCHEMA_VERSION) return;
  db.exec(SCHEMA_SQL);
  if (v === 0) setMeta(db, 'created_at', nowIso());
  setMeta(db, 'schema_version', String(SCHEMA_VERSION));
}

/**
 * Open a connection. `create:true` makes the dir + schema if absent (used by
 * writes and `init`); otherwise a missing DB is an error (reads).
 */
export function connect(dbPath: string, opts: { create?: boolean } = {}): DatabaseSync {
  if (!existsSync(dbPath)) {
    if (!opts.create) throw new PrimerError(`no primer DB at ${dbPath} — run: primer init`);
    mkdirSync(dirname(dbPath), { recursive: true });
  }
  const db = new sqlite.DatabaseSync(dbPath);
  applyPragmas(db);
  if (opts.create) ensureSchema(db);
  return db;
}

/** Explicit `primer init`: returns true if it created a new DB, false if it already existed. */
export function initDb(dbPath: string): boolean {
  const existed = existsSync(dbPath);
  const db = connect(dbPath, { create: true });
  try {
    ensureSchema(db);
  } finally {
    db.close();
  }
  return !existed;
}

/** Open, run `fn`, always close. Convenience for one-shot CLI commands. */
export function withDb<T>(dbPath: string, opts: { create?: boolean }, fn: (db: DatabaseSync) => T): T {
  const db = connect(dbPath, opts);
  try {
    return fn(db);
  } finally {
    db.close();
  }
}
