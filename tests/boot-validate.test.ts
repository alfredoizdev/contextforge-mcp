import { readFileSync } from 'fs';
import { describe, it, expect } from 'vitest';

const src = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');

describe('boot key validation', () => {
  it('main() validates the key at startup (best-effort, non-blocking)', () => {
    expect(src).toContain('validateKey(config.apiKey)');
    // must be fire-and-forget (has a .catch so it never rejects the boot)
    expect(src).toMatch(/validateKey\(config\.apiKey\)[\s\S]{0,400}\.catch\(/);
  });
});
