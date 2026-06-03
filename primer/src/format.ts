// Rendering for the style brief — shared by the CLI (`show`/`brief`) and the MCP
// `primer_apply` tool. Kept compact: the brief is injected into agent context every
// session, so it must stay small.

import type { BriefItem } from './graph/store.js';

export function briefToText(items: BriefItem[]): string {
  if (items.length === 0) return '';
  const byCat = new Map<string, BriefItem[]>();
  for (const it of items) {
    const list = byCat.get(it.category) ?? [];
    list.push(it);
    byCat.set(it.category, list);
  }
  const lines: string[] = [];
  for (const [cat, its] of byCat) {
    lines.push(`${cat}:`);
    for (const it of its) lines.push(`  - ${it.statement}${it.detail ? ` — ${it.detail}` : ''}`);
  }
  return lines.join('\n');
}

export function briefToMarkdown(items: BriefItem[]): string {
  if (items.length === 0) return '';
  const byCat = new Map<string, BriefItem[]>();
  for (const it of items) {
    const list = byCat.get(it.category) ?? [];
    list.push(it);
    byCat.set(it.category, list);
  }
  const lines: string[] = [];
  for (const [cat, its] of byCat) {
    lines.push(`**${cat}**`);
    for (const it of its) lines.push(`- ${it.statement}${it.detail ? ` — ${it.detail}` : ''}`);
    lines.push('');
  }
  return lines.join('\n').trim();
}

export function briefToJson(items: BriefItem[]): Array<Record<string, unknown>> {
  return items.map((it) => ({
    id: it.id,
    category: it.category,
    statement: it.statement,
    detail: it.detail,
    language: it.language,
    framework: it.framework,
    tags: it.tags,
    weight: Number(it.rank.toFixed(3)),
  }));
}
