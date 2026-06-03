// The 5 primer_* tools, defined with raw JSON Schema (no zod dependency) and a
// dispatcher that opens/closes DB connections per call (WAL + busy_timeout make this
// safe under concurrent agents). NOTHING here writes to stdout — the transport owns it.

import type { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { CATEGORIES, SOURCES } from '../types.js';
import { connect } from '../db/index.js';
import { readableDbPaths, resolveDbPath } from '../paths.js';
import { buildBrief, queryPreferences, recordPreference } from '../graph/store.js';
import { fileImpact, preferenceImpact } from '../graph/impact.js';
import { briefToText } from '../format.js';
import { buildDigest } from '../learn/distill.js';
import { pendingCount } from '../learn/signals.js';

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export const TOOLS: ToolDef[] = [
  {
    name: 'primer_apply',
    description:
      "Fetch the user's recorded coding-style preferences to apply before writing/editing code. Scope with language/context.",
    inputSchema: {
      type: 'object',
      properties: {
        context: { type: 'string', description: 'what you are about to do (topic / file / framework)' },
        language: { type: 'string', description: 'language scope, e.g. typescript' },
        category: { type: 'string', enum: [...CATEGORIES] },
        limit: { type: 'number', description: 'max preferences (default 24)' },
      },
    },
  },
  {
    name: 'primer_record',
    description: 'Record (upsert) a durable coding-style preference learned from a correction or a stated preference.',
    inputSchema: {
      type: 'object',
      required: ['category', 'statement'],
      properties: {
        category: { type: 'string', enum: [...CATEGORIES] },
        statement: { type: 'string', description: 'one terse imperative line' },
        detail: { type: 'string' },
        source: { type: 'string', enum: [...SOURCES] },
        language: { type: 'string' },
        framework: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        signalIds: { type: 'array', items: { type: 'number' }, description: 'signal ids this preference came from' },
        supersedes: { type: 'number', description: 'preference id to forget + supersede' },
        force: { type: 'boolean', description: 'bypass the near-duplicate gate' },
      },
    },
  },
  {
    name: 'primer_query',
    description: 'Full-text search the recorded preferences.',
    inputSchema: {
      type: 'object',
      required: ['text'],
      properties: {
        text: { type: 'string' },
        category: { type: 'string', enum: [...CATEGORIES] },
        limit: { type: 'number' },
      },
    },
  },
  {
    name: 'primer_learn',
    description: 'Get a bounded digest of recent edit-signals to distill into durable preferences (then call primer_record).',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'number', description: 'max signals (default/cap 30)' } },
    },
  },
  {
    name: 'primer_status',
    description: 'Style-graph health: preference + pending-signal counts.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'primer_impact',
    description:
      "Impact analysis. For {preference: id}: its graph neighbors (conflicts/supersedes/co-occurs) + support. For {file} or {code}: the file's AST style facts + which recorded preferences govern it.",
    inputSchema: {
      type: 'object',
      properties: {
        preference: { type: 'number', description: 'preference id to analyze' },
        file: { type: 'string', description: 'file path (read from disk if code omitted)' },
        code: { type: 'string', description: 'source to analyze (pass file for the language)' },
      },
    },
  },
];

function withWriteDb<T>(fn: (db: DatabaseSync) => T): T {
  const { path } = resolveDbPath({});
  const db = connect(path, { create: true });
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

function withReadDbs<T>(fn: (dbs: DatabaseSync[]) => T): T {
  const opened = readableDbPaths({}).map((r) => connect(r.path, { create: false }));
  try {
    return fn(opened);
  } finally {
    for (const d of opened) d.close();
  }
}

function text(s: string): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text', text: s }] };
}

export async function dispatch(name: string, args: Record<string, any>): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
  try {
    switch (name) {
      case 'primer_apply': {
        const items = withReadDbs((dbs) =>
          buildBrief(dbs, { context: args.context, language: args.language, category: args.category, limit: args.limit }),
        );
        return text(items.length ? briefToText(items) : 'No recorded preferences yet. Record durable ones with primer_record as the user corrects you.');
      }
      case 'primer_record': {
        const r = withWriteDb((db) =>
          recordPreference(db, {
            category: args.category,
            statement: args.statement,
            detail: args.detail,
            source: args.source ?? 'inferred',
            language: args.language,
            framework: args.framework,
            tags: args.tags,
            signalIds: args.signalIds,
            supersedes: args.supersedes,
            force: args.force,
          }),
        );
        return text(JSON.stringify({ status: r.status, message: r.message, preference: r.preference, similar: r.similar }, null, 2));
      }
      case 'primer_query': {
        const rows = withReadDbs((dbs) => dbs.flatMap((db) => queryPreferences(db, { text: args.text, category: args.category, limit: args.limit })));
        return text(JSON.stringify(rows, null, 2));
      }
      case 'primer_learn': {
        // buildDigest does all DB work before its first await, so the sync withWriteDb
        // closes the connection safely; the tree-sitter work that follows needs no DB.
        const digest = await withWriteDb((db) => buildDigest(db, { limit: args.limit, consume: true }));
        return text(JSON.stringify(digest, null, 2));
      }
      case 'primer_status': {
        const status = withReadDbs((dbs) =>
          dbs.map((db) => ({
            preferences: (db.prepare("SELECT COUNT(*) AS n FROM preferences WHERE status='active'").get() as any).n,
            pending_signals: pendingCount(db),
          })),
        );
        return text(JSON.stringify({ initialized: status.length > 0, scopes: status }, null, 2));
      }
      case 'primer_impact': {
        if (args.preference != null) {
          const res = withReadDbs((dbs) => (dbs.length ? preferenceImpact(dbs[0], Number(args.preference)) : null));
          return text(res ? JSON.stringify(res, null, 2) : 'no primer DB yet');
        }
        if (args.file || args.code) {
          const filePath = args.file ?? 'snippet.ts';
          let code = args.code as string | undefined;
          if (code == null && args.file) {
            try {
              code = readFileSync(args.file, 'utf8');
            } catch {
              return { ...text(`cannot read ${args.file}`), isError: true };
            }
          }
          const res = await withReadDbs((dbs) => fileImpact(dbs, filePath, code ?? ''));
          return text(JSON.stringify(res, null, 2));
        }
        return { ...text('primer_impact needs {preference} or {file|code}'), isError: true };
      }
      default:
        return { ...text(`unknown tool: ${name}`), isError: true };
    }
  } catch (e) {
    return { ...text(`primer error: ${(e as Error).message}`), isError: true };
  }
}
