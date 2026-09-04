import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { CORE_TOOL_NAMES, GATEWAY_TOOL_NAME } from "../src/tool-registry.js";

/**
 * src/index.ts calls main() at import time, so it cannot be imported here and
 * is excluded from coverage. We assert its wiring at the source level — the
 * same approach tests/server-instructions.test.ts uses.
 */
const SRC = readFileSync(join(__dirname, "..", "src", "index.ts"), "utf8");

/** The TOOLS array literal, extracted by balancing brackets. */
function toolsBlock(): string {
  const start = SRC.indexOf("const TOOLS");
  expect(start).toBeGreaterThan(-1);
  const open = SRC.indexOf("[", start);
  let depth = 0;
  for (let k = open; k < SRC.length; k++) {
    if (SRC[k] === "[") depth++;
    else if (SRC[k] === "]") {
      depth--;
      if (depth === 0) return SRC.slice(open, k + 1);
    }
  }
  throw new Error("TOOLS array not terminated");
}

function toolNames(): string[] {
  return [...toolsBlock().matchAll(/name:\s*"([a-z_]+)"/g)].map((m) => m[1]);
}

describe("index.ts tool inventory", () => {
  it("still defines 69 tools", () => {
    expect(toolNames()).toHaveLength(69);
  });

  it("defines every core tool", () => {
    const names = toolNames();
    for (const core of CORE_TOOL_NAMES) expect(names).toContain(core);
  });

  it("has no duplicate tool names", () => {
    const names = toolNames();
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("index.ts wiring", () => {
  it("imports the tool registry", () => {
    expect(SRC).toMatch(/from\s+"\.\/tool-registry\.js"/);
  });

  it("builds the ListTools response through visibleTools, not the raw array", () => {
    const handler = SRC.slice(SRC.indexOf("ListToolsRequestSchema"));
    const body = handler.slice(0, handler.indexOf("});"));
    expect(body).toContain("visibleTools");
    expect(body).not.toMatch(/return\s*\{\s*tools:\s*TOOLS\s*\}/);
  });

  it("dispatches the gateway tool", () => {
    expect(SRC).toContain(`case "${GATEWAY_TOOL_NAME}":`);
  });

  it("refuses to let the gateway invoke itself", () => {
    const caseStart = SRC.indexOf(`case "${GATEWAY_TOOL_NAME}":`);
    const body = SRC.slice(caseStart, caseStart + 3000);
    expect(body).toContain("GATEWAY_TOOL_NAME");
  });
});

describe("no orphaned tools", () => {
  it("every declared tool has a dispatch case", () => {
    const cases = new Set([...SRC.matchAll(/case\s+"([a-z_]+)":/g)].map((m) => m[1]));
    const missing = toolNames().filter((n) => !cases.has(n));
    expect(missing).toEqual([]);
  });
});
