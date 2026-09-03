import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const indexSrc = readFileSync(join(__dirname, "..", "src", "index.ts"), "utf8");

describe("memory_ingest agent-driven routing wiring", () => {
  it("captures whether the agent chose a space before default resolution", () => {
    expect(indexSrc).toContain("const agentProvidedSpace = !!input.space_id");
  });

  it("appends a routing hint from buildRoutingHint when no space was chosen", () => {
    expect(indexSrc).toContain("buildRoutingHint(");
    expect(indexSrc).toContain("getRoutableSpaceNames(apiClient)");
  });

  it("tells the agent to route by topic in the memory_ingest description", () => {
    expect(indexSrc).toContain("ROUTE BY TOPIC");
  });
});
