// Register the primer MCP server into each agent's config. For a stable install the command is
// an absolute node + script path; for a transient `npx` launcher (under ~/.npm/_npx) we wire a
// self-healing `npx -y @agent-primer/primer` instead, so the entry never dangles when npx prunes
// its cache. Validates the built launcher exists before writing. Atomic writes; refuses to clobber
// invalid JSON. Mirrors CodeGraph's per-agent AgentTarget pattern.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { PrimerError } from '../types.js';

export type Location = 'global' | 'local';

interface Entry {
  command: string; // launcher command: absolute node binary, or `npx` for a transient install
  args: string[]; // launch args incl. ['serve', '--mcp']
}

// Decide the MCP launch command for a built primer at `script`, run by `node`. Exported for tests.
export function entryForScript(script: string, node: string): Entry {
  // A launcher under npx's transient cache (~/.npm/_npx/<hash>) must NOT be baked into persistent
  // MCP config — npx prunes it. Wire a self-healing `npx` invocation that re-resolves each session.
  if (/[/\\]_npx[/\\]/.test(script)) {
    return { command: 'npx', args: ['-y', '@agent-primer/primer', 'serve', '--mcp'] };
  }
  return { command: node, args: [script, 'serve', '--mcp'] };
}

function resolveEntry(): Entry {
  const here = fileURLToPath(import.meta.url); // dist/installer/index.js
  const script = resolve(dirname(here), '..', 'bin', 'primer.js');
  if (!existsSync(script)) {
    throw new PrimerError(`built launcher not found at ${script} — run: npm run build`);
  }
  return entryForScript(script, process.execPath);
}

function readJsonSafe(file: string): any {
  if (!existsSync(file)) return {};
  const raw = readFileSync(file, 'utf8').trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new PrimerError(`refusing to edit ${file}: not valid JSON`);
  }
}

function atomicWriteJson(file: string, data: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.primer.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n');
  renameSync(tmp, file);
}

function serverValueJson(entry: Entry): Record<string, unknown> {
  return { command: entry.command, args: entry.args };
}

interface Target {
  id: string;
  detect(): boolean;
  configPath(loc: Location, cwd: string): string | null;
  install(loc: Location, cwd: string, entry: Entry): string | null;
  uninstall(loc: Location, cwd: string): string | null;
}

function jsonTarget(id: string, mapKey: string, paths: (loc: Location, cwd: string) => string | null, detectPaths: string[]): Target {
  return {
    id,
    detect: () => detectPaths.some((p) => existsSync(p)),
    configPath: paths,
    install(loc, cwd, entry) {
      const file = paths(loc, cwd);
      if (!file) return null;
      const data = readJsonSafe(file);
      data[mapKey] = data[mapKey] ?? {};
      data[mapKey].primer =
        id === 'opencode'
          ? { type: 'local', command: [entry.command, ...entry.args], enabled: true }
          : serverValueJson(entry);
      atomicWriteJson(file, data);
      return file;
    },
    uninstall(loc, cwd) {
      const file = paths(loc, cwd);
      if (!file || !existsSync(file)) return null;
      const data = readJsonSafe(file);
      if (data[mapKey]?.primer) delete data[mapKey].primer;
      atomicWriteJson(file, data);
      return file;
    },
  };
}

const PRIMER_TOML_MARKER = '# primer-mcp';

function codexTarget(): Target {
  const pathFor = (loc: Location, cwd: string) => (loc === 'global' ? join(homedir(), '.codex', 'config.toml') : join(cwd, '.codex', 'config.toml'));
  return {
    id: 'codex',
    detect: () => existsSync(join(homedir(), '.codex')),
    configPath: pathFor,
    install(loc, cwd, entry) {
      const file = pathFor(loc, cwd);
      let body = existsSync(file) ? readFileSync(file, 'utf8') : '';
      if (body.includes(PRIMER_TOML_MARKER)) return file; // idempotent
      const block = `\n${PRIMER_TOML_MARKER}\n[mcp_servers.primer]\ncommand = ${JSON.stringify(entry.command)}\nargs = [${entry.args.map((a) => JSON.stringify(a)).join(', ')}]\n`;
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, body + block);
      return file;
    },
    uninstall(loc, cwd) {
      const file = pathFor(loc, cwd);
      if (!existsSync(file)) return null;
      const body = readFileSync(file, 'utf8');
      const re = new RegExp(`\\n?${PRIMER_TOML_MARKER}\\n\\[mcp_servers\\.primer\\][\\s\\S]*?(?=\\n\\[|$)`, 'g');
      writeFileSync(file, body.replace(re, ''));
      return file;
    },
  };
}

function targets(): Target[] {
  const home = homedir();
  return [
    jsonTarget(
      'claude',
      'mcpServers',
      (loc, cwd) => (loc === 'global' ? join(home, '.claude.json') : join(cwd, '.mcp.json')),
      [join(home, '.claude.json'), join(home, '.claude')],
    ),
    jsonTarget(
      'cursor',
      'mcpServers',
      (loc, cwd) => (loc === 'global' ? join(home, '.cursor', 'mcp.json') : join(cwd, '.cursor', 'mcp.json')),
      [join(home, '.cursor')],
    ),
    jsonTarget('gemini', 'mcpServers', (loc, cwd) => (loc === 'global' ? join(home, '.gemini', 'settings.json') : join(cwd, '.gemini', 'settings.json')), [
      join(home, '.gemini'),
    ]),
    jsonTarget(
      'opencode',
      'mcp',
      (loc, cwd) => (loc === 'global' ? join(home, '.config', 'opencode', 'opencode.json') : join(cwd, 'opencode.json')),
      [join(home, '.config', 'opencode')],
    ),
    codexTarget(),
  ];
}

function selectTargets(ids: string[] | undefined): Target[] {
  const all = targets();
  if (ids && ids.length) return all.filter((t) => ids.includes(t.id));
  const detected = all.filter((t) => t.detect());
  return detected.length ? detected : all;
}

export function runInstall(opts: { targets?: string[]; cwd?: string; location?: Location }): void {
  const cwd = opts.cwd ?? process.cwd();
  const location = opts.location ?? 'global';
  const entry = resolveEntry();
  const sel = selectTargets(opts.targets);
  for (const t of sel) {
    try {
      const file = t.install(location, cwd, entry);
      if (file) process.stderr.write(`primer: registered MCP for ${t.id} -> ${file}\n`);
      else process.stderr.write(`primer: skipped ${t.id} (no ${location} config path)\n`);
    } catch (e) {
      process.stderr.write(`primer: failed ${t.id}: ${(e as Error).message}\n`);
    }
  }
  process.stderr.write('primer: restart your agent/IDE so the primer_* MCP tools load.\n');
}

export function runUninstall(opts: { targets?: string[]; cwd?: string; location?: Location }): void {
  const cwd = opts.cwd ?? process.cwd();
  const location = opts.location ?? 'global';
  for (const t of selectTargets(opts.targets)) {
    try {
      const file = t.uninstall(location, cwd);
      if (file) process.stderr.write(`primer: removed MCP for ${t.id} -> ${file}\n`);
    } catch (e) {
      process.stderr.write(`primer: failed ${t.id}: ${(e as Error).message}\n`);
    }
  }
}
