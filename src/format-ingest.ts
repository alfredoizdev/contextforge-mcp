import type { IngestResponse } from './types.js';

/** Turns an ingest response into an accurate, human-readable message.
 * Distinguishes created / duplicate / error so a failed save is never
 * mislabeled as a duplicate (the silent-data-loss bug), and warns when an
 * item was saved but is not yet searchable (embedding pending). */
export function formatIngestResult(
  result: IngestResponse,
  title: string,
): { message: string; hint: string; details?: Record<string, unknown> } {
  const item = result.items?.[0];
  const hint = 'Use memory_query to search your saved knowledge';

  if (item?.status === 'error') {
    return {
      message: `❌ Save failed: ${item.error ?? 'unknown error'}`,
      hint: 'Check your API key and plan limits, then try again.',
    };
  }
  if (item?.status === 'duplicate') {
    return {
      message: `⏭️ Identical content already in memory (id ${item.id}). Nothing new saved. Pass deduplicate:false to save a copy anyway.`,
      hint,
    };
  }
  // created
  const unsearchable = item?.embedded === false;
  return {
    message: unsearchable
      ? `📥 Saved "${title}" to memory ⚠️ (saved but not yet searchable — embedding pending)`
      : `📥 Saved "${title}" to memory`,
    hint,
    details: { id: item?.id, title },
  };
}
