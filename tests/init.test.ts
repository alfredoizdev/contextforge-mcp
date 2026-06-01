import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { runInit, INIT_MARKER, CLAUDE_TEMPLATE, detectEditors } from "../src/init.js";

describe("runInit", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "cf-init-test-"));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("creates a new CLAUDE.md when none exists", () => {
    const results = runInit(tmp, { editor: "claude" });
    expect(results).toHaveLength(1);
    expect(results[0].action).toBe("created");
    expect(results[0].editor).toBe("claude");
    expect(results[0].path).toBe(join(tmp, "CLAUDE.md"));
    expect(existsSync(results[0].path)).toBe(true);
    const written = readFileSync(results[0].path, "utf-8");
    expect(written).toContain(INIT_MARKER);
    expect(written).toContain("ContextForge MCP — Memory Rules");
  });

  it("appends to existing CLAUDE.md without our section", () => {
    const claudeMdPath = join(tmp, "CLAUDE.md");
    const userContent = "# My Project\n\nSome user notes here.\n";
    writeFileSync(claudeMdPath, userContent);

    const results = runInit(tmp);
    expect(results).toHaveLength(1);
    expect(results[0].action).toBe("appended");
    expect(results[0].editor).toBe("claude");

    const written = readFileSync(claudeMdPath, "utf-8");
    expect(written).toContain("Some user notes here.");
    expect(written).toContain(INIT_MARKER);
    expect(written.indexOf("Some user notes here.")).toBeLessThan(
      written.indexOf(INIT_MARKER),
    );
  });

  it("is idempotent when CLAUDE.md already has our section", () => {
    const claudeMdPath = join(tmp, "CLAUDE.md");
    writeFileSync(claudeMdPath, CLAUDE_TEMPLATE);

    const results = runInit(tmp);
    expect(results).toHaveLength(1);
    expect(results[0].action).toBe("already-present");

    const written = readFileSync(claudeMdPath, "utf-8");
    const markerCount = written.split(INIT_MARKER).length - 1;
    expect(markerCount).toBe(1);
  });

  it("does not duplicate when called twice in a row", () => {
    runInit(tmp, { editor: "claude" });
    const second = runInit(tmp, { editor: "claude" });
    expect(second).toHaveLength(1);
    expect(second[0].action).toBe("already-present");

    const written = readFileSync(join(tmp, "CLAUDE.md"), "utf-8");
    const markerCount = written.split(INIT_MARKER).length - 1;
    expect(markerCount).toBe(1);
  });

  it("normalizes trailing newline when appending", () => {
    const claudeMdPath = join(tmp, "CLAUDE.md");
    writeFileSync(claudeMdPath, "# No trailing newline");

    runInit(tmp);

    const written = readFileSync(claudeMdPath, "utf-8");
    expect(written.startsWith("# No trailing newline\n")).toBe(true);
    expect(written).toContain(INIT_MARKER);
  });

  it("creates .cursorrules with editor=cursor", () => {
    const results = runInit(tmp, { editor: "cursor" });
    expect(results).toHaveLength(1);
    expect(results[0].editor).toBe("cursor");
    expect(results[0].action).toBe("created");
    expect(results[0].path).toBe(join(tmp, ".cursorrules"));
    const written = readFileSync(results[0].path, "utf-8");
    expect(written).toContain(INIT_MARKER);
    expect(written).toContain("ContextForge MCP — Memory Rules");
  });

  it("appends to existing .cursorrules without marker", () => {
    const cursorRulesPath = join(tmp, ".cursorrules");
    writeFileSync(cursorRulesPath, "# my custom rule\n");

    const results = runInit(tmp);
    expect(results).toHaveLength(1);
    expect(results[0].editor).toBe("cursor");
    expect(results[0].action).toBe("appended");

    const written = readFileSync(cursorRulesPath, "utf-8");
    expect(written).toContain("# my custom rule");
    expect(written).toContain(INIT_MARKER);
    expect(written.indexOf("# my custom rule")).toBeLessThan(
      written.indexOf(INIT_MARKER),
    );
  });

  it("is idempotent on .cursorrules when marker present", () => {
    const cursorRulesPath = join(tmp, ".cursorrules");
    writeFileSync(cursorRulesPath, "# header\n\n" + INIT_MARKER + "\nbody\n");

    const results = runInit(tmp);
    expect(results).toHaveLength(1);
    expect(results[0].action).toBe("already-present");
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
    const editors = results.map((r) => r.editor).sort();
    expect(editors).toEqual(["claude", "cursor"]);
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
