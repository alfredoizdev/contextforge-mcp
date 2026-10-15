import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { runRecall, type RecallClient } from "../src/recall.js";

function linkProject(cwd: string) {
  writeFileSync(
    join(cwd, ".contextforge"),
    JSON.stringify({ project_id: "proj-1", project_name: "MCP-memory", linked_at: "2026-09-24" }),
  );
}

/** Items per space id, as the real `items` endpoint returns them (space_id filter). */
const ITEMS_BY_SPACE: Record<string, RecallClient extends { listItems(...a: any[]): Promise<{ items: infer I }> } ? I : never> = {
  "sp-decisions": [
    { title: "In project", content_preview: "p1", space: "Decisions", created_at: "2026-09-24T10:00:00Z" },
  ],
  "sp-infra": [
    { title: "Infra note", content_preview: "p3", space: "Infra", created_at: "2026-09-24T11:00:00Z" },
  ],
  "sp-marketing": [
    { title: "Other project", content_preview: "p2", space: "Marketing", created_at: "2026-09-24T12:00:00Z" },
  ],
};

function fakeClient(overrides: Partial<RecallClient> = {}): RecallClient {
  return {
    listSpaces: async () => [
      { id: "sp-decisions", name: "Decisions" },
      { id: "sp-infra", name: "Infra" },
    ],
    listItems: async (spaceId) => ({ items: spaceId ? (ITEMS_BY_SPACE[spaceId] ?? []) : Object.values(ITEMS_BY_SPACE).flat() }),
    listTasks: async () => ({ issues: [{ short_id: "abc", title: "Do thing", priority: "high" }] }),
    ...overrides,
  };
}

describe("runRecall", () => {
  let cwd: string;
  let home: string;
  const env = { CONTEXTFORGE_API_KEY: "k" };

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "cf-recall-run-"));
    home = mkdtempSync(join(tmpdir(), "cf-recall-home-"));
  });
  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  });

  it("returns empty when no API key can be resolved", async () => {
    linkProject(cwd);
    const out = await runRecall({ cwd, env: {}, homeDir: home, makeClient: () => fakeClient() });
    expect(out).toBe("");
  });

  it("returns empty when the project is not linked", async () => {
    const out = await runRecall({ cwd, env, homeDir: home, makeClient: () => fakeClient() });
    expect(out).toBe("");
  });

  it("fetches items per project space, never account-wide, and merges newest first", async () => {
    linkProject(cwd);
    const out = await runRecall({ cwd, env, homeDir: home, makeClient: () => fakeClient() });
    expect(out).toContain("In project");
    expect(out).toContain("Infra note");
    expect(out).not.toContain("Other project");
    expect(out.indexOf("Infra note")).toBeLessThan(out.indexOf("In project"));
    expect(out).toContain("[abc] Do thing");
  });

  it("passes the linked project id to listSpaces and asks each space for 10 items", async () => {
    linkProject(cwd);
    const calls: unknown[] = [];
    const client = fakeClient({
      listSpaces: async (projectId, type) => {
        calls.push(["spaces", projectId, type]);
        return [{ id: "sp-decisions", name: "Decisions" }, { id: "sp-infra", name: "Infra" }];
      },
      listItems: async (spaceId, limit) => { calls.push(["items", spaceId, limit]); return { items: [] }; },
    });
    await runRecall({ cwd, env, homeDir: home, makeClient: () => client });
    expect(calls).toContainEqual(["spaces", "proj-1", "regular"]);
    expect(calls).toContainEqual(["items", "sp-decisions", 10]);
    expect(calls).toContainEqual(["items", "sp-infra", 10]);
    expect(calls.filter((c) => (c as unknown[])[0] === "items" && (c as unknown[])[1] === undefined)).toHaveLength(0);
  });

  it("drops a space whose items call fails but keeps the others", async () => {
    linkProject(cwd);
    const client = fakeClient({
      listItems: async (spaceId) => {
        if (spaceId === "sp-infra") throw new Error("boom");
        return { items: ITEMS_BY_SPACE[spaceId ?? ""] ?? [] };
      },
    });
    const out = await runRecall({ cwd, env, homeDir: home, makeClient: () => client });
    expect(out).toContain("In project");
    expect(out).not.toContain("Infra note");
  });

  it("caps the merged list at 10 items across spaces", async () => {
    linkProject(cwd);
    const many = (space: string, n: number) =>
      Array.from({ length: n }, (_, i) => ({
        title: `${space}-${i}`, content_preview: "", space, created_at: `2026-09-${String(10 + i).padStart(2, "0")}T00:00:00Z`,
      }));
    const client = fakeClient({
      listItems: async (spaceId) => ({ items: spaceId === "sp-decisions" ? many("D", 10) : many("I", 10) }),
    });
    const out = await runRecall({ cwd, env, homeDir: home, makeClient: () => client });
    const lines = out.split("\n").filter((l) => l.startsWith("- [") && !l.startsWith("- [abc]"));
    expect(lines).toHaveLength(10);
  });

  it("returns empty instead of throwing when the whole API fails", async () => {
    linkProject(cwd);
    const boom = async () => { throw new Error("boom"); };
    const client = fakeClient({ listSpaces: boom, listTasks: boom });
    const out = await runRecall({ cwd, env, homeDir: home, makeClient: () => client });
    expect(out).toBe("");
  });

  it("0.13.1: still shows tasks when only the spaces/items call fails (best effort, mirrors the tasks-fail case)", async () => {
    linkProject(cwd);
    const client = fakeClient({ listSpaces: async () => { throw new Error("boom"); } });
    const out = await runRecall({ cwd, env, homeDir: home, makeClient: () => client });
    expect(out).not.toContain("Recent memories");
    expect(out).toContain("Pending tasks:\n- [abc] Do thing (high)");
  });

  it("still shows items when only the tasks call fails", async () => {
    linkProject(cwd);
    const client = fakeClient({ listTasks: async () => { throw new Error("boom"); } });
    const out = await runRecall({ cwd, env, homeDir: home, makeClient: () => client });
    expect(out).toContain("In project");
    expect(out).not.toContain("Pending tasks");
  });

  it("returns empty when the work exceeds the timeout", async () => {
    linkProject(cwd);
    const client = fakeClient({
      listItems: () => new Promise((resolve) => setTimeout(() => resolve({ items: [] }), 200)),
    });
    const out = await runRecall({ cwd, env, homeDir: home, timeoutMs: 20, makeClient: () => client });
    expect(out).toBe("");
  });

  it("uses CONTEXTFORGE_API_URL when set, else the production default", async () => {
    linkProject(cwd);
    const urls: string[] = [];
    await runRecall({
      cwd, env: { ...env, CONTEXTFORGE_API_URL: "http://127.0.0.1:55321" }, homeDir: home,
      makeClient: (_k, url) => { urls.push(url); return fakeClient(); },
    });
    await runRecall({ cwd, env, homeDir: home, makeClient: (_k, url) => { urls.push(url); return fakeClient(); } });
    expect(urls[0]).toBe("http://127.0.0.1:55321");
    expect(urls[1]).toBe("https://byzngcpqiqmqpxpmnhmo.supabase.co");
  });
});

// ---------------------------------------------------------------------------
// 0.13.0: objective from the session log + relevance query + stdin reader
// ---------------------------------------------------------------------------
import { mkdirSync } from "fs";
import { PassThrough } from "stream";
import { readStdinBounded, parseHookInput, type GitSignals } from "../src/recall.js";
import { sessionsDir } from "../src/objective-hook.js";

describe("runRecall 0.13.0 (objective + relevance)", () => {
  let cwd: string;
  let home: string;
  const env = { CONTEXTFORGE_API_KEY: "k" };
  const git: GitSignals = { branch: "feat/retry", commits: ["move retry into client"], changedFiles: ["src/retry.ts"] };

  const writeSession = (sid: string, prompts: string[]) => {
    mkdirSync(sessionsDir(home), { recursive: true });
    writeFileSync(
      join(sessionsDir(home), `${sid}.jsonl`),
      prompts.map((p, i) => JSON.stringify({ t: 1000 + i, turn: i + 1, cwd, prompt: p })).join("\n") + "\n",
    );
  };

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "cf-recall2-"));
    home = mkdtempSync(join(tmpdir(), "cf-recall2-home-"));
    linkProject(cwd);
  });
  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  });

  it("restores the objective from the session log and queries with it", async () => {
    writeSession("sess-1", ["hola", "Move the payment retry logic into the client", "ok", "now add a backoff test please"]);
    const seen: string[] = [];
    const client: RecallClient = {
      ...fakeClient(),
      query: async (input) => {
        seen.push(input.query);
        return { results: [{ id: "old-1", title: "Retry lives in the client", content: "Decided in May: handler stays dumb", score: 0.8 }] };
      },
    };
    const out = await runRecall({ cwd, env, homeDir: home, sessionId: "sess-1", makeClient: () => client, collectGit: () => git });
    expect(out).toContain('Session objective (the user\'s first request): "Move the payment retry logic into the client"');
    expect(out).toContain('Latest request before compaction: "now add a backoff test please"');
    expect(out).toContain("Relevant to current work (branch feat/retry, 1 changed file):\n- Retry lives in the client — Decided in May: handler stays dumb");
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain("Move the payment retry logic into the client");
    expect(seen[0]).toContain("feat retry");
    expect(seen[0]).toContain("src/retry.ts");
  });

  it("is byte-identical to 0.12.0 when there is no session log, no git and no query support", async () => {
    const out = await runRecall({ cwd, env, homeDir: home, sessionId: "missing", makeClient: () => fakeClient(), collectGit: () => null });
    expect(out).toBe(
      "## ContextForge: context restored after compaction\n" +
        'The conversation was just compacted. These are the most recent saved memories for project "MCP-memory". Treat them as current decisions.\n' +
        "\nRecent memories:\n" +
        "- [Infra] Infra note — p3\n" +
        "- [Decisions] In project — p1\n" +
        "\nPending tasks:\n" +
        "- [abc] Do thing (high)\n" +
        "\nFor anything older or more specific, call memory_query before answering.\n",
    );
  });

  it("a query that never resolves cannot erase the 0.12.0 block (own 4 s deadline, here 50 ms)", async () => {
    writeSession("sess-hang", ["Refactor the auth middleware to use the session table"]);
    const hanging: RecallClient = { ...fakeClient(), query: () => new Promise(() => {}) };
    const t0 = Date.now();
    const out = await runRecall({ cwd, env, homeDir: home, sessionId: "sess-hang", makeClient: () => hanging, collectGit: () => null, relevanceTimeoutMs: 50 });
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(out).toContain("Session objective");
    expect(out).toContain("Recent memories:\n- [Infra] Infra note — p3");
    expect(out).toContain("Pending tasks:");
    expect(out).not.toContain("Relevant to current work");
  });

  it("does not spend a metered query for git-only context on a default branch, but does on a feature branch", async () => {
    let calls = 0;
    const counting: RecallClient = { ...fakeClient(), query: async () => { calls++; return { results: [] }; } };
    const main: GitSignals = { branch: "main", commits: ["chore: bump"], changedFiles: ["package.json"] };
    await runRecall({ cwd, env, homeDir: home, sessionId: "missing", makeClient: () => counting, collectGit: () => main });
    expect(calls).toBe(0);
    await runRecall({ cwd, env, homeDir: home, sessionId: "missing", makeClient: () => counting, collectGit: () => git });
    expect(calls).toBe(1);
  });

  it("honors CONTEXTFORGE_RECALL_RELEVANCE=0 as a kill switch", async () => {
    writeSession("sess-off", ["Refactor the auth middleware to use the session table"]);
    let calls = 0;
    const counting: RecallClient = { ...fakeClient(), query: async () => { calls++; return { results: [] }; } };
    const out = await runRecall({ cwd, env: { ...env, CONTEXTFORGE_RECALL_RELEVANCE: "0" }, homeDir: home, sessionId: "sess-off", makeClient: () => counting, collectGit: () => git });
    expect(calls).toBe(0);
    expect(out).toContain("Session objective");
  });

  it("does not print an untitled relevant memory twice", async () => {
    writeSession("sess-untitled", ["Investigate the nightly import job slowness"]);
    const client: RecallClient = { ...fakeClient(), query: async () => ({ results: [{ id: "u", content: "untitled content here", score: 0.9 }] }) };
    const out = await runRecall({ cwd, env, homeDir: home, sessionId: "sess-untitled", makeClient: () => client, collectGit: () => null });
    expect(out).toContain("Relevant to current work:\n- untitled content here\n");
  });

  it("falls back to the plain block when query throws, and never calls query without a working context", async () => {
    writeSession("sess-2", ["Refactor the auth middleware to use the session table"]);
    let calls = 0;
    const throwing: RecallClient = { ...fakeClient(), query: async () => { calls++; throw new Error("boom"); } };
    const out = await runRecall({ cwd, env, homeDir: home, sessionId: "sess-2", makeClient: () => throwing, collectGit: () => null });
    expect(calls).toBe(1);
    expect(out).toContain("Session objective");
    expect(out).not.toContain("Relevant to current work");
    expect(out).toContain("Recent memories:");

    // an unknown session id → no objective; no git → no working context → query is never called
    calls = 0;
    await runRecall({ cwd, env, homeDir: home, sessionId: "missing", makeClient: () => throwing, collectGit: () => null });
    expect(calls).toBe(0);
  });

  it("treats a query response without results as empty and dedups recent items that are also relevant", async () => {
    writeSession("sess-3", ["Keep working on the infra note cleanup task"]);
    const client: RecallClient = {
      ...fakeClient(),
      listItems: async (spaceId) => ({
        items: spaceId === "sp-infra"
          ? [{ id: "dup", title: "Infra note", content_preview: "p3", space: "Infra", created_at: "2026-09-24T11:00:00Z" }]
          : [{ id: "k", title: "In project", content_preview: "p1", space: "Decisions", created_at: "2026-09-24T10:00:00Z" }],
      }),
      query: async () => ({ results: [{ id: "dup", title: "Infra note", content: "p3 full", score: 0.9 }] }),
    };
    const out = await runRecall({ cwd, env, homeDir: home, sessionId: "sess-3", makeClient: () => client, collectGit: () => null });
    expect(out.match(/Infra note/g)).toHaveLength(1);
    expect(out).toContain("Relevant to current work:\n- Infra note — p3 full");

    const empty: RecallClient = { ...fakeClient(), query: async () => ({} as any) };
    const out2 = await runRecall({ cwd, env, homeDir: home, sessionId: "sess-3", makeClient: () => empty, collectGit: () => null });
    expect(out2).not.toContain("Relevant to current work");
  });

  it("keeps only the top 5 relevant hits by score", async () => {
    writeSession("sess-4", ["Investigate why the nightly import job is slow"]);
    const results = Array.from({ length: 8 }, (_, i) => ({ id: `r${i}`, title: `hit ${i}`, content: "c", score: i / 10 }));
    const client: RecallClient = { ...fakeClient(), query: async () => ({ results }) };
    const out = await runRecall({ cwd, env, homeDir: home, sessionId: "sess-4", makeClient: () => client, collectGit: () => null });
    for (const i of [7, 6, 5, 4, 3]) expect(out).toContain(`hit ${i}`);
    for (const i of [2, 1, 0]) expect(out).not.toContain(`hit ${i} `);
    expect(out.indexOf("hit 7")).toBeLessThan(out.indexOf("hit 3"));
  });

  it("prunes session logs older than 14 days but keeps fresh ones", async () => {
    writeSession("fresh", ["Fresh session about something useful"]);
    writeSession("stale", ["Stale session about something useful"]);
    const old = new Date(Date.now() - 20 * 24 * 3600 * 1000);
    const { utimesSync, existsSync } = await import("fs");
    utimesSync(join(sessionsDir(home), "stale.jsonl"), old, old);
    await runRecall({ cwd, env, homeDir: home, sessionId: "fresh", makeClient: () => fakeClient(), collectGit: () => null });
    expect(existsSync(join(sessionsDir(home), "stale.jsonl"))).toBe(false);
    expect(existsSync(join(sessionsDir(home), "fresh.jsonl"))).toBe(true);
  });
});

describe("readStdinBounded / parseHookInput", () => {
  it("returns the piped text once the stream ends", async () => {
    const s = new PassThrough();
    const p = readStdinBounded(s as any, 1000);
    s.end('{"session_id":"abc","cwd":"/x"}');
    expect(await p).toBe('{"session_id":"abc","cwd":"/x"}');
  });

  it("gives up after the deadline when the stream never ends", async () => {
    const s = new PassThrough();
    s.write("partial");
    const t0 = Date.now();
    expect(await readStdinBounded(s as any, 120)).toBe("partial");
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it("returns empty for a TTY without touching it", async () => {
    const s = Object.assign(new PassThrough(), { isTTY: true });
    expect(await readStdinBounded(s as any, 50)).toBe("");
  });

  it("parses session_id and cwd, tolerating junk", () => {
    expect(parseHookInput('{"session_id":"abc","cwd":"/x","source":"compact"}')).toEqual({ session_id: "abc", cwd: "/x" });
    expect(parseHookInput("not json")).toEqual({});
    expect(parseHookInput("")).toEqual({});
    expect(parseHookInput('{"session_id":7}')).toEqual({});
  });
});

describe("runRecall records a local event", () => {
  it("writes one recall event with counts after a successful run", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "cf-recall-ev-"));
    const home = mkdtempSync(join(tmpdir(), "cf-recall-ev-home-"));
    try {
      linkProject(cwd);
      await runRecall({ cwd, env: { CONTEXTFORGE_API_KEY: "k" }, homeDir: home, sessionId: "none", makeClient: () => fakeClient(), collectGit: () => null });
      const { recallEventsFile } = await import("../src/recall-stats.js");
      const { readFileSync } = await import("fs");
      const ev = JSON.parse(readFileSync(recallEventsFile(home), "utf-8").trim());
      expect(ev).toMatchObject({ cwd, session_id: "none", objective: false, relevant: 0, recent: 2, tasks: 1 });
      expect(typeof ev.latency_ms).toBe("number");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(home, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// 0.13.1: best effort at the deadline — a slow stage degrades, never erases
// ---------------------------------------------------------------------------
describe("runRecall 0.13.1 (staged deadlines)", () => {
  let cwd: string;
  let home: string;
  const env = { CONTEXTFORGE_API_KEY: "k" };
  const never = () => new Promise<never>(() => {});
  const writeSession = (sid: string, prompts: string[]) => {
    mkdirSync(sessionsDir(home), { recursive: true });
    writeFileSync(join(sessionsDir(home), `${sid}.jsonl`), prompts.map((p, i) => JSON.stringify({ t: 1000 + i, turn: i + 1, cwd, prompt: p })).join("\n") + "\n");
  };
  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "cf-recall3-"));
    home = mkdtempSync(join(tmpdir(), "cf-recall3-home-"));
    linkProject(cwd);
  });
  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
    rmSync(home, { recursive: true, force: true });
  });

  it("one space whose items never arrive does not erase the other spaces, tasks or objective", async () => {
    writeSession("s-slow", ["Investigate the nightly import job slowness"]);
    const client: RecallClient = {
      ...fakeClient(),
      listItems: (spaceId) => (spaceId === "sp-infra" ? never() : fakeClient().listItems(spaceId)),
    };
    const t0 = Date.now();
    const out = await runRecall({ cwd, env, homeDir: home, sessionId: "s-slow", makeClient: () => client, collectGit: () => null, stageTimeoutMs: 100, timeoutMs: 5000 });
    expect(Date.now() - t0).toBeLessThan(2000);
    expect(out).toContain("Session objective");
    expect(out).toContain("- [Decisions] In project — p1");
    expect(out).not.toContain("Infra note");
    expect(out).toContain("- [abc] Do thing (high)");
  });

  it("listSpaces that never resolves still yields objective + tasks", async () => {
    writeSession("s-spaces", ["Investigate the nightly import job slowness"]);
    const client: RecallClient = { ...fakeClient(), listSpaces: never };
    const out = await runRecall({ cwd, env, homeDir: home, sessionId: "s-spaces", makeClient: () => client, collectGit: () => null, stageTimeoutMs: 100, timeoutMs: 5000 });
    expect(out).toContain('Session objective (the user\'s first request): "Investigate the nightly import job slowness"');
    expect(out).not.toContain("Recent memories");
    expect(out).toContain("Pending tasks:\n- [abc] Do thing (high)");
  });

  it("everything hanging except the local log still prints the objective block", async () => {
    writeSession("s-all", ["Investigate the nightly import job slowness"]);
    const client: RecallClient = { listSpaces: never, listItems: never, listTasks: never, query: never };
    const out = await runRecall({ cwd, env, homeDir: home, sessionId: "s-all", makeClient: () => client, collectGit: () => null, stageTimeoutMs: 100, timeoutMs: 5000 });
    expect(out).toContain("Session objective");
    expect(out).toContain("call memory_query before answering");
  });

  it("the global deadline is a last resort above the stage deadlines", async () => {
    const { RECALL_TIMEOUT_MS, RECALL_STAGE_TIMEOUT_MS, RECALL_RELEVANCE_TIMEOUT_MS } = await import("../src/recall.js");
    expect(RECALL_STAGE_TIMEOUT_MS).toBeLessThan(RECALL_TIMEOUT_MS);
    expect(RECALL_RELEVANCE_TIMEOUT_MS).toBeLessThanOrEqual(RECALL_STAGE_TIMEOUT_MS);
  });
});
