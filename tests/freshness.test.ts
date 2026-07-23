import { describe, it, expect } from "vitest";
import { pathTouched } from "../src/freshness.js";

describe("pathTouched", () => {
  it("matches exact file", () => {
    expect(pathTouched(["src/api.ts", "README.md"], ["src/api.ts"])).toBe(true);
  });
  it("matches directory prefix", () => {
    expect(pathTouched(["src/auth/token.ts"], ["src/auth"])).toBe(true);
  });
  it("no match when unrelated", () => {
    expect(pathTouched(["docs/x.md"], ["src/api.ts"])).toBe(false);
  });
  it("empty relatedPaths never matches", () => {
    expect(pathTouched(["a"], [])).toBe(false);
  });
});
