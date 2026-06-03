// The primer CLI. Data goes to stdout; human/status lines go to stderr. (The MCP
// server in `serve --mcp` keeps stdout strictly JSON-RPC and is loaded lazily.)

import { Command } from 'commander';
import type { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { PrimerError, type Scope } from '../types.js';
import { connect, getMeta, initDb } from '../db/index.js';
import { type DbResolution, readableDbPaths, resolveDbPath } from '../paths.js';
import { buildBrief, forgetPreference, listPreferences, queryPreferences, recordPreference } from '../graph/store.js';
import { fileImpact, preferenceImpact } from '../graph/impact.js';
import { briefToJson, briefToMarkdown, briefToText } from '../format.js';
import { captureFromGit, parseHookPayload, pendingCount, recordSignal } from '../learn/signals.js';
import { buildDigest, digestText } from '../learn/distill.js';
import { VERSION } from '../version.js';

function out(s = ''): void {
  process.stdout.write(s + '\n');
}
function info(s: string): void {
  process.stderr.write(s + '\n');
}

function parseScope(s: string | undefined): Scope | undefined {
  if (s == null) return undefined;
  if (s !== 'project' && s !== 'global') throw new PrimerError(`invalid --scope "${s}" (project|global)`);
  return s;
}

function collect(v: string, acc: string[]): string[] {
  acc.push(v);
  return acc;
}

interface CommonOpts {
  db?: string;
  scope?: string;
}

function writeDb(opts: CommonOpts): { db: DatabaseSync; res: DbResolution } {
  const res = resolveDbPath({ db: opts.db, scope: parseScope(opts.scope) });
  return { db: connect(res.path, { create: true }), res };
}

interface OpenDb {
  db: DatabaseSync;
  scope: Scope;
  path: string;
}

function readDbs(opts: CommonOpts): OpenDb[] {
  return readableDbPaths({ db: opts.db }).map((r) => ({ db: connect(r.path, { create: false }), scope: r.scope, path: r.path }));
}

function closeAll(dbs: OpenDb[]): void {
  for (const d of dbs) d.db.close();
}

function count(db: DatabaseSync, sql: string): number {
  const r = db.prepare(sql).get() as Record<string, unknown> | undefined;
  return r ? Number(Object.values(r)[0]) : 0;
}

async function runKit(sub: 'setup' | 'teardown', args: string[]): Promise<void> {
  const { spawnSync } = await import('node:child_process');
  const { existsSync } = await import('node:fs');
  const { dirname, join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..'); // dist/cli -> dist -> package root
  const which = sub === 'setup' ? 'install' : 'uninstall';
  const script = [join(pkgRoot, 'kit', `${which}.sh`), join(pkgRoot, '..', `${which}.sh`)].find((p) => existsSync(p));
  if (!script) {
    info(`primer ${sub}: could not find the kit (${which}.sh) — reinstall @agent-primer/primer.`);
    process.exitCode = 1;
    return;
  }
  // `setup` wires primer by default (you already have the Node app); everything else passes through.
  const finalArgs = sub === 'setup' && !args.some((a) => a === '--with' || a.startsWith('--with=')) ? [...args, '--with', 'primer'] : args;
  const r = spawnSync('bash', [script, ...finalArgs], { stdio: 'inherit' });
  if (r.error && (r.error as NodeJS.ErrnoException).code === 'ENOENT') {
    info('primer setup needs `bash` (the agent-primer kit is bash-based). On Windows, use WSL or Git Bash.');
    process.exitCode = 1;
    return;
  }
  process.exitCode = r.status ?? 1;
}

export async function run(argv: string[]): Promise<void> {
  // `setup`/`teardown` run the bundled agent-primer bash kit (3 core policies + primer).
  const sub = argv[2];
  if (sub === 'setup' || sub === 'teardown') {
    await runKit(sub, argv.slice(3));
    return;
  }
  const program = new Command();
  program.name('primer').description('Local-first personal coding-intelligence engine.').version(VERSION);
  program.addHelpText(
    'after',
    '\nKit setup (runs the bundled agent-primer bash kit; needs bash + python3):\n' +
      '  primer setup [--global | --project DIR]    wire the 3 core policies + primer into your agents\n' +
      '  primer teardown [--global | --project DIR] reverse it',
  );

  const withDbOpts = (c: Command): Command =>
    c.option('--db <path>', 'explicit DB path (overrides scope)').option('--scope <scope>', 'project | global');

  withDbOpts(program.command('init'))
    .description('Create the style-graph DB (no-op if it already exists)')
    .action((opts: CommonOpts) => {
      const res = resolveDbPath({ db: opts.db, scope: parseScope(opts.scope) });
      const created = initDb(res.path);
      info(`primer: ${created ? 'initialized' : 'already initialized'} (${res.scope}) at ${res.path}`);
    });

  withDbOpts(program.command('status'))
    .description('Show style-graph health')
    .option('-j, --json', 'JSON output')
    .action((opts: CommonOpts & { json?: boolean }) => {
      const dbs = readDbs(opts);
      try {
        if (dbs.length === 0) {
          if (opts.json) out(JSON.stringify({ initialized: false }));
          else info('primer: no DB yet — run: primer init');
          return;
        }
        const scopes = dbs.map((d) => ({
          scope: d.scope,
          path: d.path,
          created_at: getMeta(d.db, 'created_at'),
          preferences: count(d.db, "SELECT COUNT(*) FROM preferences WHERE status='active'"),
          forgotten: count(d.db, "SELECT COUNT(*) FROM preferences WHERE status='forgotten'"),
          pending_signals: count(d.db, 'SELECT COUNT(*) FROM signals WHERE processed=0'),
        }));
        if (opts.json) {
          out(JSON.stringify({ initialized: true, scopes }, null, 2));
        } else {
          for (const s of scopes) {
            out(`primer [${s.scope}] ${s.path}`);
            out(`  preferences: ${s.preferences} active, ${s.forgotten} forgotten`);
            out(`  pending signals: ${s.pending_signals}`);
          }
        }
      } finally {
        closeAll(dbs);
      }
    });

  withDbOpts(program.command('record'))
    .description('Record (upsert) a coding-style preference')
    .requiredOption('--category <category>', 'controlled category')
    .requiredOption('--statement <statement>', 'one-line imperative rule')
    .option('--detail <detail>', 'optional rationale/example')
    .option('--source <source>', 'user-stated | correction | inferred', 'user-stated')
    .option('--language <language>', 'language scope')
    .option('--framework <framework>', 'framework scope')
    .option('--tag <tag>', 'repeatable tag', collect, [])
    .option('--supersedes <id>', 'forget and supersede preference id', (v) => Number(v))
    .option('--force', 'bypass the near-duplicate gate')
    .action((opts: CommonOpts & Record<string, any>) => {
      const { db } = writeDb(opts);
      try {
        const r = recordPreference(db, {
          category: opts.category,
          statement: opts.statement,
          detail: opts.detail,
          source: opts.source,
          scope: parseScope(opts.scope),
          language: opts.language,
          framework: opts.framework,
          tags: opts.tag,
          supersedes: opts.supersedes,
          force: opts.force,
        });
        info(`primer: ${r.message}`);
        if (r.status === 'needs_review') {
          for (const s of r.similar) info(`  similar #${s.id} [${s.category}] ${s.statement}`);
        }
      } finally {
        db.close();
      }
    });

  withDbOpts(program.command('show'))
    .description('Print the merged style brief (project over global)')
    .option('--context <text>', 'soft-boost preferences matching this context')
    .option('--category <category>', 'limit to a category')
    .option('--language <language>', 'limit to a language')
    .option('-l, --limit <n>', 'max items', (v) => Number(v))
    .option('-f, --format <format>', 'text | md | json', 'text')
    .action((opts: CommonOpts & Record<string, any>) => {
      const dbs = readDbs(opts);
      try {
        const items = buildBrief(dbs.map((d) => d.db), {
          context: opts.context,
          category: opts.category,
          language: opts.language,
          limit: opts.limit,
        });
        if (opts.format === 'json') out(JSON.stringify(briefToJson(items), null, 2));
        else if (opts.format === 'md') out(briefToMarkdown(items));
        else out(briefToText(items));
      } finally {
        closeAll(dbs);
      }
    });

  withDbOpts(program.command('brief'))
    .description('SessionStart-hook style brief (hook envelopes; silent when empty)')
    .option('--context <text>', 'session context (repo/branch)')
    .option('-f, --format <format>', 'text | json | cursor (hook envelopes)', 'text')
    .option('--nudge', 'append a pending-signals nudge')
    .option('--threshold <n>', 'min pending signals to nudge', (v) => Number(v), 15)
    .action((opts: CommonOpts & Record<string, any>) => {
      const dbs = readDbs(opts);
      try {
        const items = buildBrief(dbs.map((d) => d.db), { context: opts.context, limit: 20 });
        const pending = dbs.reduce((n, d) => n + pendingCount(d.db), 0);
        const bt = briefToText(items);
        let inner = bt ? `[Primer] Apply the user's recorded coding style this session:\n${bt}` : '';
        if (opts.nudge && pending >= opts.threshold) {
          inner += `${inner ? '\n\n' : ''}[Primer] ${pending} pending edit-signals — call primer_learn to fold them into your preferences.`;
        }
        if (!inner) return; // silent when there is nothing to inject
        if (opts.format === 'json') out(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: inner } }));
        else if (opts.format === 'cursor') out(JSON.stringify({ additional_context: inner }));
        else out(inner);
      } finally {
        closeAll(dbs);
      }
    });

  withDbOpts(program.command('query'))
    .description('Search preferences (full-text)')
    .argument('<text>', 'search text')
    .option('--category <category>', 'limit to a category')
    .option('-l, --limit <n>', 'max results', (v) => Number(v))
    .option('-j, --json', 'JSON output')
    .action((text: string, opts: CommonOpts & Record<string, any>) => {
      const dbs = readDbs(opts);
      try {
        const all = dbs.flatMap((d) => queryPreferences(d.db, { text, category: opts.category, limit: opts.limit }));
        if (opts.json) out(JSON.stringify(all, null, 2));
        else for (const p of all) out(`[${p.category}] ${p.statement}`);
      } finally {
        closeAll(dbs);
      }
    });

  withDbOpts(program.command('list'))
    .description('List preferences')
    .option('--all', 'include forgotten')
    .option('--category <category>', 'limit to a category')
    .option('-j, --json', 'JSON output')
    .action((opts: CommonOpts & Record<string, any>) => {
      const dbs = readDbs(opts);
      try {
        const all = dbs.flatMap((d) => listPreferences(d.db, { all: opts.all, category: opts.category }).map((p) => ({ ...p, _scope: d.scope })));
        if (opts.json) out(JSON.stringify(all, null, 2));
        else for (const p of all) out(`#${p.id} [${p.category}] ${p.statement}${p.status === 'forgotten' ? ' (forgotten)' : ''}`);
      } finally {
        closeAll(dbs);
      }
    });

  withDbOpts(program.command('forget'))
    .description('Soft-delete a preference (--hard to remove)')
    .option('--id <id>', 'preference id', (v) => Number(v))
    .option('--category <category>', 'with --statement')
    .option('--statement <statement>', 'with --category')
    .option('--hard', 'delete permanently')
    .action((opts: CommonOpts & Record<string, any>) => {
      const { db } = writeDb(opts);
      try {
        const r = forgetPreference(db, { id: opts.id, category: opts.category, statement: opts.statement, hard: opts.hard });
        info(`primer: forgot ${r.forgotten} preference(s)`);
      } finally {
        db.close();
      }
    });

  withDbOpts(program.command('signal'))
    .description('Record a learning signal (privacy-filtered). Always exits 0.')
    .option('--file <path>', 'edited file')
    .option('--before <text>', 'content before')
    .option('--after <text>', 'content after')
    .option('--agent <agent>', 'originating agent')
    .option('--stdin', 'read a PostToolUse payload from stdin')
    .option('--git', 'reconstruct before/after from git')
    .action((opts: CommonOpts & Record<string, any>) => {
      try {
        let input = null as ReturnType<typeof parseHookPayload> | null;
        if (opts.stdin) {
          input = parseHookPayload(readFileSync(0, 'utf8'));
        } else if (opts.git && opts.file) {
          input = captureFromGit(opts.file);
        } else if (opts.file) {
          input = { filePath: opts.file, before: opts.before ?? null, after: opts.after ?? null, agent: opts.agent ?? null };
        }
        if (!input) {
          info('primer: no edit signal in input (ignored)');
          return;
        }
        const { db } = writeDb(opts);
        try {
          const r = recordSignal(db, input);
          info(r.captured ? `primer: signal #${r.id} (${input.filePath})` : `primer: skipped (${r.reason})`);
        } finally {
          db.close();
        }
      } catch (e) {
        info(`primer: signal error (ignored): ${(e as Error).message}`);
      }
      // never fail an agent's edit on signal capture
      process.exitCode = 0;
    });

  withDbOpts(program.command('learn'))
    .description('Build a bounded distillation digest for the agent to record from')
    .option('-l, --limit <n>', 'max signals', (v) => Number(v))
    .option('--no-consume', 'do not mark signals processed')
    .option('-j, --json', 'JSON output')
    .action(async (opts: CommonOpts & Record<string, any>) => {
      const { db } = writeDb(opts);
      try {
        const digest = await buildDigest(db, { limit: opts.limit, consume: opts.consume });
        if (opts.json) out(JSON.stringify(digest, null, 2));
        else out(digestText(digest));
      } finally {
        db.close();
      }
    });

  withDbOpts(program.command('impact'))
    .description('Impact: a preference (--id) graph, or a file (--file) -> its style facts + governing prefs')
    .option('--id <n>', 'preference id', (v) => Number(v))
    .option('--file <path>', 'file to analyze')
    .action(async (opts: CommonOpts & Record<string, any>) => {
      const dbs = readDbs(opts);
      try {
        if (opts.id != null) {
          out(JSON.stringify(dbs.length ? preferenceImpact(dbs[0].db, opts.id) : null, null, 2));
        } else if (opts.file) {
          const res = await fileImpact(dbs.map((d) => d.db), opts.file, readFileSync(opts.file, 'utf8'));
          out(JSON.stringify(res, null, 2));
        } else {
          info('primer impact: pass --id <preference> or --file <path>');
        }
      } finally {
        closeAll(dbs);
      }
    });

  program
    .command('install')
    .description('Register the primer MCP server into AI agents')
    .option('-t, --target <ids>', 'comma-separated agent ids (default: detected)')
    .option('--local', 'write project-local config (default: global)')
    .option('--cwd <dir>', 'project dir (for --local config)')
    .action(async (opts: Record<string, any>) => {
      const { runInstall } = await import('../installer/index.js');
      runInstall({ targets: opts.target ? String(opts.target).split(',') : undefined, cwd: opts.cwd, location: opts.local ? 'local' : 'global' });
    });

  program
    .command('uninstall')
    .description('Remove the primer MCP server from AI agents')
    .option('-t, --target <ids>', 'comma-separated agent ids')
    .option('--local', 'remove project-local config (default: global)')
    .option('--cwd <dir>', 'project dir')
    .action(async (opts: Record<string, any>) => {
      const { runUninstall } = await import('../installer/index.js');
      runUninstall({ targets: opts.target ? String(opts.target).split(',') : undefined, cwd: opts.cwd, location: opts.local ? 'local' : 'global' });
    });

  program
    .command('serve')
    .description('Start the MCP server (stdio)')
    .option('--mcp', 'serve over MCP (stdio)')
    .action(async (opts: Record<string, any>) => {
      if (!opts.mcp) {
        info('primer serve: pass --mcp to start the stdio MCP server');
        return;
      }
      const { serveMcp } = await import('../mcp/server.js');
      await serveMcp();
    });

  try {
    await program.parseAsync(argv);
  } catch (e) {
    if (e instanceof PrimerError) {
      info(`primer: ${e.message}`);
      process.exitCode = 1;
    } else {
      info(`primer: ${(e as Error).stack ?? String(e)}`);
      process.exitCode = 1;
    }
  }
}
