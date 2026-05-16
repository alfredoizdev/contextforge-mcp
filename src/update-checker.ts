import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

interface UpdateCache {
  lastCheck: number;
  latestVersion: string;
}

const CACHE_DIR = join(homedir(), ".cache", "contextforge");
const CACHE_FILE = join(CACHE_DIR, "update-check.json");
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours

function readCache(): UpdateCache | null {
  try {
    const raw = readFileSync(CACHE_FILE, "utf-8");
    return JSON.parse(raw) as UpdateCache;
  } catch {
    return null;
  }
}

function writeCache(cache: UpdateCache): void {
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(CACHE_FILE, JSON.stringify(cache));
  } catch {
    // Silent fail
  }
}

/** Cached update message, set once at startup */
let updateMessage: string | null = null;

/**
 * Check npm for a newer version. Stores result internally.
 * Call getUpdateNotice() later to retrieve the message.
 */
export async function checkForUpdates(
  currentVersion: string,
  colors: Record<string, string>,
): Promise<void> {
  try {
    let latestVersion: string | null = null;

    // Check cache first
    const cache = readCache();
    if (cache && Date.now() - cache.lastCheck < CHECK_INTERVAL_MS) {
      latestVersion = cache.latestVersion;
    } else {
      // Fetch from npm with 3s timeout
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);

      try {
        const res = await fetch(
          "https://registry.npmjs.org/contextforge-mcp/latest",
          { signal: controller.signal },
        );
        const data = (await res.json()) as { version: string };
        latestVersion = data.version;
        writeCache({ lastCheck: Date.now(), latestVersion });
      } finally {
        clearTimeout(timeout);
      }
    }

    if (latestVersion && latestVersion !== currentVersion) {
      updateMessage = `\n⚠️ Update available: ${currentVersion} → ${latestVersion} — Run: npm update -g contextforge-mcp`;
      // Also log to stderr for debugging
      console.error(
        `${colors.yellow}⚠ Update available: ${currentVersion} → ${latestVersion}${colors.reset}`,
      );
      console.error(
        `${colors.dim}  Run: npm update -g contextforge-mcp${colors.reset}`,
      );
      console.error("");
    }
  } catch {
    // Silent fail — must never crash the MCP server
  }
}

/**
 * Returns update notice string to append to tool responses, or empty string.
 */
export function getUpdateNotice(): string {
  return updateMessage || "";
}
