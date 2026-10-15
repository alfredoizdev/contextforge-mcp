import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { spawnSync } from "child_process";
import { buildWorkingContext, collectGitSignals, type GitSignals } from "../src/recall.js";

describe("buildWorkingContext", () => {
  it("returns empty when there is nothing to say", () => {
    expect(buildWorkingContext({})).toBe("");
    expect(buildWorkingContext({ git: { branch: "main", commits: [], changedFiles: [] } })).toBe("");
  });

  it("composes objective, latest, branch words, commits and file paths", () => {
    const git: GitSignals = {
      branch: "feat/retry-client_logic",
      commits: ["move retry into client", "drop redis cache"],
      changedFiles: ["src/payments/retry.ts", "tests/retry.test.ts"],
    };
    const q = buildWorkingContext({ objective: "Move the retry logic into the client", latest: "add backoff test", git });
    expect(q).toContain("Move the retry logic into the client");
    expect(q).toContain("add backoff test");
    expect(q).toContain("feat retry client logic");
    expect(q).toContain("drop redis cache");
    expect(q).toContain("src/payments/retry.ts");
    expect(q).not.toContain("main");
  });

  it("ignores main/master branch names and caps at 600 characters", () => {
    expect(buildWorkingContext({ git: { branch: "master", commits: ["x".repeat(50)], changedFiles: [] } })).toBe("x".repeat(50));
    const q = buildWorkingContext({ objective: "y".repeat(1000) });
    expect(q.length).toBe(600);
  });
});

const hasGit = spawnSync("git", ["--version"], { encoding: "utf-8" }).status === 0;

describe.skipIf(!hasGit)("collectGitSignals", () => {
  let repo: string;
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "cf-git-"));
    const run = (args: string[]) => spawnSync("git", args, { cwd: repo, encoding: "utf-8" });
    run(["init", "-q", "-b", "feat/signals"]);
    run(["config", "user.email", "t@t.t"]);
    run(["config", "user.name", "t"]);
    writeFileSync(join(repo, "a.ts"), "1");
    run(["add", "."]);
    run(["commit", "-q", "-m", "first commit subject"]);
    writeFileSync(join(repo, "a.ts"), "2");
    writeFileSync(join(repo, "b.ts"), "new");
  });
  afterEach(() => rmSync(repo, { recursive: true, force: true }));

  it("reads branch, commit subjects and changed files", () => {
    const g = collectGitSignals(repo)!;
    expect(g.branch).toBe("feat/signals");
    expect(g.commits).toEqual(["first commit subject"]);
    expect(g.changedFiles.sort()).toEqual(["a.ts", "b.ts"]);
  });

  it("returns null outside a repository", () => {
    const plain = mkdtempSync(join(tmpdir(), "cf-nogit-"));
    try {
      expect(collectGitSignals(plain)).toBeNull();
    } finally {
      rmSync(plain, { recursive: true, force: true });
    }
  });

  it("returns null for a non-existent directory", () => {
    expect(collectGitSignals(join(repo, "does-not-exist"))).toBeNull();
  });
});
