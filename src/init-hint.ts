import { existsSync, readFileSync, writeFileSync, mkdirSync, openSync, readSync, closeSync } from "fs";
import { dirname, join } from "path";
import { homedir } from "os";
import { STARTUP_MARKER } from "./init.js";
import {
  OBJECTIVE_HOOK_RELATIVE_PATH,
  OBJECTIVE_HOOK_VERSION,
} from "./objective-hook.js";

const DEFAULT_CACHE_FILE = join(
  homedir(),
  ".cache",
  "contextforge",
  "init-hint.json",
);

const DEFAULT_HOOK_CACHE_FILE = join(
  homedir(),
  ".cache",
  "contextforge",
  "hook-hint.json",
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

// ---- Hook hint (0.13.2): recall hook present, objective hook missing/old ----

/** One-time tip for projects that have the recall hook (0.12.0) but not the current objective hook (0.13.0+). */
export const HOOK_HINT_TEXT =
  "\n\n💡 ContextForge: this project has the post-compaction recall hook but not the session objective hook (or an older version of it). Run `npx contextforge-mcp init` once here to add it — it only adds what is missing. (Shown once per project.)";

/** True when `<cwd>/.claude/settings.json` has a SessionStart hook that runs `contextforge-mcp recall`. Never throws. */
function hasRecallHook(cwd: string): boolean {
  try {
    const raw = readFileSync(join(cwd, ".claude", "settings.json"), "utf-8");
    const parsed = JSON.parse(raw) as { hooks?: { SessionStart?: unknown } };
    const groups = parsed?.hooks?.SessionStart;
    if (!Array.isArray(groups)) return false;
    return groups.some((g) => {
      const hooks = (g as { hooks?: unknown })?.hooks;
      return (
        Array.isArray(hooks) &&
        hooks.some((h) => {
          const command = (h as { command?: unknown })?.command;
          return (
            typeof command === "string" &&
            /contextforge-mcp(@\S+)?\s+recall\b/.test(command)
          );
        })
      );
    });
  } catch {
    return false;
  }
}

/** True when the generated objective script exists and its header names the current version. */
function hasCurrentObjectiveScript(cwd: string): boolean {
  let fd: number | null = null;
  try {
    // Only the header line matters; read a bounded prefix instead of the whole file.
    fd = openSync(join(cwd, OBJECTIVE_HOOK_RELATIVE_PATH), "r");
    const buf = Buffer.alloc(256);
    const n = readSync(fd, buf, 0, buf.length, 0);
    const head = buf.toString("utf-8", 0, n).split("\n", 1)[0] ?? "";
    return head.includes(`objective hook v${OBJECTIVE_HOOK_VERSION}`);
  } catch {
    return false;
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
        /* ignore */
      }
    }
  }
}

/**
 * Returns HOOK_HINT_TEXT when the project runs the recall hook but lacks the
 * current objective hook script, and the hint was not yet shown for this
 * project under the current script version. All failures return null.
 */
export function computeHookHint(
  cwd: string,
  cacheFile: string = DEFAULT_HOOK_CACHE_FILE,
): string | null {
  try {
    if (process.env.CONTEXTFORGE_DISABLE_INIT_HINT === "1") return null;
    if (!hasRecallHook(cwd)) return null;
    if (hasCurrentObjectiveScript(cwd)) return null;
    const cache = readCache(cacheFile);
    // Keyed under the script version so a future bump re-nudges once per project.
    const shown =
      cache.version === OBJECTIVE_HOOK_VERSION ? cache.shownFor : [];
    if (shown.includes(cwd)) return null;
    return HOOK_HINT_TEXT;
  } catch {
    return null;
  }
}

/** Record that the hook hint was shown for this project path. Silent-fail. */
export function markHookHintShown(
  cwd: string,
  cacheFile: string = DEFAULT_HOOK_CACHE_FILE,
): void {
  try {
    const cache = readCache(cacheFile);
    const shownFor =
      cache.version === OBJECTIVE_HOOK_VERSION ? cache.shownFor : [];
    if (!shownFor.includes(cwd)) shownFor.push(cwd);
    mkdirSync(dirname(cacheFile), { recursive: true });
    writeFileSync(
      cacheFile,
      JSON.stringify({ version: OBJECTIVE_HOOK_VERSION, shownFor }),
    );
  } catch {
    // Silent — must never crash the MCP server.
  }
}

let pendingHookHint: string | null = null;
let pendingHookCwd = "";

/** Call once at server startup, next to checkInitHint. */
export function checkHookHint(
  cwd: string,
  cacheFile: string = DEFAULT_HOOK_CACHE_FILE,
): void {
  pendingHookHint = computeHookHint(cwd, cacheFile);
  pendingHookCwd = cwd;
}

/** Returns the hook hint once (marking it shown in the cache), then always "". */
export function consumeHookHint(
  cacheFile: string = DEFAULT_HOOK_CACHE_FILE,
): string {
  if (!pendingHookHint) return "";
  const hint = pendingHookHint;
  pendingHookHint = null;
  markHookHintShown(pendingHookCwd, cacheFile);
  pendingHookCwd = "";
  return hint;
}
