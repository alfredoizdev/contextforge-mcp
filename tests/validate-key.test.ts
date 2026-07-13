import { describe, it, expect, vi } from 'vitest';
import { validateKey } from '../src/validate-key';

function fakeClient(behavior: 'ok' | 'auth' | 'net') {
  return {
    listProjects: vi.fn(async () => {
      if (behavior === 'ok') return [];
      if (behavior === 'auth') throw { statusCode: 401, code: 'invalid_api_key' };
      throw { code: 'NETWORK_ERROR' };
    }),
  };
}

describe('validateKey', () => {
  it('ok when listProjects resolves', async () => {
    expect(await validateKey('k', fakeClient('ok') as never)).toEqual({ ok: true });
  });
  it('invalid on auth error', async () => {
    expect(await validateKey('k', fakeClient('auth') as never)).toEqual({
      ok: false,
      reason: 'invalid',
    });
  });
  it('network on connection error', async () => {
    expect(await validateKey('k', fakeClient('net') as never)).toEqual({
      ok: false,
      reason: 'network',
    });
  });
});
