import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { ApiClient, readProjectLinkConfig } from "./api-client.js";

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

export const DEFAULT_API_URL = "https://byzngcpqiqmqpxpmnhmo.supabase.co";
export const RECALL_TIMEOUT_MS = 8000;

export interface RecallClient {
  listSpaces(
    projectId?: string,
    spaceType?: "regular" | "git" | "all",
  ): Promise<Array<{ name: string }>>;
  listItems(spaceId?: string, limit?: number): Promise<{ items: RecallItem[] }>;
  listTasks(input: { status?: string; limit?: number }): Promise<{ issues: RecallTask[] }>;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("recall timeout")), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

/**
 * Fetch and format the post-compaction context block. Never rejects; any
 * failure resolves to "" so the hook can never break a session.
 */
export async function runRecall(opts: {
  cwd: string;
  env: NodeJS.ProcessEnv;
  homeDir: string;
  timeoutMs?: number;
  makeClient?: (apiKey: string, apiUrl: string) => RecallClient;
}): Promise<string> {
  try {
    const apiKey = resolveApiKey({ env: opts.env, homeDir: opts.homeDir, cwd: opts.cwd });
    if (!apiKey) return "";

    const link = readProjectLinkConfig(opts.cwd);
    if (!link?.project_id) return "";

    const apiUrl = opts.env.CONTEXTFORGE_API_URL || DEFAULT_API_URL;
    const client =
      opts.makeClient?.(apiKey, apiUrl) ??
      (new ApiClient({ apiKey, apiUrl }) as unknown as RecallClient);

    const work = (async () => {
      const spaces = await client.listSpaces(link.project_id, "regular");
      const names = new Set(spaces.map((s) => s.name));
      const { items } = await client.listItems(undefined, 50);
      const scoped = items.filter((it) => names.has(it.space)).slice(0, RECALL_MAX_ITEMS);

      let tasks: RecallTask[] = [];
      try {
        const res = await client.listTasks({ status: "pending", limit: RECALL_MAX_TASKS });
        tasks = res.issues ?? [];
      } catch {
        tasks = [];
      }

      return formatRecall({ projectName: link.project_name || link.project_id, items: scoped, tasks });
    })();

    return await withTimeout(work, opts.timeoutMs ?? RECALL_TIMEOUT_MS);
  } catch {
    return "";
  }
}
