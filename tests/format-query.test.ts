import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { formatQueryResult, formatExpandedResult } from '../src/format-query';

// Verbatim copies of the inline formatters src/index.ts used for memory_query
// before 0.14 (characterization). Legacy responses — no created_at/updated_at/
// last_confirmed_at/superseded_by — must still format byte-identically, because
// installed clients talk to servers of every age.
function legacyResult(r: any, idx: number): string {
  const score = r.score ? ` (${Math.round(r.score * 100)}% match)` : '';
  const tags = r.tags?.length ? `\n  🏷️ ${r.tags.join(', ')}` : '';
  const preview = r.content
    ? r.content.slice(0, 150).replace(/\n/g, ' ') + (r.content.length > 150 ? '...' : '')
    : '';
  return `${idx + 1}. ${r.title || 'Untitled'}${score}\n  🆔 ${r.id}\n  📄 ${preview}${tags}`;
}
function legacyExpanded(r: any, idx: number): string {
  const score = r.score ? ` (${Math.round(r.score * 100)}% match)` : '';
  const tags = r.tags?.length ? `\n  🏷️ ${r.tags.join(', ')}` : '';
  const preview = r.content
    ? r.content.slice(0, 150).replace(/\n/g, ' ') + (r.content.length > 150 ? '...' : '')
    : '';
  return `${idx + 1}. ${r.title || 'Untitled'}${score}\n  🆔 ${r.id}\n  🔗 ${r.relationship_type} → ${r.expanded_from}\n  📄 ${preview}${tags}`;
}

const legacyFixtures: any[] = [
  { id: 'id1', title: 'T', content: 'body', score: 0.91, tags: ['a', 'b'] },
  { id: 'id2', content: 'x'.repeat(200), score: 0, tags: [] },
  { id: 'id3', title: '', content: 'line1\nline2', score: 0.5 },
  { id: 'id4', title: 'No content', content: '', score: 0.333, tags: ['only'] },
  { id: 'id5', title: 'Exactly 150', content: 'y'.repeat(150), score: 1, tags: ['t'] },
  // Today's prod server already returns source_uri: without a date it must not add a line.
  { id: 'id6', title: 'Has source', content: 'body', score: 0.7, tags: ['s'], source_uri: 'src/a.ts' },
];

const base = { id: 'id1', title: 'T', content: 'body', score: 0.91, tags: ['a', 'b'] } as any;

describe('formatQueryResult', () => {
  it('legacy result without new fields formats exactly as before', () => {
    expect(formatQueryResult(base, 0)).toBe('1. T (91% match)\n  🆔 id1\n  📄 body\n  🏷️ a, b');
    legacyFixtures.forEach((r, i) => {
      expect(formatQueryResult(r, i)).toBe(legacyResult(r, i));
    });
  });

  it('legacy result with the new fields explicitly null formats exactly as before', () => {
    const r = {
      ...base,
      created_at: null,
      updated_at: null,
      last_confirmed_at: null,
      source_uri: null,
      superseded_by: null,
    };
    expect(formatQueryResult(r, 0)).toBe(legacyResult(base, 0));
  });

  it('prints date line', () => {
    const out = formatQueryResult(
      { ...base, created_at: '2026-11-01T09:00:00Z', updated_at: '2026-11-24T10:00:00Z', source_uri: 'src/a.ts' },
      0,
    );
    expect(out).toContain('\n  📅 2026-11-24 · 📁 src/a.ts');
  });

  it('falls back to created_at when updated_at is missing', () => {
    const out = formatQueryResult({ ...base, created_at: '2026-11-20T23:59:00Z', updated_at: null }, 0);
    expect(out).toContain('\n  📅 2026-11-20');
    expect(out).not.toContain('🔗');
  });

  it('uses the UTC date, not local time', () => {
    const out = formatQueryResult({ ...base, updated_at: '2026-11-24T23:30:00.000Z' }, 0);
    expect(out).toContain('📅 2026-11-24');
  });

  it('prints no freshness line for a source without a date (legacy servers send source_uri)', () => {
    const r = { ...base, source_uri: 'https://x.dev/a' };
    expect(formatQueryResult(r, 0)).toBe(legacyResult(r, 0));
  });

  it('adds confirmed date', () => {
    const out = formatQueryResult(
      { ...base, updated_at: '2026-11-24T10:00:00Z', last_confirmed_at: '2026-11-25T08:00:00Z' },
      0,
    );
    const line = out.split('\n').find((l) => l.includes('📅'))!;
    expect(line).toContain('confirmed 2026-11-25');
    expect(line).toContain('2026-11-24');
  });

  it('prints replaced-by line', () => {
    const out = formatQueryResult(
      {
        ...base,
        created_at: '2026-11-01T00:00:00Z',
        superseded_by: { id: 'n1', title: 'Sessions in Postgres', created_at: '2026-11-24T12:00:00Z' },
      },
      0,
    );
    expect(out).toContain('⚠️ Replaced by "Sessions in Postgres" (2026-11-24, 🆔 n1). Prefer that one.');
  });

  it('uses "untitled" when the replacing memory has no title', () => {
    const out = formatQueryResult(
      { ...base, superseded_by: { id: 'n2', title: null, created_at: '2026-11-24T12:00:00Z' } },
      0,
    );
    expect(out).toContain('⚠️ Replaced by "untitled" (2026-11-24, 🆔 n2). Prefer that one.');
  });
});

describe('formatExpandedResult', () => {
  const exp = {
    id: 'e1',
    title: 'Rel',
    content: 'related body',
    score: 0.42,
    source_type: 'manual',
    tags: ['x'],
    expanded_from: 'id1',
    relationship_type: 'related_to',
  } as any;

  it('legacy expanded result formats exactly as before', () => {
    expect(formatExpandedResult(exp, 0)).toBe(legacyExpanded(exp, 0));
    legacyFixtures.forEach((r, i) => {
      const e = { ...r, expanded_from: 'p', relationship_type: 'depends_on' };
      expect(formatExpandedResult(e, i)).toBe(legacyExpanded(e, i));
    });
  });

  it('prints date and replaced-by lines on expanded results', () => {
    const out = formatExpandedResult(
      {
        ...exp,
        updated_at: '2026-11-24T10:00:00Z',
        superseded_by: { id: 'n1', title: 'New', created_at: '2026-11-24T12:00:00Z' },
      },
      0,
    );
    expect(out).toContain('\n  📅 2026-11-24');
    expect(out).toContain('⚠️ Replaced by "New" (2026-11-24, 🆔 n1). Prefer that one.');
  });
});

// Source-level wiring checks: index.ts must route memory_query through these
// formatters and expose `replaces` on memory_ingest.
describe('index.ts wiring (superseded memories)', () => {
  const src = readFileSync(fileURLToPath(new URL('../src/index.ts', import.meta.url)), 'utf8');
  it('memory_query uses formatQueryResult / formatExpandedResult', () => {
    expect(src).toContain('results.map(formatQueryResult)');
    expect(src).toContain('expanded.map(formatExpandedResult)');
  });
  it('memory_ingest exposes replaces with the agreed wording', () => {
    expect(src).toContain(
      '"Id of a memory this one replaces (a decision that changed). The old memory stays but is marked as superseded in search."',
    );
    expect(src).toContain('If this memory replaces one you found earlier, pass its id in `replaces`.');
  });
  it('memory_correct points to replaces when the decision changed', () => {
    expect(src).toContain('If the decision itself changed, save a new memory with `replaces` instead.');
  });
});
