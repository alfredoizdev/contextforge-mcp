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

  it("ends with the reminder to query memory for anything older", () => {
    const out = formatRecall({ projectName: "P", items: [item("X")], tasks: [] });
    expect(out).toContain("memory_query");
  });
});
