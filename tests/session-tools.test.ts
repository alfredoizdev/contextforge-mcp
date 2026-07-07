import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const indexSrc = readFileSync(join(__dirname, '..', 'src', 'index.ts'), 'utf-8');
const pkg = JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf-8'));
const serverJson = JSON.parse(readFileSync(join(__dirname, '..', 'server.json'), 'utf-8'));

describe('session presence wiring (static)', () => {
  it('registers the three session tools in the tool list and dispatch', () => {
    for (const tool of ['session_update', 'session_list', 'session_end']) {
      expect(indexSrc.includes(`name: "${tool}"`), `${tool} listed`).toBe(true);
      expect(indexSrc.includes(`case "${tool}"`), `${tool} dispatched`).toBe(true);
    }
    // No session_start tool — registration is implicit (spec decision)
    expect(indexSrc.includes('session_start')).toBe(false);
  });

  it('fires lazy registration on every tool call, fire-and-forget', () => {
    expect(indexSrc.includes('void presence.ensureRegistered()')).toBe(true);
  });

  it('installs exit hooks for best-effort end', () => {
    expect(indexSrc.includes('presence.installExitHooks()')).toBe(true);
  });

  it('bumps 0.3.1 everywhere (package.json + both server.json fields)', () => {
    expect(pkg.version).toBe('0.3.1');
    expect(serverJson.version).toBe('0.3.1');
    expect(serverJson.packages[0].version).toBe('0.3.1');
  });
});
