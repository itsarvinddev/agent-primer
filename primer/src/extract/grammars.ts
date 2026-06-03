// Lazy web-tree-sitter loader. Grammars are loaded as WASM BYTES (passing a path
// trips web-tree-sitter's ESM `Dynamic require of "fs/promises"`). Verified on Node 26
// with no V8 flags. The whole module is imported lazily (only by distill/impact/observe),
// so the hot paths (signal/brief/record) never pay the tree-sitter cost.

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const req = createRequire(import.meta.url);
let wasmDir: string | null = null;
function grammarsDir(): string {
  if (!wasmDir) wasmDir = req.resolve('tree-sitter-wasms/package.json').replace(/package\.json$/, 'out/');
  return wasmDir;
}

// Grammar name = the tree-sitter-wasms file stem (tree-sitter-<key>.wasm).
export type GrammarKey = string;

// Extension -> grammar. ~22 programming languages; config/markup formats are excluded
// (style learning is for code). Universal markers (naming/quotes/comments) work for all;
// the rich structural markers (var/const, types, async) apply to TS/JS/Python.
const EXT_GRAMMAR: Record<string, GrammarKey> = {
  ts: 'typescript', mts: 'typescript', cts: 'typescript',
  tsx: 'tsx',
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  py: 'python', pyi: 'python',
  go: 'go',
  rs: 'rust',
  java: 'java',
  c: 'c', h: 'c',
  cc: 'cpp', cpp: 'cpp', cxx: 'cpp', hpp: 'cpp', hh: 'cpp', hxx: 'cpp',
  cs: 'c_sharp',
  rb: 'ruby',
  php: 'php',
  swift: 'swift',
  kt: 'kotlin', kts: 'kotlin',
  scala: 'scala', sc: 'scala',
  lua: 'lua',
  sh: 'bash', bash: 'bash',
  ex: 'elixir', exs: 'elixir',
  ml: 'ocaml', mli: 'ocaml',
  m: 'objc', mm: 'objc',
  sol: 'solidity',
};

export function grammarForPath(path: string): GrammarKey | null {
  const dot = path.lastIndexOf('.');
  if (dot < 0) return null;
  return EXT_GRAMMAR[path.slice(dot + 1).toLowerCase()] ?? null;
}

export function isTsJs(g: GrammarKey): boolean {
  return g === 'typescript' || g === 'tsx' || g === 'javascript';
}
export function isPython(g: GrammarKey): boolean {
  return g === 'python';
}

// Minimal shapes we use from web-tree-sitter (typed loosely on purpose).
export interface TsNode {
  type: string;
  text: string;
  childCount: number;
  child(i: number): TsNode | null;
  childForFieldName(name: string): TsNode | null;
}
interface TsParser {
  setLanguage(lang: unknown): void;
  parse(code: string): { rootNode: TsNode };
}

let ParserCtor: any = null;
let LanguageNS: any = null;
let initPromise: Promise<void> | null = null;
const langCache = new Map<GrammarKey, unknown>();

async function ensureInit(): Promise<void> {
  if (ParserCtor) return;
  if (!initPromise) {
    initPromise = (async () => {
      const mod: any = await import('web-tree-sitter');
      ParserCtor = mod.Parser ?? mod.default?.Parser;
      LanguageNS = mod.Language ?? mod.default?.Language;
      await ParserCtor.init();
    })();
  }
  await initPromise;
}

/** Parse `code` with the grammar for `key`; returns the root node (or null on failure). */
export async function parse(key: GrammarKey, code: string): Promise<TsNode | null> {
  try {
    await ensureInit();
    let lang = langCache.get(key);
    if (!lang) {
      lang = await LanguageNS.load(new Uint8Array(readFileSync(grammarsDir() + `tree-sitter-${key}.wasm`)));
      langCache.set(key, lang);
    }
    const p: TsParser = new ParserCtor();
    p.setLanguage(lang);
    return p.parse(code).rootNode;
  } catch {
    return null; // grammar missing or parse failure -> caller falls back to raw text
  }
}
