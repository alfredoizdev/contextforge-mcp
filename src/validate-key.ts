import { ApiClient } from './api-client.js';
import { ConfigSchema } from './types.js';

type KeyClient = Pick<ApiClient, 'listProjects'>;

/** Validates an API key against the backend with the lightest authenticated
 * call (listProjects → GET /functions/v1/projects, returns [] for a fresh
 * account). Definitive auth failures → invalid; anything else (transport /
 * cold-start) → network, which the wizard warns about but does not block on. */
export async function validateKey(
  apiKey: string,
  client?: KeyClient,
): Promise<{ ok: true } | { ok: false; reason: 'invalid' | 'network' }> {
  const c =
    client ??
    new ApiClient(
      ConfigSchema.parse({
        apiKey,
        apiUrl: process.env.CONTEXTFORGE_API_URL || undefined,
      }),
    );
  try {
    await c.listProjects();
    return { ok: true };
  } catch (err) {
    const e = err as { statusCode?: number; code?: string; error?: string };
    const status = e?.statusCode;
    const code = e?.code ?? e?.error;
    if (status === 401 || status === 403 || code === 'invalid_api_key') {
      return { ok: false, reason: 'invalid' };
    }
    return { ok: false, reason: 'network' };
  }
}
