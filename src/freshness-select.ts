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

/**
 * Selects candidates whose related_paths were touched by a code change.
 *
 * `changedBySha` is keyed by each candidate's OWN stored `git.sha` (NOT by
 * repo) — every memory recorded the commit it was true as of, so it must be
 * diffed against `git diff <that memory's sha>..HEAD`, not against some
 * other memory's diff from the same repo. Callers should compute one
 * changed-files list per distinct sha and pass them all in this map.
 */
export function selectStale(
  candidates: Candidate[],
  changedBySha: Record<string, string[]>,
  opts: { max: number },
): FlaggedMemory[] {
  const out: FlaggedMemory[] = [];
  for (const c of candidates) {
    const changed = changedBySha[c.git.sha] ?? [];
    const hits = changed.filter((f) => pathTouched([f], c.git.related_paths));
    if (hits.length) out.push({ ...c, changed: hits });
    if (out.length >= opts.max) break;
  }
  return out;
}
