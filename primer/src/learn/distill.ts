// Distillation digest. primer ships NO model — the user's agent is the brain. This
// builds a BOUNDED digest (recent signals + AST-derived candidate preferences + existing
// prefs so the agent can dedup) and the contract the agent must follow when it calls
// primer_record. Building the digest consumes (marks processed) the signals.
//
// Stage C: each signal's before/after is parsed (tree-sitter) into concrete style
// observations, aggregated into ranked candidates — so the agent records evidence-backed
// preferences instead of guessing from raw text.

import type { DatabaseSync } from 'node:sqlite';
import { CATEGORIES } from '../types.js';
import { listPreferences } from '../graph/store.js';
import { observeEdit } from '../extract/index.js';
import { markProcessed, pendingCount, pendingSignals } from './signals.js';

export const DEFAULT_DIGEST_LIMIT = 30;
export const MAX_RECORD_SUGGESTIONS = 8;

export interface DigestSignal {
  id: number;
  file: string;
  language: string | null;
  before: string | null;
  after: string | null;
  observations: string[];
}

export interface Candidate {
  category: string;
  statement: string;
  support: number; // how many signals evidence this
}

export interface Digest {
  pending: number;
  included: number;
  remaining: number;
  candidates: Candidate[];
  signals: DigestSignal[];
  existingPreferences: Array<{ id: number; category: string; statement: string }>;
  categories: readonly string[];
  contract: string;
  instructions: string;
}

const CONTRACT = [
  `Record AT MOST ${MAX_RECORD_SUGGESTIONS} preferences.`,
  `Prefer the high-support candidates below; each must be DURABLE (a habit), never task-specific.`,
  `category MUST be one of: ${CATEGORIES.join(', ')}.`,
  `statement MUST be a single terse imperative line.`,
  `Set source="inferred" and language when the rule is language-specific.`,
  `Skip anything already in existingPreferences (reinforce instead).`,
  `Invent nothing the signals do not evidence.`,
].join(' ');

/**
 * Build the digest. All DB access happens synchronously BEFORE the first `await`
 * (so a sync withDb wrapper can close the connection safely); the tree-sitter work
 * that follows needs no DB.
 */
export async function buildDigest(db: DatabaseSync, opts: { limit?: number; consume?: boolean } = {}): Promise<Digest> {
  const limit = Math.min(Math.max(opts.limit ?? DEFAULT_DIGEST_LIMIT, 1), DEFAULT_DIGEST_LIMIT);
  const totalPending = pendingCount(db);
  const sigs = pendingSignals(db, limit);
  if (opts.consume !== false) markProcessed(db, sigs.map((s) => s.id));
  const existing = listPreferences(db, { limit: 40 }).map((p) => ({ id: p.id, category: p.category, statement: p.statement }));
  // ---- no more DB access past this point ----

  const candMap = new Map<string, Candidate>();
  const digestSignals: DigestSignal[] = [];
  for (const s of sigs) {
    const observations = await observeEdit(s.file_path, s.excerpt_before, s.excerpt_after);
    digestSignals.push({
      id: s.id,
      file: s.file_path,
      language: s.language,
      before: s.excerpt_before,
      after: s.excerpt_after,
      observations: observations.map((o) => `[${o.category}] ${o.statement} (${o.evidence})`),
    });
    for (const o of observations) {
      const key = `${o.category}::${o.statement}`;
      const c = candMap.get(key) ?? { category: o.category, statement: o.statement, support: 0 };
      c.support++;
      candMap.set(key, c);
    }
  }
  const candidates = [...candMap.values()].sort((a, b) => b.support - a.support);

  return {
    pending: totalPending,
    included: sigs.length,
    remaining: Math.max(0, totalPending - sigs.length),
    candidates,
    signals: digestSignals,
    existingPreferences: existing,
    categories: CATEGORIES,
    contract: CONTRACT,
    instructions:
      sigs.length === 0
        ? 'No pending signals to distill.'
        : `Review ${sigs.length} recent edit-signal(s). The candidates below are AST-derived (with support counts); call primer_record for each DURABLE one, following the contract.`,
  };
}

/** Human-readable rendering for the CLI. */
export function digestText(d: Digest): string {
  if (d.included === 0) return 'primer: no pending signals to distill.';
  const lines: string[] = [];
  lines.push(`primer learn — ${d.included} signal(s) (${d.remaining} still pending)`);
  lines.push('');
  lines.push('Contract: ' + d.contract);
  if (d.candidates.length) {
    lines.push('');
    lines.push('Candidate preferences (AST-derived, by support):');
    for (const c of d.candidates) lines.push(`  (${c.support}×) [${c.category}] ${c.statement}`);
  }
  if (d.existingPreferences.length) {
    lines.push('');
    lines.push('Already recorded:');
    for (const p of d.existingPreferences.slice(0, 20)) lines.push(`  [${p.category}] ${p.statement}`);
  }
  lines.push('');
  lines.push('Signals:');
  for (const s of d.signals) {
    lines.push(`  #${s.id} ${s.file}${s.language ? ` (${s.language})` : ''}`);
    for (const o of s.observations) lines.push(`      · ${o}`);
  }
  return lines.join('\n');
}
