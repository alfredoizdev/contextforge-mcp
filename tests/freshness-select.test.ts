import { describe, it, expect } from "vitest";
import { selectStale } from "../src/freshness-select.js";

const cand = (id: string, sha: string, paths: string[]) =>
  ({
    id,
    title: id,
    content: id,
    last_confirmed_at: null,
    git: { repo: "r", sha, related_paths: paths },
  });

describe("selectStale", () => {
  it("flags only memories whose related paths changed", () => {
    const out = selectStale(
      [cand("a", "sha1", ["src/api.ts"]), cand("b", "sha1", ["docs"])],
      { sha1: ["src/api.ts"] },
      { max: 3 },
    );
    expect(out.map((m) => m.id)).toEqual(["a"]);
  });

  it("caps at max", () => {
    const many = ["a", "b", "c", "d"].map((id) => cand(id, "sha1", ["src/x.ts"]));
    expect(selectStale(many, { sha1: ["src/x.ts"] }, { max: 3 })).toHaveLength(3);
  });

  it("diffs each candidate against its OWN stored sha, not one shared sha for the repo", () => {
    // Same repo, two candidates saved at different commits. sha-old's diff
    // touches memory A's related_paths; sha-new's diff does NOT touch
    // memory B's related_paths (it only touched unrelated files). If both
    // were (incorrectly) compared against a single arbitrary sha for the
    // repo, either both or neither would flag — instead exactly A flags.
    const candidates = [
      cand("memory-a", "sha-old", ["src/api.ts"]),
      cand("memory-b", "sha-new", ["src/other.ts"]),
    ];
    const changedBySha = {
      "sha-old": ["src/api.ts"], // matches memory-a's related_paths
      "sha-new": ["docs/readme.md"], // does NOT match memory-b's related_paths
    };
    const out = selectStale(candidates, changedBySha, { max: 3 });
    expect(out.map((m) => m.id)).toEqual(["memory-a"]);
  });
});
