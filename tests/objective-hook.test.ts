import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  OBJECTIVE_HOOK_SCRIPT,
  OBJECTIVE_HOOK_COMMAND,
  OBJECTIVE_HOOK_RELATIVE_PATH,
  sessionsDir,
} from "../src/objective-hook.js";

/** Run the generated hook script exactly as Claude Code would: node + JSON on stdin. */
function runHook(scriptPath: string, home: string, stdin: string | null) {
  return spawnSync(process.execPath, [scriptPath], {
    input: stdin ?? undefined,
    env: { ...process.env, CONTEXTFORGE_HOME: home },
    encoding: "utf-8",
    timeout: 10_000,
  });
}

describe("objective hook script", () => {
  let tmp: string;
  let home: string;
  let script: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "cf-objhook-"));
    home = mkdtempSync(join(tmpdir(), "cf-objhome-"));
    script = join(tmp, "contextforge-objective.cjs");
    writeFileSync(script, OBJECTIVE_HOOK_SCRIPT);
  });
  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  });

  const sessionFile = (sid: string) => join(sessionsDir(home), `${sid}.jsonl`);

  it("exports stable constants that match the README contract", () => {
    expect(OBJECTIVE_HOOK_RELATIVE_PATH).toBe(".claude/hooks/contextforge-objective.cjs");
    expect(OBJECTIVE_HOOK_COMMAND).toBe('node "$CLAUDE_PROJECT_DIR/.claude/hooks/contextforge-objective.cjs"');
    expect(OBJECTIVE_HOOK_SCRIPT.startsWith("// contextforge-mcp objective hook v1")).toBe(true);
    expect(sessionsDir("/h")).toBe(join("/h", ".contextforge", "sessions"));
  });

  it("appends one JSON line per prompt, flattened, with turn and cwd", () => {
    const r = runHook(script, home, JSON.stringify({
      session_id: "abc-123", hook_event_name: "UserPromptSubmit", turn: 1, cwd: "/repo",
      prompt: "migrate the retry logic\n  into the client",
    }));
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
    const lines = readFileSync(sessionFile("abc-123"), "utf-8").trim().split("\n");
    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0]);
    expect(entry.prompt).toBe("migrate the retry logic into the client");
    expect(entry.turn).toBe(1);
    expect(entry.cwd).toBe("/repo");
    expect(typeof entry.t).toBe("number");
  });

  it("ignores slash commands and empty prompts", () => {
    for (const prompt of ["/compact", "  /clear ", "", "   \n  "]) {
      const r = runHook(script, home, JSON.stringify({ session_id: "s1", prompt }));
      expect(r.status).toBe(0);
    }
    expect(existsSync(sessionFile("s1"))).toBe(false);
  });

  it("exits 0 and writes nothing on invalid JSON, missing fields, or empty stdin", () => {
    for (const stdin of ["not json", "{}", JSON.stringify({ prompt: "x" }), JSON.stringify({ session_id: 5, prompt: "x" }), ""]) {
      const r = runHook(script, home, stdin);
      expect(r.status).toBe(0);
      expect(r.stdout).toBe("");
    }
    expect(existsSync(sessionsDir(home)) ? readdirSync(sessionsDir(home)) : []).toEqual([]);
  });

  it("truncates prompts to 600 characters", () => {
    runHook(script, home, JSON.stringify({ session_id: "s2", prompt: "x".repeat(2000) }));
    const entry = JSON.parse(readFileSync(sessionFile("s2"), "utf-8").trim());
    expect(entry.prompt).toHaveLength(600);
  });

  it("sanitizes the session id used for the file name", () => {
    runHook(script, home, JSON.stringify({ session_id: "../../evil id!", prompt: "hello there world" }));
    expect(readdirSync(sessionsDir(home))).toEqual(["evilid.jsonl"]);
  });

  it("stops appending once the session file reaches 64 KB", () => {
    mkdirSync(sessionsDir(home), { recursive: true });
    writeFileSync(sessionFile("big"), "x".repeat(64 * 1024));
    runHook(script, home, JSON.stringify({ session_id: "big", prompt: "one more prompt" }));
    expect(readFileSync(sessionFile("big"), "utf-8")).toHaveLength(64 * 1024);
  });

  it("never throws when the home dir cannot be created (prints nothing, exit 0)", () => {
    // A regular file where the home dir should be → mkdirSync fails with ENOTDIR.
    const blocker = join(home, "blocker");
    writeFileSync(blocker, "x");
    const r = runHook(script, blocker, JSON.stringify({ session_id: "s3", prompt: "hello there world" }));
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("");
  });
});
