// Small text utilities for dedup, FTS5 query building, polarity (for conflict
// detection), and recency-decayed ranking. Deliberately simple — the agent (the
// LLM brain) does the hard semantic work; this just keeps the store tidy.

const STOPWORDS = new Set([
  'the', 'a', 'an', 'to', 'of', 'for', 'in', 'on', 'and', 'or', 'use', 'using',
  'prefer', 'when', 'with', 'your', 'you', 'it', 'is', 'be', 'that', 'this', 'as',
]);

const NEGATIONS = new Set(['no', 'not', 'dont', 'don', 'never', 'avoid', 'without', 'disallow', 'forbid', 'neither', 'nor']);

export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

/** Jaccard similarity over content tokens (negation words excluded so polarity is judged separately). */
export function jaccard(a: string, b: string): number {
  const sa = new Set(tokenize(a).filter((t) => !NEGATIONS.has(t)));
  const sb = new Set(tokenize(b).filter((t) => !NEGATIONS.has(t)));
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  for (const x of sa) if (sb.has(x)) inter++;
  return inter / (sa.size + sb.size - inter);
}

/** true if the statement carries a negation (used to spot contradictory pairs). */
export function isNegated(text: string): boolean {
  const toks = (text.toLowerCase().match(/[a-z0-9']+/g) ?? []).map((t) => t.replace(/'/g, ''));
  return toks.some((t) => NEGATIONS.has(t));
}

/** Build a safe FTS5 MATCH expression (quoted OR-joined tokens), or null if empty. */
export function ftsMatchExpr(text: string): string | null {
  const toks = [...new Set(tokenize(text))];
  if (toks.length === 0) return null;
  return toks.map((t) => `"${t}"`).join(' OR ');
}

export function normalizeStatement(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

const HALFLIFE_DAYS = 120;

/** Effective rank: accumulated weight, boosted by signals, decayed by recency. */
export function decayedWeight(weight: number, signalCount: number, updatedAtIso: string, now: number = Date.now()): number {
  const ageDays = Math.max(0, (now - Date.parse(updatedAtIso)) / 86_400_000);
  const recency = Math.pow(0.5, ageDays / HALFLIFE_DAYS);
  const reinforcement = 1 + Math.log1p(Math.max(0, signalCount));
  return weight * reinforcement * recency;
}
