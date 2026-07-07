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

  it('session_list defaults to the current project, with an all_projects escape', () => {
    const listCase = indexSrc.slice(indexSrc.indexOf('case "session_list"'));
    const body = listCase.slice(0, listCase.indexOf('case "session_end"'));
    // default scope uses this session's linked project
    expect(body.includes('presence.getDefaultProjectId()')).toBe(true);
    // all_projects widens back to org-wide
    expect(body.includes('all_projects')).toBe(true);
    // the tool advertises both the project arg and all_projects
    expect(indexSrc.includes('all_projects: true to see')).toBe(true);
    // explicit project takes precedence over all_projects (checked first)
    expect(body.indexOf('"project" in args')).toBeGreaterThan(-1);
    expect(body.indexOf('"project" in args')).toBeLessThan(
      body.indexOf('!allProjects'),
    );
  });

  it('session_update gives an honest message after the session was ended', () => {
    const updateCase = indexSrc.slice(indexSrc.indexOf('case "session_update"'));
    const body = updateCase.slice(0, updateCase.indexOf('case "session_list"'));
    expect(body.includes('presence.isEnded()')).toBe(true);
    expect(body.includes("won't be recreated until the MCP process restarts")).toBe(true);
  });

  it('bumps 0.3.3 everywhere (package.json + both server.json fields)', () => {
    expect(pkg.version).toBe('0.3.3');
    expect(serverJson.version).toBe('0.3.3');
    expect(serverJson.packages[0].version).toBe('0.3.3');
  });
});
