// The style-graph store: the single write path (`recordPreference`, an upsert that
// enforces the distillation contract + near-dup gate + conflict/supersede edges)
// plus reads (query, list, the merged brief). The agent supplies intelligence; this
// keeps the graph clean and bounded.

import type { DatabaseSync } from 'node:sqlite';
import { CATEGORIES, type Preference, PrimerError, type Scope, isCategory, isSource, nowIso } from '../types.js';
import type { Row } from '../db/index.js';
import { decayedWeight, ftsMatchExpr, isNegated, jaccard, normalizeStatement } from './text.js';

const MAX_STATEMENT = 200;
const NEAR_DUP_THRESHOLD = 0.5;
const TASK_SPECIFIC = /\b(this file|in here|right here|for now|temporarily|just here|todo|fixme)\b/i;

function rowToPref(r: Row): Preference {
  return {
    id: Number(r.id),
    scope: String(r.scope) as Scope,
    category: String(r.category) as Preference['category'],
    statement: String(r.statement),
    detail: r.detail == null ? null : String(r.detail),
    source: String(r.source) as Preference['source'],
    weight: Number(r.weight),
    status: String(r.status) as Preference['status'],
    language: r.language == null ? null : String(r.language),
    framework: r.framework == null ? null : String(r.framework),
    signal_count: Number(r.signal_count),
    created_at: String(r.created_at),
    updated_at: String(r.updated_at),
  };
}

export function getPreference(db: DatabaseSync, id: number): Preference | null {
  const r = db.prepare('SELECT * FROM preferences WHERE id = ?').get(id) as Row | undefined;
  return r ? rowToPref(r) : null;
}

export function getTags(db: DatabaseSync, prefId: number): string[] {
  const rows = db.prepare('SELECT tag FROM tags WHERE pref_id = ? ORDER BY tag').all(prefId) as Row[];
  return rows.map((r) => String(r.tag));
}

function setTags(db: DatabaseSync, prefId: number, tags: string[] | undefined): void {
  if (!tags || tags.length === 0) return;
  const ins = db.prepare('INSERT OR IGNORE INTO tags(pref_id, tag) VALUES(?, ?)');
  for (const t of tags) {
    const norm = t.trim().toLowerCase();
    if (norm) ins.run(prefId, norm);
  }
}

function addEdge(db: DatabaseSync, source: number, target: number, kind: string): void {
  if (source === target) return;
  db.prepare('INSERT OR IGNORE INTO pref_edges(source_id, target_id, kind, created_at) VALUES(?, ?, ?, ?)').run(
    source,
    target,
    kind,
    nowIso(),
  );
}

function markSignals(db: DatabaseSync, ids: number[] | undefined): void {
  if (!ids || ids.length === 0) return;
  const upd = db.prepare('UPDATE signals SET processed = 1 WHERE id = ?');
  for (const id of ids) upd.run(id);
}

/** Active prefs in the same category whose content overlaps but polarity differs. */
function findConflicts(db: DatabaseSync, category: string, statement: string): Preference[] {
  const rows = db.prepare("SELECT * FROM preferences WHERE category = ? AND status = 'active'").all(category) as Row[];
  const negNew = isNegated(statement);
  return rows
    .map(rowToPref)
    .filter((p) => p.statement !== statement && jaccard(p.statement, statement) >= NEAR_DUP_THRESHOLD && isNegated(p.statement) !== negNew);
}

export interface RecordInput {
  category: string;
  statement: string;
  detail?: string | null;
  source?: string;
  scope?: Scope;
  language?: string | null;
  framework?: string | null;
  tags?: string[];
  signalIds?: number[];
  supersedes?: number;
  force?: boolean;
}

export interface RecordResult {
  status: 'recorded' | 'reinforced' | 'needs_review';
  preference: Preference | null;
  similar: Preference[];
  conflicts: Preference[];
  message: string;
}

/** The one write path. Validates the contract, dedups, links conflicts/supersedes. */
export function recordPreference(db: DatabaseSync, input: RecordInput): RecordResult {
  const category = input.category?.trim().toLowerCase();
  if (!isCategory(category)) {
    throw new PrimerError(`invalid category "${input.category}" — use one of: ${CATEGORIES.join(', ')}`);
  }
  const statement = normalizeStatement(input.statement ?? '');
  if (!statement) throw new PrimerError('statement is required');
  if (statement.length > MAX_STATEMENT) throw new PrimerError(`statement too long (max ${MAX_STATEMENT} chars) — keep it one terse rule`);
  if (TASK_SPECIFIC.test(statement)) throw new PrimerError('statement looks task-specific; record only durable preferences');
  const source = input.source ?? 'user-stated';
  if (!isSource(source)) throw new PrimerError(`invalid source "${source}"`);

  const now = nowIso();
  const scope = input.scope ?? 'project';

  // Exact match -> reinforce (the upsert).
  const existing = db.prepare('SELECT * FROM preferences WHERE category = ? AND statement = ?').get(category, statement) as
    | Row
    | undefined;
  if (existing) {
    const pref = rowToPref(existing);
    const addSignals = input.signalIds?.length ?? (source !== 'user-stated' ? 1 : 0);
    db.prepare(
      "UPDATE preferences SET weight = weight + 1, signal_count = signal_count + ?, status = 'active', updated_at = ?, detail = COALESCE(?, detail) WHERE id = ?",
    ).run(addSignals, now, input.detail ?? null, pref.id);
    setTags(db, pref.id, input.tags);
    markSignals(db, input.signalIds);
    return { status: 'reinforced', preference: getPreference(db, pref.id), similar: [], conflicts: [], message: `reinforced #${pref.id}` };
  }

  // Near-dup gate (skippable with force / explicit supersede).
  if (!input.force && input.supersedes == null) {
    const expr = ftsMatchExpr(statement);
    let candidates: Preference[] = [];
    if (expr) {
      const rows = db
        .prepare(
          "SELECT p.* FROM preferences_fts f JOIN preferences p ON p.id = f.rowid WHERE preferences_fts MATCH ? AND p.category = ? AND p.status = 'active' LIMIT 25",
        )
        .all(`${expr}`, category) as Row[];
      candidates = rows.map(rowToPref);
    }
    const similar = candidates.filter((p) => jaccard(p.statement, statement) >= NEAR_DUP_THRESHOLD);
    if (similar.length > 0) {
      return {
        status: 'needs_review',
        preference: null,
        similar,
        conflicts: [],
        message:
          `similar preference(s) already recorded — reinforce the existing one, or re-run with force/supersedes to add a distinct rule`,
      };
    }
  }

  const initialSignals = input.signalIds?.length ?? (source !== 'user-stated' ? 1 : 0);
  const info = db
    .prepare(
      'INSERT INTO preferences(scope, category, statement, detail, source, weight, status, language, framework, signal_count, created_at, updated_at) VALUES(?, ?, ?, ?, ?, 1.0, \'active\', ?, ?, ?, ?, ?)',
    )
    .run(scope, category, statement, input.detail ?? null, source, input.language ?? null, input.framework ?? null, initialSignals, now, now);
  const id = Number(info.lastInsertRowid);
  setTags(db, id, input.tags);
  markSignals(db, input.signalIds);

  if (input.supersedes != null) {
    const old = getPreference(db, input.supersedes);
    if (old) {
      db.prepare("UPDATE preferences SET status = 'forgotten', updated_at = ? WHERE id = ?").run(now, old.id);
      addEdge(db, id, old.id, 'supersedes');
    }
  }

  const conflicts = findConflicts(db, category, statement);
  for (const c of conflicts) addEdge(db, id, c.id, 'conflicts');

  return {
    status: 'recorded',
    preference: getPreference(db, id),
    similar: [],
    conflicts,
    message: conflicts.length ? `recorded #${id} (conflicts with ${conflicts.map((c) => `#${c.id}`).join(', ')})` : `recorded #${id}`,
  };
}

export function queryPreferences(db: DatabaseSync, opts: { text?: string; category?: string; limit?: number }): Preference[] {
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);
  const expr = opts.text ? ftsMatchExpr(opts.text) : null;
  if (expr) {
    const rows = db
      .prepare(
        `SELECT p.* FROM preferences_fts f JOIN preferences p ON p.id = f.rowid
         WHERE preferences_fts MATCH ? AND p.status = 'active' ${opts.category ? 'AND p.category = ?' : ''}
         ORDER BY rank LIMIT ?`,
      )
      .all(...(opts.category ? [expr, opts.category, limit] : [expr, limit])) as Row[];
    return rows.map(rowToPref);
  }
  const rows = db
    .prepare(
      `SELECT * FROM preferences WHERE status = 'active' ${opts.category ? 'AND category = ?' : ''} ORDER BY updated_at DESC LIMIT ?`,
    )
    .all(...(opts.category ? [opts.category, limit] : [limit])) as Row[];
  return rows.map(rowToPref);
}

export function listPreferences(db: DatabaseSync, opts: { all?: boolean; category?: string; limit?: number }): Preference[] {
  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 1000);
  const where: string[] = [];
  const params: Array<string | number> = [];
  if (!opts.all) where.push("status = 'active'");
  if (opts.category) {
    where.push('category = ?');
    params.push(opts.category);
  }
  const sql = `SELECT * FROM preferences ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY category, updated_at DESC LIMIT ?`;
  const rows = db.prepare(sql).all(...params, limit) as Row[];
  return rows.map(rowToPref);
}

export function forgetPreference(
  db: DatabaseSync,
  opts: { id?: number; category?: string; statement?: string; hard?: boolean },
): { forgotten: number } {
  let target: Preference | null = null;
  if (opts.id != null) target = getPreference(db, opts.id);
  else if (opts.category && opts.statement) {
    const r = db
      .prepare('SELECT * FROM preferences WHERE category = ? AND statement = ?')
      .get(opts.category, normalizeStatement(opts.statement)) as Row | undefined;
    target = r ? rowToPref(r) : null;
  } else {
    throw new PrimerError('forget needs --id or both --category and --statement');
  }
  if (!target) return { forgotten: 0 };
  if (opts.hard) db.prepare('DELETE FROM preferences WHERE id = ?').run(target.id);
  else db.prepare("UPDATE preferences SET status = 'forgotten', updated_at = ? WHERE id = ?").run(nowIso(), target.id);
  return { forgotten: 1 };
}

export interface BriefItem extends Preference {
  tags: string[];
  rank: number;
}

/** Merge project+global active prefs (project wins), rank by decayed weight, bound the result. */
export function buildBrief(
  dbs: DatabaseSync[],
  opts: { context?: string; category?: string; language?: string; limit?: number },
): BriefItem[] {
  const limit = Math.min(Math.max(opts.limit ?? 24, 1), 60);
  const byKey = new Map<string, BriefItem>();
  for (const db of dbs) {
    const prefs = listPreferences(db, { category: opts.category, limit: 1000 });
    for (const p of prefs) {
      if (opts.language && p.language && p.language.toLowerCase() !== opts.language.toLowerCase()) continue;
      const key = `${p.category}::${p.statement}`;
      if (byKey.has(key)) continue; // project (first db) wins
      byKey.set(key, { ...p, tags: getTags(db, p.id), rank: decayedWeight(p.weight, p.signal_count, p.updated_at) });
    }
  }
  let items = [...byKey.values()];
  if (opts.context) {
    const ctxTokens = opts.context.toLowerCase();
    // Soft boost: prefs whose statement/tags match the context float up, but everything stays eligible.
    items = items.map((it) => {
      const hay = `${it.statement} ${it.tags.join(' ')} ${it.language ?? ''} ${it.framework ?? ''}`.toLowerCase();
      const overlap = jaccard(ctxTokens, hay);
      return { ...it, rank: it.rank * (1 + overlap) };
    });
  }
  items.sort((a, b) => b.rank - a.rank);
  return items.slice(0, limit);
}
