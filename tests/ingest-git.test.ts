import { describe, it, expect } from "vitest";
import { buildGitContext } from "../src/freshness.js";

describe("buildGitContext", () => {
  it("returns null outside a repo", () => {
    expect(buildGitContext(null, ["a.ts"])).toBeNull();
  });
  it("attaches related_paths inside a repo", () => {
    expect(buildGitContext({ repo: "acme/api", sha: "s" }, ["a.ts"]))
      .toEqual({ repo: "acme/api", sha: "s", related_paths: ["a.ts"] });
  });
});
