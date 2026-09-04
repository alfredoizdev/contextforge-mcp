import { describe, it, expect } from "vitest";
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
  { name: "memory_forget", description: "Mark a knowledge item as no longer applicable", inputSchema: {} },
  { name: "tasks_create", description: "Create a new task or issue", inputSchema: {} },
  { name: "skills_run", description: "Execute a stored skill", inputSchema: {} },
  { name: "memory_export", description: "Export all knowledge items to a file", inputSchema: {} },
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
    const names = searchTools(HIDDEN, "olvidar algo que ya no aplica").map((t) => t.name);
    expect(names).toContain("memory_forget");
  });

  it("finds a tool through an English synonym with no lexical overlap", () => {
    const names = searchTools(HIDDEN, "this memory is outdated").map((t) => t.name);
    expect(names).toContain("memory_forget");
  });

  it("matches words in the description", () => {
    const names = searchTools(HIDDEN, "issue").map((t) => t.name);
    expect(names).toContain("tasks_create");
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
  });

  it("ignores very short noise words", () => {
    const names = searchTools(HIDDEN, "a of the git").map((t) => t.name);
    expect(names).toContain("memory_git_sync");
  });
});
