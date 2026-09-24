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
