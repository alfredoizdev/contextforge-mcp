import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, utimesSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  selectObjective,
  readSessionPrompts,
  findSessionFile,
  flattenCut,
  type SessionPromptEntry,
} from "../src/recall.js";
import { sessionsDir } from "../src/objective-hook.js";

const e = (prompt: string, turn: number, cwd = "/repo"): SessionPromptEntry => ({ t: 1000 + turn, turn, cwd, prompt });

describe("selectObjective", () => {
  it("returns nothing for an empty log", () => {
    expect(selectObjective([])).toEqual({});
  });

  it("skips greetings, acks and short prompts; first real prompt is the objective", () => {
    const res = selectObjective([
      e("hola", 1), e("ok", 2), e("yes", 3), e("fix it", 4),
      e("Move the payment retry logic out of the request handler into the client", 5),
    ]);
    expect(res.objective).toBe("Move the payment retry logic out of the request handler into the client");
    expect(res.latest).toBeUndefined();
  });

  it("reports the latest real prompt when it differs from the objective", () => {
    const res = selectObjective([
      e("Move the payment retry logic into the client", 1),
      e("ok continue", 2),
      e("now add a unit test for the retry backoff and run the suite", 3),
      e("gracias", 4),
    ]);
    expect(res.objective).toBe("Move the payment retry logic into the client");
    expect(res.latest).toBe("now add a unit test for the retry backoff and run the suite");
  });

  it("does not repeat the objective as latest when the user re-sent the same text", () => {
    const res = selectObjective([
      e("Move the payment retry logic into the client", 1),
      e("Move the payment retry logic into the client", 2),
    ]);
    expect(res.latest).toBeUndefined();
  });

  it("ignores slash commands even if they slipped into the log", () => {
    const res = selectObjective([e("/compact please now", 1), e("Refactor the auth middleware to use the new session table", 2)]);
    expect(res.objective).toBe("Refactor the auth middleware to use the new session table");
  });

  it("0.13.2: ignores tag-prefixed system turns already present in a v1 log", () => {
    const res = selectObjective([
      e("Move the payment retry logic into the client", 1),
      e("<task-notification> <task-id>x1</task-id> <status>completed</status> </task-notification>", 2),
    ]);
    expect(res.objective).toBe("Move the payment retry logic into the client");
    expect(res.latest).toBeUndefined();
  });

  it("0.13.2: a system turn cut at the 600-char cap by a v1 script (no final closing tag) is still ignored", () => {
    const cut = "<task-notification> <task-id>bc8xyom8c</task-id> <output-file>/tmp/x.output</output-file> <status>completed</status> <summary>Background command finished and the summary keeps going until the log cap trims it";
    const res = selectObjective([e("Move the payment retry logic into the client", 1), e(cut, 2)]);
    expect(res.latest).toBeUndefined();
  });

  it("0.13.2: a prompt that merely starts with markup is still a candidate", () => {
    const res = selectObjective([e("<div> is not centered on mobile, fix the flex layout", 1)]);
    expect(res.objective).toBe("<div> is not centered on mobile, fix the flex layout");
  });

  it("truncates to 300 characters with an ellipsis", () => {
    const res = selectObjective([e("word ".repeat(200), 1)]);
    // 300 chars max before the ellipsis; trailing whitespace is trimmed first
    expect(res.objective!.length).toBeLessThanOrEqual(301);
    expect(res.objective!.length).toBeGreaterThanOrEqual(296);
    expect(res.objective!.endsWith("…")).toBe(true);
  });

  it("orders by turn when present, falls back to timestamp", () => {
    const res = selectObjective([
      { t: 50, turn: null, cwd: null, prompt: "second prompt about the database migration plan" },
      { t: 10, turn: null, cwd: null, prompt: "first prompt about the database migration plan" },
    ]);
    expect(res.objective).toBe("first prompt about the database migration plan");
  });
});

describe("flattenCut", () => {
  it("collapses whitespace and cuts with an ellipsis", () => {
    expect(flattenCut("a\n\n  b\tc", 100)).toBe("a b c");
    expect(flattenCut("abcdef", 3)).toBe("abc…");
  });
});

describe("session prompt files", () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "cf-sess-"));
    mkdirSync(sessionsDir(home), { recursive: true });
  });
  afterEach(() => rmSync(home, { recursive: true, force: true }));

  const write = (sid: string, lines: string[]) =>
    writeFileSync(join(sessionsDir(home), `${sid}.jsonl`), lines.join("\n") + "\n");

  it("reads good lines and skips corrupt ones", () => {
    write("s1", [JSON.stringify(e("first real prompt about things", 1)), "{corrupt", JSON.stringify(e("second real prompt about things", 2)), ""]);
    const entries = readSessionPrompts(join(sessionsDir(home), "s1.jsonl"));
    expect(entries.map((x) => x.turn)).toEqual([1, 2]);
  });

  it("returns [] for a missing file", () => {
    expect(readSessionPrompts(join(home, "nope.jsonl"))).toEqual([]);
  });

  it("finds the file by session id (sanitized) when given", () => {
    write("abc-1", [JSON.stringify(e("x", 1))]);
    expect(findSessionFile({ homeDir: home, sessionId: "abc-1", cwd: "/elsewhere" })).toBe(join(sessionsDir(home), "abc-1.jsonl"));
    expect(findSessionFile({ homeDir: home, sessionId: "../abc-1", cwd: "/elsewhere" })).toBe(join(sessionsDir(home), "abc-1.jsonl"));
    expect(findSessionFile({ homeDir: home, sessionId: "missing", cwd: "/repo" })).toBeNull();
  });

  it("without a session id, picks the newest recent file whose last entry cwd matches", () => {
    write("old", [JSON.stringify(e("old prompt about something", 1, "/repo"))]);
    write("other", [JSON.stringify(e("other repo prompt about something", 1, "/other"))]);
    write("new", [JSON.stringify(e("new prompt about something", 1, "/repo"))]);
    const past = new Date(Date.now() - 3 * 24 * 3600 * 1000);
    utimesSync(join(sessionsDir(home), "old.jsonl"), past, past);
    expect(findSessionFile({ homeDir: home, cwd: "/repo" })).toBe(join(sessionsDir(home), "new.jsonl"));
    expect(findSessionFile({ homeDir: home, cwd: "/nowhere" })).toBeNull();
  });

  it("returns null when the sessions dir does not exist", () => {
    expect(findSessionFile({ homeDir: join(home, "x"), cwd: "/repo" })).toBeNull();
  });
});
