import { execFileSync } from "child_process";

export function pathTouched(changedFiles: string[], relatedPaths: string[]): boolean {
  if (!relatedPaths.length) return false;
  return changedFiles.some((f) =>
    relatedPaths.some((p) => f === p || f.startsWith(p.endsWith("/") ? p : p + "/")),
  );
}

function git(args: string[], cwd?: string): string | null {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch { return null; }
}

export function currentGit(cwd: string = process.cwd()): { repo: string; sha: string } | null {
  const sha = git(["rev-parse", "HEAD"], cwd);
  if (!sha) return null;
  const url = git(["remote", "get-url", "origin"], cwd) ?? "local";
  const repo = url.replace(/^git@[^:]+:/, "").replace(/^https?:\/\/[^/]+\//, "").replace(/\.git$/, "");
  return { repo, sha };
}

export function changedSince(sha: string, cwd: string = process.cwd()): string[] {
  const out = git(["diff", "--name-only", `${sha}..HEAD`], cwd);
  return out ? out.split("\n").filter(Boolean) : [];
}

export interface GitContext {
  repo: string;
  sha: string;
  related_paths: string[];
}

export function buildGitContext(
  git: { repo: string; sha: string } | null,
  relatedPaths: string[],
): GitContext | null {
  return git ? { ...git, related_paths: relatedPaths ?? [] } : null;
}
