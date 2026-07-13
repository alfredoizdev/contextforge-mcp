import { describe, it, expect } from 'vitest';
import { formatIngestResult } from '../src/format-ingest';
import type { IngestResponse } from '../src/types';

const base = { duplicates_skipped: 0, tokens_used: 0 };
function res(item: IngestResponse['items'][number], created = 0): IngestResponse {
  return { ...base, created, items: [item] } as IngestResponse;
}

describe('formatIngestResult', () => {
  it('created → saved message with id', () => {
    const out = formatIngestResult(res({ id: 'k1', status: 'created', embedded: true }, 1), 'Note');
    expect(out.message).toContain('Saved');
    expect(out.details).toMatchObject({ id: 'k1' });
  });
  it('created but unembedded → warns not yet searchable', () => {
    const out = formatIngestResult(res({ id: 'k1', status: 'created', embedded: false }, 1), 'Note');
    expect(out.message).toContain('Saved');
    expect(out.message).toContain('not yet searchable');
  });
  it('duplicate → says already exists with id, not a failure', () => {
    const out = formatIngestResult(res({ id: 'k9', status: 'duplicate' }), 'Note');
    expect(out.message).toContain('already in memory');
    expect(out.message).toContain('k9');
    expect(out.message).not.toContain('Saved');
  });
  it('error → surfaces the real error', () => {
    const out = formatIngestResult(res({ id: '', status: 'error', error: 'db down' }), 'Note');
    expect(out.message).toContain('failed');
    expect(out.message).toContain('db down');
  });
});
