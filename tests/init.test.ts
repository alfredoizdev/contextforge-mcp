import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
  mkdirSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  runInit,
  INIT_MARKER,
  PRESENCE_MARKER,
  STARTUP_MARKER,
  CLAUDE_MEMORY_SECTION,
  CLAUDE_PRESENCE_SECTION,
  CLAUDE_STARTUP_SECTION,
  detectEditors,
} from "../src/init.js";

/** Map a result's sections to { id: action } for terse assertions. */
function actions(result: { sections: { id: string; action: string }[] }) {
  return Object.fromEntries(result.sections.map((s) => [s.id, s.action]));
}

describe("runInit", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "cf-init-test-"));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("creates a new CLAUDE.md with all sections", () => {
    const results = runInit(tmp, { editor: "claude" });
    expect(results).toHaveLength(1);
    expect(results[0].fileCreated).toBe(true);
    expect(results[0].editor).toBe("claude");
    expect(results[0].path).toBe(join(tmp, "CLAUDE.md"));
    expect(actions(results[0])).toEqual({
      memory: "created",
      presence: "created",
      startup: "created",
    });

    const written = readFileSync(results[0].path, "utf-8");
    expect(written).toContain(INIT_MARKER);
    expect(written).toContain(PRESENCE_MARKER);
    expect(written).toContain(STARTUP_MARKER);
    expect(written).toContain("ContextForge MCP — Memory Rules");
    expect(written).toContain("Session Presence — Coordination Rules");
    expect(written).toContain("ContextForge MCP — Startup Context Rule");
    expect(written.indexOf(INIT_MARKER)).toBeLessThan(
      written.indexOf(PRESENCE_MARKER),
    );
    expect(written.indexOf(PRESENCE_MARKER)).toBeLessThan(
      written.indexOf(STARTUP_MARKER),
    );
  });

  it("appends both sections to an existing CLAUDE.md without our markers", () => {
    const claudeMdPath = join(tmp, "CLAUDE.md");
    const userContent = "# My Project\n\nSome user notes here.\n";
    writeFileSync(claudeMdPath, userContent);

    const results = runInit(tmp);
    expect(results).toHaveLength(1);
    expect(results[0].fileCreated).toBe(false);
    expect(actions(results[0])).toEqual({
      memory: "appended",
      presence: "appended",
      startup: "appended",
    });

    const written = readFileSync(claudeMdPath, "utf-8");
    expect(written).toContain("Some user notes here.");
    expect(written.indexOf("Some user notes here.")).toBeLessThan(
      written.indexOf(INIT_MARKER),
    );
    expect(written.indexOf(INIT_MARKER)).toBeLessThan(
      written.indexOf(PRESENCE_MARKER),
    );
  });

  it("UPGRADE: a memory+presence CLAUDE.md receives only startup, preserving everything", () => {
    const claudeMdPath = join(tmp, "CLAUDE.md");
    const preUpgrade =
      "# My project\n\n" +
      CLAUDE_MEMORY_SECTION +
      "\n" +
      CLAUDE_PRESENCE_SECTION +
      "\n## My own rules\nkeep me exactly\n";
    writeFileSync(claudeMdPath, preUpgrade);

    const results = runInit(tmp, { editor: "claude" });
    expect(actions(results[0])).toEqual({
      memory: "already-present",
      presence: "already-present",
      startup: "appended",
    });

    const written = readFileSync(claudeMdPath, "utf-8");
    expect(written.startsWith(preUpgrade)).toBe(true);
    expect(written).toContain("keep me exactly");
    expect(written.split(STARTUP_MARKER).length - 1).toBe(1);
    expect(written.split(PRESENCE_MARKER).length - 1).toBe(1);
  });

  it("is fully idempotent when both markers are present", () => {
    runInit(tmp, { editor: "claude" });
    const before = readFileSync(join(tmp, "CLAUDE.md"), "utf-8");

    const second = runInit(tmp, { editor: "claude" });
    expect(second[0].fileCreated).toBe(false);
    expect(actions(second[0])).toEqual({
      memory: "already-present",
      presence: "already-present",
      startup: "already-present",
    });
    expect(readFileSync(join(tmp, "CLAUDE.md"), "utf-8")).toBe(before);
  });

  it("handles a file that somehow has ONLY the presence section (memory gets appended)", () => {
    const claudeMdPath = join(tmp, "CLAUDE.md");
    writeFileSync(claudeMdPath, CLAUDE_PRESENCE_SECTION);

    const results = runInit(tmp, { editor: "claude" });
    expect(actions(results[0])).toEqual({
      memory: "appended",
      presence: "already-present",
      startup: "appended",
    });
  });

  it("normalizes trailing newline when appending", () => {
    const claudeMdPath = join(tmp, "CLAUDE.md");
    writeFileSync(claudeMdPath, "# No trailing newline");

    runInit(tmp);

    const written = readFileSync(claudeMdPath, "utf-8");
    expect(written.startsWith("# No trailing newline\n")).toBe(true);
    expect(written).toContain(INIT_MARKER);
    expect(written).toContain(PRESENCE_MARKER);
  });

  it("creates .cursorrules with both sections when editor=cursor", () => {
    const results = runInit(tmp, { editor: "cursor" });
    expect(results).toHaveLength(1);
    expect(results[0].editor).toBe("cursor");
    expect(results[0].fileCreated).toBe(true);
    expect(results[0].path).toBe(join(tmp, ".cursorrules"));

    const written = readFileSync(results[0].path, "utf-8");
    expect(written).toContain(INIT_MARKER);
    expect(written).toContain(PRESENCE_MARKER);
    expect(written).toContain(STARTUP_MARKER);
    expect(written).toContain("Session Presence — Coordination Rules");
  });

  it("UPGRADE: .cursorrules with only the old marker receives only presence", () => {
    const cursorRulesPath = join(tmp, ".cursorrules");
    writeFileSync(cursorRulesPath, "# header\n\n" + INIT_MARKER + "\nbody\n");

    const results = runInit(tmp);
    expect(results[0].editor).toBe("cursor");
    expect(actions(results[0])).toEqual({
      memory: "already-present",
      presence: "appended",
      startup: "appended",
    });

    const written = readFileSync(cursorRulesPath, "utf-8");
    expect(written).toContain("# header");
    expect(written).toContain("body");
  });

  it("writes both files when both editors detected", () => {
    writeFileSync(join(tmp, "CLAUDE.md"), "");
    writeFileSync(join(tmp, ".cursorrules"), "");

    const results = runInit(tmp);
    expect(results).toHaveLength(2);
    const editors = results.map((r) => r.editor).sort();
    expect(editors).toEqual(["claude", "cursor"]);
  });

  it("writes both files when neither editor detected (zero-friction fallback)", () => {
    const results = runInit(tmp);
    expect(results).toHaveLength(2);
    expect(existsSync(join(tmp, "CLAUDE.md"))).toBe(true);
    expect(existsSync(join(tmp, ".cursorrules"))).toBe(true);
  });

  it("editor=all writes both regardless of detection", () => {
    writeFileSync(join(tmp, "CLAUDE.md"), "");
    const results = runInit(tmp, { editor: "all" });
    expect(results).toHaveLength(2);
  });

  it("editor=cursor overrides detection (CLAUDE.md present)", () => {
    writeFileSync(join(tmp, "CLAUDE.md"), "");
    const results = runInit(tmp, { editor: "cursor" });
    expect(results).toHaveLength(1);
    expect(results[0].editor).toBe("cursor");
    expect(existsSync(join(tmp, ".cursorrules"))).toBe(true);
  });
});

describe("Startup sections", () => {
  it("startup rule instructs a freshness check", () => {
    expect(CLAUDE_STARTUP_SECTION).toContain("memory_check_freshness");
  });
});

describe("detectEditors", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "cf-detect-test-"));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("detects claude when CLAUDE.md exists", () => {
    writeFileSync(join(tmp, "CLAUDE.md"), "# anything");
    expect(detectEditors(tmp)).toEqual(["claude"]);
  });

  it("detects claude when .claude/ directory exists", () => {
    mkdirSync(join(tmp, ".claude"));
    expect(detectEditors(tmp)).toEqual(["claude"]);
  });

  it("detects cursor when .cursorrules exists", () => {
    writeFileSync(join(tmp, ".cursorrules"), "");
    expect(detectEditors(tmp)).toEqual(["cursor"]);
  });

  it("detects cursor when .cursor/ directory exists", () => {
    mkdirSync(join(tmp, ".cursor"));
    expect(detectEditors(tmp)).toEqual(["cursor"]);
  });

  it("detects both editors when both signals present", () => {
    writeFileSync(join(tmp, "CLAUDE.md"), "");
    writeFileSync(join(tmp, ".cursorrules"), "");
    const result = detectEditors(tmp);
    expect(result).toContain("claude");
    expect(result).toContain("cursor");
    expect(result.length).toBe(2);
  });

  it("returns empty array when neither editor is detected", () => {
    expect(detectEditors(tmp)).toEqual([]);
  });
});
