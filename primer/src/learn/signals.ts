// Learning-signal capture. A signal is one observed edit (before/after). Capture
// source is the agent's PostToolUse payload (high-fidelity); `--git` is a fallback.
// Every signal passes the privacy gate and has its excerpts scrubbed + capped.

import type { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, relative } from 'node:path';
import { type Signal, nowIso } from '../types.js';
import type { Row } from '../db/index.js';
import { gitRoot } from '../paths.js';
import { MAX_FILE_SIZE, languageFromPath, sanitizeExcerpt, shouldCapture } from './privacy.js';

export interface SignalInput {
  filePath: string;
  before?: string | null;
  after?: string | null;
  agent?: string | null;
  cwd?: string;
}

export interface CaptureResult {
  captured: boolean;
  id?: number;
  reason?: string;
}

function toRepoRelative(filePath: string, cwd: string): string {
  const root = gitRoot(cwd);
  const abs = isAbsolute(filePath) ? filePath : `${cwd}/${filePath}`;
  if (root) {
    const rel = relative(root, abs);
    if (!rel.startsWith('..')) return rel;
  }
  return filePath;
}

export function recordSignal(db: DatabaseSync, input: SignalInput): CaptureResult {
  const cwd = input.cwd ?? process.cwd();
  const rel = toRepoRelative(input.filePath, cwd);
  // Prefer the "after" content for gating; fall back to before.
  const content = input.after ?? input.before ?? undefined;
  const decision = shouldCapture(rel, content ?? undefined);
  if (!decision.ok) return { captured: false, reason: decision.reason };

  const info = db
    .prepare(
      'INSERT INTO signals(kind, file_path, language, excerpt_before, excerpt_after, agent, processed, created_at) VALUES(?, ?, ?, ?, ?, ?, 0, ?)',
    )
    .run(
      'edit',
      rel,
      languageFromPath(rel),
      sanitizeExcerpt(input.before),
      sanitizeExcerpt(input.after),
      input.agent ?? null,
      nowIso(),
    );
  return { captured: true, id: Number(info.lastInsertRowid) };
}

/** Reconstruct before/after from git (HEAD vs working tree). Best-effort fallback. */
export function captureFromGit(filePath: string, cwd: string = process.cwd()): SignalInput | null {
  const root = gitRoot(cwd);
  if (!root) return null;
  const rel = toRepoRelative(filePath, cwd);
  let before: string | null = null;
  try {
    before = execFileSync('git', ['show', `HEAD:${rel}`], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    before = null; // untracked / new file — no baseline
  }
  const abs = isAbsolute(filePath) ? filePath : `${cwd}/${filePath}`;
  let after: string | null = null;
  if (existsSync(abs) && statSync(abs).size <= MAX_FILE_SIZE) {
    try {
      after = readFileSync(abs, 'utf8');
    } catch {
      after = null;
    }
  }
  if (before == null && after == null) return null;
  return { filePath: rel, before, after, cwd };
}

/**
 * Parse a PostToolUse payload into a signal input. Generic on purpose: it matches by FIELD shape,
 * not by hardcoded tool names, so capture works across agents — Claude (Edit/Write/MultiEdit),
 * Kimi (WriteFile/StrReplaceFile), Codex, etc. Returns null if there's no file or no before/after.
 */
export function parseHookPayload(json: string): SignalInput | null {
  let data: any;
  try {
    data = JSON.parse(json);
  } catch {
    return null;
  }
  const ti = data.tool_input ?? data.toolInput ?? data.input ?? data.args ?? {};
  const cwd = data.cwd ?? process.cwd();
  const filePath = ti.file_path ?? ti.filePath ?? ti.path ?? ti.target_file ?? ti.targetFile;
  if (!filePath) return null;

  let before: string | null = null;
  let after: string | null = null;
  const edits = ti.edits ?? ti.replacements;
  if (Array.isArray(edits) && edits.length) {
    before = edits.map((e: any) => e.old_string ?? e.old_str ?? e.oldString ?? '').join('\n');
    after = edits.map((e: any) => e.new_string ?? e.new_str ?? e.newString ?? '').join('\n');
  } else {
    before = ti.old_string ?? ti.old_str ?? ti.oldString ?? null;
    after = ti.new_string ?? ti.new_str ?? ti.newString ?? ti.content ?? ti.text ?? ti.file_text ?? null;
  }
  if ((before == null || before === '') && (after == null || after === '')) return null;
  const agent = typeof data.agent === 'string' ? data.agent : null;
  return { filePath, before, after, agent, cwd };
}

function rowToSignal(r: Row): Signal {
  return {
    id: Number(r.id),
    kind: String(r.kind) as Signal['kind'],
    file_path: String(r.file_path),
    language: r.language == null ? null : String(r.language),
    excerpt_before: r.excerpt_before == null ? null : String(r.excerpt_before),
    excerpt_after: r.excerpt_after == null ? null : String(r.excerpt_after),
    agent: r.agent == null ? null : String(r.agent),
    processed: Number(r.processed) as 0 | 1,
    created_at: String(r.created_at),
  };
}

export function pendingCount(db: DatabaseSync): number {
  const r = db.prepare('SELECT COUNT(*) AS n FROM signals WHERE processed = 0').get() as Row | undefined;
  return r ? Number(r.n) : 0;
}

export function pendingSignals(db: DatabaseSync, limit = 30): Signal[] {
  const rows = db.prepare('SELECT * FROM signals WHERE processed = 0 ORDER BY created_at DESC LIMIT ?').all(limit) as Row[];
  return rows.map(rowToSignal);
}

export function markProcessed(db: DatabaseSync, ids: number[]): void {
  if (ids.length === 0) return;
  const upd = db.prepare('UPDATE signals SET processed = 1 WHERE id = ?');
  for (const id of ids) upd.run(id);
}
