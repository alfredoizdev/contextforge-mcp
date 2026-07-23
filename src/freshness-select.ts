import { pathTouched } from "./freshness.js";

export interface Candidate {
  id: string;
  title: string;
  content: string;
  last_confirmed_at: string | null;
  git: { repo: string; sha: string; related_paths: string[] };
}

export interface FlaggedMemory extends Candidate {
  changed: string[];
}

export function selectStale(
  candidates: Candidate[],
  changedByRepo: Record<string, string[]>,
  opts: { max: number },
): FlaggedMemory[] {
  const out: FlaggedMemory[] = [];
  for (const c of candidates) {
    const changed = changedByRepo[c.git.repo] ?? [];
    const hits = changed.filter((f) => pathTouched([f], c.git.related_paths));
    if (hits.length) out.push({ ...c, changed: hits });
    if (out.length >= opts.max) break;
  }
  return out;
}
