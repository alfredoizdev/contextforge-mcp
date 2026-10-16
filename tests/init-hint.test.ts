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
  computeHookHint,
  markHookHintShown,
  HOOK_HINT_TEXT,
} from "../src/init-hint.js";
import { STARTUP_MARKER } from "../src/init.js";
import {
  OBJECTIVE_HOOK_VERSION,
  OBJECTIVE_HOOK_SCRIPT,
} from "../src/objective-hook.js";
import { RECALL_COMMAND } from "../src/recall.js";

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

describe("hook hint (0.13.2 — existing users without the objective hook)", () => {
  let tmp: string;
  let cacheFile: string;
  const settingsWithRecall = () =>
    JSON.stringify({
      hooks: {
        SessionStart: [
          {
            matcher: "compact",
            hooks: [{ type: "command", command: RECALL_COMMAND }],
          },
        ],
      },
    });
  const writeSettings = (json: string) => {
    mkdirSync(join(tmp, ".claude"), { recursive: true });
    writeFileSync(join(tmp, ".claude", "settings.json"), json);
  };
  const writeScript = (body: string) => {
    mkdirSync(join(tmp, ".claude", "hooks"), { recursive: true });
    writeFileSync(
      join(tmp, ".claude", "hooks", "contextforge-objective.cjs"),
      body,
    );
  };

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "cf-hookhint-"));
    cacheFile = join(tmp, "cache", "hook-hint.json");
  });
  afterEach(() => rmSync(tmp, { recursive: true, force: true }));

  it("hints when the recall hook is installed but the objective script is missing", () => {
    writeSettings(settingsWithRecall());
    expect(computeHookHint(tmp, cacheFile)).toBe(HOOK_HINT_TEXT);
  });

  it("hints when the objective script is an older version", () => {
    writeSettings(settingsWithRecall());
    writeScript(
      "// contextforge-mcp objective hook v0 — generated by `contextforge-mcp init`.\n",
    );
    expect(computeHookHint(tmp, cacheFile)).toBe(HOOK_HINT_TEXT);
  });

  it("does not hint when the current script is present", () => {
    writeSettings(settingsWithRecall());
    writeScript(OBJECTIVE_HOOK_SCRIPT);
    expect(computeHookHint(tmp, cacheFile)).toBeNull();
  });

  it("does not hint without a settings file, without a recall hook, or with unparseable/odd settings", () => {
    expect(computeHookHint(tmp, cacheFile)).toBeNull();
    writeSettings(JSON.stringify({ hooks: { PreToolUse: [] } }));
    expect(computeHookHint(tmp, cacheFile)).toBeNull();
    writeSettings("{not json");
    expect(computeHookHint(tmp, cacheFile)).toBeNull();
    writeSettings(JSON.stringify({ hooks: { SessionStart: "nope" } }));
    expect(computeHookHint(tmp, cacheFile)).toBeNull();
  });

  it("shows once per project, and again after a hook version bump", () => {
    writeSettings(settingsWithRecall());
    markHookHintShown(tmp, cacheFile);
    expect(computeHookHint(tmp, cacheFile)).toBeNull();
    // simulate a cache written under the previous script version
    writeFileSync(
      cacheFile,
      JSON.stringify({ version: OBJECTIVE_HOOK_VERSION - 1, shownFor: [tmp] }),
    );
    expect(computeHookHint(tmp, cacheFile)).toBe(HOOK_HINT_TEXT);
  });

  it("is disabled by CONTEXTFORGE_DISABLE_INIT_HINT=1", () => {
    writeSettings(settingsWithRecall());
    const prev = process.env.CONTEXTFORGE_DISABLE_INIT_HINT;
    process.env.CONTEXTFORGE_DISABLE_INIT_HINT = "1";
    try {
      expect(computeHookHint(tmp, cacheFile)).toBeNull();
    } finally {
      if (prev === undefined) delete process.env.CONTEXTFORGE_DISABLE_INIT_HINT;
      else process.env.CONTEXTFORGE_DISABLE_INIT_HINT = prev;
    }
  });
});
