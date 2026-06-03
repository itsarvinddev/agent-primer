// AST-based style extraction. Turns a source snapshot into a StyleProfile, a before/after
// edit into concrete Observations (candidate one-line preferences + evidence), and a file
// into its dominant style facts (used by primer_impact).
//
// Two layers: UNIVERSAL markers (declaration-name case, quotes, comments) extracted by
// generic node-type matching across all ~22 grammars; and RICH markers (var/const, types,
// async/await, imports, docstrings) for TS/JS/Python. Conservative — crisp markers only.

import type { Category } from '../types.js';
import { type GrammarKey, type TsNode, grammarForPath, isPython, isTsJs, parse } from './grammars.js';

type CaseKind = 'camel' | 'snake' | 'pascal' | 'constant';

export interface StyleProfile {
  grammar: GrammarKey;
  // rich (TS/JS/Python)
  var: number; let: number; const: number;
  arrow: number; funcDecl: number; method: number;
  typeAnn: number;
  await: number; then: number;
  importNamed: number; importDefault: number; importNamespace: number; importFrom: number; importPlain: number;
  try: number; docstring: number;
  // universal (all grammars)
  qSingle: number; qDouble: number; qBacktick: number;
  comments: number;
  valueNames: Record<string, number>;
  typeNames: Record<string, number>;
}

export interface Observation {
  category: Category;
  statement: string;
  evidence: string;
}

function emptyProfile(grammar: GrammarKey): StyleProfile {
  return {
    grammar,
    var: 0, let: 0, const: 0, arrow: 0, funcDecl: 0, method: 0, typeAnn: 0, await: 0, then: 0,
    importNamed: 0, importDefault: 0, importNamespace: 0, importFrom: 0, importPlain: 0,
    try: 0, docstring: 0, qSingle: 0, qDouble: 0, qBacktick: 0, comments: 0, valueNames: {}, typeNames: {},
  };
}

const STRING_TYPES = new Set(['string', 'string_literal', 'interpreted_string_literal', 'raw_string_literal', 'char_literal']);
const VALUE_DECL = new Set([
  'function_declaration', 'function_definition', 'function_item', 'method_definition', 'method_declaration', 'function_signature',
  'variable_declarator', 'field_declaration', 'const_item', 'static_item', 'let_declaration', 'property_signature',
  'public_field_definition', 'property_declaration',
]);
const TYPE_DECL = new Set([
  'class_declaration', 'class_definition', 'class_specifier', 'struct_specifier', 'struct_item', 'interface_declaration',
  'trait_item', 'enum_declaration', 'enum_item', 'enum_specifier', 'type_alias_declaration', 'type_item', 'type_definition',
  'protocol_declaration', 'object_declaration',
]);
const NAMED = new Set(['named_imports']);
const NAMESPACE = new Set(['namespace_import']);

function classifyCase(n: string): CaseKind | null {
  if (n.length < 2 || !/^[A-Za-z_]/.test(n)) return null;
  if (/^[A-Z][A-Z0-9_]*$/.test(n) && n.includes('_')) return 'constant'; // UPPER_SNAKE
  if (/^[a-z][a-zA-Z0-9]*[A-Z]/.test(n)) return 'camel'; // has a hump
  if (n.includes('_') && /^[a-z]/.test(n)) return 'snake';
  if (/^[A-Z][a-z]/.test(n)) return 'pascal';
  return null; // single lowercase word, all-caps acronym, etc. -> ambiguous, skip
}

function hasDescendant(node: TsNode, types: Set<string>, depth = 3): boolean {
  if (depth < 0) return false;
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i);
    if (!c) continue;
    if (types.has(c.type)) return true;
    if (hasDescendant(c, types, depth - 1)) return true;
  }
  return false;
}

function firstStatementIsString(body: TsNode | null): boolean {
  if (!body) return false;
  const first = body.child(0);
  if (!first) return false;
  const target = first.type === 'expression_statement' ? first.child(0) : first;
  return target?.type === 'string';
}

function walkTsJs(node: TsNode, t: string, p: StyleProfile): void {
  switch (t) {
    case 'variable_declaration': p.var++; break;
    case 'lexical_declaration': {
      const kw = node.child(0)?.type;
      if (kw === 'const') p.const++;
      else if (kw === 'let') p.let++;
      break;
    }
    case 'arrow_function': p.arrow++; break;
    case 'function_declaration': case 'function_expression': p.funcDecl++; break;
    case 'method_definition': p.method++; break;
    case 'type_annotation': p.typeAnn++; break;
    case 'await_expression': p.await++; break;
    case 'call_expression': {
      const fn = node.childForFieldName('function');
      if (fn?.type === 'member_expression' && fn.childForFieldName('property')?.text === 'then') p.then++;
      break;
    }
    case 'import_statement':
      if (hasDescendant(node, NAMED)) p.importNamed++;
      else if (hasDescendant(node, NAMESPACE)) p.importNamespace++;
      else p.importDefault++;
      break;
  }
}

function walkPython(node: TsNode, t: string, p: StyleProfile): void {
  switch (t) {
    case 'function_definition': p.funcDecl++; if (firstStatementIsString(node.childForFieldName('body'))) p.docstring++; break;
    case 'class_definition': if (firstStatementIsString(node.childForFieldName('body'))) p.docstring++; break;
    case 'import_statement': p.importPlain++; break;
    case 'import_from_statement': p.importFrom++; break;
  }
}

function walk(node: TsNode, p: StyleProfile): void {
  const t = node.type;
  // --- universal (all grammars) ---
  if (t === 'comment' || t.endsWith('_comment')) p.comments++;
  if (STRING_TYPES.has(t)) {
    const q = node.text[0];
    if (q === "'") p.qSingle++;
    else if (q === '"') p.qDouble++;
    else if (q === '`') p.qBacktick++;
  }
  if (VALUE_DECL.has(t) || TYPE_DECL.has(t)) {
    const nm = node.childForFieldName('name');
    if (nm && /identifier/.test(nm.type)) {
      const c = classifyCase(nm.text);
      if (c) {
        const bucket = TYPE_DECL.has(t) ? p.typeNames : p.valueNames;
        bucket[c] = (bucket[c] ?? 0) + 1;
      }
    }
  }
  if (t === 'try_statement') p.try++;
  // --- rich (language-specific) ---
  if (isTsJs(p.grammar)) walkTsJs(node, t, p);
  else if (isPython(p.grammar)) walkPython(node, t, p);
  // --- recurse ---
  for (let i = 0; i < node.childCount; i++) {
    const c = node.child(i);
    if (c) walk(c, p);
  }
}

export async function profileSource(filePath: string, code: string): Promise<StyleProfile | null> {
  const g = grammarForPath(filePath);
  if (!g) return null;
  const root = await parse(g, code);
  if (!root) return null;
  const p = emptyProfile(g);
  walk(root, p);
  return p;
}

export function extractorSupports(filePath: string): boolean {
  return grammarForPath(filePath) != null;
}

function obs(category: Category, statement: string, evidence: string): Observation {
  return { category, statement, evidence };
}

const CASE_LABEL: Record<CaseKind, string> = { camel: 'camelCase', snake: 'snake_case', pascal: 'PascalCase', constant: 'UPPER_SNAKE_CASE' };

function dominant(counts: Record<string, number>): { case: CaseKind; count: number; total: number; ratio: number } | null {
  let total = 0;
  let best = '';
  let bestN = 0;
  for (const [k, n] of Object.entries(counts)) {
    total += n;
    if (n > bestN) {
      bestN = n;
      best = k;
    }
  }
  return total > 0 ? { case: best as CaseKind, count: bestN, total, ratio: bestN / total } : null;
}

/** Naming-case observations when a case strongly dominates (high precision). */
function namingFacts(p: StyleProfile): Observation[] {
  const out: Observation[] = [];
  const v = dominant(p.valueNames);
  if (v && v.total >= 3 && v.ratio >= 0.7) out.push(obs('naming', `Use ${CASE_LABEL[v.case]} for variable and function names`, `${v.count}/${v.total} ${v.case}`));
  const ty = dominant(p.typeNames);
  if (ty && ty.total >= 2 && ty.ratio >= 0.7) out.push(obs('naming', `Use ${CASE_LABEL[ty.case]} for type and class names`, `${ty.count}/${ty.total} ${ty.case}`));
  return out;
}

/** Directional structural changes between two profiles -> candidate preferences. */
function diff(before: StyleProfile, after: StyleProfile): Observation[] {
  const out: Observation[] = [];
  if (before.var > 0 && after.var < before.var && after.const + after.let >= before.const + before.let)
    out.push(obs('structure', 'Use const/let instead of var', `var ${before.var}→${after.var}`));
  if (after.typeAnn > before.typeAnn) out.push(obs('types', 'Add explicit type annotations', `+${after.typeAnn - before.typeAnn} type annotation(s)`));
  if (after.then < before.then && after.await >= before.await) out.push(obs('async', 'Prefer async/await over .then() chains', `.then ${before.then}→${after.then}`));
  if (after.arrow > before.arrow && after.funcDecl <= before.funcDecl) out.push(obs('structure', 'Prefer arrow functions', `arrow ${before.arrow}→${after.arrow}`));
  else if (after.funcDecl > before.funcDecl && after.arrow < before.arrow) out.push(obs('structure', 'Prefer function declarations over arrow functions', `decl ${before.funcDecl}→${after.funcDecl}`));
  if (before.qDouble >= before.qSingle && after.qSingle > after.qDouble) out.push(obs('formatting', 'Use single quotes', 'quotes →single'));
  else if (before.qSingle >= before.qDouble && after.qDouble > after.qSingle) out.push(obs('formatting', 'Use double quotes', 'quotes →double'));
  if (after.importNamed > before.importNamed && after.importDefault <= before.importDefault) out.push(obs('imports', 'Prefer named imports', `named ${before.importNamed}→${after.importNamed}`));
  if (after.try > before.try) out.push(obs('error-handling', 'Wrap fallible operations in try/catch', `+${after.try - before.try} try block(s)`));
  if (after.docstring > before.docstring) out.push(obs('comments', 'Document functions with docstrings', `+${after.docstring - before.docstring} docstring(s)`));
  return out;
}

/** Dominant style facts of a single file (used by primer_impact). */
export function profileFacts(p: StyleProfile): Observation[] {
  const out: Observation[] = [];
  if (p.const + p.let > 0 && p.var === 0) out.push(obs('structure', 'Use const/let instead of var', 'no var declarations'));
  if (p.typeAnn > 0) out.push(obs('types', 'Add explicit type annotations', `${p.typeAnn} annotation(s)`));
  if (p.await > 0 && p.then === 0) out.push(obs('async', 'Prefer async/await over .then() chains', `${p.await} await(s), 0 .then`));
  if (p.importNamed > p.importDefault) out.push(obs('imports', 'Prefer named imports', `${p.importNamed} named`));
  if (p.qSingle > p.qDouble * 2) out.push(obs('formatting', 'Use single quotes', `${p.qSingle} single`));
  else if (p.qDouble > p.qSingle * 2) out.push(obs('formatting', 'Use double quotes', `${p.qDouble} double`));
  if (p.arrow > p.funcDecl && p.arrow > 0) out.push(obs('structure', 'Prefer arrow functions', `${p.arrow} arrow`));
  if (p.docstring > 0) out.push(obs('comments', 'Document functions with docstrings', `${p.docstring} docstring(s)`));
  return [...out, ...namingFacts(p)];
}

/** Observations for one edit: structural changes + naming state. New file -> the file's facts. */
export async function observeEdit(filePath: string, before: string | null | undefined, after: string | null | undefined): Promise<Observation[]> {
  const g = grammarForPath(filePath);
  if (!g) return [];
  if (after == null || after === '') return [];
  const afterP = await profileSource(filePath, after);
  if (!afterP) return [];
  if (before == null || before === '') return profileFacts(afterP);
  const beforeP = await profileSource(filePath, before);
  if (!beforeP) return profileFacts(afterP);
  return [...diff(beforeP, afterP), ...namingFacts(afterP)];
}

/** Observations for a whole file (primer_impact). */
export async function observeFile(filePath: string, code: string): Promise<Observation[]> {
  const p = await profileSource(filePath, code);
  return p ? profileFacts(p) : [];
}
