import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  CORE_TOOL_NAMES,
  MAX_CORE_TOOLS,
  categoryOf,
  splitTools,
  searchTools,
  type ToolDef,
} from "../src/tool-registry.js";

const SRC = readFileSync(join(__dirname, "..", "src", "index.ts"), "utf8");

/** Every tool declared in index.ts, as {name, description} pairs. */
function declaredTools(): ToolDef[] {
  const start = SRC.indexOf("const TOOLS");
  const open = SRC.indexOf("[", start);
  let depth = 0;
  let block = "";
  for (let k = open; k < SRC.length; k++) {
    if (SRC[k] === "[") depth++;
    else if (SRC[k] === "]") {
      depth--;
      if (depth === 0) {
        block = SRC.slice(open, k + 1);
        break;
      }
    }
  }
  const marks = [...block.matchAll(/name:\s*"([a-z_]+)"/g)];
  return marks.map((m, i) => {
    const from = m.index!;
    const to = i + 1 < marks.length ? marks[i + 1].index! : block.length;
    const slice = block.slice(from, to);
    const desc = slice.match(/description:\s*\n?\s*"((?:[^"\\]|\\.)*)"/);
    return { name: m[1], description: desc ? desc[1] : "", inputSchema: {} };
  });
}

describe("core size guard", () => {
  it("keeps the visible core at or under the ceiling", () => {
    // This is a hard gate, not a guideline. The whole saving of this change
    // erodes if tools drift back one "obviously essential" addition at a time.
    expect(CORE_TOOL_NAMES.length).toBeLessThanOrEqual(MAX_CORE_TOOLS);
  });

  it("exposes 11 tools in lean mode", () => {
    expect(CORE_TOOL_NAMES.length + 1).toBe(11);
  });
});

describe("reachability", () => {
  const all = declaredTools();
  const { core, hidden } = splitTools(all);

  it("accounts for every declared tool", () => {
    expect(core.length + hidden.length).toBe(all.length);
    expect(all.length).toBe(69);
  });

  it("splits 10 core and 59 hidden", () => {
    expect(core).toHaveLength(10);
    expect(hidden).toHaveLength(59);
  });

  it("finds EVERY hidden tool by its own name — enumerated, not sampled", () => {
    const unreachable = hidden.filter(
      (t) => !searchTools(hidden, t.name.replace(/_/g, " "), 5).some((m) => m.name === t.name),
    );
    expect(unreachable.map((t) => t.name)).toEqual([]);
  });

  it("assigns every hidden tool to a known category", () => {
    const known = ["memory", "tasks", "git", "skills", "routines", "snapshots", "sessions", "collaboration"];
    for (const t of hidden) expect(known).toContain(categoryOf(t.name));
  });

  it("finds at least one tool for every category term", () => {
    const categories = [...new Set(hidden.map((t) => categoryOf(t.name)))];
    for (const c of categories) {
      expect(searchTools(hidden, c, 5).length).toBeGreaterThan(0);
    }
  });
});
