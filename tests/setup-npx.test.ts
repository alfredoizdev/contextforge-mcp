import { readFileSync } from 'fs';
import { describe, it, expect } from 'vitest';

// Regression for the churn-#1 fix: the setup wizard must register the server
// via `npx -y contextforge-mcp`, never the bare `contextforge-mcp` binary
// (which is ENOENT unless the user separately ran `npm i -g`).
const src = readFileSync(new URL('../src/setup.ts', import.meta.url), 'utf8');

describe('setup uses the canonical npx command (no bare binary)', () => {
  it('every `claude mcp add` ends with `-- npx -y contextforge-mcp`', () => {
    const adds = [...src.matchAll(/claude mcp add contextforge[^`]*/g)].map((m) => m[0]);
    expect(adds.length).toBeGreaterThan(0);
    for (const add of adds) {
      expect(add).toContain('-- npx -y contextforge-mcp');
      // must NOT end with the bare binary form
      expect(add).not.toMatch(/--\s+contextforge-mcp\s*$/);
    }
  });

  it('the JSON config snippet uses command "npx" with args, not the bare binary', () => {
    expect(src).toContain("command: 'npx'");
    expect(src).toContain("args: ['-y', 'contextforge-mcp']");
    expect(src).not.toMatch(/command:\s*'contextforge-mcp'/);
  });
});
