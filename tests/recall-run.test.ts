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

  it("returns empty instead of throwing when the API fails", async () => {
    linkProject(cwd);
    const client = fakeClient({ listSpaces: async () => { throw new Error("boom"); } });
    const out = await runRecall({ cwd, env, homeDir: home, makeClient: () => client });
    expect(out).toBe("");
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
