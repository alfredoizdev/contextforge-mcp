import { describe, it, expect } from "vitest";
import { formatRecall } from "../src/recall.js";

const item = (title: string, preview = "some preview", space = "Decisions") => ({
  title,
  content_preview: preview,
  space,
  created_at: "2026-09-24T10:00:00Z",
});

describe("formatRecall", () => {
  it("returns empty string when there is nothing to show", () => {
    expect(formatRecall({ projectName: "MCP", items: [], tasks: [] })).toBe("");
  });

  it("renders a header, one line per item with space and preview", () => {
    const out = formatRecall({
      projectName: "MCP-memory",
      items: [item("Retry logic lives in the client", "Handler untouched. Next: timeout config.")],
      tasks: [],
    });
    expect(out.startsWith("## ContextForge: context restored after compaction")).toBe(true);
    expect(out).toContain("MCP-memory");
    expect(out).toContain("- [Decisions] Retry logic lives in the client — Handler untouched. Next: timeout config.");
    expect(out.endsWith("\n")).toBe(true);
  });

  it("caps items at 10 and tasks at 5", () => {
    const items = Array.from({ length: 14 }, (_, i) => item(`Item ${i}`));
    const tasks = Array.from({ length: 8 }, (_, i) => ({ short_id: `t${i}`, title: `Task ${i}` }));
    const out = formatRecall({ projectName: "P", items, tasks });
    expect(out).toContain("Item 9");
    expect(out).not.toContain("Item 10");
    expect(out).toContain("Task 4");
    expect(out).not.toContain("Task 5");
  });

  it("truncates previews to 160 chars and collapses newlines", () => {
    const long = "a".repeat(200) + "\nsecond line";
    const out = formatRecall({ projectName: "P", items: [item("T", long)], tasks: [] });
    const line = out.split("\n").find((l) => l.startsWith("- [Decisions] T"))!;
    expect(line).not.toContain("\n");
    expect(line.length).toBeLessThan(200 + "- [Decisions] T — ".length);
    expect(line.endsWith("…")).toBe(true);
  });

  it("renders pending tasks with short id, priority and due date when present", () => {
    const out = formatRecall({
      projectName: "P",
      items: [],
      tasks: [{ short_id: "f8drg2", title: "Check-in 7 días", priority: "high", due_date: "2026-09-30" }],
    });
    expect(out).toContain("Pending tasks");
    expect(out).toContain("- [f8drg2] Check-in 7 días (high, due 2026-09-30)");
  });

  it("shows only the date part of an ISO due_date", () => {
    const out = formatRecall({
      projectName: "P",
      items: [],
      tasks: [{ short_id: "x1", title: "T", priority: "high", due_date: "2026-05-29T00:00:00+00:00" }],
    });
    expect(out).toContain("- [x1] T (high, due 2026-05-29)");
  });

  it("ends with the reminder to query memory for anything older", () => {
    const out = formatRecall({ projectName: "P", items: [item("X")], tasks: [] });
    expect(out).toContain("memory_query");
  });
});

// ---------------------------------------------------------------------------
// 0.13.0: objective + relevant sections (absent inputs → unchanged block)
// ---------------------------------------------------------------------------
describe("formatRecall 0.13.0 sections", () => {
  const base = {
    projectName: "P",
    items: [{ id: "i1", title: "Recent one", content_preview: "r1", space: "Decisions", created_at: "2026-10-01T00:00:00Z" }],
    tasks: [],
  };

  it("prints the objective and latest request right after the intro line", () => {
    const out = formatRecall({ ...base, objective: "Move retry into the client", latest: "add a backoff test" });
    const lines = out.split("\n");
    expect(lines[0]).toBe("## ContextForge: context restored after compaction");
    expect(lines[2]).toBe("");
    expect(lines[3]).toBe('Session objective (the user\'s first request): "Move retry into the client"');
    expect(lines[4]).toBe('Latest request before compaction: "add a backoff test"');
    expect(out).toContain("\nRecent memories:\n- [Decisions] Recent one — r1\n");
  });

  it("omits the latest line when only the objective is known", () => {
    const out = formatRecall({ ...base, objective: "Move retry into the client" });
    expect(out).toContain('Session objective (the user\'s first request): "Move retry into the client"\n\nRecent memories:');
    expect(out).not.toContain("Latest request");
  });

  it("prints relevant hits before recent memories, with a git summary when available", () => {
    const out = formatRecall({
      ...base,
      relevant: [{ id: "x", title: "Old but relevant", preview: "decided in May", space: "Decisions" }],
      gitSummary: { branch: "feat/retry", changedFiles: 2 },
    });
    expect(out).toContain("\nRelevant to current work (branch feat/retry, 2 changed files):\n- [Decisions] Old but relevant — decided in May\n\nRecent memories:");
  });

  it("uses a plain header without git, singular file count, and no space label when unknown", () => {
    const out = formatRecall({ ...base, relevant: [{ title: "No space", preview: "p" }] });
    expect(out).toContain("\nRelevant to current work:\n- No space — p\n");
    const one = formatRecall({ ...base, relevant: [{ title: "T", preview: "" }], gitSummary: { branch: "b", changedFiles: 1 } });
    expect(one).toContain("(branch b, 1 changed file):\n- T\n");
  });

  it("returns a block when only an objective is known (no items, no tasks)", () => {
    const out = formatRecall({ projectName: "P", items: [], tasks: [], objective: "Ship the thing today" });
    expect(out).toContain('Session objective (the user\'s first request): "Ship the thing today"');
    expect(out).toContain("call memory_query before answering");
    expect(out).not.toContain("Recent memories");
  });

  it("caps relevant at 5 and previews at 160 chars; worst case stays well under the 10,000-char hook cap", () => {
    const long = "x".repeat(1000);
    const out = formatRecall({
      projectName: "P",
      objective: long, latest: long,
      relevant: Array.from({ length: 9 }, (_, i) => ({ id: `r${i}`, title: long, preview: long, space: "S" })),
      items: Array.from({ length: 20 }, (_, i) => ({ id: `i${i}`, title: long, content_preview: long, space: "S", created_at: "2026-10-01T00:00:00Z" })),
      tasks: Array.from({ length: 9 }, (_, i) => ({ short_id: `t${i}`, title: long, priority: "high" })),
    });
    expect((out.match(/^- /gm) ?? []).length).toBe(5 + 10 + 5);
    expect(out.length).toBeLessThan(8000);
  });
});
