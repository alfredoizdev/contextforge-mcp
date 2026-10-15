import { describe, it, expect } from "vitest";
import { formatRecall } from "../src/recall.js";

/**
 * Byte-for-byte pin of the 0.12.0 block. The 0.13.0 additions (objective,
 * relevant hits) must leave this output untouched when those inputs are absent.
 */
describe("formatRecall 0.12.0 compatibility", () => {
  it("produces the exact 0.12.0 block when no objective and no relevant hits are given", () => {
    const out = formatRecall({
      projectName: "MCP-memory",
      items: [
        { title: "Keep landing static", content_preview: "Decided ISR; streaming only in admin because it cost 40ms.", space: "Decisions", created_at: "2026-09-24T10:00:00Z" },
        { title: "Infra note", content_preview: "", space: "Infra", created_at: "2026-09-24T11:00:00Z" },
      ],
      tasks: [
        { short_id: "abc", title: "Do thing", priority: "high", due_date: "2026-10-20T00:00:00Z" },
        { title: "No meta" },
      ],
    });
    expect(out).toBe("## ContextForge: context restored after compaction\nThe conversation was just compacted. These are the most recent saved memories for project \"MCP-memory\". Treat them as current decisions.\n\nRecent memories:\n- [Decisions] Keep landing static — Decided ISR; streaming only in admin because it cost 40ms.\n- [Infra] Infra note\n\nPending tasks:\n- [abc] Do thing (high, due 2026-10-20)\n- No meta\n\nFor anything older or more specific, call memory_query before answering.\n");
  });
});
