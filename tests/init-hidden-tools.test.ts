import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { SERVER_INSTRUCTIONS } from "../src/init.js";
import { CORE_TOOL_NAMES, GATEWAY_TOOL_NAME } from "../src/tool-registry.js";

const INIT_SRC = readFileSync(join(__dirname, "..", "src", "init.ts"), "utf8");

const HIDDEN_IN_DOCS = [
  "memory_create_space",
  "memory_current_project",
  "memory_link_project",
  "memory_list_spaces",
  "memory_list_items",
  "session_update",
];

describe("generated CLAUDE.md and server instructions", () => {
  it("names no tool that is hidden in lean mode", () => {
    const named = [
      ...INIT_SRC.matchAll(/(?:mcp__contextforge__)?((?:memory|tasks|skills|routines|session|project|collaborators)_[a-z_]+)/g),
    ].map((m) => m[1]);
    const offenders = [...new Set(named)].filter(
      (n) => !CORE_TOOL_NAMES.includes(n) && n !== GATEWAY_TOOL_NAME,
    );
    expect(offenders).toEqual([]);
  });

  it("names none of the six specific plumbing tools", () => {
    for (const t of HIDDEN_IN_DOCS) expect(INIT_SRC).not.toContain(t);
  });

  it("still instructs proactive recall and save", () => {
    expect(SERVER_INSTRUCTIONS).toContain("memory_query");
    expect(SERVER_INSTRUCTIONS).toContain("memory_ingest");
  });

  it("routes hidden setup-time actions through the cf_tools gateway instead", () => {
    // Every place that used to tell the agent to call one of the six hidden
    // tools directly must now point at the gateway instead of just vanishing
    // silently — the capability (list/create spaces, link project, update
    // session) should still be reachable.
    expect(INIT_SRC).toContain("cf_tools");
    expect(INIT_SRC).toMatch(/cf_tools.*(?:list spaces|create space)/);
    expect(INIT_SRC).toMatch(/cf_tools.*link project/);
    expect(INIT_SRC).toMatch(/cf_tools.*update session/);
  });
});
