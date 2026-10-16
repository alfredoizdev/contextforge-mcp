import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  mkdirSync,
  existsSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { installClaudeRecallHook, runInit } from "../src/init.js";
import { RECALL_COMMAND } from "../src/recall.js";

describe("installClaudeRecallHook", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "cf-hooks-"));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  const settingsPath = () => join(tmp, ".claude", "settings.json");

  it("creates .claude/settings.json with the SessionStart compact hook", () => {
    const res = installClaudeRecallHook(tmp);
    expect(res.action).toBe("created");
    expect(res.path).toBe(settingsPath());
    const json = JSON.parse(readFileSync(settingsPath(), "utf-8"));
    expect(json.hooks.SessionStart).toEqual([
      {
        matcher: "compact",
        hooks: [{ type: "command", command: RECALL_COMMAND }],
      },
    ]);
  });

  it("appends to an existing settings.json without touching other keys or hooks", () => {
    mkdirSync(join(tmp, ".claude"));
    writeFileSync(
      settingsPath(),
      JSON.stringify(
        {
          permissions: { allow: ["Bash(npm test)"] },
          hooks: {
            PostToolUse: [
              {
                matcher: "Edit",
                hooks: [{ type: "command", command: "echo hi" }],
              },
            ],
            SessionStart: [
              {
                matcher: "startup",
                hooks: [{ type: "command", command: "echo start" }],
              },
            ],
          },
        },
        null,
        2,
      ),
    );
    const res = installClaudeRecallHook(tmp);
    expect(res.action).toBe("appended");
    const json = JSON.parse(readFileSync(settingsPath(), "utf-8"));
    expect(json.permissions.allow).toEqual(["Bash(npm test)"]);
    expect(json.hooks.PostToolUse).toHaveLength(1);
    expect(json.hooks.SessionStart).toHaveLength(2);
    expect(json.hooks.SessionStart[1]).toEqual({
      matcher: "compact",
      hooks: [{ type: "command", command: RECALL_COMMAND }],
    });
  });

  it("is idempotent: a second run reports already-present and changes nothing", () => {
    installClaudeRecallHook(tmp);
    const before = readFileSync(settingsPath(), "utf-8");
    const res = installClaudeRecallHook(tmp);
    expect(res.action).toBe("already-present");
    expect(readFileSync(settingsPath(), "utf-8")).toBe(before);
  });

  it("detects the command even inside a matcher group that has other hooks", () => {
    mkdirSync(join(tmp, ".claude"));
    writeFileSync(
      settingsPath(),
      JSON.stringify({
        hooks: {
          SessionStart: [
            {
              matcher: "compact",
              hooks: [
                { type: "command", command: "echo x" },
                { type: "command", command: RECALL_COMMAND },
              ],
            },
          ],
        },
      }),
    );
    expect(installClaudeRecallHook(tmp).action).toBe("already-present");
  });

  it("leaves a malformed settings.json alone and reports already-present with a warning path", () => {
    mkdirSync(join(tmp, ".claude"));
    writeFileSync(settingsPath(), "{ broken");
    const res = installClaudeRecallHook(tmp);
    expect(res.action).toBe("already-present");
    expect(readFileSync(settingsPath(), "utf-8")).toBe("{ broken");
  });
});

describe("runInit wires the hook for the claude editor only", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "cf-init-hooks-"));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("claude: installs the hook and reports it on the result", () => {
    const [res] = runInit(tmp, { editor: "claude" });
    expect(res.hook?.action).toBe("created");
    expect(existsSync(join(tmp, ".claude", "settings.json"))).toBe(true);
  });

  it("cursor: does not create .claude/settings.json", () => {
    const [res] = runInit(tmp, { editor: "cursor" });
    expect(res.hook).toBeUndefined();
    expect(existsSync(join(tmp, ".claude", "settings.json"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 0.13.0: objective hook (UserPromptSubmit) installed next to the recall hook
// ---------------------------------------------------------------------------
import { installClaudeHooks, installClaudeObjectiveHook } from "../src/init.js";
import { OBJECTIVE_HOOK_COMMAND, OBJECTIVE_HOOK_SCRIPT } from "../src/objective-hook.js";

describe("installClaudeHooks (recall + objective)", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "cf-hooks2-"));
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });
  const settingsPath = () => join(tmp, ".claude", "settings.json");
  const scriptPath = () => join(tmp, ".claude", "hooks", "contextforge-objective.cjs");

  it("creates settings.json with both hook groups and writes the script", () => {
    const res = installClaudeHooks(tmp);
    expect(res.recall.action).toBe("created");
    // recall created settings.json a moment earlier, so the objective group is appended to it
    expect(res.objective.action).toBe("appended");
    expect(res.objective.scriptAction).toBe("created");
    expect(res.objective.scriptPath).toBe(scriptPath());
    expect(readFileSync(scriptPath(), "utf-8")).toBe(OBJECTIVE_HOOK_SCRIPT);
    const json = JSON.parse(readFileSync(settingsPath(), "utf-8"));
    expect(json.hooks.SessionStart).toEqual([
      { matcher: "compact", hooks: [{ type: "command", command: RECALL_COMMAND }] },
    ]);
    expect(json.hooks.UserPromptSubmit).toEqual([
      { hooks: [{ type: "command", command: OBJECTIVE_HOOK_COMMAND, timeout: 5 }] },
    ]);
  });

  it("is idempotent: second run reports already-present and changes nothing", () => {
    installClaudeHooks(tmp);
    const before = readFileSync(settingsPath(), "utf-8");
    const res = installClaudeHooks(tmp);
    expect(res.recall.action).toBe("already-present");
    expect(res.objective.action).toBe("already-present");
    expect(res.objective.scriptAction).toBe("already-present");
    expect(readFileSync(settingsPath(), "utf-8")).toBe(before);
  });

  it("upgrades from 0.12.0: recall hook present, objective missing → only the objective group is appended", () => {
    mkdirSync(join(tmp, ".claude"));
    writeFileSync(settingsPath(), JSON.stringify({
      permissions: { allow: ["Bash(ls)"] },
      hooks: {
        SessionStart: [{ matcher: "compact", hooks: [{ type: "command", command: RECALL_COMMAND }] }],
        PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo hi" }] }],
      },
    }, null, 2));
    const res = installClaudeHooks(tmp);
    expect(res.recall.action).toBe("already-present");
    expect(res.objective.action).toBe("appended");
    const json = JSON.parse(readFileSync(settingsPath(), "utf-8"));
    expect(json.permissions).toEqual({ allow: ["Bash(ls)"] });
    expect(json.hooks.PreToolUse).toEqual([{ matcher: "Bash", hooks: [{ type: "command", command: "echo hi" }] }]);
    expect(json.hooks.SessionStart).toHaveLength(1);
    expect(json.hooks.UserPromptSubmit).toHaveLength(1);
  });

  it("rewrites an outdated script (reports updated) but leaves an identical one alone", () => {
    mkdirSync(join(tmp, ".claude", "hooks"), { recursive: true });
    writeFileSync(scriptPath(), "// old version\n");
    const res = installClaudeObjectiveHook(tmp);
    expect(res.scriptAction).toBe("updated");
    expect(readFileSync(scriptPath(), "utf-8")).toBe(OBJECTIVE_HOOK_SCRIPT);
    expect(installClaudeObjectiveHook(tmp).scriptAction).toBe("already-present");
  });

  it("0.13.2: replaces a v1 objective hook script with the current version (action 'updated')", () => {
    mkdirSync(join(tmp, ".claude", "hooks"), { recursive: true });
    writeFileSync(scriptPath(), "// contextforge-mcp objective hook v1 — generated by `contextforge-mcp init`.\n");
    const res = installClaudeHooks(tmp);
    expect(res.objective.scriptAction).toBe("updated");
    expect(readFileSync(scriptPath(), "utf-8")).toBe(OBJECTIVE_HOOK_SCRIPT);
    expect(readFileSync(scriptPath(), "utf-8").startsWith("// contextforge-mcp objective hook v2")).toBe(true);
    // idempotent on the second run
    expect(installClaudeHooks(tmp).objective.scriptAction).toBe("already-present");
  });

  it("leaves an unparseable settings.json untouched but still writes the script", () => {
    mkdirSync(join(tmp, ".claude"));
    writeFileSync(settingsPath(), "{ not json");
    const res = installClaudeHooks(tmp);
    expect(res.objective.action).toBe("already-present");
    expect(readFileSync(settingsPath(), "utf-8")).toBe("{ not json");
    expect(existsSync(scriptPath())).toBe(true);
  });

  it("runInit for claude returns both hook results", () => {
    const [res] = runInit(tmp, { editor: "claude" });
    expect(res.hook?.action).toBe("created");
    expect(res.objectiveHook?.action).toBe("appended");
    expect(res.objectiveHook?.scriptAction).toBe("created");
  });
});
