// primer_impact — two real, well-defined queries (no vague "code impact" hand-waving):
//  1. preferenceImpact(id): the preference + its graph neighbors (conflicts / supersedes /
//     superseded-by / co-occurs) + signal support — "what's affected if I change this rule".
//  2. fileImpact(file): parse the file's AST -> its dominant style facts, then which recorded
//     preferences govern it (followed vs merely related) — "what style governs this code".

import type { DatabaseSync } from 'node:sqlite';
import type { Preference } from '../types.js';
import type { Row } from '../db/index.js';
import { getPreference, listPreferences } from './store.js';
import { jaccard } from './text.js';
import { type Observation, observeFile } from '../extract/index.js';

export interface PreferenceImpact {
  preference: Preference | null;
  signalSupport: number;
  conflicts: Preference[];
  supersedes: Preference[];
  supersededBy: Preference[];
  coOccurs: Preference[];
}

export function preferenceImpact(db: DatabaseSync, id: number): PreferenceImpact {
  const preference = getPreference(db, id);
  const edges = db.prepare('SELECT source_id, target_id, kind FROM pref_edges WHERE source_id = ? OR target_id = ?').all(id, id) as Row[];
  const conflicts: Preference[] = [];
  const supersedes: Preference[] = [];
  const supersededBy: Preference[] = [];
  const coOccurs: Preference[] = [];
  for (const e of edges) {
    const sid = Number(e.source_id);
    const tid = Number(e.target_id);
    const kind = String(e.kind);
    const other = getPreference(db, sid === id ? tid : sid);
    if (!other) continue;
    if (kind === 'conflicts') conflicts.push(other);
    else if (kind === 'supersedes') (sid === id ? supersedes : supersededBy).push(other);
    else if (kind === 'co_occurs') coOccurs.push(other);
  }
  return { preference, signalSupport: preference?.signal_count ?? 0, conflicts, supersedes, supersededBy, coOccurs };
}

export interface GoverningPref {
  id: number;
  category: string;
  statement: string;
  status: 'followed' | 'related';
}

export interface FileImpact {
  file: string;
  facts: Observation[];
  governing: GoverningPref[];
}

export async function fileImpact(dbs: DatabaseSync[], filePath: string, code: string): Promise<FileImpact> {
  // Read preferences FIRST (sync) so a sync withDb wrapper can close the connection before
  // the tree-sitter await below.
  const allPrefs = dbs.flatMap((db) => listPreferences(db, { limit: 1000 }));
  // ---- no more DB access past this point ----
  const facts = await observeFile(filePath, code);
  const factsByCat = new Map<string, Observation[]>();
  for (const f of facts) {
    const list = factsByCat.get(f.category) ?? [];
    list.push(f);
    factsByCat.set(f.category, list);
  }
  const governing: GoverningPref[] = [];
  const seen = new Set<string>();
  for (const p of allPrefs) {
    const key = `${p.category}::${p.statement}`;
    if (seen.has(key)) continue;
    const catFacts = factsByCat.get(p.category);
    if (!catFacts) continue; // pref's area isn't exercised by this file
    seen.add(key);
    const followed = catFacts.some((f) => jaccard(f.statement, p.statement) >= 0.5);
    governing.push({ id: p.id, category: p.category, statement: p.statement, status: followed ? 'followed' : 'related' });
  }
  return { file: filePath, facts, governing };
}
