import { describe, it, expect } from "vitest";
import { selectStale } from "../src/freshness-select.js";

const cand = (id: string, paths: string[]) =>
  ({ id, title: id, content: id, last_confirmed_at: null, git: { repo: "r", sha: "old", related_paths: paths } });

describe("selectStale", () => {
  it("flags only memories whose related paths changed", () => {
    const out = selectStale([cand("a", ["src/api.ts"]), cand("b", ["docs"])], { r: ["src/api.ts"] }, { max: 3 });
    expect(out.map((m) => m.id)).toEqual(["a"]);
  });
  it("caps at max", () => {
    const many = ["a", "b", "c", "d"].map((id) => cand(id, ["src/x.ts"]));
    expect(selectStale(many, { r: ["src/x.ts"] }, { max: 3 })).toHaveLength(3);
  });
});
