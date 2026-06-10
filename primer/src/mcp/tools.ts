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

// Every tool accepts an optional projectPath: MCP hosts may launch this server with a
// cwd OUTSIDE the project (the cwd of stdio servers is not specified by most hosts),
// which would silently resolve the wrong .primer/ DB. projectPath pins resolution to
// the real workspace root — same recovery contract CodeGraph uses.
const PROJECT_PATH_PROP = {
  projectPath: {
    type: 'string',
    description: 'absolute project root — pass when the MCP server may have been launched outside the project',
  },
} as const;

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
        ...PROJECT_PATH_PROP,
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
        ...PROJECT_PATH_PROP,
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
        ...PROJECT_PATH_PROP,
      },
    },
  },
  {
    name: 'primer_learn',
    description: 'Get a bounded digest of recent edit-signals to distill into durable preferences (then call primer_record).',
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'number', description: 'max signals (default/cap 30)' }, ...PROJECT_PATH_PROP },
    },
  },
  {
    name: 'primer_status',
    description: 'Style-graph health: preference + pending-signal counts.',
    inputSchema: { type: 'object', properties: { ...PROJECT_PATH_PROP } },
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
        ...PROJECT_PATH_PROP,
      },
    },
  },
];

function projectCwd(args: Record<string, any>): string | undefined {
  return typeof args.projectPath === 'string' && args.projectPath ? args.projectPath : undefined;
}

function withWriteDb<T>(cwd: string | undefined, fn: (db: DatabaseSync) => T): T {
  const { path } = resolveDbPath({ cwd });
  const db = connect(path, { create: true });
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

function withReadDbs<T>(cwd: string | undefined, fn: (dbs: DatabaseSync[]) => T): T {
  const opened = readableDbPaths({ cwd }).map((r) => connect(r.path, { create: false }));
  try {
    return fn(opened);
  } finally {
    for (const d of opened) d.close();
  }
}

function text(s: string): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text', text: s }] };
}

const NO_DB_HINT =
  'No primer style DB found from this working directory. If one exists for your project, retry with projectPath: "<absolute project root>" (MCP hosts sometimes launch this server outside the project). Otherwise this is a fresh memory: record durable preferences with primer_record as the user expresses them.';

export async function dispatch(name: string, args: Record<string, any>): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
  const cwd = projectCwd(args);
  try {
    switch (name) {
      case 'primer_apply': {
        const { found, items } = withReadDbs(cwd, (dbs) => ({
          found: dbs.length > 0,
          items: buildBrief(dbs, { context: args.context, language: args.language, category: args.category, limit: args.limit }),
        }));
        if (!found) return text(NO_DB_HINT);
        return text(items.length ? briefToText(items) : 'No recorded preferences yet. Record durable ones with primer_record as the user corrects you.');
      }
      case 'primer_record': {
        const r = withWriteDb(cwd, (db) =>
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
        const rows = withReadDbs(cwd, (dbs) => dbs.flatMap((db) => queryPreferences(db, { text: args.text, category: args.category, limit: args.limit })));
        return text(JSON.stringify(rows, null, 2));
      }
      case 'primer_learn': {
        // buildDigest does all DB work before its first await, so the sync withWriteDb
        // closes the connection safely; the tree-sitter work that follows needs no DB.
        const digest = await withWriteDb(cwd, (db) => buildDigest(db, { limit: args.limit, consume: true }));
        return text(JSON.stringify(digest, null, 2));
      }
      case 'primer_status': {
        const status = withReadDbs(cwd, (dbs) =>
          dbs.map((db) => ({
            preferences: (db.prepare("SELECT COUNT(*) AS n FROM preferences WHERE status='active'").get() as any).n,
            pending_signals: pendingCount(db),
          })),
        );
        const out: Record<string, unknown> = { initialized: status.length > 0, scopes: status };
        if (!status.length) out.hint = NO_DB_HINT;
        return text(JSON.stringify(out, null, 2));
      }
      case 'primer_impact': {
        if (args.preference != null) {
          const res = withReadDbs(cwd, (dbs) => (dbs.length ? preferenceImpact(dbs[0], Number(args.preference)) : null));
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
          const res = await withReadDbs(cwd, (dbs) => fileImpact(dbs, filePath, code ?? ''));
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
