import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { SERVER_INSTRUCTIONS } from "../src/init.js";

/**
 * The MCP `initialize` response carries a server-level `instructions` string.
 * Clients that honor it inject it into the model's context on connect, so
 * ContextForge memory auto-loads with no per-tool config. These tests guard
 * two things: the instruction text stays useful, and index.ts keeps it wired
 * into `new Server(...)` (index.ts is excluded from coverage, so we assert the
 * wiring at the source level — matching how the runtime handshake was verified).
 */
describe("SERVER_INSTRUCTIONS content", () => {
  it("is a non-trivial, self-describing instruction block", () => {
    expect(SERVER_INSTRUCTIONS.length).toBeGreaterThan(200);
    expect(SERVER_INSTRUCTIONS).toContain("ContextForge");
  });

  it("directs the model to load memory proactively at session start", () => {
    expect(SERVER_INSTRUCTIONS).toMatch(/start of a conversation/i);
    // must not claim empty memory before actually querying
    expect(SERVER_INSTRUCTIONS).toMatch(/without calling it first/i);
  });

  it("references the memory tools by their client-agnostic base names", () => {
    expect(SERVER_INSTRUCTIONS).toContain("memory_query");
    expect(SERVER_INSTRUCTIONS).toContain("tasks_what_next");
    expect(SERVER_INSTRUCTIONS).toContain("memory_ingest");
  });

  it("steers proactive saving over local/file-based memory", () => {
    // save proactively, not only on an explicit "remember"
    expect(SERVER_INSTRUCTIONS).toMatch(/proactively/i);
    // ContextForge wins over any built-in / file-based memory for writes
    expect(SERVER_INSTRUCTIONS).toMatch(/source of truth/i);
    expect(SERVER_INSTRUCTIONS).toMatch(/not to local files/i);
  });

  it("steers topic-based organization into spaces", () => {
    // route to an existing space, create only for a new major area — via the
    // cf_tools gateway, since memory_list_spaces/memory_create_space are
    // hidden tools the agent cannot call by name directly (progressive tool
    // disclosure; see src/tool-registry.ts CORE_TOOL_NAMES).
    expect(SERVER_INSTRUCTIONS).toContain("cf_tools");
    expect(SERVER_INSTRUCTIONS).toMatch(/best-matching space/i);
    expect(SERVER_INSTRUCTIONS).toMatch(/new MAJOR area/i);
  });

  it("does not leak the Claude-Code-specific tool prefix", () => {
    expect(SERVER_INSTRUCTIONS).not.toContain("mcp__contextforge__");
  });
});

describe("MCP server wiring", () => {
  const indexSrc = readFileSync(
    join(__dirname, "..", "src", "index.ts"),
    "utf8",
  );

  it("imports SERVER_INSTRUCTIONS from init", () => {
    expect(indexSrc).toMatch(
      /import\s*\{[^}]*\bSERVER_INSTRUCTIONS\b[^}]*\}\s*from\s*["']\.\/init\.js["']/,
    );
  });

  it("passes instructions into the Server options", () => {
    expect(indexSrc).toContain("instructions: SERVER_INSTRUCTIONS");
  });

  it("handles a --version / -v flag that prints the version and exits", () => {
    expect(indexSrc).toMatch(/["']--version["']/);
    expect(indexSrc).toMatch(/["']-v["']/);
    expect(indexSrc).toMatch(/console\.log\(`contextforge-mcp \$\{VERSION\}`\)/);
  });
});
