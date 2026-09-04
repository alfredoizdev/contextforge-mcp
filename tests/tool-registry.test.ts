import { describe, it, expect } from "vitest";
import {
  CORE_TOOL_NAMES,
  GATEWAY_TOOL_NAME,
  categoryOf,
  isLeanMode,
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
