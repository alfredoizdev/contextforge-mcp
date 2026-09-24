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

export interface RecallItem {
  title: string;
  content_preview: string;
  space: string;
  created_at: string;
}

export interface RecallTask {
  short_id?: string;
  title: string;
  priority?: string;
  due_date?: string | null;
}

export const RECALL_MAX_ITEMS = 10;
export const RECALL_MAX_TASKS = 5;
const PREVIEW_MAX = 160;

function oneLine(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > PREVIEW_MAX ? flat.slice(0, PREVIEW_MAX).trimEnd() + "…" : flat;
}

/**
 * Plain-text block Claude Code appends to the model context after a
 * compaction. Pure function; returns "" when there is nothing to show.
 */
export function formatRecall(input: {
  projectName: string;
  items: RecallItem[];
  tasks: RecallTask[];
}): string {
  const items = input.items.slice(0, RECALL_MAX_ITEMS);
  const tasks = input.tasks.slice(0, RECALL_MAX_TASKS);
  if (items.length === 0 && tasks.length === 0) return "";

  const lines: string[] = [];
  lines.push("## ContextForge: context restored after compaction");
  lines.push(
    `The conversation was just compacted. These are the most recent saved memories for project "${input.projectName}". Treat them as current decisions.`,
  );
  if (items.length > 0) {
    lines.push("");
    lines.push("Recent memories:");
    for (const it of items) {
      const preview = oneLine(it.content_preview || "");
      lines.push(`- [${it.space}] ${oneLine(it.title)}${preview ? ` — ${preview}` : ""}`);
    }
  }
  if (tasks.length > 0) {
    lines.push("");
    lines.push("Pending tasks:");
    for (const t of tasks) {
      const meta = [t.priority, t.due_date ? `due ${t.due_date}` : undefined].filter(Boolean).join(", ");
      const id = t.short_id ? `[${t.short_id}] ` : "";
      lines.push(`- ${id}${oneLine(t.title)}${meta ? ` (${meta})` : ""}`);
    }
  }
  lines.push("");
  lines.push("For anything older or more specific, call memory_query before answering.");
  return lines.join("\n") + "\n";
}
