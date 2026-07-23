import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { homedir } from "os";
import { STARTUP_MARKER } from "./init.js";

const DEFAULT_CACHE_FILE = join(
  homedir(),
  ".cache",
  "contextforge",
  "init-hint.json",
);

/** Bump when a new init section ships, to re-nudge users who dismissed the old hint. */
export const HINT_VERSION = 3;

/** One-time tip appended to the first tool response of a session. */
export const INIT_HINT_TEXT =
  "\n\n💡 New: run `npx contextforge-mcp init` in this project to add the Startup Context rule to CLAUDE.md — Claude will load your project overview, open tasks, and live sessions automatically at the start of each conversation. (Shown once per project.)";

interface HintCache {
  version?: number;
  shownFor: string[];
}

function readCache(cacheFile: string): HintCache {
  try {
    const parsed = JSON.parse(readFileSync(cacheFile, "utf-8")) as HintCache;
    return {
      version: typeof parsed?.version === "number" ? parsed.version : 0,
      shownFor: Array.isArray(parsed?.shownFor) ? parsed.shownFor : [],
    };
  } catch {
    return { version: 0, shownFor: [] };
  }
}

/** Record that the hint was shown for this project path. Silent-fail. */
export function markInitHintShown(
  cwd: string,
  cacheFile: string = DEFAULT_CACHE_FILE,
): void {
  try {
    const cache = readCache(cacheFile);
    const shownFor = cache.version === HINT_VERSION ? cache.shownFor : [];
    if (!shownFor.includes(cwd)) shownFor.push(cwd);
    mkdirSync(dirname(cacheFile), { recursive: true });
    writeFileSync(
      cacheFile,
      JSON.stringify({ version: HINT_VERSION, shownFor }),
    );
  } catch {
    // Silent — must never crash the MCP server.
  }
}

/**
 * Returns the hint if this project's CLAUDE.md lacks the startup marker
 * AND the hint has not been shown for this project under the current hint
 * version before; otherwise null. A cache written under an older hint
 * version re-nudges once, since it predates whatever shipped in the bump.
 * All failures return null (never crash, never slow the server).
 */
export function computeInitHint(
  cwd: string,
  cacheFile: string = DEFAULT_CACHE_FILE,
): string | null {
  try {
    // Claude Desktop bundles have no CLAUDE.md workflow — the MCPB manifest
    // sets this env var so desktop users never see the init tip.
    if (process.env.CONTEXTFORGE_DISABLE_INIT_HINT === "1") return null;
    const claudeMd = join(cwd, "CLAUDE.md");
    if (
      existsSync(claudeMd) &&
      readFileSync(claudeMd, "utf-8").includes(STARTUP_MARKER)
    ) {
      return null;
    }
    const cache = readCache(cacheFile);
    // A cache from an older hint version has stale per-project flags — re-nudge once.
    const shownForThisVersion =
      cache.version === HINT_VERSION ? cache.shownFor : [];
    if (shownForThisVersion.includes(cwd)) return null;
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
