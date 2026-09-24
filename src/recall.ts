import { existsSync, readFileSync } from "fs";
import { join } from "path";

/** Exact hook command written by `init`. Keep in sync with README. */
export const RECALL_COMMAND = "npx -y contextforge-mcp recall";

interface McpServersFile {
  mcpServers?: Record<string, { env?: Record<string, string> }>;
}

/**
 * Read CONTEXTFORGE_API_KEY from an MCP-servers style JSON file
 * (`~/.claude.json` or a project `.mcp.json`). Prefers the server named
 * exactly `contextforge`; otherwise the first server whose name starts with
 * `contextforge`. Never throws.
 */
export function readMcpServerKey(filePath: string): string | undefined {
  if (!existsSync(filePath)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf-8")) as McpServersFile;
    const servers = parsed.mcpServers ?? {};
    const exact = servers["contextforge"]?.env?.CONTEXTFORGE_API_KEY;
    if (exact) return exact;
    for (const [name, server] of Object.entries(servers)) {
      if (name.startsWith("contextforge")) {
        const key = server?.env?.CONTEXTFORGE_API_KEY;
        if (key) return key;
      }
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Resolve the API key for the recall hook. The hook runs as a shell command,
 * so the MCP server's env vars are NOT in scope; we look where
 * `claude mcp add` stores them.
 *
 * Order: env var → ~/.claude.json → <cwd>/.mcp.json.
 */
export function resolveApiKey(opts: {
  env: NodeJS.ProcessEnv;
  homeDir: string;
  cwd: string;
}): string | undefined {
  if (opts.env.CONTEXTFORGE_API_KEY) return opts.env.CONTEXTFORGE_API_KEY;
  return (
    readMcpServerKey(join(opts.homeDir, ".claude.json")) ??
    readMcpServerKey(join(opts.cwd, ".mcp.json"))
  );
}
