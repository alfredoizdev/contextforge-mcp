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
  const space = result.space;
  // Show where the memory actually landed. Falls back to "to memory" for older
  // servers that don't yet return the space, so the message stays natural.
  const spaceSuffix = space?.name ? ` → space: ${space.name}` : ' to memory';
  const savedMessage = unsearchable
    ? `📥 Saved "${title}"${spaceSuffix} ⚠️ (saved but not yet searchable — embedding pending)`
    : `📥 Saved "${title}"${spaceSuffix}`;
  // When it fell back to the default space, nudge the caller toward routing.
  const savedHint = space?.was_default
    ? `Filed under your default space${space.name ? ` (${space.name})` : ''}. To route a memory to a specific space, pass space:"<space name>" on save, or move it with memory_move_item.`
    : hint;
  return {
    message: savedMessage,
    hint: savedHint,
    details: { id: item?.id, title, space_id: space?.id },
  };
}
