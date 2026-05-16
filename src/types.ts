import { z } from "zod";

// ============ Helpers ============

/**
 * Preprocessor for array fields that may come as JSON strings from MCP clients
 * Handles both: ["tag1", "tag2"] and "[\"tag1\", \"tag2\"]"
 */
export const parseArrayInput = (val: unknown): unknown => {
  if (typeof val === "string") {
    try {
      const parsed = JSON.parse(val);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      // Not valid JSON, return as-is for Zod to handle
    }
  }
  return val;
};

/**
 * Preprocessor for number fields that may come as strings from MCP clients
 * Handles: "10" -> 10, "0.5" -> 0.5
 */
const parseNumberInput = (val: unknown): unknown => {
  if (typeof val === "string") {
    const num = Number(val);
    if (!isNaN(num)) {
      return num;
    }
  }
  return val;
};

// ============ Configuration ============

export const ConfigSchema = z.object({
  apiKey: z.string().min(1, "API key is required"),
  apiUrl: z.string().url().default("https://byzngcpqiqmqpxpmnhmo.supabase.co"),
  defaultSpace: z.string().uuid().optional(),
});

export type Config = z.infer<typeof ConfigSchema>;

// ============ API Responses ============

export interface ApiError {
  error: string;
  code?: string;
  details?: Record<string, unknown>;
}

// ============ Projects ============

export interface Project {
  id: string;
  name: string;
  slug: string;
  description?: string;
  space_count?: number;
  settings?: ProjectSettings;
  created_at: string;
  updated_at?: string;
}

export interface ProjectSettings {
  default_space_name: string;
}

export interface ProjectWithSpaces extends Project {
  spaces: Space[];
}

// ============ Spaces ============

export interface Space {
  id: string;
  name: string;
  slug: string;
  description?: string;
  project_id?: string;
  project?: {
    id: string;
    name: string;
    slug: string;
  };
  settings?: SpaceSettings;
  created_at: string;
  updated_at?: string;
}

export interface SpaceSettings {
  auto_learning: boolean;
  git_sync_enabled: boolean;
  default_priority_decay: number;
  embedding_model: string;
}

export interface KnowledgeItem {
  id: string;
  content: string;
  title?: string;
  source_type: SourceType;
  source_uri?: string;
  tags: string[];
  category?: string;
  priority_score: number;
  created_at: string;
  updated_at: string;
}

export type SourceType =
  | "manual"
  | "git_commit"
  | "git_pr"
  | "git_file"
  | "url"
  | "file_upload"
  | "api_ingestion";

export interface Relationship {
  id: string;
  source_item_id: string;
  target_item_id: string;
  relationship_type: RelationshipType;
  weight: number;
  confidence: number;
}

export interface RelationshipWithDetails {
  id: string;
  relationship_type: RelationshipType;
  weight: number;
  confidence: number;
  direction: "outgoing" | "incoming";
  related_item_id: string;
  related_item_title: string | null;
  related_item_source_type: string;
  created_at: string;
}

export type RelationshipType =
  | "references"
  | "implements"
  | "extends"
  | "depends_on"
  | "related_to"
  | "contradicts"
  | "supersedes"
  | "part_of"
  | "similar_to"
  | "derived_from";

// ============ Tool Input Schemas ============

export const IngestInputSchema = z.object({
  content: z.string().min(1, "Content is required"),
  title: z.string().optional(),
  source_type: z
    .enum(["manual", "url", "file_upload", "api_ingestion"])
    .default("manual"),
  source_uri: z.string().optional(),
  tags: z.preprocess(parseArrayInput, z.array(z.string()).default([])),
  category: z.string().optional(),
  space_id: z.string().optional(), // Accepts UUID or space name (resolved before API call)
});

export type IngestInput = z.infer<typeof IngestInputSchema>;

export const QueryInputSchema = z.object({
  query: z.string().min(1, "Query is required"),
  space_id: z.string().optional(), // Accepts UUID or space name (resolved before API call)
  project_id: z.string().optional(), // Filter to spaces within this project (auto-set from linked project)
  limit: z.preprocess(parseNumberInput, z.number().int().min(1).max(50).default(10)),
  min_score: z.preprocess(parseNumberInput, z.number().min(0).max(1).default(0.3)),
  filters: z
    .object({
      tags: z.preprocess(parseArrayInput, z.array(z.string()).optional()),
      source_types: z
        .array(
          z.enum([
            "manual",
            "git_commit",
            "git_pr",
            "git_file",
            "url",
            "file_upload",
            "api_ingestion",
          ]),
        )
        .optional(),
      category: z.string().optional(),
    })
    .optional(),
  include_relationships: z.boolean().default(false),
});

export type QueryInput = z.infer<typeof QueryInputSchema>;

export const RelateInputSchema = z.object({
  source_id: z.string().uuid(),
  target_id: z.string().uuid(),
  relationship_type: z.enum([
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
  ]),
  weight: z.preprocess(parseNumberInput, z.number().min(0).max(1).default(0.5)),
  bidirectional: z.boolean().default(false),
});

export type RelateInput = z.infer<typeof RelateInputSchema>;

export const ListRelationshipsInputSchema = z.object({
  item_id: z.string().uuid(),
});

// ============ Project Input Schemas ============

export const CreateProjectInputSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
});

export type CreateProjectInput = z.infer<typeof CreateProjectInputSchema>;

export const ListProjectsInputSchema = z.object({});

export type ListProjectsInput = z.infer<typeof ListProjectsInputSchema>;

// ============ Space Input Schemas ============

export const CreateSpaceInputSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  project_id: z.string().optional(), // UUID of project
  project_name: z.string().optional(), // Or name of project (resolved to ID)
  settings: z
    .object({
      auto_learning: z.boolean().default(true),
      git_sync_enabled: z.boolean().default(false),
    })
    .optional(),
});

export type CreateSpaceInput = z.infer<typeof CreateSpaceInputSchema>;

export const DeleteInputSchema = z
  .object({
    id: z.string().uuid().optional(),
    title: z.string().optional(),
    space_id: z.string().optional(), // Accepts UUID or space name (resolved before API call)
    cascade: z.boolean().default(false),
  })
  .refine((data) => data.id || data.title, {
    message: "Either id or title must be provided",
  });

export type DeleteInput = z.infer<typeof DeleteInputSchema>;

// ============ API Response Types ============

export interface QueryResult {
  id: string;
  content: string;
  title?: string;
  score: number;
  priority_score: number;
  source_type: SourceType;
  source_uri?: string;
  tags: string[];
  relationships?: Array<{
    type: RelationshipType;
    target_id: string;
    target_title?: string;
    weight: number;
  }>;
}

export interface ExpandedResult {
  id: string;
  title: string | null;
  content: string;
  score: number;
  source_type: string;
  tags: string[];
  expanded_from: string;
  relationship_type: string;
}

export interface QueryResponse {
  results: QueryResult[];
  expanded_results?: ExpandedResult[];
  query_embedding_cached: boolean;
  tokens_used: number;
  latency_ms: number;
}

export interface IngestResponse {
  created: number;
  duplicates_skipped: number;
  items: Array<{
    id: string;
    status: "created" | "duplicate" | "error";
    error?: string;
  }>;
  tokens_used: number;
}

export interface StatsResponse {
  space_id?: string;
  total_documents: number;
  total_relationships: number;
  total_snapshots: number;
  storage_used_mb: number;
  queries_this_month: number;
  plan: {
    name: string;
    documents_limit: number;
    queries_limit: number;
  };
}

// ============ Git Integration Types ============

export const GitConnectInputSchema = z.object({
  repo_url: z.string().min(1, "Repository URL is required"),
  space_id: z.string().uuid(),
});

export type GitConnectInput = z.infer<typeof GitConnectInputSchema>;

export const GitActivateInputSchema = z
  .object({
    repository_id: z.string().uuid().optional(),
    repo: z.string().optional(),
    active: z.boolean().default(true),
  })
  .refine((data) => data.repository_id || data.repo, {
    message: "Either repository_id or repo must be provided",
  });

export type GitActivateInput = z.infer<typeof GitActivateInputSchema>;

export const GitDisconnectInputSchema = z
  .object({
    repository_id: z.string().uuid().optional(),
    repo: z.string().optional(),
  })
  .refine((data) => data.repository_id || data.repo, {
    message: "Either repository_id or repo must be provided",
  });

export type GitDisconnectInput = z.infer<typeof GitDisconnectInputSchema>;

export interface GitRepository {
  id: string;
  owner: string;
  name: string;
  full_name: string;
  url: string;
  default_branch: string;
  webhook_active: boolean;
  status: "pending" | "active" | "error" | "disabled";
  last_sync_at?: string;
  space?: {
    id: string;
    name: string;
  };
  settings: {
    sync_commits: boolean;
    sync_prs: boolean;
    sync_readme: boolean;
    sync_file_changes: boolean;
  };
  created_at: string;
}

export interface GitConnectResponse {
  success: boolean;
  repository: {
    id: string;
    owner: string;
    name: string;
    full_name: string;
    status: string;
  };
  webhook_setup: {
    url: string;
    secret: string;
    content_type: string;
    events: string[];
    instructions: string[];
  };
}

export interface GitListResponse {
  repositories: GitRepository[];
  total: number;
}

// ============ Snapshots Types ============

export const SnapshotCreateInputSchema = z.object({
  space_id: z.string().uuid(),
  name: z.string().min(1, "Name is required"),
  description: z.string().optional(),
});

export type SnapshotCreateInput = z.infer<typeof SnapshotCreateInputSchema>;

export const SnapshotRestoreInputSchema = z.object({
  snapshot_id: z.string().uuid(),
  mode: z.enum(["merge", "replace"]).default("merge"),
});

export type SnapshotRestoreInput = z.infer<typeof SnapshotRestoreInputSchema>;

export const SnapshotDeleteInputSchema = z.object({
  snapshot_id: z.string().uuid(),
});

export type SnapshotDeleteInput = z.infer<typeof SnapshotDeleteInputSchema>;

export interface Snapshot {
  id: string;
  name: string;
  description?: string;
  item_count: number;
  size_bytes: number;
  trigger_type: "manual" | "auto" | "pre_delete" | "pre_restore" | "scheduled";
  space?: {
    id: string;
    name: string;
  };
  created_at: string;
}

export interface SnapshotListResponse {
  snapshots: Snapshot[];
  total: number;
}

export interface SnapshotCreateResponse {
  success: boolean;
  snapshot: Snapshot;
}

export interface SnapshotRestoreResponse {
  success: boolean;
  restored_from: {
    id: string;
    name: string;
  };
  auto_backup_id?: string;
  mode: "merge" | "replace";
  stats: {
    restored_count: number;
    skipped_count: number;
    deleted_count: number;
  };
}

// ============ Import/Export Types ============

export const ExportInputSchema = z.object({
  space_id: z.string().uuid(),
  format: z.enum(["json", "markdown", "csv"]).default("json"),
});

export type ExportInput = z.infer<typeof ExportInputSchema>;

export const ImportInputSchema = z.object({
  space_id: z.string().uuid(),
  format: z.enum(["contextforge", "markdown", "notion", "obsidian", "claude_memory", "knowledge_graph_jsonl", "chatgpt"]).optional(),
  data: z.any().optional(),
  items: z
    .array(
      z.object({
        title: z.string().optional(),
        content: z.string(),
        source_type: z.string().optional(),
        source_uri: z.string().optional(),
        tags: z.preprocess(parseArrayInput, z.array(z.string()).optional()),
        category: z.string().optional(),
      }),
    )
    .optional(),
});

export type ImportInput = z.infer<typeof ImportInputSchema>;

export interface ExportResponse {
  version: string;
  exported_at: string;
  space: {
    id: string;
    name: string;
    description?: string;
  };
  items: Array<{
    id: string;
    title?: string;
    content: string;
    source_type: string;
    source_uri?: string;
    tags: string[];
    category?: string;
    priority_score: number;
    created_at: string;
    updated_at: string;
  }>;
  total_items: number;
}

export interface ImportResponse {
  success: boolean;
  imported: number;
  skipped: number;
  errors?: Array<{ title: string; error: string }>;
  total_processed: number;
  space: {
    id: string;
    name: string;
  };
}

// ============ Git Sync/History Types ============

export const GitSyncInputSchema = z
  .object({
    repository_id: z.string().uuid().optional(),
    repo: z.string().optional(),
    sync_type: z.enum(["commits", "prs", "all"]).default("all"),
    limit: z.preprocess(parseNumberInput, z.number().int().min(1).max(100).default(30)),
  })
  .refine((data) => data.repository_id || data.repo, {
    message: "Either repository_id or repo must be provided",
  });

export type GitSyncInput = z.infer<typeof GitSyncInputSchema>;

export const GitHistoryInputSchema = z.object({
  type: z.enum(["commits", "prs", "all"]).default("all"),
  repository_id: z.string().uuid().optional(),
  repo: z.string().optional(),
  space_id: z.string().optional(), // Accepts UUID or space name (resolved before API call)
  limit: z.preprocess(parseNumberInput, z.number().int().min(1).max(100).default(50)),
  offset: z.preprocess(parseNumberInput, z.number().int().min(0).default(0)),
});

export type GitHistoryInput = z.infer<typeof GitHistoryInputSchema>;

export interface GitSyncResponse {
  success: boolean;
  repository: {
    id: string;
    full_name: string;
  };
  sync_type: string;
  synced: number;
  skipped: number;
  items: Array<{
    id: string;
    type: string;
    title: string;
  }>;
}

export interface GitHistoryItem {
  id: string;
  type: "commit" | "pr";
  title: string;
  content_preview: string;
  url: string;
  commit_sha?: string;
  repository: string | null;
  tags: string[];
  created_at: string;
}

export interface GitHistoryResponse {
  items: GitHistoryItem[];
  total: number;
  commits_count: number;
  prs_count: number;
  limit: number;
  offset: number;
}

// ============ Batch Operations Types ============

export const IngestBatchInputSchema = z.object({
  space_id: z.string().optional(), // Accepts UUID or space name (resolved before API call)
  items: z
    .array(
      z.object({
        content: z.string().min(1),
        title: z.string().optional(),
        source_type: z
          .enum(["manual", "url", "file_upload", "api_ingestion"])
          .default("manual"),
        source_uri: z.string().optional(),
        tags: z.preprocess(parseArrayInput, z.array(z.string()).default([])),
        category: z.string().optional(),
      }),
    )
    .min(1)
    .max(100),
});

export type IngestBatchInput = z.infer<typeof IngestBatchInputSchema>;

export const DeleteBatchInputSchema = z.object({
  space_id: z.string().optional(), // Accepts UUID or space name (resolved before API call)
  filter: z
    .object({
      tags: z.preprocess(parseArrayInput, z.array(z.string()).optional()),
      source_types: z
        .array(
          z.enum([
            "manual",
            "git_commit",
            "git_pr",
            "git_file",
            "url",
            "file_upload",
            "api_ingestion",
          ]),
        )
        .optional(),
      category: z.string().optional(),
      older_than: z.string().optional(), // ISO date
      newer_than: z.string().optional(), // ISO date
      title_contains: z.string().optional(),
      content_contains: z.string().optional(),
    })
    .optional(),
  dry_run: z.boolean().default(true), // Default to dry_run for safety
});

export type DeleteBatchInput = z.infer<typeof DeleteBatchInputSchema>;

export interface DeleteBatchResponse {
  success?: boolean;
  dry_run: boolean;
  deleted?: number;
  would_delete?: number;
  items: Array<{
    id: string;
    title: string;
    source_type?: string;
    tags?: string[];
    created_at?: string;
  }>;
  message: string;
}

// ============ Project Linking Types ============

export const LinkProjectInputSchema = z.object({
  project_name: z.string().optional(), // Name of project to link (shows list if not provided)
  create_new: z.boolean().default(false), // If true, creates a new project with this name
});

export type LinkProjectInput = z.infer<typeof LinkProjectInputSchema>;

export interface ProjectLinkConfig {
  project_id: string;
  project_name: string;
  linked_at: string;
  default_space?: string;
}

export interface LinkProjectResponse {
  success: boolean;
  linked: boolean;
  project: {
    id: string;
    name: string;
    slug: string;
  };
  config_path: string;
  message: string;
}

export interface CurrentProjectResponse {
  linked: boolean;
  project?: {
    id: string;
    name: string;
    slug: string;
    space_count?: number;
  };
  config_path?: string;
  spaces?: Array<{
    id: string;
    name: string;
    slug: string;
  }>;
  message: string;
}

// ============ Skills ============

export const SkillsListInputSchema = z.object({
  project_id: z.string().uuid(),
});
export type SkillsListInput = z.infer<typeof SkillsListInputSchema>;

export const SkillsGetInputSchema = z.object({
  id: z.string().uuid(),
});
export type SkillsGetInput = z.infer<typeof SkillsGetInputSchema>;

export const SkillsCreateInputSchema = z.object({
  project_id: z.string().uuid(),
  name: z.string().min(1).max(200),
  description: z.string().optional(),
  body: z.string().min(1),
  input_schema: z.record(z.any()).optional(),
  llm_provider: z.enum(["anthropic", "openai"]).optional(),
  model: z.string().min(1),
  save_to_space_id: z.string().uuid().optional(),
});
export type SkillsCreateInput = z.infer<typeof SkillsCreateInputSchema>;

export const SkillsUpdateInputSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(200).optional(),
  description: z.string().optional(),
  body: z.string().optional(),
  input_schema: z.record(z.any()).optional(),
  llm_provider: z.enum(["anthropic", "openai"]).optional(),
  model: z.string().optional(),
  save_to_space_id: z.string().uuid().nullable().optional(),
});
export type SkillsUpdateInput = z.infer<typeof SkillsUpdateInputSchema>;

export const SkillsDeleteInputSchema = z.object({
  id: z.string().uuid(),
});
export type SkillsDeleteInput = z.infer<typeof SkillsDeleteInputSchema>;

export const SkillsRunInputSchema = z.object({
  skill_id: z.string().uuid(),
  input_params: z.record(z.any()).optional(),
});
export type SkillsRunInput = z.infer<typeof SkillsRunInputSchema>;

// ============ Routines ============

export const SchedulePresetEnum = z.enum([
  "hourly",
  "daily",
  "weekly",
  "monthly",
  "custom",
]);
export type SchedulePreset = z.infer<typeof SchedulePresetEnum>;

export const RoutinesListInputSchema = z.object({
  project_id: z.string().uuid(),
});
export type RoutinesListInput = z.infer<typeof RoutinesListInputSchema>;

export const RoutinesGetInputSchema = z.object({
  id: z.string().uuid(),
});
export type RoutinesGetInput = z.infer<typeof RoutinesGetInputSchema>;

export const RoutinesCreateInputSchema = z.object({
  project_id: z.string().uuid(),
  skill_id: z.string().uuid(),
  name: z.string().min(1).max(200),
  schedule_preset: SchedulePresetEnum.optional(),
  cron_expression: z.string().optional(),
  timezone: z.string().optional(),
  input_params: z.record(z.any()).optional(),
});
export type RoutinesCreateInput = z.infer<typeof RoutinesCreateInputSchema>;

export const RoutinesUpdateInputSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(200).optional(),
  schedule_preset: SchedulePresetEnum.optional(),
  cron_expression: z.string().optional(),
  timezone: z.string().optional(),
  input_params: z.record(z.any()).optional(),
});
export type RoutinesUpdateInput = z.infer<typeof RoutinesUpdateInputSchema>;

export const RoutinesToggleInputSchema = z.object({
  id: z.string().uuid(),
  enabled: z.boolean(),
});
export type RoutinesToggleInput = z.infer<typeof RoutinesToggleInputSchema>;

export const RoutinesRunNowInputSchema = z.object({
  id: z.string().uuid(),
});
export type RoutinesRunNowInput = z.infer<typeof RoutinesRunNowInputSchema>;

export const RoutinesDeleteInputSchema = z.object({
  id: z.string().uuid(),
});
export type RoutinesDeleteInput = z.infer<typeof RoutinesDeleteInputSchema>;
