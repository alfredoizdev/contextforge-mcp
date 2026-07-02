import { readFileSync } from 'fs';
import { describe, it, expect } from 'vitest';

// Regression guard for the "cannot overwrite an existing API key" bug.
//
// `claude mcp add` refuses to overwrite a server that already exists
// ("MCP server contextforge already exists in user config"), so the setup tool
// MUST run `claude mcp remove contextforge` before each `claude mcp add`.
// Without it, overwrite/reconfigure fail every time. This static check reads the
// source so it fails if the remove-before-add is ever dropped from either path
// (the initial add and the "reconfigure with a different key" retry).
const src = readFileSync(new URL('../src/setup.ts', import.meta.url), 'utf8');

describe('setup overwrites an existing MCP config', () => {
  it('runs `claude mcp remove` once per `claude mcp add` (both paths)', () => {
    const adds = (src.match(/claude mcp add contextforge/g) || []).length;
    const removes = (src.match(/claude mcp remove contextforge/g) || []).length;
    expect(adds).toBeGreaterThanOrEqual(2); // initial add + retry add
    expect(removes).toBe(adds); // one remove precedes each add
  });

  it('places a `remove` before every `add` in the source', () => {
    const addPositions = [...src.matchAll(/claude mcp add contextforge/g)].map(
      (m) => m.index ?? -1,
    );
    const removePositions = [
      ...src.matchAll(/claude mcp remove contextforge/g),
    ].map((m) => m.index ?? -1);
    for (const addPos of addPositions) {
      expect(removePositions.some((r) => r >= 0 && r < addPos)).toBe(true);
    }
  });
});
