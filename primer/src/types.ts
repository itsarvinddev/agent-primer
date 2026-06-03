// Shared types + the controlled vocabularies that keep the style-graph from
// accreting noise (enforced in the store layer, not in SQL).

export type Scope = 'project' | 'global';

/** Controlled category vocabulary. Free-text categories are rejected at write time. */
export const CATEGORIES = [
  'naming',
  'formatting',
  'imports',
  'types',
  'error-handling',
  'async',
  'testing',
  'comments',
  'tooling',
  'structure',
] as const;
export type Category = (typeof CATEGORIES)[number];

export function isCategory(s: string): s is Category {
  return (CATEGORIES as readonly string[]).includes(s);
}

export const SOURCES = ['user-stated', 'correction', 'inferred'] as const;
export type PreferenceSource = (typeof SOURCES)[number];

export function isSource(s: string): s is PreferenceSource {
  return (SOURCES as readonly string[]).includes(s);
}

export interface Preference {
  id: number;
  scope: Scope;
  category: Category;
  statement: string;
  detail: string | null;
  source: PreferenceSource;
  weight: number;
  status: 'active' | 'forgotten';
  language: string | null;
  framework: string | null;
  signal_count: number;
  created_at: string;
  updated_at: string;
}

export type SignalKind = 'edit';

export interface Signal {
  id: number;
  kind: SignalKind;
  file_path: string;
  language: string | null;
  excerpt_before: string | null;
  excerpt_after: string | null;
  agent: string | null;
  processed: 0 | 1;
  created_at: string;
}

export type PrefEdgeKind = 'conflicts' | 'supersedes' | 'co_occurs';

/** A user-facing error whose message is safe to print (no stack needed). */
export class PrimerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PrimerError';
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}
