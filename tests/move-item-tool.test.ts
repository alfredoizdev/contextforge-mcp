import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * Source-level checks for the `memory_move_item` MCP tool (Part B of the
 * topic-spaces feature). Verifies the tool is declared, handled, and wired to
 * the api-client method that calls the move-item edge function.
 */
const indexSrc = readFileSync(join(__dirname, "..", "src", "index.ts"), "utf8");
const apiSrc = readFileSync(join(__dirname, "..", "src", "api-client.ts"), "utf8");

describe("memory_move_item tool wiring", () => {
  it("declares the memory_move_item tool with a target_space input", () => {
    expect(indexSrc).toContain('name: "memory_move_item"');
    expect(indexSrc).toMatch(/required:\s*\["target_space"\]/);
  });

  it("handles the memory_move_item case and calls apiClient.moveItem", () => {
    expect(indexSrc).toContain('case "memory_move_item"');
    expect(indexSrc).toContain("apiClient.moveItem(");
  });

  it("has an api-client moveItem method that POSTs to the move-item edge fn", () => {
    expect(apiSrc).toMatch(/async moveItem\s*\(/);
    expect(apiSrc).toContain('"/functions/v1/move-item"');
    expect(apiSrc).toContain("target_space");
  });
});
