// Where the style-graph lives. primer owns its own data dir, separate from the
// agent-primer kit, so uninstalling the kit never deletes a developer's learned
// taste (the dir is simply left in place). Mirrors CodeGraph's `.codegraph/` idea.
//
//   project scope -> <git-root>/.primer/primer.db   (gitignored)
//   global  scope -> ~/.primer/primer.db

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Scope } from './types.js';

export function gitRoot(cwd: string = process.cwd()): string | null {
  try {
    const out = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return out || null;
  } catch {
    return null;
  }
}

export function dataDir(scope: Scope, cwd: string = process.cwd()): string {
  if (scope === 'global') return join(homedir(), '.primer');
  return join(gitRoot(cwd) ?? cwd, '.primer');
}

/** A repo defaults to project scope; outside a repo, global. */
export function autoScope(cwd: string = process.cwd()): Scope {
  return gitRoot(cwd) ? 'project' : 'global';
}

export interface DbResolution {
  path: string;
  scope: Scope;
}

/** Resolution for a single read/write target: --db > $PRIMER_DB > scoped default. */
export function resolveDbPath(opts: { db?: string; scope?: Scope; cwd?: string } = {}): DbResolution {
  const cwd = opts.cwd ?? process.cwd();
  if (opts.db) return { path: resolve(opts.db), scope: opts.scope ?? 'project' };
  const env = process.env.PRIMER_DB;
  if (env) return { path: resolve(env), scope: opts.scope ?? 'project' };
  const scope = opts.scope ?? autoScope(cwd);
  return { path: join(dataDir(scope, cwd), 'primer.db'), scope };
}

/** For reads we consult both DBs that exist (project rows win on merge). */
export function readableDbPaths(opts: { db?: string; cwd?: string } = {}): DbResolution[] {
  const cwd = opts.cwd ?? process.cwd();
  if (opts.db) return existsSync(resolve(opts.db)) ? [{ path: resolve(opts.db), scope: 'project' }] : [];
  const env = process.env.PRIMER_DB;
  if (env) return existsSync(resolve(env)) ? [{ path: resolve(env), scope: 'project' }] : [];
  const out: DbResolution[] = [];
  const proj = join(dataDir('project', cwd), 'primer.db');
  const glob = join(dataDir('global', cwd), 'primer.db');
  if (existsSync(proj)) out.push({ path: proj, scope: 'project' });
  if (glob !== proj && existsSync(glob)) out.push({ path: glob, scope: 'global' });
  return out;
}
