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
