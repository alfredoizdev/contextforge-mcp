import { describe, it, expect } from 'vitest';
import { parseApiError } from '../src/api-client';

describe('parseApiError', () => {
  it('auth shape {error: code, message: human} → code + friendly + isAuthError', () => {
    const e = parseApiError({ error: 'invalid_api_key', message: 'Your API key is invalid.' }, 401);
    expect(e.code).toBe('invalid_api_key');
    expect(e.isAuthError()).toBe(true);
    expect(e.getUserFriendlyMessage().length).toBeGreaterThan(0);
  });
  it('ingest/query shape {error: human, code} → code preserved', () => {
    const e = parseApiError({ error: 'Document limit reached', code: 'quota_exceeded_documents' }, 403);
    expect(e.code).toBe('quota_exceeded_documents');
    expect(e.isQuotaError()).toBe(true);
  });
  it('bare {error} → code falls back to the error string', () => {
    const e = parseApiError({ error: 'NO_SPACES' }, 400);
    expect(e.code).toBe('NO_SPACES');
  });
});
