import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const src = readFileSync(join(__dirname, "..", "src", "index.ts"), "utf-8");

describe("recall CLI wiring (source-level)", () => {
  it("imports runRecall from ./recall.js", () => {
    expect(src).toMatch(/import \{[^}]*\brunRecall\b[^}]*\} from "\.\/recall\.js"/);
  });

  it("handles the `recall` subcommand before the MCP server starts", () => {
    const idx = src.indexOf('process.argv[2] === "recall"');
    const mainIdx = src.indexOf("async function main()");
    expect(idx).toBeGreaterThan(-1);
    expect(idx).toBeLessThan(mainIdx);
  });

  it("writes the block to stdout and always exits 0", () => {
    const block = src.slice(src.indexOf('process.argv[2] === "recall"'), src.indexOf("// ============ Logger with Colors"));
    expect(block).toContain("process.stdout.write(");
    expect(block).toContain("process.exit(0)");
    expect(block).not.toContain("process.exit(1)");
  });
});

describe("recall CLI wiring 0.13.0 (source-level)", () => {
  const block = src.slice(src.indexOf('process.argv[2] === "recall"'), src.indexOf("// ============ Logger with Colors"));

  it("reads stdin with a bounded wait and forwards the hook's session_id", () => {
    expect(src).toMatch(/import \{[^}]*\breadStdinBounded\b[^}]*\} from "\.\/recall\.js"/);
    expect(block).toContain("readStdinBounded(process.stdin");
    expect(block).toContain("sessionId:");
  });
});

describe("recall stats wiring (source-level)", () => {
  it("serves `recall --stats` before running recall", () => {
    const block = src.slice(src.indexOf('process.argv[2] === "recall"'), src.indexOf("// ============ Logger with Colors"));
    expect(block).toContain('process.argv[3] === "--stats"');
    expect(block).toContain("formatRecallStats(computeRecallStats(");
    expect(block).not.toContain("process.exit(1)");
  });

  it("records a post-recall follow-up inside the memory_query handler, guarded by try/catch", () => {
    const start = src.indexOf('case "memory_query": {');
    const handler = src.slice(start, src.indexOf("case ", start + 10));
    expect(handler).toContain("recordRecallFollowup(");
    const idx = handler.indexOf("recordRecallFollowup(");
    expect(handler.slice(Math.max(0, idx - 120), idx)).toContain("try {");
  });
});
