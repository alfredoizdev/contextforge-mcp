import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  mkdirSync,
} from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";
import {
  computeInitHint,
  markInitHintShown,
  checkInitHint,
  consumeInitHint,
  INIT_HINT_TEXT,
  HINT_VERSION,
} from "../src/init-hint.js";
import { STARTUP_MARKER } from "../src/init.js";

function cacheFileEnsuringDir(p: string): string {
  mkdirSync(dirname(p), { recursive: true });
  return p;
}

describe("init hint", () => {
  let tmp: string;
  let cacheFile: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "cf-hint-test-"));
    cacheFile = join(tmp, "cache", "init-hint.json");
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("hints when CLAUDE.md lacks the presence marker", () => {
    writeFileSync(join(tmp, "CLAUDE.md"), "# project\n");
    expect(computeInitHint(tmp, cacheFile)).toBe(INIT_HINT_TEXT);
  });

  it("hints when CLAUDE.md does not exist at all", () => {
    expect(computeInitHint(tmp, cacheFile)).toBe(INIT_HINT_TEXT);
  });

  it("does not hint when the startup marker is present", () => {
    writeFileSync(join(tmp, "CLAUDE.md"), STARTUP_MARKER + "\nrules\n");
    expect(computeInitHint(tmp, cacheFile)).toBeNull();
  });

  it("does not hint again after markInitHintShown for the same project", () => {
    markInitHintShown(tmp, cacheFile);
    expect(computeInitHint(tmp, cacheFile)).toBeNull();
  });

  it("still hints for a different project path", () => {
    markInitHintShown("/some/other/project", cacheFile);
    writeFileSync(join(tmp, "CLAUDE.md"), "# project\n");
    expect(computeInitHint(tmp, cacheFile)).toBe(INIT_HINT_TEXT);
  });

  it("treats a corrupt cache file as empty (still hints, no crash)", () => {
    writeFileSync(join(tmp, "CLAUDE.md"), "# project\n");
    rmSync(join(tmp, "cache"), { recursive: true, force: true });
    // create the cache dir with a corrupt file
    markInitHintShown("/tmp/prime-the-dir", cacheFile); // creates dir
    writeFileSync(cacheFile, "not json{{{");
    expect(computeInitHint(tmp, cacheFile)).toBe(INIT_HINT_TEXT);
  });

  it("checkInitHint + consumeInitHint returns the hint exactly once and marks the cache", () => {
    writeFileSync(join(tmp, "CLAUDE.md"), "# project\n");
    checkInitHint(tmp, cacheFile);
    expect(consumeInitHint(cacheFile)).toBe(INIT_HINT_TEXT);
    expect(consumeInitHint(cacheFile)).toBe("");
    const cache = JSON.parse(readFileSync(cacheFile, "utf-8"));
    expect(cache.shownFor).toContain(tmp);
  });

  it("consumeInitHint returns empty string when startup marker present", () => {
    writeFileSync(join(tmp, "CLAUDE.md"), STARTUP_MARKER + "\n");
    checkInitHint(tmp, cacheFile);
    expect(consumeInitHint(cacheFile)).toBe("");
  });

  it("does not hint when CONTEXTFORGE_DISABLE_INIT_HINT=1 (desktop bundle)", () => {
    writeFileSync(join(tmp, "CLAUDE.md"), "# project\n");
    process.env.CONTEXTFORGE_DISABLE_INIT_HINT = "1";
    try {
      expect(computeInitHint(tmp, cacheFile)).toBeNull();
    } finally {
      delete process.env.CONTEXTFORGE_DISABLE_INIT_HINT;
    }
  });

  it("re-nudges when the cache is from an older hint version", () => {
    // Existing user: already dismissed the hint under an older version.
    writeFileSync(join(tmp, "CLAUDE.md"), "# project\n");
    writeFileSync(
      cacheFileEnsuringDir(cacheFile),
      JSON.stringify({ version: 1, shownFor: [tmp] }),
    );
    expect(computeInitHint(tmp, cacheFile)).toBe(INIT_HINT_TEXT);
  });

  it("re-nudge fires only once: after shown, the current-version cache silences it", () => {
    writeFileSync(join(tmp, "CLAUDE.md"), "# project\n");
    markInitHintShown(tmp, cacheFile); // writes version = HINT_VERSION
    expect(computeInitHint(tmp, cacheFile)).toBeNull();
    const cache = JSON.parse(readFileSync(cacheFile, "utf-8"));
    expect(cache.version).toBe(HINT_VERSION);
  });
});
