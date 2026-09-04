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

/**
 * Round 2: the same bug (instructions naming a tool the agent can no longer
 * see) also lived in runtime hint strings and agent-facing message templates
 * inside src/index.ts's tool-call dispatch — not just in the generated
 * CLAUDE.md text above. This sweep guards against that whole class of bug
 * coming back for ANY of the 59 hidden tools, not just the original six.
 *
 * src/index.ts calls main() at import time, so — same rule as the rest of
 * this file — it is read as text, never imported.
 */
describe("src/index.ts runtime hints never name a hidden tool as a bare instruction", () => {
  const INDEX_SRC = readFileSync(join(__dirname, "..", "src", "index.ts"), "utf8");

  // The canonical list of all 69 tool names, read off their own `name: "..."`
  // declarations rather than hardcoded, so this test stays correct if a tool
  // is ever added, renamed, or removed.
  const ALL_TOOL_NAMES = [
    ...new Set(
      [...INDEX_SRC.matchAll(/^\s{4}name: "([a-z_]+)",$/gm)].map((m) => m[1]),
    ),
  ];
  const HIDDEN_TOOL_NAMES = ALL_TOOL_NAMES.filter(
    (n) => !CORE_TOOL_NAMES.includes(n) && n !== GATEWAY_TOOL_NAME,
  );

  it("sanity: sees all 69 tool names and the expected 59 are hidden", () => {
    expect(ALL_TOOL_NAMES.length).toBe(69);
    expect(HIDDEN_TOOL_NAMES.length).toBe(59);
  });

  /**
   * Strips two zones out of index.ts before sweeping for tool names, and
   * documents exactly why each is excluded:
   *
   *  - `logTool()`'s emoji map: pure log decoration keyed by tool name. The
   *    agent never sees these keys — they're for the human tailing the log
   *    file — so a hidden name appearing there is not an instruction.
   *  - The `TOOLS` array: each tool's own `description`/`inputSchema` text
   *    is a "self-description". A core tool's description is always visible,
   *    and a hidden tool's description is only ever read AFTER the agent
   *    already found that tool through `cf_tools` — so a hidden name inside
   *    a description (even one hidden tool's description naming another) is
   *    not the same bug as a runtime hint pointing at a name the agent has
   *    never seen and has no other way to discover.
   *
   * What's left after stripping is the tool-call switch/dispatch body: the
   * `hint:`/`message:`/`text:` strings actually returned to the agent.
   */
  function sweepableSrc(src: string): string {
    const logToolStart = src.indexOf("function logTool(");
    const logToolEnd = src.indexOf("function logSuccess(", logToolStart);
    const toolsStart = src.indexOf("const TOOLS = [");
    const closingMarker = "\n];\n";
    const closingIdx = src.indexOf(closingMarker, toolsStart);
    if (
      logToolStart === -1 ||
      logToolEnd === -1 ||
      toolsStart === -1 ||
      closingIdx === -1
    ) {
      throw new Error(
        "sweepableSrc: expected structural markers not found in src/index.ts — " +
          "the file was restructured; update this test's markers before trusting it.",
      );
    }
    const toolsEnd = closingIdx + closingMarker.length;
    return (
      src.slice(0, logToolStart) +
      src.slice(logToolEnd, toolsStart) +
      src.slice(toolsEnd)
    );
  }

  /**
   * Returns every hidden tool name that appears, in the swept source, on a
   * line that does NOT also mention `cf_tools`. A bare mention is the bug:
   * text telling the agent to directly call a tool it cannot see. A mention
   * paired with `cf_tools` on the same line is fine either way it's used —
   * a plain-language `query:"..."` reroute, or (in one deliberate case) the
   * `cf_tools` execution convention `name:"<hidden tool>"` — because the
   * agent is being told to go THROUGH the gateway, not to call the name
   * directly.
   *
   * Dispatch `case "tool_name": {` lines are excluded — they are routing,
   * never text shown to the agent.
   */
  function bareHiddenToolMentions(src: string, hiddenNames: string[]): string[] {
    const lines = sweepableSrc(src)
      .split("\n")
      .filter((l) => !/^\s*case "[a-z_]+":\s*\{?\s*$/.test(l.trim()));
    const offenders: string[] = [];
    for (const line of lines) {
      if (line.includes("cf_tools")) continue;
      for (const name of hiddenNames) {
        if (new RegExp(`\\b${name}\\b`).test(line)) {
          offenders.push(`${name} :: ${line.trim()}`);
        }
      }
    }
    return offenders;
  }

  it("names no hidden tool as a bare, un-routed instruction anywhere in the dispatch body", () => {
    const offenders = bareHiddenToolMentions(INDEX_SRC, HIDDEN_TOOL_NAMES);
    expect(offenders).toEqual([]);
  });
});
