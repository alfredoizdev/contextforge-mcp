#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import {
  ApiClient,
  ApiClientError,
  readProjectLinkConfig,
  getConfigFilePath,
} from "./api-client.js";
import {
  ConfigSchema,
  IngestInputSchema,
  QueryInputSchema,
  CreateProjectInputSchema,
  CreateSpaceInputSchema,
  RelateInputSchema,
  ListRelationshipsInputSchema,
  DeleteInputSchema,
  GitConnectInputSchema,
  GitActivateInputSchema,
  GitDisconnectInputSchema,
  GitSyncInputSchema,
  GitHistoryInputSchema,
  SnapshotCreateInputSchema,
  SnapshotRestoreInputSchema,
  SnapshotDeleteInputSchema,
  ExportInputSchema,
  ImportInputSchema,
  IngestBatchInputSchema,
  DeleteBatchInputSchema,
  LinkProjectInputSchema,
  SkillsListInputSchema,
  SkillsGetInputSchema,
  SkillsCreateInputSchema,
  SkillsUpdateInputSchema,
  SkillsDeleteInputSchema,
  SkillsRunInputSchema,
  RoutinesListInputSchema,
  RoutinesGetInputSchema,
  RoutinesCreateInputSchema,
  RoutinesUpdateInputSchema,
  RoutinesToggleInputSchema,
  RoutinesRunNowInputSchema,
  RoutinesDeleteInputSchema,
  parseArrayInput,
} from "./types.js";
import type { Config } from "./types.js";
import { resolveTaskId, resolveTaskTitle, resolveTaskIdentifier } from "./task-params.js";

import { appendFileSync } from "fs";
import { createRequire } from "module";
import { checkForUpdates, getUpdateNotice } from "./update-checker.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json");
const VERSION: string = pkg.version;

// ============ Logger with Colors ============

const LOG_FILE =
  process.env.CONTEXTFORGE_LOG_FILE || "/tmp/contextforge-mcp.log";

const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  bgBlue: "\x1b[44m",
  bgGreen: "\x1b[42m",
  bgYellow: "\x1b[43m",
  bgRed: "\x1b[41m",
};

function log(icon: string, message: string, color: string = colors.white) {
  const timestamp = new Date().toLocaleTimeString();
  const logLine = `${colors.dim}[${timestamp}]${colors.reset} ${icon} ${color}${message}${colors.reset}`;
  console.error(logLine);

  // Also write to log file (without colors)
  const plainLine = `[${timestamp}] ${icon} ${message}\n`;
  try {
    appendFileSync(LOG_FILE, plainLine);
  } catch {
    // Ignore file write errors
  }
}

function logTool(toolName: string, details?: string) {
  const icons: Record<string, string> = {
    memory_ingest: "📥",
    memory_query: "🔍",
    memory_get_item: "📖",
    memory_list_projects: "🗂️",
    memory_create_project: "📁",
    memory_list_spaces: "📂",
    memory_list_items: "📋",
    memory_create_space: "✨",
    memory_move_space: "📦",
    memory_delete_space: "🗑️",
    memory_delete_project: "🗑️",
    memory_relate: "🔗",
    memory_delete: "🗑️",
    memory_stats: "📊",
    memory_help: "❓",
    memory_git_connect: "🔌",
    memory_git_list: "📡",
    memory_git_activate: "✅",
    memory_git_disconnect: "🔌",
    memory_git_sync: "🔄",
    memory_git_commits: "📝",
    memory_git_prs: "🔀",
    memory_snapshot_create: "📸",
    memory_snapshot_list: "🗂️",
    memory_snapshot_restore: "⏪",
    memory_snapshot_delete: "🗑️",
    memory_export: "📤",
    memory_import: "📥",
    memory_ingest_batch: "📦",
    memory_delete_batch: "🗑️",
    memory_link_project: "🔗",
    memory_unlink_project: "🔓",
    memory_current_project: "📍",
    tasks_list: "📋",
    tasks_start: "▶️",
    tasks_resolve: "✅",
    tasks_what_next: "🎯",
    tasks_create: "➕",
    tasks_assign: "👤",
    tasks_resolve_by_name: "✅",
    tasks_delete: "🗑️",
    tasks_list_comments: "💬",
    tasks_add_comment: "💬",
    collaborators_list: "👥",
    project_share: "🔗",
    skills_list: "🧰",
    skills_get: "🔧",
    skills_create: "➕",
    skills_update: "✏️",
    skills_delete: "🗑️",
    skills_run: "▶️",
    routines_list: "📅",
    routines_get: "🔍",
    routines_create: "➕",
    routines_update: "✏️",
    routines_toggle: "⏯",
    routines_run_now: "▶",
    routines_delete: "🗑️",
  };
  const icon = icons[toolName] || "🔧";
  log(
    icon,
    `${colors.bright}${toolName}${colors.reset}${details ? ` ${colors.dim}${details}${colors.reset}` : ""}`,
    colors.cyan,
  );
}

function logSuccess(message: string) {
  log("✅", message, colors.green);
}

function logError(message: string) {
  log("❌", message, colors.red);
}

function logInfo(message: string) {
  log("ℹ️", message, colors.blue);
}

// ============ Response Formatter ============

/**
 * Formats a response object into a clean, human-readable text format.
 * Puts the main message first, followed by key details in a structured format.
 */
function formatResponse(data: {
  message: string;
  hint?: string;
  details?: Record<string, unknown>;
}): string {
  const lines: string[] = [data.message];

  if (data.details && Object.keys(data.details).length > 0) {
    lines.push("");
    for (const [key, value] of Object.entries(data.details)) {
      if (value !== undefined && value !== null) {
        const formattedKey = key
          .replace(/_/g, " ")
          .replace(/\b\w/g, (l) => l.toUpperCase());
        if (Array.isArray(value)) {
          lines.push(`${formattedKey}: ${value.length} items`);
        } else if (typeof value === "object") {
          lines.push(`${formattedKey}: ${JSON.stringify(value)}`);
        } else {
          lines.push(`${formattedKey}: ${value}`);
        }
      }
    }
  }

  if (data.hint) {
    lines.push("");
    lines.push(`💡 ${data.hint}`);
  }

  return lines.join("\n");
}

/**
 * Get the dashboard URL for a task by its UUID
 */
function getTaskDashboardUrl(taskId: string): string {
  const apiUrl = process.env.CONTEXTFORGE_API_URL || "";
  const baseUrl =
    apiUrl.includes("localhost") || apiUrl.includes("127.0.0.1")
      ? "http://localhost:3001"
      : "https://contextforge.dev";
  return `${baseUrl}/dashboard/tasks/${taskId}`;
}

// ============ Configuration ============

function loadConfig(): Config {
  const apiKey = process.env.CONTEXTFORGE_API_KEY;
  const apiUrl =
    process.env.CONTEXTFORGE_API_URL ??
    "https://byzngcpqiqmqpxpmnhmo.supabase.co";
  const defaultSpace = process.env.CONTEXTFORGE_DEFAULT_SPACE;

  const result = ConfigSchema.safeParse({
    apiKey,
    apiUrl,
    defaultSpace,
  });

  if (!result.success) {
    console.error("Configuration error:", result.error.format());
    console.error("\nRequired environment variables:");
    console.error("  CONTEXTFORGE_API_KEY - Your ContextForge API key");
    console.error("\nOptional environment variables:");
    console.error(
      "  CONTEXTFORGE_API_URL - API URL (default: https://byzngcpqiqmqpxpmnhmo.supabase.co)",
    );
    console.error("  CONTEXTFORGE_DEFAULT_SPACE - Default space UUID");
    process.exit(1);
  }

  return result.data;
}

// ============ Tool Definitions ============

const TOOLS = [
  {
    name: "memory_ingest",
    description:
      "Add content to the contextual memory. Use this to store code snippets, documentation, decisions, or any knowledge you want to remember.",
    annotations: { title: "Save to Memory", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    inputSchema: {
      type: "object" as const,
      properties: {
        content: {
          type: "string",
          description: "The content to store in memory",
        },
        title: {
          type: "string",
          description: "Optional title for the content",
        },
        source_type: {
          type: "string",
          enum: ["manual", "url", "file_upload", "api_ingestion"],
          description: "Type of source (default: manual)",
        },
        source_uri: {
          type: "string",
          description: "Optional source URI (file path, URL, etc.)",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Optional tags for categorization",
        },
        category: {
          type: "string",
          description: "Optional category",
        },
        space_id: {
          type: "string",
          description: "Space UUID (uses default if not specified)",
        },
      },
      required: ["content"],
    },
  },
  {
    name: "memory_query",
    description:
      "Search the contextual memory using semantic search. Returns the most relevant stored content based on your query.",
    annotations: { title: "Search Memory", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "The search query",
        },
        space_id: {
          type: "string",
          description: "Space UUID (uses default if not specified)",
        },
        project_id: {
          type: "string",
          description:
            "Filter to spaces within this project (auto-set from linked project if not specified)",
        },
        limit: {
          type: "number",
          description: "Maximum number of results (1-50, default: 10)",
        },
        min_score: {
          type: "number",
          description: "Minimum similarity score (0-1, default: 0.3)",
        },
        filters: {
          type: "object",
          properties: {
            tags: {
              type: "array",
              items: { type: "string" },
              description: "Filter by tags",
            },
            source_types: {
              type: "array",
              items: { type: "string" },
              description: "Filter by source types",
            },
            category: {
              type: "string",
              description: "Filter by category",
            },
          },
          description: "Optional filters",
        },
        include_relationships: {
          type: "boolean",
          description: "Include related items (default: false)",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "memory_get_item",
    description:
      "Get the full content of a knowledge item by its ID. Use this when memory_query returns truncated previews and you need the complete content.",
    annotations: { title: "Get Memory Item", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: "object" as const,
      properties: {
        id: {
          type: "string",
          description: "The UUID of the knowledge item to retrieve",
        },
      },
      required: ["id"],
    },
  },
  // ============ Projects ============
  {
    name: "memory_list_projects",
    description:
      "List all projects. Projects contain multiple spaces for organizing knowledge by project.",
    annotations: { title: "List Projects", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "memory_create_project",
    description: "Create a new project to organize related spaces",
    annotations: { title: "Create Project", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    inputSchema: {
      type: "object" as const,
      properties: {
        name: {
          type: "string",
          description: "Name of the project",
        },
        description: {
          type: "string",
          description: "Optional description",
        },
      },
      required: ["name"],
    },
  },
  // ============ Spaces ============
  {
    name: "memory_list_spaces",
    description:
      'List knowledge spaces (workspaces). By default shows only knowledge spaces. Use space_type "git" for GitHub repos, or "all" to see everything.',
    annotations: { title: "List Spaces", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: "object" as const,
      properties: {
        project_id: {
          type: "string",
          description: "Filter by project UUID (optional)",
        },
        project_name: {
          type: "string",
          description: "Filter by project name (optional)",
        },
        space_type: {
          type: "string",
          enum: ["regular", "git", "all"],
          description:
            'Filter by space type: "regular" for knowledge spaces (default), "git" for GitHub repository spaces, "all" for both',
        },
      },
      required: [],
    },
  },
  {
    name: "memory_create_space",
    description:
      "Create a new memory space (workspace) for organizing knowledge",
    annotations: { title: "Create Space", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    inputSchema: {
      type: "object" as const,
      properties: {
        name: {
          type: "string",
          description: "Name of the space",
        },
        description: {
          type: "string",
          description: "Optional description",
        },
        project_id: {
          type: "string",
          description: "Project UUID to create space in (optional)",
        },
        project_name: {
          type: "string",
          description: "Project name to create space in (optional)",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "memory_move_space",
    description: "Move a space to a different project",
    annotations: { title: "Move Space", readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: "object" as const,
      properties: {
        space: {
          type: "string",
          description: "Space name or UUID to move",
        },
        target_project: {
          type: "string",
          description: "Target project name or UUID",
        },
      },
      required: ["space", "target_project"],
    },
  },
  {
    name: "memory_delete_space",
    description:
      "Delete a space and all its items permanently. This action cannot be undone.",
    annotations: { title: "Delete Space", readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: "object" as const,
      properties: {
        space: {
          type: "string",
          description: "Space name or UUID to delete",
        },
      },
      required: ["space"],
    },
  },
  {
    name: "memory_delete_project",
    description:
      "Delete a project and all its spaces permanently. This will delete all spaces and their items within the project. This action cannot be undone.",
    annotations: { title: "Delete Project", readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: "object" as const,
      properties: {
        project: {
          type: "string",
          description: "Project name or UUID to delete",
        },
      },
      required: ["project"],
    },
  },
  {
    name: "memory_relate",
    description: "Create a relationship between two knowledge items",
    annotations: { title: "Relate Memory Items", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    inputSchema: {
      type: "object" as const,
      properties: {
        source_id: {
          type: "string",
          description: "Source item UUID",
        },
        target_id: {
          type: "string",
          description: "Target item UUID",
        },
        relationship_type: {
          type: "string",
          enum: [
            "references",
            "implements",
            "extends",
            "depends_on",
            "related_to",
            "contradicts",
            "supersedes",
            "part_of",
            "similar_to",
            "derived_from",
          ],
          description: "Type of relationship",
        },
        weight: {
          type: "number",
          description: "Relationship weight (0-1, default: 0.5)",
        },
        bidirectional: {
          type: "boolean",
          description:
            "Create relationship in both directions (default: false)",
        },
      },
      required: ["source_id", "target_id", "relationship_type"],
    },
  },
  {
    name: "memory_list_relationships",
    description:
      "List all relationships for a knowledge item, showing both incoming and outgoing connections with related item details",
    annotations: { title: "List Relationships", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: "object" as const,
      properties: {
        item_id: {
          type: "string",
          description: "UUID of the knowledge item to list relationships for",
        },
      },
      required: ["item_id"],
    },
  },
  {
    name: "memory_delete",
    description: "Delete a knowledge item from memory by ID or title",
    annotations: { title: "Delete Memory Item", readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: "object" as const,
      properties: {
        id: {
          type: "string",
          description: "Item UUID to delete (optional if title is provided)",
        },
        title: {
          type: "string",
          description:
            "Item title to search and delete (optional if id is provided)",
        },
        space_id: {
          type: "string",
          description: "Space UUID to narrow down title search (optional)",
        },
        cascade: {
          type: "boolean",
          description: "Also delete related relationships (default: false)",
        },
      },
      required: [],
    },
  },
  {
    name: "memory_stats",
    description: "Get statistics about memory usage",
    annotations: { title: "Memory Stats", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: "object" as const,
      properties: {
        space_id: {
          type: "string",
          description: "Space UUID (optional, shows all if not specified)",
        },
      },
      required: [],
    },
  },
  {
    name: "memory_list_items",
    description:
      "List all items stored in memory. Shows titles, previews, tags, and creation dates.",
    annotations: { title: "List Memory Items", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: "object" as const,
      properties: {
        space_id: {
          type: "string",
          description:
            "Space UUID (optional, lists all spaces if not specified)",
        },
        limit: {
          type: "number",
          description: "Maximum number of items to return (1-100, default: 50)",
        },
        offset: {
          type: "number",
          description: "Number of items to skip (for pagination, default: 0)",
        },
      },
      required: [],
    },
  },
  {
    name: "memory_help",
    description:
      "Show help and usage instructions for ContextForge memory commands",
    annotations: { title: "Memory Help", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  // ============ Git Integration Tools ============
  {
    name: "memory_git_connect",
    description:
      "Connect a GitHub repository to automatically sync commits and PRs to memory",
    annotations: { title: "Connect GitHub Repo", readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    inputSchema: {
      type: "object" as const,
      properties: {
        repo_url: {
          type: "string",
          description:
            'GitHub repository URL or owner/repo format (e.g., "owner/repo" or "https://github.com/owner/repo")',
        },
        space_id: {
          type: "string",
          description: "Space UUID where git knowledge will be stored",
        },
      },
      required: ["repo_url", "space_id"],
    },
  },
  {
    name: "memory_git_list",
    description: "List all connected GitHub repositories",
    annotations: { title: "List GitHub Repos", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: "object" as const,
      properties: {
        space_id: {
          type: "string",
          description: "Filter by space UUID (optional)",
        },
      },
      required: [],
    },
  },
  {
    name: "memory_git_activate",
    description:
      "Activate or deactivate a connected repository webhook after setup",
    annotations: { title: "Activate GitHub Repo", readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: "object" as const,
      properties: {
        repository_id: {
          type: "string",
          description: "Repository UUID (optional if repo is provided)",
        },
        repo: {
          type: "string",
          description:
            "Repository name in owner/repo format (optional if repository_id is provided)",
        },
        active: {
          type: "boolean",
          description:
            "Set to true to activate, false to deactivate (default: true)",
        },
      },
      required: [],
    },
  },
  {
    name: "memory_git_disconnect",
    description: "Disconnect a GitHub repository and stop syncing",
    annotations: { title: "Disconnect GitHub Repo", readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: "object" as const,
      properties: {
        repository_id: {
          type: "string",
          description: "Repository UUID (optional if repo is provided)",
        },
        repo: {
          type: "string",
          description:
            "Repository name in owner/repo format (optional if repository_id is provided)",
        },
      },
      required: [],
    },
  },
  {
    name: "memory_git_sync",
    description:
      "Sync existing commits and PRs from a connected GitHub repository into memory",
    annotations: { title: "Sync GitHub Repo", readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    inputSchema: {
      type: "object" as const,
      properties: {
        repository_id: {
          type: "string",
          description: "Repository UUID (optional if repo is provided)",
        },
        repo: {
          type: "string",
          description:
            "Repository name in owner/repo format (optional if repository_id is provided)",
        },
        sync_type: {
          type: "string",
          enum: ["commits", "prs", "all"],
          description: "What to sync: commits, prs, or all (default: all)",
        },
        limit: {
          type: "number",
          description: "Maximum number of items to sync (1-100, default: 30)",
        },
      },
      required: [],
    },
  },
  {
    name: "memory_git_commits",
    description: "List commits stored in memory from connected repositories",
    annotations: { title: "List Git Commits", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: "object" as const,
      properties: {
        repository_id: {
          type: "string",
          description: "Filter by repository UUID (optional)",
        },
        repo: {
          type: "string",
          description:
            "Filter by repository name in owner/repo format (optional)",
        },
        space_id: {
          type: "string",
          description: "Filter by space UUID (optional)",
        },
        limit: {
          type: "number",
          description:
            "Maximum number of commits to return (1-100, default: 50)",
        },
        offset: {
          type: "number",
          description: "Number of items to skip for pagination (default: 0)",
        },
      },
      required: [],
    },
  },
  {
    name: "memory_git_prs",
    description:
      "List pull requests stored in memory from connected repositories",
    annotations: { title: "List Pull Requests", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: "object" as const,
      properties: {
        repository_id: {
          type: "string",
          description: "Filter by repository UUID (optional)",
        },
        repo: {
          type: "string",
          description:
            "Filter by repository name in owner/repo format (optional)",
        },
        space_id: {
          type: "string",
          description: "Filter by space UUID (optional)",
        },
        limit: {
          type: "number",
          description: "Maximum number of PRs to return (1-100, default: 50)",
        },
        offset: {
          type: "number",
          description: "Number of items to skip for pagination (default: 0)",
        },
      },
      required: [],
    },
  },
  // ============ Snapshot Tools ============
  {
    name: "memory_snapshot_create",
    description: "Create a snapshot (backup) of the current memory state",
    annotations: { title: "Create Snapshot", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    inputSchema: {
      type: "object" as const,
      properties: {
        space_id: {
          type: "string",
          description: "Space UUID to snapshot",
        },
        name: {
          type: "string",
          description: 'Name for the snapshot (e.g., "Before refactoring")',
        },
        description: {
          type: "string",
          description: "Optional description of why this snapshot was created",
        },
      },
      required: ["space_id", "name"],
    },
  },
  {
    name: "memory_snapshot_list",
    description: "List all available snapshots",
    annotations: { title: "List Snapshots", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: "object" as const,
      properties: {
        space_id: {
          type: "string",
          description: "Filter by space UUID (optional)",
        },
      },
      required: [],
    },
  },
  {
    name: "memory_snapshot_restore",
    description: "Restore memory to a previous snapshot state",
    annotations: { title: "Restore Snapshot", readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    inputSchema: {
      type: "object" as const,
      properties: {
        snapshot_id: {
          type: "string",
          description: "Snapshot UUID to restore",
        },
        mode: {
          type: "string",
          enum: ["merge", "replace"],
          description:
            "merge: add missing items, replace: delete current and restore all (default: merge)",
        },
      },
      required: ["snapshot_id"],
    },
  },
  {
    name: "memory_snapshot_delete",
    description: "Delete a snapshot",
    annotations: { title: "Delete Snapshot", readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: "object" as const,
      properties: {
        snapshot_id: {
          type: "string",
          description: "Snapshot UUID to delete",
        },
      },
      required: ["snapshot_id"],
    },
  },
  // ============ Import/Export Tools ============
  {
    name: "memory_export",
    description:
      "Export all items from a space to JSON, Markdown, or CSV format",
    annotations: { title: "Export Memory", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: "object" as const,
      properties: {
        space_id: {
          type: "string",
          description: "Space UUID to export",
        },
        format: {
          type: "string",
          enum: ["json", "markdown", "csv"],
          description: "Export format (default: json)",
        },
      },
      required: ["space_id"],
    },
  },
  {
    name: "memory_import",
    description:
      "Import items from JSON, Markdown, Notion, or Obsidian format into a space",
    annotations: { title: "Import Memory", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    inputSchema: {
      type: "object" as const,
      properties: {
        space_id: {
          type: "string",
          description: "Space UUID to import into",
        },
        format: {
          type: "string",
          enum: ["contextforge", "markdown", "notion", "obsidian"],
          description: "Import format (auto-detected if not specified)",
        },
        data: {
          type: "object",
          description: "The data to import (format-specific structure)",
        },
        items: {
          type: "array",
          description: "Direct array of items to import (alternative to data)",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              content: { type: "string" },
              tags: { type: "array", items: { type: "string" } },
              category: { type: "string" },
            },
            required: ["content"],
          },
        },
      },
      required: ["space_id"],
    },
  },
  // ============ Batch Operations Tools ============
  {
    name: "memory_ingest_batch",
    description:
      "Add multiple items to memory in a single operation. More efficient than multiple single ingests.",
    annotations: { title: "Batch Save to Memory", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    inputSchema: {
      type: "object" as const,
      properties: {
        space_id: {
          type: "string",
          description: "Space UUID (uses default if not specified)",
        },
        items: {
          type: "array",
          description: "Array of items to ingest (max 100)",
          items: {
            type: "object",
            properties: {
              content: { type: "string", description: "The content to store" },
              title: { type: "string", description: "Optional title" },
              source_type: {
                type: "string",
                enum: ["manual", "url", "file_upload", "api_ingestion"],
                description: "Type of source",
              },
              source_uri: { type: "string", description: "Source URI" },
              tags: {
                type: "array",
                items: { type: "string" },
                description: "Tags",
              },
              category: { type: "string", description: "Category" },
            },
            required: ["content"],
          },
        },
      },
      required: ["items"],
    },
  },
  {
    name: "memory_delete_batch",
    description:
      "Delete multiple items from memory based on filters. Use dry_run=true first to preview what will be deleted.",
    annotations: { title: "Batch Delete Memory Items", readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: "object" as const,
      properties: {
        space_id: {
          type: "string",
          description:
            "Space UUID (optional, deletes from all spaces if not specified)",
        },
        filter: {
          type: "object",
          description: "Filters to select items to delete",
          properties: {
            tags: {
              type: "array",
              items: { type: "string" },
              description: "Delete items with any of these tags",
            },
            source_types: {
              type: "array",
              items: { type: "string" },
              description: "Delete items with these source types",
            },
            category: {
              type: "string",
              description: "Delete items in this category",
            },
            older_than: {
              type: "string",
              description: "Delete items older than this date (ISO format)",
            },
            newer_than: {
              type: "string",
              description: "Delete items newer than this date (ISO format)",
            },
            title_contains: {
              type: "string",
              description: "Delete items with title containing this text",
            },
            content_contains: {
              type: "string",
              description: "Delete items with content containing this text",
            },
          },
        },
        dry_run: {
          type: "boolean",
          description:
            "If true, only preview what would be deleted without actually deleting (default: true for safety)",
        },
      },
      required: [],
    },
  },
  // ============ Project Linking Tools ============
  {
    name: "memory_link_project",
    description:
      "Link the current directory to a ContextForge project. When linked, all queries will be automatically filtered to only search within that project's spaces. This creates a .contextforge file in the current directory.",
    annotations: { title: "Link Project", readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: "object" as const,
      properties: {
        project_name: {
          type: "string",
          description:
            "Name of the project to link. If not provided, shows available projects to choose from.",
        },
        create_new: {
          type: "boolean",
          description:
            "If true and project_name is provided, creates a new project with that name instead of linking to an existing one (default: false)",
        },
      },
      required: [],
    },
  },
  {
    name: "memory_unlink_project",
    description:
      "Remove the project link from the current directory. This deletes the .contextforge file and queries will no longer be filtered by project.",
    annotations: { title: "Unlink Project", readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "memory_current_project",
    description:
      "Show the currently linked project for this directory, including its spaces. Use this to see which project is linked and what spaces are available.",
    annotations: { title: "Current Linked Project", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  // ============ Tasks (Task Management) ============
  {
    name: "tasks_list",
    description:
      'List tasks assigned to you. Shows pending tasks by default. Use status "all" to see everything, or "resolved" for completed tasks. IMPORTANT: Each task includes a dashboard URL (🔗). You MUST include these clickable links when presenting tasks to the user.',
    annotations: { title: "List Tasks", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: "object" as const,
      properties: {
        status: {
          type: "string",
          enum: ["pending", "in_progress", "resolved", "all"],
          description: "Filter by status (default: pending)",
        },
        project_id: {
          type: "string",
          description: "Filter by project UUID (optional)",
        },
        scope: {
          type: "string",
          enum: ["mine", "all"],
          description:
            '"mine" shows only tasks assigned to or created by you (default), "all" shows all tasks in your organization/shared projects',
        },
        limit: {
          type: "number",
          description: "Maximum number of tasks (1-100, default: 20)",
        },
      },
      required: [],
    },
  },
  {
    name: "tasks_start",
    description:
      'Mark a task as "in_progress". Use this when you start working on a task. Accepts any identifier: UUID, short_id, or task title. The response includes a dashboard URL — always show it to the user.',
    annotations: { title: "Start Task", readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: "object" as const,
      properties: {
        identifier: {
          type: "string",
          description: "Task identifier — can be a UUID, short_id (e.g. 'hpiu09'), or task title/name",
        },
      },
      required: ["identifier"],
    },
  },
  {
    name: "tasks_resolve",
    description:
      'Mark a task as "resolved". Use this when you finish working on a task. Accepts any identifier: UUID, short_id, or task title. The response includes a dashboard URL — always show it to the user.',
    annotations: { title: "Resolve Task", readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: "object" as const,
      properties: {
        identifier: {
          type: "string",
          description: "Task identifier — can be a UUID, short_id (e.g. 'hpiu09'), or task title/name",
        },
      },
      required: ["identifier"],
    },
  },
  {
    name: "tasks_what_next",
    description:
      "Get a recommendation of what task to work on next, based on priority and due dates. Use this when you want to know what task to focus on. The response includes a dashboard URL — always show it to the user.",
    annotations: { title: "What Task is Next?", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  // ============ Tasks - Create & Assign ============
  {
    name: "tasks_create",
    description:
      "Create a new task in a project. Optionally assign it to a collaborator by their email. The response includes a dashboard URL — always show it to the user.",
    annotations: { title: "Create Task", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    inputSchema: {
      type: "object" as const,
      properties: {
        title: {
          type: "string",
          description: "Title of the task",
        },
        description: {
          type: "string",
          description: "Detailed description of the task (optional)",
        },
        project_id: {
          type: "string",
          description: "Project UUID to create the task in",
        },
        project_name: {
          type: "string",
          description:
            "Project name to create the task in (alternative to project_id)",
        },
        priority: {
          type: "string",
          enum: ["low", "medium", "high", "urgent"],
          description: "Priority level (default: medium)",
        },
        assignee_email: {
          type: "string",
          description:
            "Email of a collaborator to assign this task to (optional)",
        },
        due_date: {
          type: "string",
          description: "Due date in ISO format (optional)",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Tags for categorization (optional)",
        },
        space_id: {
          type: "string",
          description: "Space UUID to link this task to (optional)",
        },
      },
      required: ["title"],
    },
  },
  {
    name: "tasks_update",
    description:
      "Update a task's title, description, status, priority, tags, due date, or assignee. Accepts any identifier: UUID, short_id, or task title. The response includes a dashboard URL — always show it to the user.",
    annotations: { title: "Update Task", readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: "object" as const,
      properties: {
        identifier: {
          type: "string",
          description: "Task identifier — can be a UUID, short_id (e.g. 'hpiu09'), or task title/name",
        },
        title: {
          type: "string",
          description: "New title for the task",
        },
        description: {
          type: "string",
          description: "New description for the task",
        },
        status: {
          type: "string",
          enum: ["pending", "in_progress", "resolved"],
          description: "New status for the task",
        },
        priority: {
          type: "string",
          enum: ["low", "medium", "high", "urgent"],
          description: "New priority level",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "New tags (replaces existing tags)",
        },
        due_date: {
          type: "string",
          description: "New due date in ISO format, or null to clear",
        },
        assignee_email: {
          type: "string",
          description: "Email of a collaborator to assign this task to",
        },
      },
      required: [],
    },
  },
  {
    name: "tasks_assign",
    description: "Assign a task to a collaborator by their email address. Accepts any task identifier: UUID, short_id, or task title. The response includes a dashboard URL — always show it to the user.",
    annotations: { title: "Assign Task", readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: "object" as const,
      properties: {
        identifier: {
          type: "string",
          description: "Task identifier — can be a UUID, short_id (e.g. 'hpiu09'), or task title/name",
        },
        assignee_email: {
          type: "string",
          description: "Email of the collaborator to assign the task to",
        },
      },
      required: ["identifier", "assignee_email"],
    },
  },
  {
    name: "tasks_resolve_by_name",
    description:
      "Resolve a task by searching for it by title, short_id, or UUID. Use this when you have any identifier for the task. The response includes a dashboard URL — always show it to the user.",
    annotations: { title: "Resolve Task by Name", readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: "object" as const,
      properties: {
        title: {
          type: "string",
          description: "Task identifier — can be a title (partial match), short_id, or UUID",
        },
      },
      required: ["title"],
    },
  },
  {
    name: "tasks_delete",
    description:
      "Permanently delete a task. Accepts any identifier: UUID, short_id, or task title. Also deletes related comments, activity, and notifications.",
    annotations: { title: "Delete Task", readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: "object" as const,
      properties: {
        identifier: {
          type: "string",
          description: "Task identifier — can be a UUID, short_id (e.g. 'hpiu09'), or task title/name",
        },
      },
      required: ["identifier"],
    },
  },
  // ============ Task Comments ============
  {
    name: "tasks_list_comments",
    description:
      "List comments on a task. Accepts any identifier: UUID, short_id, or task title.",
    annotations: { title: "List Task Comments", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: "object" as const,
      properties: {
        identifier: {
          type: "string",
          description: "Task identifier — can be a UUID, short_id (e.g. 'hpiu09'), or task title/name",
        },
      },
      required: ["identifier"],
    },
  },
  {
    name: "tasks_add_comment",
    description:
      "Add a comment to a task. Accepts any task identifier: UUID, short_id, or task title. The response includes the task dashboard URL — always show it to the user.",
    annotations: { title: "Add Task Comment", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    inputSchema: {
      type: "object" as const,
      properties: {
        identifier: {
          type: "string",
          description: "Task identifier — can be a UUID, short_id (e.g. 'hpiu09'), or task title/name",
        },
        content: {
          type: "string",
          description: "Comment text to add",
        },
      },
      required: ["identifier", "content"],
    },
  },
  // ============ Collaborators ============
  {
    name: "collaborators_list",
    description:
      "List collaborators on a shared project. Shows who has access and what tasks are assigned to them.",
    annotations: { title: "List Collaborators", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: "object" as const,
      properties: {
        project_id: {
          type: "string",
          description:
            "Project UUID to list collaborators for (optional if project_name is provided)",
        },
        project_name: {
          type: "string",
          description:
            "Project name to list collaborators for (optional if project_id is provided)",
        },
      },
      required: [],
    },
  },
  // ============ Project Sharing ============
  {
    name: "project_share",
    description:
      "Share a project with a collaborator by email. Creates an invitation and returns the invite URL. An email notification may also be sent.",
    annotations: { title: "Share Project", readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: "object" as const,
      properties: {
        email: {
          type: "string",
          description: "Email address of the person to invite",
        },
        project_id: {
          type: "string",
          description:
            "Project UUID to share (optional if project_name is provided or a project is linked)",
        },
        project_name: {
          type: "string",
          description:
            "Project name to share (optional if project_id is provided)",
        },
        message: {
          type: "string",
          description: "Optional personal message to include in the invitation",
        },
      },
      required: ["email"],
    },
  },
  {
    name: "skills_list",
    description:
      "List all Skills in a project. Returns skills with their name, description, model, and prompt body.",
    annotations: { title: "List Skills", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: "object" as const,
      properties: {
        project_id: { type: "string", description: "Project UUID" },
      },
      required: ["project_id"],
    },
  },
  {
    name: "skills_get",
    description: "Get a single Skill by ID with full body.",
    annotations: { title: "Get Skill", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: "object" as const,
      properties: {
        id: { type: "string", description: "Skill UUID" },
      },
      required: ["id"],
    },
  },
  {
    name: "skills_create",
    description:
      "Create a new Skill in a project. The 'body' is a markdown prompt template that may use {{variable}} placeholders for input_params at run time.",
    annotations: { title: "Create Skill", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    inputSchema: {
      type: "object" as const,
      properties: {
        project_id: { type: "string" },
        name: { type: "string" },
        description: { type: "string" },
        body: {
          type: "string",
          description:
            "Markdown prompt template with optional {{var}} placeholders",
        },
        input_schema: {
          type: "object",
          description: "Optional JSON Schema for input_params",
        },
        llm_provider: {
          type: "string",
          enum: ["anthropic", "openai"],
          description: "Default 'anthropic'",
        },
        model: { type: "string", description: "e.g., claude-sonnet-4-6" },
        save_to_space_id: {
          type: "string",
          description:
            "Optional: save outputs as knowledge_items in this space",
        },
      },
      required: ["project_id", "name", "body", "model"],
    },
  },
  {
    name: "skills_update",
    description: "Update an existing Skill.",
    annotations: { title: "Update Skill", readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: "object" as const,
      properties: {
        id: { type: "string" },
        name: { type: "string" },
        description: { type: "string" },
        body: { type: "string" },
        input_schema: { type: "object" },
        llm_provider: { type: "string", enum: ["anthropic", "openai"] },
        model: { type: "string" },
        save_to_space_id: { type: "string" },
      },
      required: ["id"],
    },
  },
  {
    name: "skills_delete",
    description: "Delete a Skill.",
    annotations: { title: "Delete Skill", readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: "object" as const,
      properties: {
        id: { type: "string" },
      },
      required: ["id"],
    },
  },
  {
    name: "skills_run",
    description:
      "Execute a Skill on the configured LLM, optionally storing the output as a knowledge_item, and returns the result. Available to all project members.",
    annotations: { title: "Run Skill", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    inputSchema: {
      type: "object" as const,
      properties: {
        skill_id: { type: "string" },
        input_params: {
          type: "object",
          description: "Variables substituted into the skill body",
        },
      },
      required: ["skill_id"],
    },
  },
  {
    name: "routines_list",
    description:
      "List all Routines in a project. Returns routines with their schedule, last/next run, and enabled flag.",
    annotations: { title: "List Routines", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: "object" as const,
      properties: {
        project_id: { type: "string", description: "Project UUID" },
      },
      required: ["project_id"],
    },
  },
  {
    name: "routines_get",
    description:
      "Get a single Routine by ID, including its cron expression, input_params, and last/next run.",
    annotations: { title: "Get Routine", readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: "object" as const,
      properties: { id: { type: "string", description: "Routine UUID" } },
      required: ["id"],
    },
  },
  {
    name: "routines_create",
    description:
      "Create a new Routine. Schedules a Skill to run on a cron expression. Pass either schedule_preset (hourly/daily/weekly/monthly) OR a custom cron_expression. timezone defaults to UTC.",
    annotations: { title: "Create Routine", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    inputSchema: {
      type: "object" as const,
      properties: {
        project_id: { type: "string" },
        skill_id: { type: "string" },
        name: { type: "string" },
        schedule_preset: {
          type: "string",
          enum: ["hourly", "daily", "weekly", "monthly", "custom"],
        },
        cron_expression: {
          type: "string",
          description:
            "Required if schedule_preset=custom. Standard 5-field cron.",
        },
        timezone: {
          type: "string",
          description: "IANA TZ name, e.g. America/New_York. Default UTC.",
        },
        input_params: {
          type: "object",
          description:
            "Variables substituted into the Skill body at each run",
        },
      },
      required: ["project_id", "skill_id", "name"],
    },
  },
  {
    name: "routines_update",
    description:
      "Update an existing Routine (name, schedule, timezone, input_params).",
    annotations: { title: "Update Routine", readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: "object" as const,
      properties: {
        id: { type: "string" },
        name: { type: "string" },
        schedule_preset: {
          type: "string",
          enum: ["hourly", "daily", "weekly", "monthly", "custom"],
        },
        cron_expression: { type: "string" },
        timezone: { type: "string" },
        input_params: { type: "object" },
      },
      required: ["id"],
    },
  },
  {
    name: "routines_toggle",
    description:
      "Enable or disable a Routine without deleting it. Pass enabled=false to pause.",
    annotations: { title: "Toggle Routine", readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: "object" as const,
      properties: {
        id: { type: "string" },
        enabled: { type: "boolean" },
      },
      required: ["id", "enabled"],
    },
  },
  {
    name: "routines_run_now",
    description:
      "Fire a Routine immediately, ahead of its schedule. Creates a skill_executions row with trigger_type=scheduled and routine_id set, just like the cron tick would.",
    annotations: { title: "Run Routine Now", readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    inputSchema: {
      type: "object" as const,
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
  {
    name: "routines_delete",
    description:
      "Permanently delete a Routine. Execution history rows are retained.",
    annotations: { title: "Delete Routine", readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    inputSchema: {
      type: "object" as const,
      properties: { id: { type: "string" } },
      required: ["id"],
    },
  },
];

// ============ Main Server ============

async function main() {
  const config = loadConfig();
  const apiClient = new ApiClient(config);

  // Startup banner
  console.error("");
  console.error(
    `${colors.bgBlue}${colors.white}${colors.bright} ContextForge MCP ${colors.reset}`,
  );
  console.error(
    `${colors.dim}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`,
  );
  console.error(`${colors.cyan}Version:${colors.reset}  ${VERSION}`);
  console.error(`${colors.cyan}API URL:${colors.reset}  ${config.apiUrl}`);
  console.error(
    `${colors.cyan}Space:${colors.reset}    ${config.defaultSpace || "(not set)"}`,
  );
  console.error(
    `${colors.dim}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`,
  );
  console.error("");

  checkForUpdates(VERSION, colors).catch(() => {});

  const server = new Server(
    {
      name: "contextforge-mcp",
      version: VERSION,
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  // List available tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    logInfo(`Tools requested (${TOOLS.length} available)`);
    return { tools: TOOLS };
  });

  // Handle tool calls
  const originalHandler = async (request: any) => {
    const { name, arguments: args } = request.params;
    const startTime = Date.now();

    try {
      switch (name) {
        case "memory_ingest": {
          const input = IngestInputSchema.parse(args);
          const title = input.title || input.content.slice(0, 50) + "...";
          logTool(name, `"${title}"`);

          // Resolve space_id if it's a name instead of UUID
          if (input.space_id) {
            const resolvedSpaceId = await apiClient.resolveSpaceId(
              input.space_id,
            );
            if (resolvedSpaceId) {
              input.space_id = resolvedSpaceId;
            }
          } else {
            // If no space_id provided, use linked project's default space
            const linkedConfig = readProjectLinkConfig();
            if (linkedConfig) {
              // Get spaces from linked project
              const spaces = await apiClient.listSpaces(
                linkedConfig.project_id,
                "regular",
              );
              if (spaces.length > 0) {
                // Use first available space in linked project
                input.space_id = spaces[0].id;
              } else {
                // Create a default space in linked project
                const defaultSpace = await apiClient.createSpace({
                  name: "Default",
                  description: "Default space for the project",
                  project_id: linkedConfig.project_id,
                });
                input.space_id = defaultSpace.id;
              }
            }
          }

          const result = await apiClient.ingest(input);
          const elapsed = Date.now() - startTime;

          logSuccess(`Saved ${result.created} item(s) in ${elapsed}ms`);

          const itemTitle =
            input.title ||
            input.content.slice(0, 50) +
              (input.content.length > 50 ? "..." : "");
          const itemId = result.items?.[0]?.id;
          return {
            content: [
              {
                type: "text" as const,
                text: formatResponse({
                  message:
                    result.created > 0
                      ? `📥 Saved "${itemTitle}" to memory`
                      : `⏭️ Item already exists in memory (skipped duplicate)`,
                  hint: "Use memory_query to search your saved knowledge",
                  details:
                    result.created > 0
                      ? {
                          id: itemId,
                          title: itemTitle,
                        }
                      : undefined,
                }),
              },
            ],
          };
        }

        case "memory_query": {
          const input = QueryInputSchema.parse(args);
          logTool(name, `"${input.query}"`);

          // Resolve space_id if it's a name instead of UUID
          if (input.space_id) {
            const resolvedSpaceId = await apiClient.resolveSpaceId(
              input.space_id,
            );
            if (resolvedSpaceId) {
              input.space_id = resolvedSpaceId;
            }
          }

          const result = await apiClient.query(input);
          const elapsed = Date.now() - startTime;

          logSuccess(
            `Found ${result.results.length} result(s) in ${elapsed}ms`,
          );

          const results = result.results || [];
          const count = results.length;

          if (count === 0) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `🔍 No results found for "${input.query}"\n\n💡 Try different keywords or check memory_list_items`,
                },
              ],
            };
          }

          // Format each result as readable text
          const resultLines = results.map((r: any, idx: number) => {
            const score = r.score
              ? ` (${Math.round(r.score * 100)}% match)`
              : "";
            const tags = r.tags?.length ? `\n  🏷️ ${r.tags.join(", ")}` : "";
            const preview = r.content
              ? r.content.slice(0, 150).replace(/\n/g, " ") +
                (r.content.length > 150 ? "..." : "")
              : "";
            return `${idx + 1}. ${r.title || "Untitled"}${score}\n  🆔 ${r.id}\n  📄 ${preview}${tags}`;
          });

          let responseText = `🔍 Found ${count} result${count === 1 ? "" : "s"} for "${input.query}"\n\n${resultLines.join("\n\n")}`;

          // Add expanded results if present
          const expanded = (result as any).expanded_results;
          if (expanded && expanded.length > 0) {
            const expandedLines = expanded.map((r: any, idx: number) => {
              const score = r.score ? ` (${Math.round(r.score * 100)}% match)` : "";
              const tags = r.tags?.length ? `\n  🏷️ ${r.tags.join(", ")}` : "";
              const preview = r.content
                ? r.content.slice(0, 150).replace(/\n/g, " ") + (r.content.length > 150 ? "..." : "")
                : "";
              return `${idx + 1}. ${r.title || "Untitled"}${score}\n  🆔 ${r.id}\n  🔗 ${r.relationship_type} → ${r.expanded_from}\n  📄 ${preview}${tags}`;
            });
            responseText += `\n\n🔗 Related items (via relationships):\n\n${expandedLines.join("\n\n")}`;
          }

          return {
            content: [
              {
                type: "text" as const,
                text: responseText,
              },
            ],
          };
        }

        case "memory_get_item": {
          const { id } = args as { id: string };
          logTool(name, `"${id}"`);

          const item = await apiClient.getItem(id);
          const elapsed = Date.now() - startTime;

          if (!item) {
            logError(`Item not found: ${id}`);
            return {
              content: [
                {
                  type: "text" as const,
                  text: `❌ Item not found with ID: ${id}`,
                },
              ],
            };
          }

          logSuccess(`Retrieved item "${item.title || "Untitled"}" in ${elapsed}ms`);

          const tags = item.tags?.length ? `\n🏷️ Tags: ${item.tags.join(", ")}` : "";
          const category = item.category ? `\n📁 Category: ${item.category}` : "";
          const source = item.source_uri ? `\n🔗 Source: ${item.source_uri}` : "";
          const created = item.created_at ? `\n📅 Created: ${new Date(item.created_at).toLocaleString()}` : "";

          return {
            content: [
              {
                type: "text" as const,
                text: `📖 ${item.title || "Untitled"}${tags}${category}${source}${created}\n\n---\n\n${item.content}`,
              },
            ],
          };
        }

        // ============ Projects Handlers ============

        case "memory_list_projects": {
          logTool(name);

          const projects = await apiClient.listProjects();
          const elapsed = Date.now() - startTime;

          logSuccess(`Listed ${projects.length} project(s) in ${elapsed}ms`);

          const projectCount = projects.length;

          if (projectCount === 0) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: "🗂️ No projects yet\n\n💡 Use memory_create_project to create your first project",
                },
              ],
            };
          }

          const projectLines = projects.map((p: any) => {
            const spaceCount = p.space_count || 0;
            const desc = p.description ? `\n  📝 ${p.description}` : "";
            return `📁 ${p.name} (${spaceCount} space${spaceCount === 1 ? "" : "s"})${desc}`;
          });

          return {
            content: [
              {
                type: "text" as const,
                text: `🗂️ You have ${projectCount} project${projectCount === 1 ? "" : "s"}\n\n${projectLines.join("\n\n")}`,
              },
            ],
          };
        }

        case "memory_create_project": {
          const input = CreateProjectInputSchema.parse(args);
          logTool(name, `"${input.name}"`);

          const project = await apiClient.createProject(input);
          const elapsed = Date.now() - startTime;

          logSuccess(`Created project "${project.name}" in ${elapsed}ms`);

          return {
            content: [
              {
                type: "text" as const,
                text: formatResponse({
                  message: `📁 Project "${project.name}" created successfully!`,
                  hint: "Use memory_create_space to add spaces to this project",
                  details: {
                    id: project.id,
                    name: project.name,
                  },
                }),
              },
            ],
          };
        }

        // ============ Spaces Handlers ============

        case "memory_list_spaces": {
          const projectId = (args as any)?.project_id;
          const projectName = (args as any)?.project_name;
          const spaceType = (args as any)?.space_type as
            | "regular"
            | "git"
            | "all"
            | undefined;

          // Use linked project if no project filter specified
          let resolvedProjectId = projectId;
          let linkedProjectName: string | undefined;

          if (!resolvedProjectId && projectName) {
            resolvedProjectId = await apiClient.resolveProjectId(projectName);
          }

          // Auto-filter by linked project if no explicit filter
          if (!resolvedProjectId && !projectName) {
            const linkedConfig = readProjectLinkConfig();
            if (linkedConfig) {
              resolvedProjectId = linkedConfig.project_id;
              linkedProjectName = linkedConfig.project_name;
            }
          }

          const typeLabel =
            spaceType && spaceType !== "all" ? `, type: ${spaceType}` : "";
          logTool(
            name,
            resolvedProjectId
              ? `(project: ${linkedProjectName || projectName || projectId || resolvedProjectId}${typeLabel})`
              : typeLabel || "",
          );

          const spaces = await apiClient.listSpaces(
            resolvedProjectId,
            spaceType,
          );
          const elapsed = Date.now() - startTime;

          logSuccess(`Listed ${spaces.length} space(s) in ${elapsed}ms`);

          const spaceCount = spaces.length;
          const projectFilter = linkedProjectName || projectName || "";

          if (spaceCount === 0) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `📂 No spaces found${projectFilter ? ` in project "${projectFilter}"` : ""}\n\n💡 Use memory_create_space to create a new space`,
                },
              ],
            };
          }

          const spaceLines = spaces.map((s: any) => {
            const projectName = s.project?.name
              ? ` (📁 ${s.project.name})`
              : "";
            const desc = s.description ? `\n  📝 ${s.description}` : "";
            return `✨ ${s.name}${projectName}${desc}`;
          });

          const filterNote = projectFilter
            ? `\n📁 Filtered by project: ${projectFilter}`
            : "";

          return {
            content: [
              {
                type: "text" as const,
                text: `📂 ${spaceCount} space${spaceCount === 1 ? "" : "s"}${filterNote}\n\n${spaceLines.join("\n\n")}`,
              },
            ],
          };
        }

        case "memory_create_space": {
          const input = CreateSpaceInputSchema.parse(args);
          logTool(name, `"${input.name}"`);

          // Use linked project if no project specified
          if (!input.project_id && !input.project_name) {
            const linkedConfig = readProjectLinkConfig();
            if (linkedConfig) {
              input.project_id = linkedConfig.project_id;
            }
          }

          const space = await apiClient.createSpace(input);
          const elapsed = Date.now() - startTime;

          logSuccess(`Created space "${space.name}" in ${elapsed}ms`);

          return {
            content: [
              {
                type: "text" as const,
                text: formatResponse({
                  message: `✨ Space "${space.name}" created successfully!`,
                  hint: "Use memory_ingest to add content to this space",
                  details: {
                    id: space.id,
                    name: space.name,
                    project: space.project?.name,
                  },
                }),
              },
            ],
          };
        }

        case "memory_move_space": {
          const { space, target_project } = args as {
            space: string;
            target_project: string;
          };
          logTool(name, `"${space}" → "${target_project}"`);

          const updatedSpace = await apiClient.moveSpace(space, target_project);
          const elapsed = Date.now() - startTime;

          logSuccess(
            `Moved space "${updatedSpace.name}" to project "${updatedSpace.project?.name || "unknown"}" in ${elapsed}ms`,
          );

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    success: true,
                    space: {
                      id: updatedSpace.id,
                      name: updatedSpace.name,
                      slug: updatedSpace.slug,
                      project: updatedSpace.project || null,
                    },
                    message: `Space "${updatedSpace.name}" moved to project "${updatedSpace.project?.name}"`,
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }

        case "memory_delete_space": {
          const { space } = args as { space: string };
          logTool(name, `"${space}"`);

          const result = await apiClient.deleteSpace(space);
          const elapsed = Date.now() - startTime;

          logSuccess(`Deleted space in ${elapsed}ms`);

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    success: true,
                    message: `🗑️ ${result.message || "Space deleted successfully"}`,
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }

        case "memory_delete_project": {
          const { project } = args as { project: string };
          logTool(name, `"${project}"`);

          // Resolve project ID if name was provided
          const projectId = await apiClient.resolveProjectId(project);
          if (!projectId) {
            throw new Error(`Project not found: ${project}`);
          }

          const result = await apiClient.deleteProject(projectId);
          const elapsed = Date.now() - startTime;

          logSuccess(`Deleted project in ${elapsed}ms`);

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    success: true,
                    message: `🗑️ ${result.message || "Project deleted successfully"}`,
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }

        case "memory_relate": {
          const input = RelateInputSchema.parse(args);
          logTool(name, `${input.relationship_type}`);

          const relationship = await apiClient.relate(input);
          const elapsed = Date.now() - startTime;

          logSuccess(`Created relationship in ${elapsed}ms`);

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    success: true,
                    relationship: {
                      id: relationship.id,
                      type: relationship.relationship_type,
                      weight: relationship.weight,
                    },
                    message: `🔗 Relationship "${relationship.relationship_type}" created between items`,
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }

        case "memory_list_relationships": {
          const input = ListRelationshipsInputSchema.parse(args);
          logTool(name, input.item_id);

          const result = await apiClient.getRelationships(input.item_id);
          const elapsed = Date.now() - startTime;

          logSuccess(
            `Found ${result.relationships.length} relationships in ${elapsed}ms`,
          );

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    success: true,
                    count: result.relationships.length,
                    relationships: result.relationships,
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }

        case "memory_delete": {
          const input = DeleteInputSchema.parse(args);
          const identifier = input.id || `"${input.title}"`;
          logTool(name, identifier);

          const result = await apiClient.deleteItem(input);
          const elapsed = Date.now() - startTime;

          logSuccess(`Deleted "${result.title}" in ${elapsed}ms`);

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    success: true,
                    deleted: {
                      id: result.id,
                      title: result.title,
                    },
                    message: `🗑️ Deleted "${result.title}" from memory`,
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }

        case "memory_stats": {
          logTool(name);

          const spaceId =
            typeof args === "object" && args !== null && "space_id" in args
              ? String(args.space_id)
              : undefined;
          const stats = await apiClient.getStats(spaceId);
          const elapsed = Date.now() - startTime;

          logSuccess(`Got stats in ${elapsed}ms`);

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    ...stats,
                    message: `📊 Memory usage: ${stats.total_documents || 0} documents, ${stats.total_relationships || 0} relationships`,
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }

        case "memory_list_items": {
          logTool(name);

          const spaceId =
            typeof args === "object" && args !== null && "space_id" in args
              ? String(args.space_id)
              : undefined;
          const limit =
            typeof args === "object" && args !== null && "limit" in args
              ? Number(args.limit)
              : undefined;
          const offset =
            typeof args === "object" && args !== null && "offset" in args
              ? Number(args.offset)
              : undefined;

          const result = await apiClient.listItems(spaceId, limit, offset);
          const elapsed = Date.now() - startTime;

          logSuccess(
            `Listed ${result.items.length} of ${result.total} item(s) in ${elapsed}ms`,
          );

          const items = result.items || [];
          const itemCount = items.length;

          if (itemCount === 0) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: "📋 No items in memory yet\n\n💡 Use memory_ingest to add content",
                },
              ],
            };
          }

          const itemLines = items.map((item: any) => {
            const tags = item.tags?.length ? ` [${item.tags.join(", ")}]` : "";
            const preview =
              item.content_preview || item.content?.slice(0, 80) || "";
            const previewText = preview
              ? `\n  📄 ${preview.replace(/\n/g, " ")}${preview.length >= 80 ? "..." : ""}`
              : "";
            return `• ${item.title || "Untitled"}${tags}${previewText}`;
          });

          const paginationNote =
            result.total > itemCount
              ? `\n\n📊 Showing ${itemCount} of ${result.total} items`
              : "";

          return {
            content: [
              {
                type: "text" as const,
                text: `📋 ${result.total} item${result.total === 1 ? "" : "s"} in memory\n\n${itemLines.join("\n\n")}${paginationNote}`,
              },
            ],
          };
        }

        // ============ Git Integration Handlers ============

        case "memory_git_connect": {
          const input = GitConnectInputSchema.parse(args);
          logTool(name, input.repo_url);

          const result = await apiClient.gitConnect(input);
          const elapsed = Date.now() - startTime;

          logSuccess(
            `Connected ${result.repository.full_name} in ${elapsed}ms`,
          );

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    success: true,
                    repository: result.repository,
                    webhook_setup: result.webhook_setup,
                    message: `Repository connected! Follow the webhook setup instructions to complete the integration.`,
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }

        case "memory_git_list": {
          logTool(name);

          const spaceId =
            typeof args === "object" && args !== null && "space_id" in args
              ? String(args.space_id)
              : undefined;

          const result = await apiClient.gitList(spaceId);
          const elapsed = Date.now() - startTime;

          logSuccess(`Listed ${result.total} repository(ies) in ${elapsed}ms`);

          const repoCount = result.total;
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    repositories: result.repositories,
                    total: repoCount,
                    message:
                      repoCount > 0
                        ? `📡 ${repoCount} connected repositor${repoCount === 1 ? "y" : "ies"}`
                        : `📡 No repositories connected`,
                    hint:
                      repoCount === 0
                        ? "Use memory_git_connect to connect a GitHub repository"
                        : undefined,
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }

        case "memory_git_activate": {
          const input = GitActivateInputSchema.parse(args);
          const identifier = input.repository_id || input.repo;
          logTool(name, identifier);

          const result = await apiClient.gitActivate(input);
          const elapsed = Date.now() - startTime;

          const isActivated = input.active !== false;
          logSuccess(
            `${isActivated ? "Activated" : "Deactivated"} ${result.repository.full_name} in ${elapsed}ms`,
          );

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    ...result,
                    message: isActivated
                      ? `✅ Webhook activated for ${result.repository.full_name}`
                      : `⏸️ Webhook deactivated for ${result.repository.full_name}`,
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }

        case "memory_git_disconnect": {
          const input = GitDisconnectInputSchema.parse(args);
          const identifier = input.repository_id || input.repo;
          logTool(name, identifier);

          const result = await apiClient.gitDisconnect(input);
          const elapsed = Date.now() - startTime;

          logSuccess(`Disconnected repository in ${elapsed}ms`);

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    ...result,
                    message: `🔌 Repository disconnected and syncing stopped`,
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }

        case "memory_git_sync": {
          const input = GitSyncInputSchema.parse(args);
          const identifier = input.repository_id || input.repo;
          logTool(name, `${identifier} (${input.sync_type || "all"})`);

          const result = await apiClient.gitSync(input);
          const elapsed = Date.now() - startTime;

          logSuccess(
            `Synced ${result.synced} items from ${result.repository.full_name} in ${elapsed}ms`,
          );

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    success: true,
                    repository: result.repository,
                    sync_type: result.sync_type,
                    synced: result.synced,
                    skipped: result.skipped,
                    items: result.items,
                    message: `🔄 Synced ${result.synced} items from ${result.repository.full_name}${result.skipped > 0 ? ` (${result.skipped} already existed)` : ""}`,
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }

        case "memory_git_commits": {
          const input = GitHistoryInputSchema.parse({
            ...args,
            type: "commits",
          });
          const identifier = input.repository_id || input.repo || "all repos";
          logTool(name, identifier);

          const result = await apiClient.gitHistory(input);
          const elapsed = Date.now() - startTime;

          logSuccess(`Listed ${result.commits_count} commits in ${elapsed}ms`);

          const commitCount = result.items.length;
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    commits: result.items,
                    total: result.total,
                    showing: commitCount,
                    offset: result.offset,
                    message:
                      commitCount > 0
                        ? `📝 Showing ${commitCount} of ${result.total} commit${result.total === 1 ? "" : "s"}`
                        : `📝 No commits synced yet`,
                    hint:
                      commitCount === 0
                        ? "Use memory_git_sync to sync commits from your repository"
                        : undefined,
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }

        case "memory_git_prs": {
          const input = GitHistoryInputSchema.parse({ ...args, type: "prs" });
          const identifier = input.repository_id || input.repo || "all repos";
          logTool(name, identifier);

          const result = await apiClient.gitHistory(input);
          const elapsed = Date.now() - startTime;

          logSuccess(`Listed ${result.prs_count} PRs in ${elapsed}ms`);

          const prCount = result.items.length;
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    pull_requests: result.items,
                    total: result.total,
                    showing: prCount,
                    offset: result.offset,
                    message:
                      prCount > 0
                        ? `🔀 Showing ${prCount} of ${result.total} pull request${result.total === 1 ? "" : "s"}`
                        : `🔀 No pull requests synced yet`,
                    hint:
                      prCount === 0
                        ? "Use memory_git_sync to sync PRs from your repository"
                        : undefined,
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }

        // ============ Snapshot Handlers ============

        case "memory_snapshot_create": {
          const input = SnapshotCreateInputSchema.parse(args);
          logTool(name, `"${input.name}"`);

          const result = await apiClient.snapshotCreate(input);
          const elapsed = Date.now() - startTime;

          logSuccess(
            `Created snapshot "${result.snapshot.name}" with ${result.snapshot.item_count} items in ${elapsed}ms`,
          );

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    success: true,
                    snapshot: result.snapshot,
                    message: `Snapshot "${result.snapshot.name}" created with ${result.snapshot.item_count} items`,
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }

        case "memory_snapshot_list": {
          logTool(name);

          const spaceId =
            typeof args === "object" && args !== null && "space_id" in args
              ? String(args.space_id)
              : undefined;

          const result = await apiClient.snapshotList(spaceId);
          const elapsed = Date.now() - startTime;

          logSuccess(`Listed ${result.total} snapshot(s) in ${elapsed}ms`);

          const snapshotCount = result.total;
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    snapshots: result.snapshots,
                    total: snapshotCount,
                    message:
                      snapshotCount > 0
                        ? `🗂️ ${snapshotCount} snapshot${snapshotCount === 1 ? "" : "s"} available`
                        : `🗂️ No snapshots created yet`,
                    hint:
                      snapshotCount === 0
                        ? "Use memory_snapshot_create to backup your memory state"
                        : undefined,
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }

        case "memory_snapshot_restore": {
          const input = SnapshotRestoreInputSchema.parse(args);
          logTool(name, input.snapshot_id);

          const result = await apiClient.snapshotRestore(input);
          const elapsed = Date.now() - startTime;

          logSuccess(
            `Restored from "${result.restored_from.name}" (${result.stats.restored_count} items) in ${elapsed}ms`,
          );

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    success: true,
                    restored_from: result.restored_from,
                    mode: result.mode,
                    stats: result.stats,
                    auto_backup_id: result.auto_backup_id,
                    message: `Restored ${result.stats.restored_count} items from snapshot "${result.restored_from.name}"`,
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }

        case "memory_snapshot_delete": {
          const input = SnapshotDeleteInputSchema.parse(args);
          logTool(name, input.snapshot_id);

          const result = await apiClient.snapshotDelete(input);
          const elapsed = Date.now() - startTime;

          logSuccess(`Deleted snapshot in ${elapsed}ms`);

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    ...result,
                    message: `🗑️ Snapshot deleted successfully`,
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }

        // ============ Import/Export Handlers ============

        case "memory_export": {
          const input = ExportInputSchema.parse(args);
          logTool(name, `space ${input.space_id} as ${input.format || "json"}`);

          const result = await apiClient.exportSpace(input);
          const elapsed = Date.now() - startTime;

          logSuccess(`Exported ${result.total_items} items in ${elapsed}ms`);

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    success: true,
                    exported_at: result.exported_at,
                    space: result.space,
                    total_items: result.total_items,
                    format: input.format || "json",
                    data: result,
                    message: `📤 Exported ${result.total_items} item${result.total_items === 1 ? "" : "s"} in ${input.format || "json"} format`,
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }

        case "memory_import": {
          const input = ImportInputSchema.parse(args);
          logTool(name, `to space ${input.space_id}`);

          const result = await apiClient.importToSpace(input);
          const elapsed = Date.now() - startTime;

          logSuccess(
            `Imported ${result.imported} items (${result.skipped} skipped) in ${elapsed}ms`,
          );

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    success: true,
                    imported: result.imported,
                    skipped: result.skipped,
                    errors: result.errors,
                    total_processed: result.total_processed,
                    space: result.space,
                    message: `📥 Imported ${result.imported} item${result.imported === 1 ? "" : "s"}${result.skipped > 0 ? ` (${result.skipped} skipped)` : ""}`,
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }

        // ============ Batch Operations Handlers ============

        case "memory_ingest_batch": {
          const input = IngestBatchInputSchema.parse(args);
          logTool(name, `${input.items.length} items`);

          // Resolve space_id if it's a name instead of UUID
          if (input.space_id) {
            const resolvedSpaceId = await apiClient.resolveSpaceId(
              input.space_id,
            );
            if (resolvedSpaceId) {
              input.space_id = resolvedSpaceId;
            }
          }

          const result = await apiClient.ingestBatchItems(input);
          const elapsed = Date.now() - startTime;

          logSuccess(
            `Ingested ${result.created} items (${result.duplicates_skipped} duplicates) in ${elapsed}ms`,
          );

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    success: true,
                    created: result.created,
                    duplicates_skipped: result.duplicates_skipped,
                    items: result.items,
                    message: `Successfully ingested ${result.created} items`,
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }

        case "memory_delete_batch": {
          const input = DeleteBatchInputSchema.parse(args);
          const isDryRun = input.dry_run !== false;
          logTool(name, isDryRun ? "(dry run)" : "(executing)");

          // Resolve space_id if it's a name instead of UUID
          if (input.space_id) {
            const resolvedSpaceId = await apiClient.resolveSpaceId(
              input.space_id,
            );
            if (resolvedSpaceId) {
              input.space_id = resolvedSpaceId;
            }
          }

          const result = await apiClient.deleteBatch(input);
          const elapsed = Date.now() - startTime;

          if (result.dry_run) {
            logSuccess(
              `Would delete ${result.would_delete} items in ${elapsed}ms (dry run)`,
            );
          } else {
            logSuccess(`Deleted ${result.deleted} items in ${elapsed}ms`);
          }

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    ...result,
                    message: result.dry_run
                      ? `🔍 Would delete ${result.would_delete} item${result.would_delete === 1 ? "" : "s"} (dry run - nothing deleted)`
                      : `🗑️ Deleted ${result.deleted} item${result.deleted === 1 ? "" : "s"}`,
                    hint: result.dry_run
                      ? "Set dry_run=false to actually delete these items"
                      : undefined,
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }

        // ============ Project Linking Handlers ============

        case "memory_link_project": {
          const input = LinkProjectInputSchema.parse(args);
          logTool(name, input.project_name || "(listing projects)");

          try {
            const result = await apiClient.linkProject(
              input.project_name,
              input.create_new,
            );
            const elapsed = Date.now() - startTime;

            logSuccess(
              `Linked to project "${result.project.name}" in ${elapsed}ms`,
            );

            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    {
                      success: true,
                      linked: true,
                      project: result.project,
                      config_file: result.config_path,
                      message: result.message,
                      hint: "Queries will now be filtered to this project's spaces",
                    },
                    null,
                    2,
                  ),
                },
              ],
            };
          } catch (error) {
            if (
              error instanceof ApiClientError &&
              error.code === "PROJECT_NAME_REQUIRED"
            ) {
              // Return the list of available projects for user to choose
              const elapsed = Date.now() - startTime;
              logInfo(`Listed available projects in ${elapsed}ms`);

              return {
                content: [
                  {
                    type: "text" as const,
                    text: JSON.stringify(
                      {
                        success: false,
                        message: "Please specify which project to link:",
                        available_projects: error.details?.available_projects,
                        hint: "Call memory_link_project with project_name set to one of these, or use create_new: true to create a new project",
                      },
                      null,
                      2,
                    ),
                  },
                ],
              };
            }
            throw error;
          }
        }

        case "memory_unlink_project": {
          logTool(name);

          const result = apiClient.unlinkProject();
          const elapsed = Date.now() - startTime;

          if (result.success) {
            logSuccess(`Unlinked project in ${elapsed}ms`);
          } else {
            logInfo(`No project to unlink (${elapsed}ms)`);
          }

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    success: result.success,
                    config_file: result.config_path,
                    message: result.message,
                    hint: result.success
                      ? "Queries will now search all your spaces"
                      : undefined,
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }

        case "memory_current_project": {
          logTool(name);

          const result = await apiClient.getCurrentProject();
          const elapsed = Date.now() - startTime;

          if (result.linked) {
            logSuccess(
              `Found linked project "${result.project?.name}" in ${elapsed}ms`,
            );
          } else {
            logInfo(`No project linked (${elapsed}ms)`);
          }

          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    linked: result.linked,
                    project: result.project,
                    spaces: result.spaces,
                    config_file: result.config_path,
                    message: result.message,
                    hint: result.linked
                      ? "Use memory_unlink_project to remove the link"
                      : "Use memory_link_project to link a project",
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }

        // ============ Tasks (Task Management) ============
        case "tasks_list": {
          const status = (args as any)?.status; // API defaults to 'pending' if not specified
          const projectId = (args as any)?.project_id;
          const scope = (args as any)?.scope || "mine";
          const limit = (args as any)?.limit || 20;
          logTool(name, scope === "all" ? "all tasks" : status || "pending");

          const result = await apiClient.listTasks({
            status,
            project_id: projectId,
            scope,
            limit,
          });
          const elapsed = Date.now() - startTime;

          logSuccess(
            `Found ${result.issues?.length || 0} task(s) in ${elapsed}ms`,
          );

          const issues = result.issues || [];
          const issueCount = issues.length;

          if (issueCount === 0) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: "📋 No tasks found",
                },
              ],
            };
          }

          // Format each issue as a readable line
          const issueLines = issues.map((i: any) => {
            const statusEmoji =
              i.status === "pending"
                ? "⏳"
                : i.status === "in_progress"
                  ? "🔄"
                  : "✅";
            const priorityLabel =
              i.priority === "urgent"
                ? "🔴"
                : i.priority === "high"
                  ? "🟠"
                  : i.priority === "medium"
                    ? "🟡"
                    : "🟢";
            const resolvedBy =
              i.status === "resolved" && i.resolved_by_email
                ? `\n  👤 Resolved by: ${i.resolved_by_email}`
                : "";
            const createdBy = i.created_by_email
              ? `\n  ✍️ Created by: ${i.created_by_email}`
              : "";
            const commentInfo = i.comment_count > 0 ? ` | 💬 ${i.comment_count}` : "";
            const taskUrl = `\n  🔗 ${getTaskDashboardUrl(i.id)}`;
            return `[${i.short_id}] ${i.title}\n  ${statusEmoji} ${i.status} | ${priorityLabel} ${i.priority} | 📁 ${i.project?.name || "No project"}${commentInfo}${resolvedBy}${createdBy}${taskUrl}`;
          });

          const responseText = `📋 Found ${issueCount} task${issueCount === 1 ? "" : "s"}\n\n${issueLines.join("\n\n")}\n\n💡 Use tasks_start <issue_id> to begin working on a task`;

          return {
            content: [
              {
                type: "text" as const,
                text: responseText,
              },
            ],
          };
        }

        case "tasks_start": {
          const ident = resolveTaskIdentifier(args);
          if (!ident) {
            throw new Error("identifier is required — pass a UUID, short_id, or task title");
          }
          logTool(name, ident.value);

          let result;
          if (ident.type === "title") {
            // Find by title first, then start
            const { issues } = await apiClient.listTasks({ status: "all", limit: 100 });
            const titleLower = ident.value.toLowerCase();
            const match = issues?.find((i: any) =>
              i.title.toLowerCase().includes(titleLower) || i.title.toLowerCase() === titleLower
            );
            if (!match) throw new Error(`No task found matching "${ident.value}"`);
            result = await apiClient.updateTaskStatus(match.id, "in_progress");
          } else {
            result = await apiClient.updateTaskStatus(ident.value, "in_progress");
          }
          const elapsed = Date.now() - startTime;

          logSuccess(
            `Started working on "${result.issue?.title}" in ${elapsed}ms`,
          );

          return {
            content: [
              {
                type: "text" as const,
                text: formatResponse({
                  message: `▶️ Now working on: ${result.issue?.title}`,
                  hint: "Use tasks_resolve when you complete this task",
                  details: {
                    id: result.issue?.id,
                    description: result.issue?.description,
                  },
                }) + `\n\n🔗 ${getTaskDashboardUrl(result.issue?.id)}`,
              },
            ],
          };
        }

        case "tasks_resolve": {
          const ident = resolveTaskIdentifier(args);
          if (!ident) {
            throw new Error("identifier is required — pass a UUID, short_id, or task title");
          }
          logTool(name, ident.value);

          let result;
          if (ident.type === "title") {
            // Resolve by title search
            result = await apiClient.resolveTaskByName(ident.value);
          } else {
            // UUID or short_id — updateTaskStatus already handles both
            result = await apiClient.updateTaskStatus(ident.value, "resolved");
          }
          const elapsed = Date.now() - startTime;

          logSuccess(`Resolved "${result.issue?.title}" in ${elapsed}ms`);

          return {
            content: [
              {
                type: "text" as const,
                text: formatResponse({
                  message: `✅ Task resolved: ${result.issue?.title}`,
                  hint: "Use tasks_what_next to see your next task",
                }) + `\n\n🔗 ${getTaskDashboardUrl(result.issue?.id)}`,
              },
            ],
          };
        }

        case "tasks_what_next": {
          logTool(name);

          const result = await apiClient.getNextTask();
          const elapsed = Date.now() - startTime;

          if (!result.issue) {
            logInfo(`No pending tasks in ${elapsed}ms`);
            return {
              content: [
                {
                  type: "text" as const,
                  text: "🎉 No pending tasks assigned to you. Great job!\n\n💡 Check with your team lead for new tasks",
                },
              ],
            };
          }

          logSuccess(`Next task: "${result.issue.title}" in ${elapsed}ms`);

          const priorityEmoji =
            result.issue.priority === "urgent"
              ? "🔴"
              : result.issue.priority === "high"
                ? "🟠"
                : result.issue.priority === "medium"
                  ? "🟡"
                  : "🟢";
          const dueDate = result.issue.due_date
            ? `\n📅 Due: ${result.issue.due_date}`
            : "";
          const desc = result.issue.description
            ? `\n📝 ${result.issue.description}`
            : "";

          return {
            content: [
              {
                type: "text" as const,
                text: `🎯 Next recommended task:\n\n[${result.issue.short_id || result.issue.id.slice(0, 6)}] ${result.issue.title}\n${priorityEmoji} ${result.issue.priority} | 📁 ${result.issue.project?.name || "No project"}${dueDate}${desc}\n\n📊 ${result.pending_count || 0} pending tasks remaining\n\n💡 Use tasks_start ${result.issue.id} to begin working\n\n🔗 ${getTaskDashboardUrl(result.issue.id)}`,
              },
            ],
          };
        }

        case "tasks_create": {
          const title = (args as any)?.title;
          const description = (args as any)?.description;
          const projectId = (args as any)?.project_id;
          const projectName = (args as any)?.project_name;
          const priority = (args as any)?.priority || "medium";
          const assigneeEmail = (args as any)?.assignee_email;
          const dueDate = (args as any)?.due_date;
          const tags = parseArrayInput((args as any)?.tags) as string[] | undefined;
          const spaceId = (args as any)?.space_id;

          if (!title) {
            throw new Error("title is required");
          }

          logTool(name, `"${title}"`);

          const result = await apiClient.createTask({
            title,
            description,
            project_id: projectId,
            project_name: projectName,
            priority,
            assignee_email: assigneeEmail,
            due_date: dueDate,
            tags,
            space_id: spaceId,
          });
          const elapsed = Date.now() - startTime;

          logSuccess(`Created task "${result.issue?.title}" in ${elapsed}ms`);

          return {
            content: [
              {
                type: "text" as const,
                text: formatResponse({
                  message: `➕ Task created: [${result.issue?.short_id}] ${result.issue?.title}`,
                  hint: assigneeEmail
                    ? `Assigned to ${assigneeEmail}`
                    : "Use tasks_assign to assign this task to a collaborator",
                  details: {
                    id: result.issue?.short_id,
                    title: result.issue?.title,
                    priority: result.issue?.priority,
                    project: result.issue?.project?.name,
                  },
                }) + `\n\n🔗 ${getTaskDashboardUrl(result.issue?.id)}`,
              },
            ],
          };
        }

        case "tasks_assign": {
          const ident = resolveTaskIdentifier(args);
          const assigneeEmail = (args as any)?.assignee_email;

          if (!assigneeEmail) {
            throw new Error("assignee_email is required");
          }
          if (!ident) {
            throw new Error("identifier is required — pass a UUID, short_id, or task title");
          }

          logTool(name, `→ ${assigneeEmail}`);

          const result = await apiClient.assignTask({
            issue_id: ident.type === "uuid" ? ident.value : undefined,
            short_id: ident.type === "short_id" ? ident.value : undefined,
            issue_title: ident.type === "title" ? ident.value : undefined,
            assignee_email: assigneeEmail,
          });
          const elapsed = Date.now() - startTime;

          logSuccess(
            `Assigned "${result.issue?.title}" to ${assigneeEmail} in ${elapsed}ms`,
          );

          return {
            content: [
              {
                type: "text" as const,
                text: `👤 Task assigned!\n\n[${result.issue?.short_id || result.issue?.id?.slice(0, 6)}] ${result.issue?.title}\n📧 Assigned to: ${assigneeEmail}\n\n💡 The collaborator can now see this task with tasks_list\n\n🔗 ${getTaskDashboardUrl(result.issue?.id)}`,
              },
            ],
          };
        }

        case "tasks_resolve_by_name": {
          const ident = resolveTaskIdentifier(args);

          if (!ident) {
            throw new Error("identifier is required — pass a title, short_id, or UUID");
          }

          logTool(name, `"${ident.value}"`);

          let result;
          if (ident.type === "title") {
            result = await apiClient.resolveTaskByName(ident.value);
          } else {
            // UUID or short_id — resolve directly
            result = await apiClient.updateTaskStatus(ident.value, "resolved");
          }
          const elapsed = Date.now() - startTime;

          logSuccess(`Resolved "${result.issue?.title}" in ${elapsed}ms`);

          return {
            content: [
              {
                type: "text" as const,
                text: formatResponse({
                  message: `✅ Task resolved: ${result.issue?.title}`,
                  hint: "Use tasks_what_next to see your next task",
                }) + `\n\n🔗 ${getTaskDashboardUrl(result.issue?.id)}`,
              },
            ],
          };
        }

        case "tasks_delete": {
          const ident = resolveTaskIdentifier(args);

          if (!ident) {
            throw new Error("identifier is required — pass a UUID, short_id, or task title");
          }

          logTool(name, ident.value);

          let deleteId = ident.value;
          if (ident.type === "title") {
            const { issues } = await apiClient.listTasks({ status: "all", limit: 100 });
            const titleLower = ident.value.toLowerCase();
            const match = issues?.find((i: any) =>
              i.title.toLowerCase().includes(titleLower) || i.title.toLowerCase() === titleLower
            );
            if (!match) throw new Error(`No task found matching "${ident.value}"`);
            deleteId = match.id;
          }

          const result = await apiClient.deleteTask(deleteId);
          const elapsed = Date.now() - startTime;

          logSuccess(`Deleted task "${result.title}" in ${elapsed}ms`);

          return {
            content: [
              {
                type: "text" as const,
                text: formatResponse({
                  message: `🗑️ Task deleted: [${result.short_id}] ${result.title}`,
                  hint: "The task and all related data (comments, activity, notifications) have been permanently deleted",
                }),
              },
            ],
          };
        }

        case "tasks_update": {
          const ident = resolveTaskIdentifier(args);

          if (!ident) {
            throw new Error("identifier is required — pass a UUID, short_id, or task title");
          }

          // Resolve title to UUID/short_id for the API
          let issueId = ident.type === "uuid" ? ident.value : undefined;
          let shortId = ident.type === "short_id" ? ident.value : undefined;
          if (ident.type === "title") {
            const { issues } = await apiClient.listTasks({ status: "all", limit: 100 });
            const titleLower = ident.value.toLowerCase();
            const match = issues?.find((i: any) =>
              i.title.toLowerCase().includes(titleLower) || i.title.toLowerCase() === titleLower
            );
            if (!match) throw new Error(`No task found matching "${ident.value}"`);
            issueId = match.id;
          }

          const updateFields: Record<string, any> = {};
          if ((args as any)?.title !== undefined)
            updateFields.title = (args as any).title;
          if ((args as any)?.description !== undefined)
            updateFields.description = (args as any).description;
          if ((args as any)?.status !== undefined)
            updateFields.status = (args as any).status;
          if ((args as any)?.priority !== undefined)
            updateFields.priority = (args as any).priority;
          if ((args as any)?.tags !== undefined)
            updateFields.tags = parseArrayInput((args as any).tags) as string[];
          if ((args as any)?.due_date !== undefined)
            updateFields.due_date = (args as any).due_date;
          if ((args as any)?.assignee_email !== undefined)
            updateFields.assignee_email = (args as any).assignee_email;

          if (Object.keys(updateFields).length === 0) {
            throw new Error(
              "At least one field to update is required (title, description, status, priority, tags, due_date, assignee_email)",
            );
          }

          logTool(name, shortId || issueId);

          const result = await apiClient.updateTask({
            issue_id: issueId,
            short_id: shortId,
            ...updateFields,
          });
          const elapsed = Date.now() - startTime;

          const updatedFieldNames = Object.keys(updateFields).join(", ");
          logSuccess(
            `Updated task "${result.issue?.title}" (${updatedFieldNames}) in ${elapsed}ms`,
          );

          return {
            content: [
              {
                type: "text" as const,
                text: formatResponse({
                  message: `✏️ Task updated: [${result.issue?.short_id}] ${result.issue?.title}`,
                  hint: `Updated fields: ${updatedFieldNames}`,
                  details: {
                    id: result.issue?.short_id,
                    title: result.issue?.title,
                    status: result.issue?.status,
                    priority: result.issue?.priority,
                    project: result.issue?.project?.name,
                  },
                }) + `\n\n🔗 ${getTaskDashboardUrl(result.issue?.id)}`,
              },
            ],
          };
        }

        case "tasks_list_comments": {
          const ident = resolveTaskIdentifier(args);
          if (!ident) {
            throw new Error("identifier is required — pass a UUID, short_id, or task title");
          }

          logTool(name, ident.value);

          // Resolve to UUID
          let resolvedId = ident.value;
          if (ident.type !== "uuid") {
            const { issues } = await apiClient.listTasks({
              status: "all",
              limit: 100,
            });
            let match;
            if (ident.type === "short_id") {
              match = issues?.find(
                (i: any) =>
                  i.short_id?.toLowerCase() === ident.value.toLowerCase(),
              );
            } else {
              const titleLower = ident.value.toLowerCase();
              match = issues?.find(
                (i: any) =>
                  i.title.toLowerCase().includes(titleLower) || i.title.toLowerCase() === titleLower,
              );
            }
            if (!match) {
              throw new Error(`No task found matching "${ident.value}"`);
            }
            resolvedId = match.id;
          }

          const result = await apiClient.listComments(resolvedId);
          const elapsed = Date.now() - startTime;

          logSuccess(
            `Found ${result.comments?.length || 0} comment(s) in ${elapsed}ms`,
          );

          const comments = result.comments || [];

          if (comments.length === 0) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `💬 No comments on this task yet\n\n💡 Use tasks_add_comment to add one`,
                },
              ],
            };
          }

          const commentLines = comments.map((c: any, idx: number) => {
            const date = new Date(c.created_at).toLocaleString();
            const author = c.user_email || "Unknown";
            const automated = c.is_automated
              ? ` (${c.automation_source || "automated"})`
              : "";
            return `${idx + 1}. ${author}${automated} — ${date}\n   ${c.content}`;
          });

          return {
            content: [
              {
                type: "text" as const,
                text: `💬 ${comments.length} comment${comments.length === 1 ? "" : "s"}\n\n${commentLines.join("\n\n")}\n\n🔗 ${getTaskDashboardUrl(resolvedId)}`,
              },
            ],
          };
        }

        case "tasks_add_comment": {
          const ident = resolveTaskIdentifier(args);
          const content = (args as any)?.content;

          if (!ident) {
            throw new Error("identifier is required — pass a UUID, short_id, or task title");
          }
          if (!content) {
            throw new Error("content is required");
          }

          logTool(name, ident.value);

          // Resolve to UUID
          let resolvedId = ident.value;
          if (ident.type !== "uuid") {
            const { issues } = await apiClient.listTasks({
              status: "all",
              limit: 100,
            });
            let match;
            if (ident.type === "short_id") {
              match = issues?.find(
                (i: any) =>
                  i.short_id?.toLowerCase() === ident.value.toLowerCase(),
              );
            } else {
              const titleLower = ident.value.toLowerCase();
              match = issues?.find(
                (i: any) =>
                  i.title.toLowerCase().includes(titleLower) || i.title.toLowerCase() === titleLower,
              );
            }
            if (!match) {
              throw new Error(`No task found matching "${ident.value}"`);
            }
            resolvedId = match.id;
          }

          const result = await apiClient.addComment(resolvedId, content);
          const elapsed = Date.now() - startTime;

          logSuccess(
            `Added comment to "${result.issue?.title}" in ${elapsed}ms`,
          );

          return {
            content: [
              {
                type: "text" as const,
                text: `💬 Comment added to [${result.issue?.short_id}] ${result.issue?.title}\n\n"${content}"\n\n🔗 ${getTaskDashboardUrl(resolvedId)}`,
              },
            ],
          };
        }

        case "collaborators_list": {
          const projectId = (args as any)?.project_id;
          const projectName = (args as any)?.project_name;

          logTool(name, projectName || projectId || "(linked project)");

          const result = await apiClient.listCollaborators({
            project_id: projectId,
            project_name: projectName,
          });
          const elapsed = Date.now() - startTime;

          logSuccess(
            `Found ${result.collaborators?.length || 0} collaborator(s) in ${elapsed}ms`,
          );

          const collaborators = result.collaborators || [];
          const collabCount = collaborators.length;

          if (collabCount === 0) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `👥 No collaborators on project "${result.project?.name || "this project"}" yet\n\n💡 Use project_share to invite collaborators`,
                },
              ],
            };
          }

          const collabLines = collaborators.map((c: any) => {
            const issueStats = `${c.issues_count || 0} tasks (${c.issues_pending || 0} pending, ${c.issues_in_progress || 0} in progress)`;
            return `📧 ${c.email}\n  📊 ${issueStats}`;
          });

          return {
            content: [
              {
                type: "text" as const,
                text: `👥 ${collabCount} collaborator${collabCount === 1 ? "" : "s"} on "${result.project?.name || "this project"}"\n\n${collabLines.join("\n\n")}\n\n💡 Use tasks_create or tasks_assign to assign tasks`,
              },
            ],
          };
        }

        case "project_share": {
          const email = (args as any)?.email;
          const projectId = (args as any)?.project_id;
          const projectName = (args as any)?.project_name;
          const message = (args as any)?.message;

          if (!email) {
            throw new Error("email is required");
          }

          logTool(
            name,
            `${email} → ${projectName || projectId || "(linked project)"}`,
          );

          const result = await apiClient.shareProject({
            email,
            project_id: projectId,
            project_name: projectName,
            message,
          });
          const elapsed = Date.now() - startTime;

          logSuccess(
            `Shared "${result.invitation.project_name}" with ${email} in ${elapsed}ms`,
          );

          return {
            content: [
              {
                type: "text" as const,
                text: `🔗 Invitation sent!\n\n📁 Project: ${result.invitation.project_name}\n📧 To: ${email}\n🔗 URL: ${result.invite_url}\n\n💡 Share this URL with the collaborator to accept the invitation`,
              },
            ],
          };
        }

        case "memory_help": {
          logTool(name);

          const helpText = `
# ContextForge Memory - Help

## Available Commands

### 📥 Save to Memory
Save code, documentation, decisions, or any knowledge.
\`\`\`
"save to memory that this project uses React 18"
"remember how the authentication flow works"
"store this API documentation in memory"
\`\`\`

### 🔍 Search Memory
Find relevant information using semantic search.
\`\`\`
"search my memory for authentication"
"what do I have saved about React?"
"find information about the login flow"
\`\`\`

### 📋 List Items
View all saved items in your memory.
\`\`\`
"list all my saved memory items"
"show me what's in my memory"
"what have I saved?"
\`\`\`

### 📂 List Spaces
View all your memory workspaces.
\`\`\`
"list my memory spaces"
"show my workspaces"
\`\`\`

### ✨ Create Space
Create a new workspace to organize knowledge.
\`\`\`
"create a new memory space called 'Backend API'"
"make a new workspace for the mobile app"
\`\`\`

### 🗑️ Delete Item
Remove an item from memory by title or ID.
\`\`\`
"delete the item about authentication from memory"
"remove 'React Setup' from my memory"
"delete item with id [uuid] from memory"
\`\`\`

### 🔗 Create Relationship
Link two knowledge items together.
\`\`\`
"relate [item1] to [item2] as 'implements'"
\`\`\`

### 📊 Get Stats
View memory usage statistics.
\`\`\`
"show my memory stats"
\`\`\`

---

## Git Integration

### 🔌 Connect Repository
Connect a GitHub repo to auto-sync commits and PRs.
\`\`\`
"connect my github repo owner/repo-name to space [space-id]"
"sync my repository https://github.com/user/project"
\`\`\`

### 📡 List Connected Repos
View all connected repositories.
\`\`\`
"list my connected git repositories"
"show my synced repos"
\`\`\`

### 🔄 Sync Commits/PRs
Sync existing commits and PRs from GitHub into memory.
\`\`\`
"sync commits from owner/repo"
"sync all from my-project"
"sync the last 50 PRs from owner/repo"
\`\`\`

### 📝 List Commits
View commits stored in memory.
\`\`\`
"list commits from owner/repo"
"show my synced commits"
"list the last 20 commits"
\`\`\`

### 🔀 List Pull Requests
View PRs stored in memory.
\`\`\`
"list PRs from owner/repo"
"show my synced pull requests"
\`\`\`

### ✅ Activate/Deactivate
Enable or disable syncing for a repository.
\`\`\`
"activate the webhook for owner/repo"
"disable git sync for my-project"
\`\`\`

### 🔌 Disconnect Repository
Stop syncing and remove a repository.
\`\`\`
"disconnect owner/repo from memory"
"remove git sync for my-project"
\`\`\`

---

## Snapshots (Version Control)

### 📸 Create Snapshot
Save the current state of your memory.
\`\`\`
"create a snapshot called 'Before refactoring'"
"backup my memory state"
\`\`\`

### 🗂️ List Snapshots
View all available snapshots.
\`\`\`
"list my memory snapshots"
"show available backups"
\`\`\`

### ⏪ Restore Snapshot
Restore memory to a previous state.
\`\`\`
"restore snapshot [id]"
"rollback to 'Before refactoring'"
\`\`\`

### 🗑️ Delete Snapshot
Remove a snapshot.
\`\`\`
"delete snapshot [id]"
\`\`\`

---

## Import/Export

### 📤 Export Space
Export all items from a space.
\`\`\`
"export my Backend space as JSON"
"export space [id] to markdown"
"download my memory as CSV"
\`\`\`

### 📥 Import Data
Import from various sources.
\`\`\`
"import this JSON data into my space"
"import from my Obsidian vault"
"import these items to memory"
\`\`\`

Supported formats:
- **contextforge**: Our native JSON format
- **markdown**: Markdown files (split by ## headers)
- **notion**: Notion export JSON
- **obsidian**: Obsidian vault export

---

## Project Linking

### 🔗 Link Project
Link your current directory to a ContextForge project.
\`\`\`
"link this directory to my project"
"link project MyProject"
"link project MyProject with create_new: true" (creates new project)
\`\`\`

### 📍 Current Project
See which project is linked to this directory.
\`\`\`
"what project is linked here?"
"show current linked project"
\`\`\`

### 🔓 Unlink Project
Remove the project link from this directory.
\`\`\`
"unlink this project"
"remove project link"
\`\`\`

**Benefits of linking:**
- Queries automatically filter to the linked project's spaces
- \`list spaces\` shows only the linked project's spaces
- Creates a \`.contextforge\` file in your project root

## Tips
- Memory persists across all your Claude Code sessions
- Search is semantic - it understands meaning, not just keywords
- Use tags to categorize your knowledge
- Create separate spaces for different projects
- **Link projects** to keep context separate between codebases

## More Info
https://github.com/alfredoizdev/contextforge-mcp
`;

          return {
            content: [
              {
                type: "text" as const,
                text: helpText,
              },
            ],
          };
        }

        case "skills_list": {
          const input = SkillsListInputSchema.parse(args);
          logTool(name, input.project_id);
          const skills = await apiClient.listSkills(input);
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(skills, null, 2),
              },
            ],
          };
        }

        case "skills_get": {
          const input = SkillsGetInputSchema.parse(args);
          logTool(name, input.id);
          const skill = await apiClient.getSkill(input);
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(skill, null, 2),
              },
            ],
          };
        }

        case "skills_create": {
          const input = SkillsCreateInputSchema.parse(args);
          logTool(name, `"${input.name}"`);
          const skill = await apiClient.createSkill(input);
          return {
            content: [
              {
                type: "text" as const,
                text: `✅ Created skill ${skill.name} (id: ${skill.id})`,
              },
            ],
          };
        }

        case "skills_update": {
          const input = SkillsUpdateInputSchema.parse(args);
          logTool(name, input.id);
          const skill = await apiClient.updateSkill(input);
          return {
            content: [
              {
                type: "text" as const,
                text: `✅ Updated skill ${skill.name}`,
              },
            ],
          };
        }

        case "skills_delete": {
          const input = SkillsDeleteInputSchema.parse(args);
          logTool(name, input.id);
          await apiClient.deleteSkill(input);
          return {
            content: [
              {
                type: "text" as const,
                text: `🗑️ Skill ${input.id} deleted`,
              },
            ],
          };
        }

        case "skills_run": {
          const input = SkillsRunInputSchema.parse(args);
          logTool(name, input.skill_id);
          const result = await apiClient.runSkill(input);
          const cost =
            typeof result?.cost_usd === "number"
              ? result.cost_usd.toFixed(4)
              : "0";
          const summary = `**Output:**\n\n${result?.output ?? ""}\n\n---\n*Tokens: ${result?.tokens_input ?? 0}/${result?.tokens_output ?? 0} • Cost: $${cost}*`;
          return {
            content: [
              {
                type: "text" as const,
                text: summary,
              },
            ],
          };
        }

        case "routines_list": {
          const input = RoutinesListInputSchema.parse(args);
          logTool(name, input.project_id);
          const routines = await apiClient.listRoutines(input);
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(routines, null, 2),
              },
            ],
          };
        }

        case "routines_get": {
          const input = RoutinesGetInputSchema.parse(args);
          logTool(name, input.id);
          const routine = await apiClient.getRoutine(input);
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(routine, null, 2),
              },
            ],
          };
        }

        case "routines_create": {
          const input = RoutinesCreateInputSchema.parse(args);
          logTool(name, input.name);
          const routine = await apiClient.createRoutine(input);
          return {
            content: [
              {
                type: "text" as const,
                text: `✅ Created routine ${routine?.name ?? input.name} (id: ${routine?.id ?? "?"})`,
              },
            ],
          };
        }

        case "routines_update": {
          const input = RoutinesUpdateInputSchema.parse(args);
          logTool(name, input.id);
          const routine = await apiClient.updateRoutine(input);
          return {
            content: [
              {
                type: "text" as const,
                text: `✅ Updated routine ${routine?.name ?? input.id}`,
              },
            ],
          };
        }

        case "routines_toggle": {
          const input = RoutinesToggleInputSchema.parse(args);
          logTool(name, `${input.id} → ${input.enabled ? "enabled" : "paused"}`);
          const routine = await apiClient.toggleRoutine(input);
          const verb = input.enabled ? "enabled" : "paused";
          return {
            content: [
              {
                type: "text" as const,
                text: `✅ Routine ${verb}: ${routine?.name ?? input.id}`,
              },
            ],
          };
        }

        case "routines_run_now": {
          const input = RoutinesRunNowInputSchema.parse(args);
          logTool(name, input.id);
          const result = await apiClient.runRoutineNow(input);
          const cost =
            typeof result?.cost_usd === "number"
              ? result.cost_usd.toFixed(4)
              : "0";
          const summary = `**Routine fired**\n\n${result?.output ?? ""}\n\n---\n*Tokens: ${result?.tokens_input ?? 0}/${result?.tokens_output ?? 0} • Cost: $${cost}*`;
          return {
            content: [
              {
                type: "text" as const,
                text: summary,
              },
            ],
          };
        }

        case "routines_delete": {
          const input = RoutinesDeleteInputSchema.parse(args);
          logTool(name, input.id);
          await apiClient.deleteRoutine(input);
          return {
            content: [
              {
                type: "text" as const,
                text: `🗑 Routine deleted: ${input.id}`,
              },
            ],
          };
        }

        default:
          logError(`Unknown tool: ${name}`);
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({
                  error: `Unknown tool: ${name}`,
                }),
              },
            ],
            isError: true,
          };
      }
    } catch (error) {
      const elapsed = Date.now() - startTime;

      if (error instanceof ApiClientError) {
        const friendlyMessage = error.getUserFriendlyMessage();
        logError(
          `${error.code}: ${friendlyMessage} (${error.statusCode}) [${elapsed}ms]`,
        );
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  error: friendlyMessage,
                  code: error.code,
                  statusCode: error.statusCode,
                  details: error.details,
                  isRetryable: error.isRetryable(),
                  isQuotaError: error.isQuotaError(),
                  isAuthError: error.isAuthError(),
                },
                null,
                2,
              ),
            },
          ],
          isError: true,
        };
      }

      if (error instanceof Error) {
        logError(`${error.message} [${elapsed}ms]`);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                error: error.message,
              }),
            },
          ],
          isError: true,
        };
      }

      logError(`Unknown error [${elapsed}ms]`);
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              error: "Unknown error occurred",
            }),
          },
        ],
        isError: true,
      };
    }
  };

  // Wrap handler to append update notice to successful responses
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const result = await originalHandler(request);
    const notice = getUpdateNotice();
    if (notice && !result.isError && result.content?.length > 0) {
      const last = result.content[result.content.length - 1];
      if (last.type === "text") {
        last.text += notice;
      }
    }
    return result;
  });

  // Start the server
  const transport = new StdioServerTransport();
  await server.connect(transport);

  logInfo("Server connected and ready");
}

main().catch((error) => {
  console.error(`${colors.red}Fatal error:${colors.reset}`, error);
  process.exit(1);
});
