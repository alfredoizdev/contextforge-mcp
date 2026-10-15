import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  recordRecallEvent,
  recordRecallFollowup,
  computeRecallStats,
  formatRecallStats,
  recallEventsFile,
  recallFollowupsFile,
  FOLLOWUP_WINDOW_MS,
} from "../src/recall-stats.js";

const MIN = 60_000;

describe("recall stats (local, best-effort)", () => {
  let home: string;
  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "cf-stats-"));
  });
  afterEach(() => rmSync(home, { recursive: true, force: true }));

  const ev = (t: number, cwd = "/repo", extra: Partial<Parameters<typeof recordRecallEvent>[1]> = {}) =>
    recordRecallEvent(home, { t, cwd, session_id: "s", objective: false, relevant: 0, recent: 3, tasks: 1, latency_ms: 120, ...extra });

  it("appends one JSON line per recall event", () => {
    ev(1000);
    ev(2000, "/other");
    const lines = readFileSync(recallEventsFile(home), "utf-8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0])).toMatchObject({ t: 1000, cwd: "/repo", recent: 3 });
  });

  it("records a follow-up query once, only within 15 minutes, only for the same cwd", () => {
    ev(10 * MIN);
    expect(recordRecallFollowup({ homeDir: home, cwd: "/repo", now: 12 * MIN })).toBe(true);
    expect(recordRecallFollowup({ homeDir: home, cwd: "/repo", now: 13 * MIN })).toBe(false); // already counted
    expect(recordRecallFollowup({ homeDir: home, cwd: "/elsewhere", now: 12 * MIN })).toBe(false);
    const lines = readFileSync(recallFollowupsFile(home), "utf-8").trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toEqual({ recall_t: 10 * MIN, query_t: 12 * MIN, cwd: "/repo" });

    ev(30 * MIN);
    expect(recordRecallFollowup({ homeDir: home, cwd: "/repo", now: 30 * MIN + FOLLOWUP_WINDOW_MS + 1 })).toBe(false);
  });

  it("does nothing when there are no events or the files are corrupt", () => {
    expect(recordRecallFollowup({ homeDir: home, cwd: "/repo", now: 5 })).toBe(false);
    mkdirSync(join(home, ".contextforge"), { recursive: true });
    writeFileSync(recallEventsFile(home), "garbage\n{bad\n");
    expect(recordRecallFollowup({ homeDir: home, cwd: "/repo", now: 5 })).toBe(false);
    expect(computeRecallStats({ homeDir: home, now: 5 })).toMatchObject({ recalls: 0, followedUp: 0, medianDelaySec: null });
  });

  it("computes counts, percentage and median delay over the last 30 days", () => {
    const now = 100 * 24 * 3600 * 1000;
    const day = 24 * 3600 * 1000;
    // chronological, as it happens in real sessions (a follow-up matches the latest recall)
    ev(now - 40 * day); // outside window, ignored
    ev(now - 3 * day, "/repo", { objective: true, relevant: 2 });
    recordRecallFollowup({ homeDir: home, cwd: "/repo", now: now - 3 * day + 30_000 }); // 30 s
    ev(now - 2 * day, "/repo", { objective: true });
    ev(now - 1 * day, "/repo");
    recordRecallFollowup({ homeDir: home, cwd: "/repo", now: now - 1 * day + 90_000 }); // 90 s
    const s = computeRecallStats({ homeDir: home, now });
    expect(s).toEqual({
      windowDays: 30,
      recalls: 3,
      withObjective: 2,
      withRelevant: 1,
      followedUp: 2,
      medianDelaySec: 60,
    });
    const text = formatRecallStats(s);
    expect(text).toContain("Recalls (last 30 days): 3");
    expect(text).toContain("with a session objective: 2 (67%)");
    expect(text).toContain("with relevant memories: 1 (33%)");
    expect(text).toContain("followed by memory_query within 15 min: 2 (67%)");
    expect(text).toContain("median time to first query: 60 s");
  });

  it("formats the empty case without dividing by zero", () => {
    const text = formatRecallStats(computeRecallStats({ homeDir: home, now: 1 }));
    expect(text).toContain("Recalls (last 30 days): 0");
    expect(text).toContain("median time to first query: n/a");
    expect(text).not.toContain("NaN");
  });

  it("caps the events file at 5,000 lines", () => {
    for (let i = 0; i < 5010; i++) ev(i);
    const lines = readFileSync(recallEventsFile(home), "utf-8").trim().split("\n");
    expect(lines.length).toBeLessThanOrEqual(5000);
    expect(JSON.parse(lines[lines.length - 1]).t).toBe(5009);
  });

  it("never throws when the home dir is unusable", () => {
    const blocker = join(home, "file");
    writeFileSync(blocker, "x");
    expect(() => ev(1)).not.toThrow();
    expect(recordRecallFollowup({ homeDir: blocker, cwd: "/repo", now: 1 })).toBe(false);
    expect(existsSync(recallEventsFile(blocker))).toBe(false);
  });
});
