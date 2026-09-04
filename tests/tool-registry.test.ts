import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import {
  CORE_TOOL_NAMES,
  GATEWAY_TOOL_NAME,
  categoryOf,
  isLeanMode,
  searchTools,
  splitTools,
  type ToolDef,
} from "../src/tool-registry.js";

const tool = (name: string): ToolDef => ({
  name,
  description: `description for ${name}`,
  inputSchema: { type: "object", properties: {} },
});

/**
 * Extract the real TOOLS array from src/index.ts (59 tools, 10 core + 59 hidden).
 * Replicates the approach used by search-probe.cjs to ensure test and probe
 * use the same tool set and catch regressions at the 59-tool scale.
 *
 * Note: Does NOT import src/index.ts to avoid triggering main() at module load.
 */
function extractRealTools(): ToolDef[] {
  const indexPath = path.resolve(process.cwd(), "src/index.ts");
  const s = fs.readFileSync(indexPath, "utf8");
  const start = s.indexOf("const TOOLS");
  let i = s.indexOf("[", start),
    d = 0,
    end = i;
  for (let k = i; k < s.length; k++) {
    if (s[k] === "[") d++;
    else if (s[k] === "]") {
      d--;
      if (d === 0) {
        end = k;
        break;
      }
    }
  }
  const block = s.slice(i, end + 1);
  const marks = [...block.matchAll(/name:\s*"([a-z_]+)"/g)];
  return marks.map((m, x) => {
    const a = m.index!;
    const b = x + 1 < marks.length ? marks[x + 1].index! : block.length;
    const sl = block.slice(a, b);
    const de = sl.match(/description:\s*\n?\s*"((?:[^"\\]|\\.)*)"/);
    return { name: m[1], description: de ? de[1] : "", inputSchema: {} };
  });
}

describe("CORE_TOOL_NAMES", () => {
  it("is exactly the 10 agreed core tools", () => {
    expect([...CORE_TOOL_NAMES].sort()).toEqual(
      [
        "memory_check_freshness",
        "memory_confirm",
        "memory_correct",
        "memory_forget",
        "memory_help",
        "memory_ingest",
        "memory_query",
        "session_list",
        "tasks_list",
        "tasks_what_next",
      ].sort(),
    );
  });

  it("does not contain the gateway itself", () => {
    expect(CORE_TOOL_NAMES).not.toContain(GATEWAY_TOOL_NAME);
  });
});

describe("categoryOf", () => {
  it("routes git tools to git, not memory", () => {
    expect(categoryOf("memory_git_commits")).toBe("git");
    expect(categoryOf("memory_git_sync")).toBe("git");
  });

  it("routes snapshot tools to snapshots, not memory", () => {
    expect(categoryOf("memory_snapshot_create")).toBe("snapshots");
  });

  it("routes plain memory tools to memory", () => {
    expect(categoryOf("memory_query")).toBe("memory");
    expect(categoryOf("memory_list_spaces")).toBe("memory");
  });

  it("routes each remaining prefix to its own category", () => {
    expect(categoryOf("tasks_create")).toBe("tasks");
    expect(categoryOf("skills_run")).toBe("skills");
    expect(categoryOf("routines_toggle")).toBe("routines");
    expect(categoryOf("session_update")).toBe("sessions");
    expect(categoryOf("project_share")).toBe("collaboration");
    expect(categoryOf("collaborators_list")).toBe("collaboration");
  });
});

describe("isLeanMode", () => {
  it("defaults to lean when the env var is unset", () => {
    expect(isLeanMode({})).toBe(true);
  });

  it("is lean for any value that is not 'full'", () => {
    expect(isLeanMode({ CONTEXTFORGE_TOOLS: "lean" })).toBe(true);
    expect(isLeanMode({ CONTEXTFORGE_TOOLS: "" })).toBe(true);
    expect(isLeanMode({ CONTEXTFORGE_TOOLS: "nonsense" })).toBe(true);
  });

  it("is full for 'full', case-insensitively", () => {
    expect(isLeanMode({ CONTEXTFORGE_TOOLS: "full" })).toBe(false);
    expect(isLeanMode({ CONTEXTFORGE_TOOLS: "FULL" })).toBe(false);
    expect(isLeanMode({ CONTEXTFORGE_TOOLS: "Full" })).toBe(false);
  });
});

describe("splitTools", () => {
  it("puts core names in core and everything else in hidden", () => {
    const all = [tool("memory_query"), tool("memory_git_sync"), tool("tasks_list")];
    const { core, hidden } = splitTools(all);
    expect(core.map((t) => t.name)).toEqual(["memory_query", "tasks_list"]);
    expect(hidden.map((t) => t.name)).toEqual(["memory_git_sync"]);
  });

  it("loses no tool: core + hidden always equals the input", () => {
    const all = ["memory_query", "memory_git_sync", "skills_run", "memory_forget"].map(tool);
    const { core, hidden } = splitTools(all);
    expect(core.length + hidden.length).toBe(all.length);
  });

  it("returns empty core when no core tool is present", () => {
    const { core, hidden } = splitTools([tool("skills_run")]);
    expect(core).toEqual([]);
    expect(hidden).toHaveLength(1);
  });
});

const HIDDEN: ToolDef[] = [
  { name: "memory_git_commits", description: "List commits stored in memory from connected repositories", inputSchema: {} },
  { name: "memory_git_sync", description: "Sync a connected git repository into memory", inputSchema: {} },
  { name: "tasks_create", description: "Create a new task or issue", inputSchema: {} },
  { name: "skills_run", description: "Execute a stored skill", inputSchema: {} },
  { name: "memory_export", description: "Export all knowledge items to a file", inputSchema: {} },
  { name: "memory_move_item", description: "Move an item to another space, or optionally export it first", inputSchema: {} },
  { name: "memory_snapshot_restore", description: "Restore memory to a previous snapshot state", inputSchema: {} },
];

describe("searchTools", () => {
  it("finds tools by exact name fragment", () => {
    const names = searchTools(HIDDEN, "git commits").map((t) => t.name);
    expect(names[0]).toBe("memory_git_commits");
  });

  it("finds every tool in a category when searching the category name", () => {
    const names = searchTools(HIDDEN, "git").map((t) => t.name);
    expect(names).toContain("memory_git_commits");
    expect(names).toContain("memory_git_sync");
  });

  it("finds a tool through a Spanish synonym with no lexical overlap", () => {
    const names = searchTools(HIDDEN, "deshacer").map((t) => t.name);
    expect(names).toContain("memory_snapshot_restore");
  });

  it("finds a tool through an English synonym with no lexical overlap", () => {
    const names = searchTools(HIDDEN, "undo snapshot").map((t) => t.name);
    expect(names).toContain("memory_snapshot_restore");
  });

  it("matches words in the description", () => {
    const names = searchTools(HIDDEN, "issue").map((t) => t.name);
    expect(names[0]).toBe("tasks_create");
    expect(names.length).toBe(1);
  });

  it("returns an empty array when nothing matches", () => {
    expect(searchTools(HIDDEN, "zzzznomatchzzzz")).toEqual([]);
  });

  it("respects the limit and defaults to 5", () => {
    expect(searchTools(HIDDEN, "memory", 2)).toHaveLength(2);
    expect(searchTools(HIDDEN, "memory").length).toBeLessThanOrEqual(5);
  });

  it("ranks a name match above a description-only match", () => {
    const names = searchTools(HIDDEN, "export").map((t) => t.name);
    expect(names[0]).toBe("memory_export");
    expect(names.length).toBeGreaterThan(1);
    expect(names).toContain("memory_move_item");
  });

  it("ignores very short noise words", () => {
    const names = searchTools(HIDDEN, "a of the git").map((t) => t.name);
    expect(names).toContain("memory_git_sync");
  });

  it("breaks ties by preferring shorter names and alphabetical order", () => {
    // Create a fixture where multiple tools match "memory" at the same score
    const fixture: ToolDef[] = [
      { name: "memory_get_item", description: "Get an item", inputSchema: {} },
      { name: "memory_list_items", description: "List items in memory", inputSchema: {} },
      { name: "memory_move_item", description: "Move an item", inputSchema: {} },
      { name: "memory_list_spaces", description: "List memory spaces", inputSchema: {} },
      { name: "memory_create_space", description: "Create a new space", inputSchema: {} },
      { name: "memory_delete_space", description: "Delete a space from memory", inputSchema: {} },
    ];
    const names = searchTools(fixture, "memory", 5).map((t) => t.name);
    // All match "memory" in name at score 10, so tie-breaker applies:
    // Sorted by: length ascending, then alphabetical
    // memory_get_item (15) < memory_move_item (16) < memory_list_items (17) < memory_list_spaces (18)
    // < memory_create_space (19) < memory_delete_space (19) alphabetically
    expect(names[0]).toBe("memory_get_item"); // 15 chars, shortest
    expect(names[1]).toBe("memory_move_item"); // 16 chars
    expect(names[2]).toBe("memory_list_items"); // 17 chars
    expect(names[3]).toBe("memory_list_spaces"); // 18 chars
    expect(names[4]).toBe("memory_create_space"); // 19 chars, alphabetically first of two
    // Verify results are deterministic (running again produces same order)
    const names2 = searchTools(fixture, "memory", 5).map((t) => t.name);
    expect(names).toEqual(names2);
  });

  it("rejects short 3-char noise terms to prevent accidental matches (against real 59 tools)", () => {
    // This test locks in the noise reduction fix from round 2.
    // Short 3-char terms should NOT match dozens of tools via substring.
    // CRITICAL: This test runs against the REAL 59 hidden tools (extracted from src/index.ts),
    // not the 7-tool HIDDEN fixture. The bug was measured at 59-tool scale and the test must
    // catch it there, not pass silently with fewer collisions.
    // The fix guards substring matching with term.length >= 4.
    // If this test passes when the guards are reverted to >= 3, the test is broken.
    //
    // Baseline (before fix, at 59-tool scale):
    // - "tar" (3): 26 matches
    // - "ate" (3): 22 matches
    // - "pro" (3): 18 matches
    // - "del" (3): 12 matches
    const allTools = extractRealTools();
    const { hidden } = splitTools(allTools);
    expect(hidden.length).toBe(59); // Verify we have the real set

    const noiseQueries = [
      { query: "tar", maxMatches: 2 }, // 3-char: should match only via segment if at all
      { query: "ate", maxMatches: 2 }, // 3-char: should match only via segment if at all
      { query: "pro", maxMatches: 2 }, // 3-char: should match only via segment if at all
      { query: "del", maxMatches: 3 }, // 3-char: should match only via segment if at all
    ];
    for (const { query, maxMatches } of noiseQueries) {
      const results = searchTools(hidden, query, 59);
      expect(results.length).toBeLessThanOrEqual(
        maxMatches,
        `"${query}" matched ${results.length} tools (max ${maxMatches}): ${results.map((t) => t.name).join(", ")}`
      );
    }
  });
});

describe("buildGatewayTool", () => {
  it("is named cf_tools and states the hidden count", async () => {
    const { buildGatewayTool } = await import("../src/tool-registry.js");
    const gw = buildGatewayTool(59);
    expect(gw.name).toBe("cf_tools");
    expect(gw.description).toContain("59");
  });

  it("tells the agent that unlisted capabilities live here", async () => {
    // This sentence is the recovery path for already-installed CLAUDE.md files
    // that name a now-hidden tool. Losing it silently breaks those users.
    // Assert both halves: (1) capability may be unlisted, (2) this tool is where to find it.
    const { buildGatewayTool } = await import("../src/tool-registry.js");
    const desc = buildGatewayTool(59).description.toLowerCase();
    expect(desc).toContain("cannot find");
    expect(desc).toContain("search for it here");
  });

  it("exposes exactly query, name and args", async () => {
    const { buildGatewayTool } = await import("../src/tool-registry.js");
    const schema = buildGatewayTool(59).inputSchema as {
      properties: Record<string, unknown>;
    };
    expect(Object.keys(schema.properties).sort()).toEqual(["args", "name", "query"]);
  });
});

describe("visibleTools", () => {
  const all: ToolDef[] = [
    ...CORE_TOOL_NAMES.map((n) => tool(n)),
    tool("memory_git_sync"),
    tool("skills_run"),
  ];

  it("returns core plus the gateway in lean mode", async () => {
    const { visibleTools } = await import("../src/tool-registry.js");
    const visible = visibleTools(all, {});
    expect(visible).toHaveLength(CORE_TOOL_NAMES.length + 1);
    expect(visible.map((t) => t.name)).toContain("cf_tools");
    expect(visible.map((t) => t.name)).not.toContain("memory_git_sync");
  });

  it("returns every tool and no gateway in full mode", async () => {
    const { visibleTools } = await import("../src/tool-registry.js");
    const visible = visibleTools(all, { CONTEXTFORGE_TOOLS: "full" });
    expect(visible).toHaveLength(all.length);
    expect(visible.map((t) => t.name)).not.toContain("cf_tools");
    expect(visible.map((t) => t.name)).toContain("memory_git_sync");
  });

  it("puts the gateway last so core tools are read first", async () => {
    const { visibleTools } = await import("../src/tool-registry.js");
    const visible = visibleTools(all, {});
    expect(visible[visible.length - 1].name).toBe("cf_tools");
  });

  it("keeps the visible core under the hard ceiling", async () => {
    const { MAX_CORE_TOOLS } = await import("../src/tool-registry.js");
    expect(CORE_TOOL_NAMES.length).toBeLessThanOrEqual(MAX_CORE_TOOLS);
  });
});

describe("CfToolsInputSchema", () => {
  it("accepts a search call", async () => {
    const { CfToolsInputSchema } = await import("../src/types.js");
    expect(CfToolsInputSchema.safeParse({ query: "git commits" }).success).toBe(true);
  });

  it("accepts an execute call", async () => {
    const { CfToolsInputSchema } = await import("../src/types.js");
    expect(
      CfToolsInputSchema.safeParse({ name: "memory_git_commits", args: { limit: 5 } }).success,
    ).toBe(true);
  });

  it("accepts an execute call with no args", async () => {
    const { CfToolsInputSchema } = await import("../src/types.js");
    expect(CfToolsInputSchema.safeParse({ name: "memory_stats" }).success).toBe(true);
  });

  it("rejects passing both query and name", async () => {
    const { CfToolsInputSchema } = await import("../src/types.js");
    expect(CfToolsInputSchema.safeParse({ query: "git", name: "memory_git_sync" }).success).toBe(false);
  });

  it("rejects passing neither", async () => {
    const { CfToolsInputSchema } = await import("../src/types.js");
    expect(CfToolsInputSchema.safeParse({}).success).toBe(false);
  });

  it("rejects an empty query", async () => {
    const { CfToolsInputSchema } = await import("../src/types.js");
    expect(CfToolsInputSchema.safeParse({ query: "" }).success).toBe(false);
  });
});
