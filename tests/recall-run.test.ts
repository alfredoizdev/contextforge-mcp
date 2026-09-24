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

function fakeClient(overrides: Partial<RecallClient> = {}): RecallClient {
  return {
    listSpaces: async () => [{ name: "Decisions" }, { name: "Infra" }],
    listItems: async () => ({
      items: [
        { title: "In project", content_preview: "p1", space: "Decisions", created_at: "2026-09-24T10:00:00Z" },
        { title: "Other project", content_preview: "p2", space: "Marketing", created_at: "2026-09-24T09:00:00Z" },
      ],
    }),
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

  it("keeps only items whose space belongs to the linked project", async () => {
    linkProject(cwd);
    const out = await runRecall({ cwd, env, homeDir: home, makeClient: () => fakeClient() });
    expect(out).toContain("In project");
    expect(out).not.toContain("Other project");
    expect(out).toContain("[abc] Do thing");
  });

  it("passes the linked project id to listSpaces and asks for 50 items", async () => {
    linkProject(cwd);
    const calls: unknown[] = [];
    const client = fakeClient({
      listSpaces: async (projectId, type) => { calls.push(["spaces", projectId, type]); return [{ name: "Decisions" }]; },
      listItems: async (spaceId, limit) => { calls.push(["items", spaceId, limit]); return { items: [] }; },
    });
    await runRecall({ cwd, env, homeDir: home, makeClient: () => client });
    expect(calls).toContainEqual(["spaces", "proj-1", "regular"]);
    expect(calls).toContainEqual(["items", undefined, 50]);
  });

  it("returns empty instead of throwing when the API fails", async () => {
    linkProject(cwd);
    const client = fakeClient({ listItems: async () => { throw new Error("boom"); } });
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
