import { spawn, spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDb } from '../db/index.js';
import { runInstall, runUninstall } from '../installer/index.js';
import { PrimerError } from '../types.js';

type Scope = 'global' | 'project';
type Agent = 'claude' | 'codex' | 'cursor' | 'gemini' | 'opencode' | 'antigravity' | 'kimi' | 'qoder';
type Bundle = 'mcp' | 'tools' | 'rules' | 'skills' | 'agent-extensions' | 'primer';

const AGENTS: Agent[] = ['claude', 'codex', 'cursor', 'gemini', 'opencode', 'antigravity', 'kimi', 'qoder'];
const GENERAL_BUNDLES: Bundle[] = ['mcp', 'tools', 'rules', 'skills', 'agent-extensions'];
const ALL_BUNDLES: Bundle[] = [...GENERAL_BUNDLES, 'primer'];

interface PolicySpec {
  marker: string;
  file: string;
  desc: string;
}

const CORE_POLICIES: PolicySpec[] = [
  {
    marker: 'codegraph-session-startup',
    file: 'codegraph-policy.md',
    desc: 'CodeGraph session-startup rule - verify install/index/freshness before work',
  },
  {
    marker: 'karpathy-guidelines',
    file: 'karpathy-policy.md',
    desc: 'Karpathy coding guidelines - think before coding, simplicity first, surgical changes, goal-driven execution',
  },
  {
    marker: 'superpowers',
    file: 'superpowers-policy.md',
    desc: 'Superpowers - install the skills plugin + its TDD/systematic/simplicity/evidence methodology',
  },
];

const OPTIONAL_POLICIES: Record<Bundle, PolicySpec> = {
  mcp: {
    marker: 'agent-primer-mcp',
    file: 'mcp-policy.md',
    desc: 'MCP servers - Context7 docs, GitHub, Playwright',
  },
  tools: {
    marker: 'agent-primer-tools',
    file: 'tools-policy.md',
    desc: 'Code tools - ast-grep and repomix',
  },
  rules: {
    marker: 'agent-primer-rules',
    file: 'rules-policy.md',
    desc: 'Security, 12-Factor Agents, and commit/PR hygiene guardrails',
  },
  skills: {
    marker: 'agent-primer-skills',
    file: 'skills-policy.md',
    desc: 'Skill registries - Anthropic skills, skills.sh, VoltAgent',
  },
  'agent-extensions': {
    marker: 'agent-primer-extensions',
    file: 'agent-extensions-policy.md',
    desc: 'Per-agent first-party plugins, skills, and tools',
  },
  primer: {
    marker: 'primer',
    file: 'primer-policy.md',
    desc: 'primer - apply and record your local coding style over MCP',
  },
};

const MARKERS = [...CORE_POLICIES.map((p) => p.marker), ...Object.values(OPTIONAL_POLICIES).map((p) => p.marker)];
const STANDALONE_NAMES = MARKERS;
const KIMI_SKILL_NAMES = ['codegraph-startup', 'karpathy-guidelines', 'superpowers', ...MARKERS.slice(3)];
const CORE_HOOK_TAGS = ['codegraph-check', 'codegraph-session-check.sh'];
const PRIMER_HOOK_TAGS = ['brief --format', 'signal --stdin', 'primer.js', '@agent-primer/primer'];

interface Parsed {
  scope: Scope;
  root: string;
  agents: Agent[];
  bundles: Set<Bundle>;
  dryRun: boolean;
  always: boolean;
  noBootstrap: boolean;
  purge: boolean;
}

interface Paths {
  home: string;
  root: string;
  kitDest: string;
  claudeRuleMode: 'append' | 'file';
  claudeRule: string;
  codexInstr: string;
  opencodeInstr: string;
  geminiInstr: string;
  antiInstr: string;
  antiRuleDir: string | null;
  qoderInstr: string | null;
  qoderRuleDir: string | null;
  cursorRuleDir: string | null;
  kimiSkillsDir: string;
  claudeSettings: string;
  codexHooks: string;
  cursorHooks: string;
  geminiSettings: string;
  antiHooks: string;
  opencodePluginDir: string;
  kimiConfig: string;
}

function note(message: string): void {
  process.stderr.write(`[agent-primer] ${message}\n`);
}

function userHome(): string {
  return process.env.HOME || process.env.USERPROFILE || homedir();
}

function packageRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
}

function repoRoot(): string {
  return resolve(packageRoot(), '..');
}

function launcherScript(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'primer.js');
}

function isTransientNpxPath(p: string): boolean {
  return /[/\\]_npx[/\\]/.test(p);
}

function shellQuote(s: string): string {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(s)) return s;
  if (process.platform === 'win32') return `"${s.replace(/"/g, '\\"')}"`;
  return `'${s.replace(/'/g, "'\\''")}'`;
}

function primerCommand(args: string[] = []): string {
  const script = launcherScript();
  const base = isTransientNpxPath(script)
    ? ['npx', '-y', '@agent-primer/primer']
    : [process.execPath, script];
  return [...base, ...args].map(shellQuote).join(' ');
}

function npmMcpCommandParts(): { command: string; args: string[] } {
  const script = launcherScript();
  if (isTransientNpxPath(script)) return { command: 'npx', args: ['-y', '@agent-primer/primer'] };
  return { command: process.execPath, args: [script] };
}

function parseList<T extends string>(raw: string, known: readonly T[], label: string): T[] {
  const values = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const bad = values.filter((v) => !known.includes(v as T));
  if (bad.length) throw new PrimerError(`unknown ${label}: ${bad.join(', ')} (known: ${known.join(', ')})`);
  return values as T[];
}

function setupUsage(): string {
  return `agent-primer npm setup

Usage:
  primer setup --global
  primer setup --project [DIR]
  primer setup ... --agents claude,codex
  primer setup ... --with mcp,rules
  primer setup ... --dry-run
  primer setup ... --no-bootstrap   (hooks only instruct; never auto install/index)
  primer teardown --global [--purge]

Agents: ${AGENTS.join(', ')}
Bundles: ${GENERAL_BUNDLES.join(', ')}; primer is included by primer setup.`;
}

function parseArgs(args: string[], mode: 'setup' | 'teardown'): Parsed {
  let scope: Scope | null = null;
  let target = '';
  let agents = AGENTS;
  let dryRun = false;
  let always = false;
  let noBootstrap = false;
  let purge = false;
  let withRaw: string | null = null;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-h' || a === '--help') {
      process.stdout.write(setupUsage() + '\n');
      process.exitCode = 0;
      throw new PrimerError('__handled__');
    } else if (a === '--global') {
      scope = 'global';
    } else if (a === '--project') {
      scope = 'project';
      const next = args[i + 1];
      if (next && !next.startsWith('-')) {
        target = next;
        i++;
      }
    } else if (a.startsWith('--project=')) {
      scope = 'project';
      target = a.slice('--project='.length);
    } else if (a === '--agents') {
      const next = args[++i];
      if (!next) throw new PrimerError('--agents needs a comma-separated value');
      agents = parseList(next, AGENTS, 'agent');
    } else if (a.startsWith('--agents=')) {
      agents = parseList(a.slice('--agents='.length), AGENTS, 'agent');
    } else if (a === '--with') {
      const next = args[++i];
      if (!next) throw new PrimerError('--with needs a comma-separated value');
      withRaw = next;
    } else if (a.startsWith('--with=')) {
      withRaw = a.slice('--with='.length);
    } else if (a === '--dry-run') {
      dryRun = true;
    } else if (a === '--always') {
      always = true;
    } else if (a === '--no-bootstrap') {
      noBootstrap = true;
    } else if (a === '--purge') {
      purge = true;
    } else {
      throw new PrimerError(`unknown arg: ${a}\n${setupUsage()}`);
    }
  }

  if (!scope) throw new PrimerError(`pass --global or --project [DIR]\n${setupUsage()}`);
  const root = scope === 'project' ? resolve(target || process.cwd()) : userHome();
  const bundles = new Set<Bundle>();
  if (mode === 'setup') {
    // The npm package is the "full setup" path, so primer stays included even when
    // users add extra bundles with --with mcp,rules.
    bundles.add('primer');
    if (withRaw) {
      const requested = withRaw === 'all' ? GENERAL_BUNDLES : parseList(withRaw, ALL_BUNDLES, 'bundle');
      for (const b of requested) bundles.add(b);
    }
  }

  return { scope, root, agents, bundles, dryRun, always, noBootstrap, purge };
}

function kimiHome(home: string): string {
  // Kimi Code's home is relocatable via KIMI_CODE_HOME (default ~/.kimi-code).
  return process.env.KIMI_CODE_HOME || join(home, '.kimi-code');
}

function pathsFor(opts: Parsed): Paths {
  const home = userHome();
  if (opts.scope === 'project') {
    return {
      home,
      root: opts.root,
      kitDest: join(opts.root, 'tools', 'agent-primer'),
      claudeRuleMode: 'file',
      claudeRule: join(opts.root, '.claude', 'rules', 'codegraph-session-startup.md'),
      codexInstr: join(opts.root, 'AGENTS.md'),
      opencodeInstr: join(opts.root, 'AGENTS.md'),
      geminiInstr: join(opts.root, 'GEMINI.md'),
      antiInstr: join(opts.root, 'AGENTS.md'),
      antiRuleDir: join(opts.root, '.agents', 'rules'),
      qoderInstr: join(opts.root, 'AGENTS.md'),
      qoderRuleDir: join(opts.root, '.qoder', 'rules'),
      cursorRuleDir: join(opts.root, '.cursor', 'rules'),
      kimiSkillsDir: join(opts.root, '.kimi-code', 'skills'),
      claudeSettings: join(opts.root, '.claude', 'settings.json'),
      codexHooks: join(opts.root, '.codex', 'hooks.json'),
      cursorHooks: join(opts.root, '.cursor', 'hooks.json'),
      geminiSettings: join(opts.root, '.gemini', 'settings.json'),
      antiHooks: join(opts.root, '.agents', 'hooks.json'),
      opencodePluginDir: join(opts.root, '.opencode', 'plugins'),
      kimiConfig: join(kimiHome(home), 'config.toml'),
    };
  }
  return {
    home,
    root: home,
    kitDest: join(home, '.agent-primer'),
    claudeRuleMode: 'append',
    claudeRule: join(home, '.claude', 'CLAUDE.md'),
    codexInstr: join(home, '.codex', 'AGENTS.md'),
    opencodeInstr: join(home, '.config', 'opencode', 'AGENTS.md'),
    geminiInstr: join(home, '.gemini', 'GEMINI.md'),
    antiInstr: join(home, '.gemini', 'GEMINI.md'),
    antiRuleDir: null,
    qoderInstr: null,
    qoderRuleDir: null,
    cursorRuleDir: null,
    kimiSkillsDir: join(kimiHome(home), 'skills'),
    claudeSettings: join(home, '.claude', 'settings.json'),
    codexHooks: join(home, '.codex', 'hooks.json'),
    cursorHooks: join(home, '.cursor', 'hooks.json'),
    geminiSettings: join(home, '.gemini', 'settings.json'),
    antiHooks: join(home, '.gemini', 'antigravity-cli', 'plugins', 'agent-primer', 'hooks.json'), // legacy: only consulted by teardown
    opencodePluginDir: join(home, '.config', 'opencode', 'plugins'),
    kimiConfig: join(kimiHome(home), 'config.toml'),
  };
}

function readText(file: string): string {
  return readFileSync(file, 'utf8');
}

function findKitFile(file: string): string {
  const candidates = [join(packageRoot(), 'kit', file), join(repoRoot(), file)];
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new PrimerError(`could not find bundled kit file: ${file}`);
  return found;
}

function readPolicy(spec: PolicySpec): string {
  return readText(findKitFile(spec.file)).trimEnd() + '\n';
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function writeAtomic(file: string, text: string): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = join(dirname(file), `.ap-${process.pid}-${Date.now()}.tmp`);
  writeFileSync(tmp, text);
  renameSync(tmp, file);
}

function putFile(file: string, text: string, opts: Parsed): void {
  if (opts.dryRun) {
    note(`would write ${file}`);
    return;
  }
  writeAtomic(file, text);
  note(`wrote ${file}`);
}

function appendMarked(file: string, spec: PolicySpec, opts: Parsed): void {
  if (opts.dryRun) {
    note(`would update ${spec.marker} block in ${file}`);
    return;
  }
  const start = `<!-- ${spec.marker}:start -->`;
  const end = `<!-- ${spec.marker}:end -->`;
  const block = `${start}\n${readPolicy(spec)}${end}\n`;
  let text = existsSync(file) ? readText(file) : '';
  if (text.includes(start) && text.includes(end)) {
    text = text.replace(new RegExp(`${escapeRe(start)}[\\s\\S]*?${escapeRe(end)}\\n?`, 'g'), block);
  } else {
    text = text.replace(start, '').replace(end, '');
    if (text && !text.endsWith('\n')) text += '\n';
    text += `${text ? '\n' : ''}${block}`;
  }
  writeAtomic(file, text);
  note(`updated ${spec.marker} block in ${file}`);
}

function cursorPolicy(spec: PolicySpec): string {
  return `---\ndescription: ${spec.desc}\nalwaysApply: true\n---\n${readPolicy(spec)}`;
}

function kimiPolicy(name: string, spec: PolicySpec): string {
  return `---\nname: ${name}\ndescription: ${spec.desc}\nwhenToUse: When this rule or bundle is relevant to the task.\n---\n${readPolicy(spec)}`;
}

function qoderPolicy(spec: PolicySpec): string {
  return `<!-- Set this rule's mode to 'Always Apply' in Qoder. ${spec.desc} -->\n${readPolicy(spec)}`;
}

function placePolicy(agent: Agent, spec: PolicySpec, opts: Parsed, p: Paths): void {
  switch (agent) {
    case 'claude':
      if (p.claudeRuleMode === 'append') appendMarked(p.claudeRule, spec, opts);
      else putFile(join(dirname(p.claudeRule), `${spec.marker}.md`), readPolicy(spec), opts);
      return;
    case 'codex':
      appendMarked(p.codexInstr, spec, opts);
      return;
    case 'cursor':
      if (p.cursorRuleDir) putFile(join(p.cursorRuleDir, `${spec.marker}.mdc`), cursorPolicy(spec), opts);
      else note('Cursor global rules are UI-only; the global hook covers Cursor.');
      return;
    case 'gemini':
      appendMarked(p.geminiInstr, spec, opts);
      return;
    case 'opencode':
      appendMarked(p.opencodeInstr, spec, opts);
      return;
    case 'antigravity':
      if (p.antiRuleDir) putFile(join(p.antiRuleDir, `${spec.marker}.md`), readPolicy(spec), opts);
      appendMarked(p.antiInstr, spec, opts);
      return;
    case 'kimi': {
      const skillName = spec.marker === 'codegraph-session-startup' ? 'codegraph-startup' : spec.marker;
      putFile(join(p.kimiSkillsDir, skillName, 'SKILL.md'), kimiPolicy(skillName, spec), opts);
      return;
    }
    case 'qoder':
      if (!p.qoderRuleDir || !p.qoderInstr) {
        note('Qoder has no documented global rules dir; wire Qoder per-project.');
        return;
      }
      putFile(join(p.qoderRuleDir, `${spec.marker}.md`), qoderPolicy(spec), opts);
      appendMarked(p.qoderInstr, spec, opts);
      return;
  }
}

function readJsonObject(file: string): Record<string, any> {
  if (!existsSync(file)) return {};
  const raw = readText(file).trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('top-level JSON is not an object');
    return parsed as Record<string, any>;
  } catch (e) {
    throw new PrimerError(`refusing to edit ${file}: ${(e as Error).message}`);
  }
}

function commandInEntry(entry: any, command: string): boolean {
  if (!entry || typeof entry !== 'object') return false;
  if (entry.command === command) return true;
  return Array.isArray(entry.hooks) && entry.hooks.some((h: any) => h && typeof h === 'object' && h.command === command);
}

// TIMEOUT_MS applies to gemini entries only (Gemini hook timeouts are MILLISECONDS,
// default 60000 — the codegraph bootstrap needs more headroom than that on a first run).
function jsonHook(file: string, kind: 'claude' | 'codex' | 'cursor' | 'gemini', command: string, opts: Parsed, timeoutMs?: number): void {
  if (opts.dryRun) {
    note(`would register ${kind} SessionStart hook in ${file}`);
    return;
  }
  const data = readJsonObject(file);
  data.hooks ??= {};
  if (kind === 'cursor') {
    data.version ??= 1;
    const arr = (data.hooks.sessionStart ??= []);
    if (!arr.some((e: any) => commandInEntry(e, command))) arr.push({ command });
  } else {
    const arr = (data.hooks.SessionStart ??= []);
    if (!arr.some((e: any) => commandInEntry(e, command))) {
      const hook: Record<string, any> = { type: 'command', command };
      if (kind === 'gemini' && timeoutMs) hook.timeout = timeoutMs;
      const entry: Record<string, any> = { hooks: [hook] };
      if (kind === 'gemini') entry.matcher = 'startup';
      arr.push(entry);
    }
    if (kind === 'gemini') {
      data.hooksConfig ??= {};
      data.hooksConfig.enabled = true;
    }
  }
  writeAtomic(file, JSON.stringify(data, null, 2) + '\n');
  note(`registered ${kind} SessionStart hook in ${file}`);
}

function jsonPostToolUse(file: string, command: string, matcher: string, opts: Parsed): void {
  if (opts.dryRun) {
    note(`would register PostToolUse capture hook in ${file}`);
    return;
  }
  const data = readJsonObject(file);
  data.hooks ??= {};
  const arr = (data.hooks.PostToolUse ??= []);
  if (!arr.some((e: any) => commandInEntry(e, command))) {
    arr.push({ matcher, hooks: [{ type: 'command', command }] });
  }
  writeAtomic(file, JSON.stringify(data, null, 2) + '\n');
  note(`registered PostToolUse capture hook in ${file}`);
}

function setGeminiContext(file: string, opts: Parsed): void {
  if (opts.dryRun) {
    note(`would set context.fileName=[AGENTS.md,GEMINI.md] in ${file}`);
    return;
  }
  const data = readJsonObject(file);
  data.context ??= {};
  const current = data.context.fileName;
  const names = Array.isArray(current) ? current : typeof current === 'string' ? [current] : [];
  for (const name of ['AGENTS.md', 'GEMINI.md']) if (!names.includes(name)) names.push(name);
  data.context.fileName = names;
  writeAtomic(file, JSON.stringify(data, null, 2) + '\n');
  note(`set context.fileName=[AGENTS.md,GEMINI.md] in ${file}`);
}

function appendTomlHook(file: string, label: string, command: string, opts: Parsed, timeoutSecs = 10): void {
  const block = `\n# ${label}\n[[hooks]]\nevent = "SessionStart"\ncommand = ${JSON.stringify(command)}\ntimeout = ${timeoutSecs}\n`;
  if (opts.dryRun) {
    note(`would append ${label} hook to ${file}`);
    return;
  }
  const body = existsSync(file) ? readText(file) : '';
  if (body.includes(command)) {
    note(`${label} hook already in ${file}`);
    return;
  }
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, body + block);
  note(`appended ${label} hook to ${file}`);
}

function appendKimiPostToolUse(file: string, command: string, opts: Parsed): void {
  const block = `\n# primer capture\n[[hooks]]\nevent = "PostToolUse"\nmatcher = "WriteFile|StrReplaceFile"\ncommand = ${JSON.stringify(command)}\ntimeout = 10\n`;
  if (opts.dryRun) {
    note(`would append Kimi primer capture to ${file}`);
    return;
  }
  const body = existsSync(file) ? readText(file) : '';
  if (body.includes(command)) return;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, body + block);
  note(`appended Kimi primer capture to ${file}`);
}

function opencodeTemplate(kind: 'codegraph' | 'primer', commandArgs: string[]): string {
  const parts = npmMcpCommandParts();
  const allArgs = [...parts.args, ...commandArgs];
  const exportName = kind === 'codegraph' ? 'CodegraphSessionCheck' : 'PrimerSessionCheck';
  const comment =
    kind === 'codegraph'
      ? 'CodeGraph session-startup hook for opencode.'
      : 'primer [Primer] style brief for opencode.';
  return `// agent-primer: ${comment}\nconst COMMAND = ${JSON.stringify(parts.command)};\nconst ARGS = ${JSON.stringify(allArgs)};\n\nexport const ${exportName} = async ({ $, directory }) => ({\n  "session.created": async () => {\n    try {\n      const projectArgs = ${kind === 'codegraph' ? '[...ARGS, "--project", directory]' : 'ARGS'};\n      const out = await $\`\${COMMAND} \${projectArgs}\`.quiet().nothrow();\n      const text = (out.stdout || "").toString().trim();\n      if (text) console.log(text);\n    } catch (_) { /* never block session start */ }\n  },\n});\n`;
}

function copyKit(opts: Parsed, p: Paths): void {
  if (opts.dryRun) {
    note(`would place kit in ${p.kitDest}`);
    return;
  }
  mkdirSync(p.kitDest, { recursive: true });
  for (const file of ['codegraph-session-check.sh', ...CORE_POLICIES.map((s) => s.file), ...Object.values(OPTIONAL_POLICIES).map((s) => s.file)]) {
    const src = [join(packageRoot(), 'kit', file), join(repoRoot(), file)].find((candidate) => existsSync(candidate));
    if (!src) continue;
    copyFileSync(src, join(p.kitDest, file));
    if (file.endsWith('.sh')) {
      try {
        chmodSync(join(p.kitDest, file), 0o755);
      } catch {
        // Windows may not support chmod in the same way; the npm hooks do not rely on this file.
      }
    }
  }
  note(`placed kit in ${p.kitDest}`);
}

function gitignorePrimer(file: string, opts: Parsed): void {
  if (opts.dryRun) {
    note(`would add .primer/ to ${file}`);
    return;
  }
  const body = existsSync(file) ? readText(file) : '';
  if (/^\/?\.primer\/?$/m.test(body)) return;
  writeFileSync(file, `${body}${body && !body.endsWith('\n') ? '\n' : ''}\n# primer: local learned coding-style DB\n.primer/\n`);
  note(`added .primer/ to ${file}`);
}

const CODEGRAPH_GITIGNORE_BLOCK = '\n# codegraph: local code-structure index (rebuilt per machine; do not commit)\n.codegraph/\n';

// The per-machine .codegraph/ index must never be committed; codegraph's own
// .codegraph/.gitignore covers files inside the dir but not the dir itself.
function gitignoreCodegraph(file: string, opts: Parsed): void {
  if (opts.dryRun) {
    note(`would add .codegraph/ to ${file}`);
    return;
  }
  const body = existsSync(file) ? readText(file) : '';
  if (/^\/?\.codegraph\/?$/m.test(body)) return;
  writeFileSync(file, `${body}${body && !body.endsWith('\n') ? '\n' : ''}${CODEGRAPH_GITIGNORE_BLOCK}`);
  note(`added .codegraph/ to ${file}`);
}

function selected(opts: Parsed, agent: Agent): boolean {
  return opts.agents.includes(agent);
}

function codegraphHookArgs(format: 'text' | 'json' | 'cursor', opts: Parsed): string[] {
  const args = ['codegraph-check', '--format', format];
  if (!opts.noBootstrap) args.push('--bootstrap');
  if (opts.always) args.push('--always');
  return args;
}

function codegraphHook(format: 'text' | 'json' | 'cursor', opts: Parsed): string {
  return primerCommand(codegraphHookArgs(format, opts));
}

function primerBrief(format: 'text' | 'json' | 'cursor'): string {
  return primerCommand(['brief', '--format', format, '--nudge']);
}

function primerSignal(): string {
  return primerCommand(['signal', '--stdin']);
}

function wireCoreHooks(opts: Parsed, p: Paths): void {
  if (selected(opts, 'claude')) jsonHook(p.claudeSettings, 'claude', codegraphHook('json', opts), opts);
  if (selected(opts, 'codex')) jsonHook(p.codexHooks, 'codex', codegraphHook('text', opts), opts);
  if (selected(opts, 'cursor')) jsonHook(p.cursorHooks, 'cursor', codegraphHook('cursor', opts), opts);
  if (selected(opts, 'gemini')) {
    jsonHook(p.geminiSettings, 'gemini', codegraphHook('json', opts), opts, 120_000);
    setGeminiContext(p.geminiSettings, opts);
  }
  // antigravity: NO session-start hook event exists — the rules + instruction files carry the policy.
  if (selected(opts, 'opencode')) {
    putFile(join(p.opencodePluginDir, 'codegraph-session-check.js'), opencodeTemplate('codegraph', codegraphHookArgs('text', opts)), opts);
  }
  if (selected(opts, 'kimi')) {
    // timeout 120, not 10: the first session in a new repo may install + index CodeGraph
    // (the check's internal budgets keep the normal case far quicker).
    if (opts.scope === 'global') appendTomlHook(p.kimiConfig, 'codegraph-session-startup', codegraphHook('text', opts), opts, 120);
    else note('Kimi hooks are global-only; wrote the project skill. Run primer setup --global --agents kimi to enable the hook.');
  }
}

function wirePrimer(opts: Parsed, p: Paths): void {
  const primerTargets = (['claude', 'cursor', 'gemini', 'codex', 'opencode'] as Agent[]).filter((a) => selected(opts, a));
  if (opts.dryRun) {
    note('would init the style DB, register the MCP server, distribute primer-policy.md, and wire the [Primer] brief + capture hooks');
  } else {
    if (opts.scope === 'project') {
      initDb(join(p.root, '.primer', 'primer.db'));
      if (primerTargets.length) runInstall({ targets: primerTargets, cwd: p.root, location: 'local' });
      gitignorePrimer(join(p.root, '.gitignore'), opts);
    } else {
      initDb(join(p.home, '.primer', 'primer.db'));
      if (primerTargets.length) runInstall({ targets: primerTargets, location: 'global' });
    }
  }

  for (const agent of opts.agents) placePolicy(agent, OPTIONAL_POLICIES.primer, opts, p);

  if (selected(opts, 'claude')) {
    jsonHook(p.claudeSettings, 'claude', primerBrief('json'), opts);
    jsonPostToolUse(p.claudeSettings, primerSignal(), 'Edit|Write|MultiEdit', opts);
  }
  if (selected(opts, 'codex')) jsonHook(p.codexHooks, 'codex', primerBrief('text'), opts);
  if (selected(opts, 'cursor')) jsonHook(p.cursorHooks, 'cursor', primerBrief('cursor'), opts);
  if (selected(opts, 'gemini')) jsonHook(p.geminiSettings, 'gemini', primerBrief('json'), opts);
  // antigravity: no session-start hook event exists — the primer policy doc is its carrier.
  if (selected(opts, 'opencode')) putFile(join(p.opencodePluginDir, 'primer-session-check.js'), opencodeTemplate('primer', ['brief', '--format', 'text', '--nudge']), opts);
  if (selected(opts, 'kimi')) {
    if (opts.scope === 'global') {
      appendTomlHook(p.kimiConfig, 'primer brief', primerBrief('text'), opts);
      appendKimiPostToolUse(p.kimiConfig, primerSignal(), opts);
    } else {
      note('primer: Kimi hooks are global-only; the policy was written for this project.');
    }
  }
  note('primer: wired. Restart your agent or IDE so primer_* MCP tools load.');
}

export async function runSetup(args: string[]): Promise<void> {
  let opts: Parsed;
  try {
    opts = parseArgs(args, 'setup');
  } catch (e) {
    if ((e as Error).message === '__handled__') return;
    throw e;
  }
  const p = pathsFor(opts);
  note(`scope=${opts.scope} target=${p.root} agents=${opts.agents.join(',')} dry-run=${opts.dryRun}`);

  copyKit(opts, p);
  // On a project install the CodeGraph index lands at the repo root — keep it out of VCS.
  if (opts.scope === 'project') gitignoreCodegraph(join(p.root, '.gitignore'), opts);
  for (const spec of CORE_POLICIES) {
    for (const agent of opts.agents) placePolicy(agent, spec, opts, p);
  }
  wireCoreHooks(opts, p);

  for (const bundle of GENERAL_BUNDLES) {
    if (!opts.bundles.has(bundle)) continue;
    for (const agent of opts.agents) placePolicy(agent, OPTIONAL_POLICIES[bundle], opts, p);
  }
  if (opts.bundles.has('primer')) wirePrimer(opts, p);

  note('done.');
}

function stripMarkers(file: string, opts: Parsed): void {
  if (!existsSync(file)) return;
  if (opts.dryRun) {
    note(`would strip policy blocks from ${file}`);
    return;
  }
  let text = readText(file);
  const original = text;
  for (const marker of MARKERS) {
    const start = `<!-- ${marker}:start -->`;
    const end = `<!-- ${marker}:end -->`;
    text = text.replace(new RegExp(`\\n*${escapeRe(start)}[\\s\\S]*?${escapeRe(end)}\\n?`, 'g'), '\n');
  }
  if (text === original) return;
  if (!text.trim()) rmSync(file, { force: true });
  else writeAtomic(file, text.replace(/^\n+/, ''));
  note(`stripped policy blocks from ${file}`);
}

function rmPath(file: string, opts: Parsed): void {
  if (!existsSync(file)) return;
  if (opts.dryRun) {
    note(`would remove ${file}`);
    return;
  }
  rmSync(file, { recursive: true, force: true });
  note(`removed ${file}`);
}

function commandHasTags(entry: any, tags: string[]): boolean {
  if (!entry || typeof entry !== 'object') return false;
  const hit = (s: unknown) => typeof s === 'string' && tags.some((tag) => s.includes(tag));
  if (hit(entry.command)) return true;
  return Array.isArray(entry.hooks) && entry.hooks.some((h: any) => h && typeof h === 'object' && hit(h.command));
}

function unhookJson(file: string, tags: string[], opts: Parsed): void {
  if (!existsSync(file)) return;
  if (opts.dryRun) {
    note(`would remove hooks from ${file}`);
    return;
  }
  const data = readJsonObject(file);
  const hooks = data.hooks;
  if (!hooks || typeof hooks !== 'object') return;
  let changed = false;
  for (const key of Object.keys(hooks)) {
    const arr = hooks[key];
    if (!Array.isArray(arr)) continue;
    const next = arr.filter((entry) => !commandHasTags(entry, tags));
    if (next.length !== arr.length) {
      changed = true;
      if (next.length) hooks[key] = next;
      else delete hooks[key];
    }
  }
  if (!changed) return;
  if (!Object.keys(hooks).length) delete data.hooks;
  writeAtomic(file, JSON.stringify(data, null, 2) + '\n');
  note(`removed hooks from ${file}`);
}

function unhookKimi(file: string, tags: string[], opts: Parsed): void {
  if (!existsSync(file)) return;
  if (opts.dryRun) {
    note(`would remove Kimi hooks from ${file}`);
    return;
  }
  const text = readText(file);
  const chunks = text.split(/(?=^\[\[hooks\]\])/m);
  const kept = chunks.filter((chunk) => !tags.some((tag) => chunk.includes(tag)));
  if (kept.length === chunks.length) return;
  writeAtomic(file, kept.join('').replace(/\n{3,}/g, '\n\n').replace(/^\n+/, ''));
  note(`removed Kimi hooks from ${file}`);
}

function removeAgentFiles(opts: Parsed, p: Paths): void {
  if (selected(opts, 'claude')) {
    if (p.claudeRuleMode === 'append') stripMarkers(p.claudeRule, opts);
    else for (const n of STANDALONE_NAMES) rmPath(join(dirname(p.claudeRule), `${n}.md`), opts);
    unhookJson(p.claudeSettings, [...CORE_HOOK_TAGS, ...PRIMER_HOOK_TAGS], opts);
  }
  if (selected(opts, 'codex')) {
    stripMarkers(p.codexInstr, opts);
    unhookJson(p.codexHooks, [...CORE_HOOK_TAGS, ...PRIMER_HOOK_TAGS], opts);
  }
  if (selected(opts, 'cursor')) {
    if (p.cursorRuleDir) for (const n of STANDALONE_NAMES) rmPath(join(p.cursorRuleDir, `${n}.mdc`), opts);
    unhookJson(p.cursorHooks, [...CORE_HOOK_TAGS, ...PRIMER_HOOK_TAGS], opts);
  }
  if (selected(opts, 'gemini')) {
    stripMarkers(p.geminiInstr, opts);
    unhookJson(p.geminiSettings, [...CORE_HOOK_TAGS, ...PRIMER_HOOK_TAGS], opts);
  }
  if (selected(opts, 'opencode')) {
    stripMarkers(p.opencodeInstr, opts);
    rmPath(join(p.opencodePluginDir, 'codegraph-session-check.js'), opts);
    rmPath(join(p.opencodePluginDir, 'primer-session-check.js'), opts);
  }
  if (selected(opts, 'antigravity')) {
    stripMarkers(p.antiInstr, opts);
    if (p.antiRuleDir) for (const n of STANDALONE_NAMES) rmPath(join(p.antiRuleDir, `${n}.md`), opts);
    unhookJson(p.antiHooks, [...CORE_HOOK_TAGS, ...PRIMER_HOOK_TAGS], opts); // legacy entries from older installs
    if (opts.scope === 'global') rmPath(dirname(p.antiHooks), opts); // legacy plugin dir was wholly ours
  }
  if (selected(opts, 'kimi')) {
    for (const n of KIMI_SKILL_NAMES) rmPath(join(p.kimiSkillsDir, n), opts);
    if (opts.scope === 'global') unhookKimi(p.kimiConfig, [...CORE_HOOK_TAGS, ...PRIMER_HOOK_TAGS], opts);
  }
  if (selected(opts, 'qoder')) {
    if (p.qoderInstr) stripMarkers(p.qoderInstr, opts);
    if (p.qoderRuleDir) for (const n of STANDALONE_NAMES) rmPath(join(p.qoderRuleDir, `${n}.md`), opts);
  }
}

export async function runTeardown(args: string[]): Promise<void> {
  let opts: Parsed;
  try {
    opts = parseArgs(args, 'teardown');
  } catch (e) {
    if ((e as Error).message === '__handled__') return;
    throw e;
  }
  const p = pathsFor(opts);
  note(`teardown scope=${opts.scope} target=${p.root} agents=${opts.agents.join(',')} dry-run=${opts.dryRun} purge=${opts.purge}`);
  removeAgentFiles(opts, p);
  if (!opts.dryRun) {
    const primerTargets = (['claude', 'cursor', 'gemini', 'codex', 'opencode'] as Agent[]).filter((a) => selected(opts, a));
    if (primerTargets.length) runUninstall({ targets: primerTargets, cwd: p.root, location: opts.scope === 'project' ? 'local' : 'global' });
  }
  if (opts.purge) rmPath(join(p.root, '.primer'), opts);
  else if (existsSync(join(p.root, '.primer'))) note(`preserved your learned primer style DB at ${join(p.root, '.primer')} (re-run with --purge to delete it)`);
  rmPath(p.kitDest, opts);
  note('teardown done.');
}

// --- codegraph-check (the SessionStart hook, npm form) ---------------------
// Mirrors codegraph-session-check.sh exactly. Robustness rules:
//   * EVERY child process is time-bounded — a hung network call or daemon must never
//     stall session start past the host's hook timeout (a killed hook emits NOTHING
//     and the agent flies blind).
//   * PATH is augmented with the usual user-bin dirs — GUI-launched agents often miss
//     ~/.local/bin (where the CodeGraph installer links the binary), which otherwise
//     reads as "not installed" and triggers a pointless reinstall.
//   * Auto-bootstrap only ever runs inside a git repo that is not $HOME.
//   * A failed CLI auto-install is not retried for an hour (marker file).
//   * If indexing outlives its budget it continues DETACHED in the background.

const WIN = process.platform === 'win32';
const INSTALL_BUDGET_MS = 25_000;
const REGISTER_BUDGET_MS = 15_000;
const INDEX_BUDGET_MS = 20_000;
const INSTALL_RETRY_MS = 60 * 60 * 1000;

// ~/.local/bin (where the CodeGraph installer links the binary) is frequently NOT on
// the PATH a GUI-launched agent inherits; spawn children with an augmented PATH.
// (AGENT_PRIMER_NO_PATH_AUGMENT disables this for tests that need a hermetic PATH.)
function augmentedEnv(): NodeJS.ProcessEnv {
  if (WIN || process.env.AGENT_PRIMER_NO_PATH_AUGMENT) return process.env;
  const extra = [join(userHome(), '.local', 'bin'), join(userHome(), 'bin'), '/usr/local/bin', '/opt/homebrew/bin'];
  const parts = (process.env.PATH ?? '').split(':');
  for (const d of extra) if (!parts.includes(d) && existsSync(d)) parts.push(d);
  return { ...process.env, PATH: parts.join(':') };
}

type RunOutcome = 'ok' | 'timeout' | 'fail';

function outcomeOf(result: ReturnType<typeof spawnSync>): RunOutcome {
  if (result.status === 0) return 'ok';
  if (result.error && (result.error as NodeJS.ErrnoException).code === 'ETIMEDOUT') return 'timeout';
  if (result.signal) return 'timeout'; // killed by the timeout's SIGTERM
  return 'fail';
}

function commandExists(command: string): boolean {
  // shell:true on Windows so .cmd/.bat shims (npm installs) resolve; require status 0
  // because a missing command under cmd.exe exits non-zero without an `error`.
  const result = spawnSync(command, ['--version'], { stdio: 'ignore', shell: WIN, timeout: 8000, env: augmentedEnv(), windowsHide: true });
  return !result.error && result.status === 0;
}

function runShell(command: string, timeoutMs: number): RunOutcome {
  return outcomeOf(spawnSync(command, { stdio: 'ignore', shell: true, timeout: timeoutMs, env: augmentedEnv(), windowsHide: true }));
}

function runCodegraph(args: string[], timeoutMs: number, cwd?: string): RunOutcome {
  return outcomeOf(spawnSync('codegraph', args, { cwd, stdio: 'ignore', shell: WIN, timeout: timeoutMs, env: augmentedEnv(), windowsHide: true }));
}

function runCodegraphStatus(): string {
  const result = spawnSync('codegraph', ['status'], { encoding: 'utf8', timeout: 8000, shell: WIN, env: augmentedEnv(), windowsHide: true });
  return `${result.stdout || ''}${result.stderr || ''}`.replace(/\x1B\[[0-9;]*m/g, '').trim();
}

function stateDir(): string {
  return process.env.AGENT_PRIMER_STATE_DIR || join(userHome(), '.agent-primer');
}

function installMarkerPath(): string {
  return join(stateDir(), 'codegraph-install.last-attempt');
}

// A failed CLI install is not retried within an hour, so a broken network never adds
// a curl|sh stall to every session start.
function installRecentlyAttempted(): boolean {
  try {
    return Date.now() - statSync(installMarkerPath()).mtimeMs < INSTALL_RETRY_MS;
  } catch {
    return false;
  }
}

function markInstallAttempt(): void {
  try {
    mkdirSync(stateDir(), { recursive: true });
    writeFileSync(installMarkerPath(), '');
  } catch {
    // best-effort: a read-only HOME just means no backoff
  }
}

function clearInstallAttempt(): void {
  try {
    rmSync(installMarkerPath(), { force: true });
  } catch {
    // best-effort
  }
}

// Auto-bootstrap is allowed only in a real project: a git repo that isn't $HOME.
// (Indexing a home dir or a scratch folder is slow, useless, and surprising.)
function safeToBootstrap(projectDir: string): boolean {
  if (!existsSync(join(projectDir, '.git'))) return false;
  return resolve(projectDir) !== resolve(userHome());
}

function ensureCodegraphGitignored(projectDir: string): void {
  try {
    if (!existsSync(join(projectDir, '.git'))) return;
    const file = join(projectDir, '.gitignore');
    const body = existsSync(file) ? readFileSync(file, 'utf8') : '';
    if (/^\/?\.codegraph\/?$/m.test(body)) return;
    writeFileSync(file, `${body}${body && !body.endsWith('\n') ? '\n' : ''}${CODEGRAPH_GITIGNORE_BLOCK}`);
  } catch {
    // never block the hook on gitignore housekeeping
  }
}

// An initialized index = the .codegraph/ dir AND at least one SQLite db file inside it
// (a bare dir left by an aborted init must not read as "set up").
function indexInitialized(projectDir: string): boolean {
  try {
    const dir = join(projectDir, '.codegraph');
    if (!existsSync(dir)) return false;
    return readdirSync(dir).some((f) => f.endsWith('.db'));
  } catch {
    return false;
  }
}

// A very recent bare .codegraph/ (dir present, no db yet) usually means another
// session — or a background run this check started earlier — is indexing RIGHT NOW.
// Don't stack a second indexer on top; a stale bare dir (crashed init) falls through.
function indexInProgress(projectDir: string): boolean {
  try {
    const dir = join(projectDir, '.codegraph');
    if (!existsSync(dir) || indexInitialized(projectDir)) return false;
    return Date.now() - statSync(dir).mtimeMs < 10 * 60 * 1000;
  } catch {
    return false;
  }
}

// Index this project, bounded. A repo too big for the foreground budget keeps indexing
// DETACHED so the session starts fast and the index is ready shortly after.
function bootstrapIndex(projectDir: string): 'ok' | 'background' | 'fail' {
  const r = runCodegraph(['init', '-i'], INDEX_BUDGET_MS, projectDir);
  if (r === 'ok') {
    ensureCodegraphGitignored(projectDir);
    return 'ok';
  }
  if (r === 'timeout') {
    try {
      spawn('codegraph', ['init', '-i'], { cwd: projectDir, stdio: 'ignore', detached: true, shell: WIN, env: augmentedEnv(), windowsHide: true }).unref();
    } catch {
      return 'fail';
    }
    ensureCodegraphGitignored(projectDir);
    return 'background';
  }
  return 'fail';
}

function emitHook(format: string, message: string): void {
  if (format === 'json') {
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: message } }) + '\n');
  } else if (format === 'cursor') {
    process.stdout.write(JSON.stringify({ additional_context: message }) + '\n');
  } else {
    process.stdout.write(message + '\n');
  }
}

function codegraphInstallText(): string {
  if (WIN) {
    return 'irm https://raw.githubusercontent.com/colbymchenry/codegraph/main/install.ps1 | iex';
  }
  return 'curl -fsSL https://raw.githubusercontent.com/colbymchenry/codegraph/main/install.sh | sh';
}

function runCodegraphInstallScript(): boolean {
  if (WIN) {
    return (
      outcomeOf(
        spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', codegraphInstallText()], {
          stdio: 'ignore',
          shell: false,
          timeout: INSTALL_BUDGET_MS,
          windowsHide: true,
        }),
      ) === 'ok'
    );
  }
  return runShell(codegraphInstallText(), INSTALL_BUDGET_MS) === 'ok';
}

// Install the CLI (network) + register the MCP server NON-interactively (`-y`: a bare
// `codegraph install` opens an interactive agent-picker that hangs without a TTY).
// Indexing is handled by the caller.
function bootstrapMissingCli(): boolean {
  if (!runCodegraphInstallScript()) return false;
  if (!commandExists('codegraph')) return false;
  return runCodegraph(['install', '-y'], REGISTER_BUDGET_MS) === 'ok';
}

function mcpRecoveryHint(projectDir: string): string {
  return `If a codegraph_* MCP call fails with "No CodeGraph project is loaded", retry it with
projectPath: "${projectDir}". If it fails with "not initialized", run \`codegraph init -i\` in
${projectDir} once, then retry.`;
}

function codegraphBootstrapSuccess(message: string, projectDir: string): string {
  return `[CodeGraph bootstrap complete]
${message}

Proceed with the user's original task now. Prefer codegraph_* MCP tools after restart; until then,
use the \`codegraph\` CLI directly for structural questions (definitions, callers/callees, impact,
traces, file maps). ${mcpRecoveryHint(projectDir)}`;
}

function codegraphBootstrapBackground(message: string): string {
  return `[CodeGraph indexing in background]
${message}

Proceed with the user's original task now using native tools. Before relying on codegraph_* MCP
tools or the \`codegraph\` CLI for structural answers, check \`codegraph status\` once — the index
becomes available as soon as the background run finishes. Do not re-run \`codegraph init\`.`;
}

function codegraphBootstrapFailure(message: string): string {
  return `[CodeGraph bootstrap failed]
${message}

STOP: do not inspect files, analyze project structure, or answer the user's task yet.
Your next assistant action MUST be to run the setup command(s) below using the host's normal command
approval UI if needed. Do not ask a yes/no chat question first; the command approval dialog is the
permission step. If command execution is unavailable or the user declines a command approval, say
that once and then proceed without CodeGraph.

Commands:
  ${codegraphInstallText()}
  codegraph install -y
  codegraph init -i

After the commands succeed, continue the user's original task immediately using the \`codegraph\`
CLI. Never append this as an after-the-fact note once the task is already answered.`;
}

// Softer, non-blocking note for directories we refuse to auto-index (not a git repo,
// or $HOME itself). No STOP: this may not be a coding session at all.
function codegraphNonprojectNote(message: string, projectDir: string): string {
  return `[CodeGraph not set up here]
${message}

This directory was NOT auto-indexed (it is not a git repository root, or it is the home
directory). If this session is about code in ${projectDir}, run the command(s) above first via
the normal command approval UI, then continue. Otherwise just proceed with the user's task.`;
}

export async function runCodegraphCheck(args: string[]): Promise<void> {
  let format = 'text';
  let project = '';
  let always = false;
  let bootstrap = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--format') format = args[++i] || 'text';
    else if (a.startsWith('--format=')) format = a.slice('--format='.length);
    else if (a === '--project') project = args[++i] || '';
    else if (a.startsWith('--project=')) project = a.slice('--project='.length);
    else if (a === '--always') always = true;
    else if (a === '--bootstrap') bootstrap = true;
  }
  // Claude/Cursor export CLAUDE_PROJECT_DIR; Gemini exports GEMINI_PROJECT_DIR; Cursor
  // also CURSOR_PROJECT_DIR. Cursor GLOBAL hooks run from ~/.cursor, so the env vars —
  // not cwd — are what make the global wiring correct there.
  const projectDir = resolve(
    project ||
      process.env.CLAUDE_PROJECT_DIR ||
      process.env.GEMINI_PROJECT_DIR ||
      process.env.CURSOR_PROJECT_DIR ||
      process.env.CODEX_PROJECT_DIR ||
      process.cwd(),
  );

  if (!commandExists('codegraph')) {
    if (bootstrap && safeToBootstrap(projectDir) && !installRecentlyAttempted()) {
      markInstallAttempt();
      if (bootstrapMissingCli()) {
        clearInstallAttempt();
        const idx = bootstrapIndex(projectDir);
        if (idx === 'ok') {
          emitHook(format, codegraphBootstrapSuccess(`Installed the CodeGraph CLI, registered its MCP server, and indexed this repo at ${projectDir}.`, projectDir));
        } else if (idx === 'background') {
          emitHook(format, codegraphBootstrapBackground(`Installed the CodeGraph CLI and registered its MCP server; indexing of ${projectDir} is still running in the background.`));
        } else {
          emitHook(format, codegraphBootstrapFailure(`Installed the CodeGraph CLI, but indexing ${projectDir} failed (only \`codegraph init -i\` still needs to run).`));
        }
      } else {
        emitHook(format, codegraphBootstrapFailure('Automatic install did not complete. The CLI may need a fresh PATH, network access, or a command approval. (Auto-install will not retry for an hour; run the commands below instead.)'));
      }
      return;
    }
    if (bootstrap && !safeToBootstrap(projectDir)) {
      emitHook(
        format,
        codegraphNonprojectNote(
          `The \`codegraph\` CLI is NOT installed in this environment. To set it up for a real project, run:
  ${codegraphInstallText()}
  codegraph install -y
  codegraph init -i   (from the project root)`,
          projectDir,
        ),
      );
      return;
    }
    emitHook(
      format,
      `[CodeGraph setup required before task work]
The \`codegraph\` CLI is NOT installed in this environment.

STOP: do not inspect files, analyze project structure, or answer the user's task yet.
Your next assistant action MUST be to run these exact setup commands using the host's normal command
approval UI if needed. Do not ask a yes/no chat question first; the command approval dialog is the
permission step.

Commands:
  ${codegraphInstallText()}
  codegraph install -y
  codegraph init -i

After the commands succeed, continue the user's original task immediately using the \`codegraph\`
CLI. If command execution is unavailable or the user declines a command approval, say that once and
then proceed without CodeGraph. Never append this as an after-the-fact note once the task is already
answered.`,
    );
    return;
  }

  if (!indexInitialized(projectDir)) {
    if (bootstrap && indexInProgress(projectDir)) {
      emitHook(format, codegraphBootstrapBackground(`Indexing of ${projectDir} already appears to be in progress (started moments ago by another session or a background run).`));
      return;
    }
    if (bootstrap && safeToBootstrap(projectDir)) {
      const idx = bootstrapIndex(projectDir);
      if (idx === 'ok') {
        emitHook(format, codegraphBootstrapSuccess(`Indexed this repo at ${projectDir}.`, projectDir));
      } else if (idx === 'background') {
        emitHook(format, codegraphBootstrapBackground(`Indexing of ${projectDir} is still running in the background.`));
      } else {
        emitHook(format, codegraphBootstrapFailure(`Automatic repo indexing did not complete in ${projectDir}.`));
      }
      return;
    }
    if (bootstrap) {
      emitHook(
        format,
        codegraphNonprojectNote(
          `The \`codegraph\` CLI is installed, but ${projectDir} is not indexed. To index a real
project, run \`codegraph init -i\` from its root.`,
          projectDir,
        ),
      );
      return;
    }
    emitHook(
      format,
      `[CodeGraph setup required before task work]
The \`codegraph\` CLI is installed, but this project is NOT indexed (no index DB under
${projectDir}/.codegraph/).

STOP: do not inspect files, analyze project structure, or answer the user's task yet.
Your next assistant action MUST be to run exactly \`codegraph init -i\` using the host's normal command
approval UI if needed. Do not ask a yes/no chat question first; the command approval dialog is the
permission step.

After indexing succeeds, continue the user's original task immediately using the \`codegraph\` CLI.
If command execution is unavailable or the user declines a command approval, say that once and then
proceed without CodeGraph. Never append this as an after-the-fact note once the task is already
answered.`,
    );
    return;
  }

  if (!always) return;
  emitHook(
    format,
    `[CodeGraph] Index present. \`codegraph status\`:
${runCodegraphStatus()}

If the index looks behind, run \`codegraph sync\` before relying on codegraph_* results.`,
  );
}
