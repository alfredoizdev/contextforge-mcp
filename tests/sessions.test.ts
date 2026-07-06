import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApiClient, ApiClientError } from '../src/api-client.js';

const mockFetch = vi.fn();
global.fetch = mockFetch;

const SESSION = {
  id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  project_id: null,
  label: 'worktree-auth',
  focus: 'working on the auth module',
  status: 'active',
  started_at: '2026-07-06T10:00:00Z',
  last_heartbeat_at: '2026-07-06T10:02:00Z',
  metadata: {},
};

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: async () => body,
  };
}

describe('ApiClient session presence', () => {
  let client: ApiClient;

  beforeEach(() => {
    client = new ApiClient({
      apiKey: 'cf_live_test123',
      apiUrl: 'https://api.contextforge.io',
    });
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('registerSession POSTs to /functions/v1/sessions and unwraps session', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ session: SESSION }, 201));
    const session = await client.registerSession({ label: 'worktree-auth' });
    expect(session.id).toBe(SESSION.id);
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe('https://api.contextforge.io/functions/v1/sessions');
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body)).toEqual({ label: 'worktree-auth' });
  });

  it('updateSession with no input sends a pure heartbeat PATCH', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ session: SESSION }));
    await client.updateSession(SESSION.id);
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe(`https://api.contextforge.io/functions/v1/sessions/${SESSION.id}`);
    expect(options.method).toBe('PATCH');
    expect(JSON.parse(options.body)).toEqual({});
  });

  it('updateSession sends focus when provided', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ session: SESSION }));
    await client.updateSession(SESSION.id, { focus: 'refactoring billing' });
    const [, options] = mockFetch.mock.calls[0];
    expect(JSON.parse(options.body)).toEqual({ focus: 'refactoring billing' });
  });

  it('listSessions builds query params and returns the array', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ sessions: [SESSION] }));
    const sessions = await client.listSessions({ projectId: 'p1', includeStale: true });
    expect(sessions).toHaveLength(1);
    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe(
      'https://api.contextforge.io/functions/v1/sessions?project_id=p1&include_stale=true',
    );
  });

  it('listSessions with no options hits the bare path', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ sessions: [] }));
    const sessions = await client.listSessions();
    expect(sessions).toEqual([]);
    expect(mockFetch.mock.calls[0][0]).toBe(
      'https://api.contextforge.io/functions/v1/sessions',
    );
  });

  it('endSession DELETEs the session', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ success: true }));
    const result = await client.endSession(SESSION.id);
    expect(result.success).toBe(true);
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe(`https://api.contextforge.io/functions/v1/sessions/${SESSION.id}`);
    expect(options.method).toBe('DELETE');
  });

  it('propagates ApiClientError on 429 over-cap', async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse({ error: 'Active session limit reached (20 per organization)' }, 429),
    );
    await expect(client.registerSession({})).rejects.toThrow(ApiClientError);
  });
});
