import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
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

  return { scope, root, agents, bundles, dryRun, always, purge };
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
      kimiConfig: join(home, '.kimi-code', 'config.toml'),
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
    kimiSkillsDir: join(home, '.kimi-code', 'skills'),
    claudeSettings: join(home, '.claude', 'settings.json'),
    codexHooks: join(home, '.codex', 'hooks.json'),
    cursorHooks: join(home, '.cursor', 'hooks.json'),
    geminiSettings: join(home, '.gemini', 'settings.json'),
    antiHooks: join(home, '.gemini', 'antigravity-cli', 'plugins', 'agent-primer', 'hooks.json'),
    opencodePluginDir: join(home, '.config', 'opencode', 'plugins'),
    kimiConfig: join(home, '.kimi-code', 'config.toml'),
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

function jsonHook(file: string, kind: 'claude' | 'codex' | 'cursor' | 'gemini' | 'antigravity', command: string, opts: Parsed): void {
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
      if (kind === 'antigravity') arr.push({ command });
      else {
        const entry: Record<string, any> = { hooks: [{ type: 'command', command }] };
        if (kind === 'gemini') entry.matcher = 'startup';
        arr.push(entry);
      }
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

function appendTomlHook(file: string, label: string, command: string, opts: Parsed, extra = ''): void {
  const block = `\n# ${label}\n[[hooks]]\nevent = "SessionStart"\ncommand = ${JSON.stringify(command)}\ntimeout = 10\n${extra}`;
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

function selected(opts: Parsed, agent: Agent): boolean {
  return opts.agents.includes(agent);
}

function codegraphHook(format: 'text' | 'json' | 'cursor', opts: Parsed): string {
  const args = ['codegraph-check', '--format', format];
  if (opts.always) args.push('--always');
  return primerCommand(args);
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
    jsonHook(p.geminiSettings, 'gemini', codegraphHook('json', opts), opts);
    setGeminiContext(p.geminiSettings, opts);
  }
  if (selected(opts, 'antigravity')) jsonHook(p.antiHooks, 'antigravity', codegraphHook('text', opts), opts);
  if (selected(opts, 'opencode')) {
    putFile(join(p.opencodePluginDir, 'codegraph-session-check.js'), opencodeTemplate('codegraph', ['codegraph-check', '--format', 'text']), opts);
  }
  if (selected(opts, 'kimi')) {
    if (opts.scope === 'global') appendTomlHook(p.kimiConfig, 'codegraph-session-startup', codegraphHook('text', opts), opts);
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
  if (selected(opts, 'antigravity')) jsonHook(p.antiHooks, 'antigravity', primerBrief('text'), opts);
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
    unhookJson(p.antiHooks, [...CORE_HOOK_TAGS, ...PRIMER_HOOK_TAGS], opts);
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

function commandExists(command: string): boolean {
  const result = spawnSync(command, ['--version'], { stdio: 'ignore', shell: false });
  return !result.error;
}

function runCodegraphStatus(): string {
  const result = spawnSync('codegraph', ['status'], { encoding: 'utf8', timeout: 8000 });
  return `${result.stdout || ''}${result.stderr || ''}`.replace(/\x1B\[[0-9;]*m/g, '').trim();
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
  if (process.platform === 'win32') {
    return 'irm https://raw.githubusercontent.com/colbymchenry/codegraph/main/install.ps1 | iex';
  }
  return 'curl -fsSL https://raw.githubusercontent.com/colbymchenry/codegraph/main/install.sh | sh';
}

export async function runCodegraphCheck(args: string[]): Promise<void> {
  let format = 'text';
  let project = '';
  let always = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--format') format = args[++i] || 'text';
    else if (a.startsWith('--format=')) format = a.slice('--format='.length);
    else if (a === '--project') project = args[++i] || '';
    else if (a.startsWith('--project=')) project = a.slice('--project='.length);
    else if (a === '--always') always = true;
  }
  const projectDir = resolve(project || process.env.CLAUDE_PROJECT_DIR || process.env.CODEX_PROJECT_DIR || process.cwd());
  if (!commandExists('codegraph')) {
    emitHook(
      format,
      `[CodeGraph] The \`codegraph\` CLI is NOT installed in this environment.
Do NOT leave this as a passive note. Ask the user this direct yes/no question before substantive work:

  CodeGraph is not installed yet. Want me to install it and index this repo now? I will run:
    ${codegraphInstallText()}
    codegraph install
    codegraph init -i

If the user says yes, announce each command, run the three commands, then ask them to RESTART this
agent/IDE so the codegraph_* MCP tools load. Until restart, use the \`codegraph\` CLI directly.
If the user says no, proceed without CodeGraph and mention that structural code answers may be weaker.`,
    );
    return;
  }
  if (!existsSync(join(projectDir, '.codegraph'))) {
    emitHook(
      format,
      `[CodeGraph] CLI present, but this project is NOT initialized (no .codegraph/ at
${projectDir}).
Do NOT leave this as a passive note. Ask the user this direct yes/no question before substantive work:

  CodeGraph is installed, but this repo is not indexed yet. Want me to run \`codegraph init -i\` now?

If the user says yes, announce and run \`codegraph init -i\`. If the codegraph_* MCP tools are
missing afterwards, run \`codegraph install\` and ask the user to restart this agent/IDE.
If the user says no, proceed without CodeGraph and mention that structural code answers may be weaker.`,
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
