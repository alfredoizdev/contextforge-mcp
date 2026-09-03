import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const indexSrc = readFileSync(join(__dirname, "..", "src", "index.ts"), "utf8");
const apiSrc = readFileSync(join(__dirname, "..", "src", "api-client.ts"), "utf8");

describe("memory_update tool wiring", () => {
  it("declares the memory_update tool requiring id + content", () => {
    expect(indexSrc).toContain('name: "memory_update"');
    expect(indexSrc).toMatch(/required:\s*\["id",\s*"content"\]/);
  });
  it("handles the memory_update case and calls apiClient.updateItem", () => {
    expect(indexSrc).toContain('case "memory_update"');
    expect(indexSrc).toContain("apiClient.updateItem(");
  });
  it("has an api-client updateItem method that POSTs to the update-item edge fn", () => {
    expect(apiSrc).toMatch(/async updateItem\s*\(/);
    expect(apiSrc).toContain('"/functions/v1/update-item"');
  });
});
