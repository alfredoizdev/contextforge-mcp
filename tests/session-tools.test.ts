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

  it('session_list awaits registration before filtering out its own row', () => {
    const listCase = indexSrc.slice(indexSrc.indexOf('case "session_list"'));
    const body = listCase.slice(0, listCase.indexOf('case "session_end"'));
    // own id must be populated before the peer filter runs
    expect(body.indexOf('await presence.ensureRegistered()')).toBeGreaterThan(-1);
    expect(body.indexOf('await presence.ensureRegistered()')).toBeLessThan(
      body.indexOf('presence.getSessionId()'),
    );
  });

  it('session_list refuses to list an unresolved project filter', () => {
    const listCase = indexSrc.slice(indexSrc.indexOf('case "session_list"'));
    const body = listCase.slice(0, listCase.indexOf('case "session_end"'));
    expect(body.includes('No project matches')).toBe(true);
  });

  it('session_update gives an honest message after the session was ended', () => {
    const updateCase = indexSrc.slice(indexSrc.indexOf('case "session_update"'));
    const body = updateCase.slice(0, updateCase.indexOf('case "session_list"'));
    expect(body.includes('presence.isEnded()')).toBe(true);
    expect(body.includes("won't be recreated until the MCP process restarts")).toBe(true);
  });

  it('bumps 0.3.2 everywhere (package.json + both server.json fields)', () => {
    expect(pkg.version).toBe('0.3.2');
    expect(serverJson.version).toBe('0.3.2');
    expect(serverJson.packages[0].version).toBe('0.3.2');
  });
});
