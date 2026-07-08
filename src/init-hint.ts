import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { homedir } from "os";
import { PRESENCE_MARKER } from "./init.js";

const DEFAULT_CACHE_FILE = join(
  homedir(),
  ".cache",
  "contextforge",
  "init-hint.json",
);

/** One-time tip appended to the first tool response of a session. */
export const INIT_HINT_TEXT =
  "\n\n💡 New: run `npx contextforge-mcp init` in this project to add Session Presence coordination rules to CLAUDE.md — your parallel sessions will then check for each other automatically. (Shown once per project.)";

interface HintCache {
  shownFor: string[];
}

function readCache(cacheFile: string): HintCache {
  try {
    const parsed = JSON.parse(readFileSync(cacheFile, "utf-8")) as HintCache;
    return Array.isArray(parsed?.shownFor) ? parsed : { shownFor: [] };
  } catch {
    return { shownFor: [] };
  }
}

/** Record that the hint was shown for this project path. Silent-fail. */
export function markInitHintShown(
  cwd: string,
  cacheFile: string = DEFAULT_CACHE_FILE,
): void {
  try {
    const cache = readCache(cacheFile);
    if (!cache.shownFor.includes(cwd)) cache.shownFor.push(cwd);
    mkdirSync(dirname(cacheFile), { recursive: true });
    writeFileSync(cacheFile, JSON.stringify(cache));
  } catch {
    // Silent — must never crash the MCP server.
  }
}

/**
 * Returns the hint if this project's CLAUDE.md lacks the presence marker
 * AND the hint has not been shown for this project before; otherwise null.
 * All failures return null (never crash, never slow the server).
 */
export function computeInitHint(
  cwd: string,
  cacheFile: string = DEFAULT_CACHE_FILE,
): string | null {
  try {
    const claudeMd = join(cwd, "CLAUDE.md");
    if (
      existsSync(claudeMd) &&
      readFileSync(claudeMd, "utf-8").includes(PRESENCE_MARKER)
    ) {
      return null;
    }
    if (readCache(cacheFile).shownFor.includes(cwd)) return null;
    return INIT_HINT_TEXT;
  } catch {
    return null;
  }
}

// ---- Module-level session state (used by index.ts) ----

let pendingHint: string | null = null;
let pendingCwd = "";

/** Call once at server startup. */
export function checkInitHint(
  cwd: string,
  cacheFile: string = DEFAULT_CACHE_FILE,
): void {
  pendingHint = computeInitHint(cwd, cacheFile);
  pendingCwd = cwd;
}

/** Returns the hint once (marking it shown in the cache), then always "". */
export function consumeInitHint(
  cacheFile: string = DEFAULT_CACHE_FILE,
): string {
  if (!pendingHint) return "";
  const hint = pendingHint;
  pendingHint = null;
  markInitHintShown(pendingCwd, cacheFile);
  pendingCwd = "";
  return hint;
}
