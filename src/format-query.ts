import type { ExpandedResult, QueryResult, ResultFreshnessFields } from './types.js';

// memory_query result formatting. Backward compat is the hard constraint: a
// result with none of the freshness/supersession fields (older servers) must
// format byte-identically to the pre-0.14 inline formatter in index.ts.

/** UTC calendar date of an ISO timestamp (no local-timezone shift). */
function isoDate(ts: string | null | undefined): string | null {
  if (typeof ts !== 'string') return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(ts);
  if (m) return m[1];
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function scoreSuffix(score: number | undefined): string {
  return score ? ` (${Math.round(score * 100)}% match)` : '';
}

function previewOf(content: string | undefined): string {
  return content
    ? content.slice(0, 150).replace(/\n/g, ' ') + (content.length > 150 ? '...' : '')
    : '';
}

function tagsLine(tags: string[] | undefined): string {
  return tags?.length ? `\n  🏷️ ${tags.join(', ')}` : '';
}

/** "\n  ⚠️ Replaced by …" when the item was superseded, else "". */
function supersededLine(r: ResultFreshnessFields): string {
  const s = r.superseded_by;
  if (!s || !s.id) return '';
  const title = s.title || 'untitled';
  const date = isoDate(s.created_at);
  const meta = date ? `${date}, 🆔 ${s.id}` : `🆔 ${s.id}`;
  return `\n  ⚠️ Replaced by "${title}" (${meta}). Prefer that one.`;
}

/** "\n  📅 date · confirmed date · 📁 source" — only when a date exists. Older
 * servers already send source_uri without dates; that must not add a line. */
function freshnessLine(r: ResultFreshnessFields & { source_uri?: string | null }): string {
  const date = isoDate(r.updated_at) ?? isoDate(r.created_at);
  const source = typeof r.source_uri === 'string' && r.source_uri ? r.source_uri : null;
  if (!date) return '';
  const parts: string[] = [`📅 ${date}`];
  const confirmed = isoDate(r.last_confirmed_at);
  if (confirmed) parts.push(`confirmed ${confirmed}`);
  if (source) parts.push(`📁 ${source}`);
  return `\n  ${parts.join(' · ')}`;
}

export function formatQueryResult(r: QueryResult, idx: number): string {
  return (
    `${idx + 1}. ${r.title || 'Untitled'}${scoreSuffix(r.score)}` +
    supersededLine(r) +
    `\n  🆔 ${r.id}` +
    freshnessLine(r) +
    `\n  📄 ${previewOf(r.content)}${tagsLine(r.tags)}`
  );
}

export function formatExpandedResult(r: ExpandedResult, idx: number): string {
  return (
    `${idx + 1}. ${r.title || 'Untitled'}${scoreSuffix(r.score)}` +
    supersededLine(r) +
    `\n  🆔 ${r.id}` +
    freshnessLine(r) +
    `\n  🔗 ${r.relationship_type} → ${r.expanded_from}` +
    `\n  📄 ${previewOf(r.content)}${tagsLine(r.tags)}`
  );
}
