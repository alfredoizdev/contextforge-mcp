import { readFileSync, writeFileSync, existsSync, unlinkSync } from "fs";
import { join } from "path";
import type { GitContext } from "./freshness.js";
import type {
  Config,
  ApiError,
  Project,
  ProjectWithSpaces,
  CreateProjectInput,
  Space,
  QueryInput,
  QueryResponse,
  IngestInput,
  IngestResponse,
  CreateSpaceInput,
  RelateInput,
  Relationship,
  RelationshipWithDetails,
  StatsResponse,
  DeleteInput,
  GitConnectInput,
  GitConnectResponse,
  GitActivateInput,
  GitDisconnectInput,
  GitListResponse,
  GitSyncInput,
  GitSyncResponse,
  GitHistoryInput,
  GitHistoryResponse,
  SnapshotCreateInput,
  SnapshotCreateResponse,
  SnapshotRestoreInput,
  SnapshotRestoreResponse,
  SnapshotDeleteInput,
  SnapshotListResponse,
  ExportInput,
  ExportResponse,
  ImportInput,
  ImportResponse,
  IngestBatchInput,
  DeleteBatchInput,
  DeleteBatchResponse,
  ProjectLinkConfig,
  LinkProjectResponse,
  CurrentProjectResponse,
  AgentSession,
} from "./types.js";

// ============ Project Linking Config ============

const CONTEXTFORGE_CONFIG_FILE = ".contextforge";
const CONTEXTFORGE_LOCAL_CONFIG_FILE = ".contextforge-local";

/**
 * Check if we're running in local development mode
 * Local mode is detected when API URL points to localhost or 127.0.0.1
 */
export function isLocalMode(): boolean {
  const apiUrl = process.env.CONTEXTFORGE_API_URL || "";
  return apiUrl.includes("localhost") || apiUrl.includes("127.0.0.1");
}

/**
 * Get the appropriate config file name based on environment
 */
export function getConfigFileName(): string {
  return isLocalMode()
    ? CONTEXTFORGE_LOCAL_CONFIG_FILE
    : CONTEXTFORGE_CONFIG_FILE;
}

/**
 * Get the path to the .contextforge or .contextforge-local config file in the current working directory
 */
export function getConfigFilePath(cwd?: string): string {
  return join(cwd || process.cwd(), getConfigFileName());
}

/**
 * Read the project link configuration from .contextforge file
 */
export function readProjectLinkConfig(cwd?: string): ProjectLinkConfig | null {
  const configPath = getConfigFilePath(cwd);

  if (!existsSync(configPath)) {
    return null;
  }

  try {
    const content = readFileSync(configPath, "utf-8");
    return JSON.parse(content) as ProjectLinkConfig;
  } catch {
    return null;
  }
}

/**
 * Write the project link configuration to .contextforge file
 */
export function writeProjectLinkConfig(
  config: ProjectLinkConfig,
  cwd?: string,
): string {
  const configPath = getConfigFilePath(cwd);
  writeFileSync(configPath, JSON.stringify(config, null, 2), "utf-8");
  return configPath;
}

/**
 * Remove the .contextforge config file (unlink project)
 */
export function removeProjectLinkConfig(cwd?: string): boolean {
  const configPath = getConfigFilePath(cwd);

  if (!existsSync(configPath)) {
    return false;
  }

  try {
    unlinkSync(configPath);
    return true;
  } catch {
    return false;
  }
}

export class ApiClientError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code?: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiClientError";
  }

  /**
   * Get a user-friendly error message with actionable advice
   */
  getUserFriendlyMessage(): string {
    switch (this.code) {
      case "api_key_expired":
        if (this.details?.expires_at) {
          const expiresAt = new Date(this.details.expires_at as string);
          return (
            `Your API key expired on ${expiresAt.toLocaleDateString()}.\n\n` +
            `Please create a new API key at: https://contextforge.dev/dashboard/settings`
          );
        }
        return `Your API key has expired. Please create a new one at: https://contextforge.dev/dashboard/settings`;

      case "quota_exceeded_queries":
        if (
          this.details?.current &&
          this.details?.limit &&
          this.details?.reset_at
        ) {
          const resetAt = new Date(this.details.reset_at as string);
          return (
            `Monthly query limit reached (${this.details.current}/${this.details.limit}).\n` +
            `Your quota resets on ${resetAt.toLocaleDateString()}.\n\n` +
            `Upgrade to Pro for 100x more queries: https://contextforge.dev/pricing`
          );
        }
        return `Monthly query limit reached. Upgrade to Pro: https://contextforge.dev/pricing`;

      case "quota_exceeded_documents":
        if (this.details?.current && this.details?.limit) {
          return (
            `Document limit reached (${this.details.current}/${this.details.limit}).\n` +
            `Delete some documents or upgrade to Pro for 50x more storage: https://contextforge.dev/pricing`
          );
        }
        return `Document limit reached. Upgrade to Pro: https://contextforge.dev/pricing`;

      case "quota_exceeded_storage":
        if (this.details?.current && this.details?.limit) {
          return (
            `Storage limit reached (${this.details.current}MB/${this.details.limit}MB).\n` +
            `Delete some items or upgrade to Pro for 50x more storage: https://contextforge.dev/pricing`
          );
        }
        return `Storage limit reached. Upgrade to Pro: https://contextforge.dev/pricing`;

      case "rate_limit_exceeded":
        if (this.details?.limit) {
          return (
            `Rate limit exceeded. Maximum ${this.details.limit} requests per minute.\n` +
            `Please wait a moment before trying again.`
          );
        }
        return `Too many requests. Please wait a moment before trying again.`;

      case "api_key_revoked":
        return (
          `This API key has been revoked.\n\n` +
          `Please create a new API key at: https://contextforge.dev/dashboard/settings`
        );

      case "invalid_api_key":
      case "missing_api_key":
        return (
          `Invalid or missing API key.\n\n` +
          `Please check your API key configuration or create a new one at:\n` +
          `https://contextforge.dev/dashboard/settings`
        );

      case "NETWORK_ERROR":
        return (
          `Network error: Could not connect to ContextForge API.\n` +
          `Please check your internet connection and try again.`
        );

      default:
        return this.message || "An unknown error occurred";
    }
  }

  /**
   * Check if this error is recoverable with a retry
   */
  isRetryable(): boolean {
    return this.code === "NETWORK_ERROR" || this.code === "rate_limit_exceeded";
  }

  /**
   * Check if this error is a quota limit error
   */
  isQuotaError(): boolean {
    return (
      (typeof this.code === "string" &&
        this.code.startsWith("quota_exceeded_")) ||
      false
    );
  }

  /**
   * Check if this error is an authentication error
   */
  isAuthError(): boolean {
    return [
      "api_key_expired",
      "api_key_revoked",
      "invalid_api_key",
      "missing_api_key",
    ].includes(this.code || "");
  }
}

/** Builds an ApiClientError from either backend error shape:
 * `{error: <code>, message: <human>}` (auth) or `{error: <human>, code}`
 * (ingest/query). Deriving code defensively keeps getUserFriendlyMessage and
 * the isAuthError/isQuotaError flags alive for both — otherwise the auth shape
 * leaves `code` undefined and every friendly message/flag falls through. */
export function parseApiError(
  errorData: ApiError,
  status: number,
): ApiClientError {
  return new ApiClientError(
    errorData.message ?? errorData.error,
    status,
    errorData.code ?? errorData.error,
    errorData.details,
  );
}

export class ApiClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly defaultSpaceId?: string;

  constructor(config: Config) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.apiUrl.replace(/\/$/, "");
    this.defaultSpaceId = config.defaultSpace;
  }

  private async request<T>(
    method: "GET" | "POST" | "PATCH" | "DELETE",
    path: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
    };

    const options: RequestInit = {
      method,
      headers,
    };

    if (body && (method === "POST" || method === "PATCH")) {
      options.body = JSON.stringify(body);
    }

    let response: Response;
    try {
      response = await fetch(url, options);
    } catch (error) {
      throw new ApiClientError(
        `Network error: ${error instanceof Error ? error.message : "Unknown error"}`,
        0,
        "NETWORK_ERROR",
      );
    }

    const contentType = response.headers.get("content-type");
    const isJson = contentType?.includes("application/json");

    if (!response.ok) {
      let errorData: ApiError = { error: "Unknown error" };

      if (isJson) {
        try {
          errorData = (await response.json()) as ApiError;
        } catch {
          // Ignore JSON parse errors
        }
      }

      throw parseApiError(errorData, response.status);
    }

    if (!isJson) {
      return {} as T;
    }

    return response.json() as Promise<T>;
  }

  private getSpaceId(providedSpaceId?: string): string | undefined {
    // Return the provided space_id, or the default, or undefined
    // The backend will handle missing space_id by using the user's default space
    return providedSpaceId ?? this.defaultSpaceId;
  }

  // ============ Projects ============

  async listProjects(): Promise<Project[]> {
    const response = await this.request<{ projects: Project[] } | Project[]>(
      "GET",
      "/functions/v1/projects",
    );
    // Handle both formats: array or object with projects property
    if (Array.isArray(response)) {
      return response;
    }
    return response.projects || [];
  }

  async getProject(projectId: string): Promise<ProjectWithSpaces> {
    return this.request<ProjectWithSpaces>(
      "GET",
      `/functions/v1/projects?id=${projectId}`,
    );
  }

  async createProject(input: CreateProjectInput): Promise<Project> {
    return this.request<Project>("POST", "/functions/v1/projects", {
      name: input.name,
      description: input.description,
    });
  }

  async deleteProject(
    projectId: string,
    cascade = true,
  ): Promise<{ success: boolean; message: string }> {
    return this.request(
      "DELETE",
      `/functions/v1/projects?id=${projectId}&cascade=${cascade}`,
    );
  }

  /**
   * Find a project by name or slug (case-insensitive)
   */
  async findProjectByName(name: string): Promise<Project | null> {
    const projects = await this.listProjects();
    const nameLower = name.toLowerCase();
    return (
      projects.find(
        (p) =>
          p.name.toLowerCase() === nameLower ||
          p.slug.toLowerCase() === nameLower,
      ) || null
    );
  }

  /**
   * Resolve a project identifier (UUID or name) to a project ID
   */
  async resolveProjectId(
    projectIdOrName?: string,
  ): Promise<string | undefined> {
    if (!projectIdOrName) {
      return undefined;
    }

    // Check if it's a UUID format
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (uuidRegex.test(projectIdOrName)) {
      return projectIdOrName;
    }

    // Otherwise, try to find by name
    const project = await this.findProjectByName(projectIdOrName);
    return project?.id;
  }

  // ============ Spaces ============

  async listSpaces(
    projectId?: string,
    spaceType?: "regular" | "git" | "all",
  ): Promise<Space[]> {
    const params = new URLSearchParams();
    if (projectId) params.set("project_id", projectId);
    if (spaceType && spaceType !== "all") params.set("space_type", spaceType);
    const queryString = params.toString();
    const path = `/functions/v1/spaces${queryString ? `?${queryString}` : ""}`;
    return this.request<Space[]>("GET", path);
  }

  async getSpace(spaceId: string): Promise<Space> {
    const spaces = await this.request<Space[]>("GET", "/functions/v1/spaces");
    const space = spaces.find((s) => s.id === spaceId);
    if (!space) {
      throw new ApiClientError("Space not found", 404, "NOT_FOUND");
    }
    return space;
  }

  /**
   * Find a space by name or slug (case-insensitive)
   */
  async findSpaceByName(name: string): Promise<Space | null> {
    const spaces = await this.request<Space[]>("GET", "/functions/v1/spaces");
    const nameLower = name.toLowerCase();
    return (
      spaces.find(
        (s) =>
          s.name.toLowerCase() === nameLower ||
          s.slug.toLowerCase() === nameLower,
      ) || null
    );
  }

  /**
   * Resolve a space identifier (UUID or name) to a space ID
   */
  async resolveSpaceId(spaceIdOrName?: string): Promise<string | undefined> {
    if (!spaceIdOrName) {
      return this.defaultSpaceId;
    }

    // Check if it's a UUID format
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (uuidRegex.test(spaceIdOrName)) {
      return spaceIdOrName;
    }

    // Otherwise, try to find by name
    const space = await this.findSpaceByName(spaceIdOrName);
    return space?.id;
  }

  async createSpace(input: CreateSpaceInput): Promise<Space> {
    return this.request<Space>("POST", "/functions/v1/spaces", {
      name: input.name,
      description: input.description,
      project_id: input.project_id,
      project_name: input.project_name,
    });
  }

  async deleteSpace(
    spaceIdOrName: string,
  ): Promise<{ success: boolean; message: string }> {
    // Determine if it's a UUID or name
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const isUuid = uuidRegex.test(spaceIdOrName);

    const params = new URLSearchParams();
    if (isUuid) {
      params.set("id", spaceIdOrName);
    } else {
      params.set("name", spaceIdOrName);
    }

    return this.request<{ success: boolean; message: string }>(
      "DELETE",
      `/functions/v1/spaces?${params.toString()}`,
    );
  }

  /**
   * Update a space (move to different project, rename, or update description)
   */
  async updateSpace(
    spaceIdOrName: string,
    updates: {
      project_id?: string;
      project_name?: string;
      name?: string;
      description?: string;
    },
  ): Promise<Space> {
    // Determine if it's a UUID or name
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const isUuid = uuidRegex.test(spaceIdOrName);

    const params = new URLSearchParams();
    if (isUuid) {
      params.set("id", spaceIdOrName);
    } else {
      params.set("name", spaceIdOrName);
    }

    return this.request<Space>(
      "PATCH",
      `/functions/v1/spaces?${params.toString()}`,
      updates,
    );
  }

  /**
   * Move a space to a different project
   */
  async moveSpace(
    spaceIdOrName: string,
    targetProjectIdOrName: string,
  ): Promise<Space> {
    // Determine if target is UUID or name
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const isUuid = uuidRegex.test(targetProjectIdOrName);

    if (isUuid) {
      return this.updateSpace(spaceIdOrName, {
        project_id: targetProjectIdOrName,
      });
    } else {
      return this.updateSpace(spaceIdOrName, {
        project_name: targetProjectIdOrName,
      });
    }
  }

  // ============ Query ============

  async query(input: QueryInput): Promise<QueryResponse> {
    const spaceId = this.getSpaceId(input.space_id);

    // If no space_id specified, use linked project to filter results
    let projectId = input.project_id;
    if (!spaceId && !projectId) {
      projectId = this.getLinkedProjectId();
    }

    return this.request<QueryResponse>("POST", "/functions/v1/query", {
      space_id: spaceId,
      project_id: projectId,
      query: input.query,
      limit: input.limit,
      min_score: input.min_score,
      filters: input.filters,
      include_relationships: input.include_relationships,
    });
  }

  // ============ Get Item by ID ============

  async getItem(id: string): Promise<{
    id: string;
    title: string | null;
    content: string;
    source_type: string;
    source_uri: string | null;
    tags: string[];
    category: string | null;
    created_at: string;
    updated_at: string;
  } | null> {
    try {
      return await this.request("GET", `/functions/v1/items?id=${id}`);
    } catch (error) {
      if (error instanceof ApiClientError && error.statusCode === 404) {
        return null;
      }
      throw error;
    }
  }

  // ============ Ingest ============

  async ingest(
    input: IngestInput & { git_context?: GitContext | null },
  ): Promise<IngestResponse> {
    const spaceId = this.getSpaceId(input.space_id);

    return this.request<IngestResponse>("POST", "/functions/v1/ingest", {
      space_id: spaceId,
      items: [
        {
          content: input.content,
          title: input.title,
          source_type: input.source_type,
          source_uri: input.source_uri,
          tags: input.tags,
          category: input.category,
          git_context: input.git_context ?? null,
        },
      ],
      options: {
        deduplicate: input.deduplicate ?? true,
        chunk_large_content: true,
      },
    });
  }

  async ingestBatch(
    spaceId: string | undefined,
    items: Array<Omit<IngestInput, "space_id">>,
  ): Promise<IngestResponse> {
    const resolvedSpaceId = this.getSpaceId(spaceId);

    return this.request<IngestResponse>("POST", "/functions/v1/ingest", {
      space_id: resolvedSpaceId,
      items: items.map((item) => ({
        content: item.content,
        title: item.title,
        source_type: item.source_type ?? "manual",
        source_uri: item.source_uri,
        tags: item.tags ?? [],
        category: item.category,
      })),
      options: {
        deduplicate: true,
        chunk_large_content: true,
      },
    });
  }

  // ============ Relationships ============

  async relate(input: RelateInput): Promise<Relationship> {
    return this.request<Relationship>("POST", "/functions/v1/relationships", {
      source_item_id: input.source_id,
      target_item_id: input.target_id,
      relationship_type: input.relationship_type,
      weight: input.weight,
      bidirectional: input.bidirectional,
    });
  }

  async getRelationships(
    itemId: string,
  ): Promise<{ relationships: RelationshipWithDetails[] }> {
    return this.request<{ relationships: RelationshipWithDetails[] }>(
      "GET",
      `/functions/v1/relationships?item_id=${encodeURIComponent(itemId)}`,
    );
  }

  async deleteRelationship(id: string): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>(
      "DELETE",
      `/functions/v1/relationships?id=${encodeURIComponent(id)}`,
    );
  }

  // ============ Delete ============

  async deleteItem(input: DeleteInput): Promise<{ id: string; title: string }> {
    const result = await this.request<{
      success: boolean;
      deleted: { id: string; title: string };
    }>("POST", "/functions/v1/delete-item", {
      id: input.id,
      title: input.title,
    });
    return result.deleted;
  }

  // ============ Stats ============

  async getStats(spaceId?: string): Promise<StatsResponse> {
    const resolvedSpaceId = spaceId ?? this.defaultSpaceId;
    const path = resolvedSpaceId
      ? `/functions/v1/stats?space_id=${resolvedSpaceId}`
      : "/functions/v1/stats";

    return this.request<StatsResponse>("GET", path);
  }

  // ============ List Items ============

  async listItems(
    spaceId?: string,
    limit?: number,
    offset?: number,
  ): Promise<{
    items: Array<{
      id: string;
      title: string;
      content_preview: string;
      source_type: string;
      tags: string[];
      category?: string;
      space: string;
      created_at: string;
    }>;
    total: number;
    limit: number;
    offset: number;
  }> {
    const params = new URLSearchParams();
    if (spaceId) params.set("space_id", spaceId);
    if (limit) params.set("limit", limit.toString());
    if (offset) params.set("offset", offset.toString());

    const queryString = params.toString();
    const path = `/functions/v1/items${queryString ? `?${queryString}` : ""}`;

    return this.request("GET", path);
  }

  // ============ Health Check ============

  async healthCheck(): Promise<boolean> {
    try {
      await this.request<{ status: string }>("GET", "/functions/v1/health");
      return true;
    } catch {
      return false;
    }
  }

  // ============ Git Integration ============

  async gitConnect(input: GitConnectInput): Promise<GitConnectResponse> {
    return this.request<GitConnectResponse>("POST", "/functions/v1/git-repos", {
      repo_url: input.repo_url,
      space_id: input.space_id,
    });
  }

  async gitList(spaceId?: string): Promise<GitListResponse> {
    const params = new URLSearchParams();
    if (spaceId) params.set("space_id", spaceId);
    const queryString = params.toString();
    const path = `/functions/v1/git-repos${queryString ? `?${queryString}` : ""}`;
    return this.request<GitListResponse>("GET", path);
  }

  async gitActivate(
    input: GitActivateInput,
  ): Promise<{
    success: boolean;
    repository: {
      id: string;
      full_name: string;
      status: string;
      webhook_active: boolean;
    };
    message: string;
  }> {
    return this.request("POST", "/functions/v1/git-activate", {
      repository_id: input.repository_id,
      repo: input.repo,
      active: input.active,
    });
  }

  async gitDisconnect(
    input: GitDisconnectInput,
  ): Promise<{ success: boolean; message: string }> {
    const params = new URLSearchParams();
    if (input.repository_id) params.set("id", input.repository_id);
    if (input.repo) params.set("repo", input.repo);
    return this.request(
      "DELETE",
      `/functions/v1/git-repos?${params.toString()}`,
    );
  }

  async gitSync(input: GitSyncInput): Promise<GitSyncResponse> {
    return this.request<GitSyncResponse>("POST", "/functions/v1/git-sync", {
      repository_id: input.repository_id,
      repo: input.repo,
      sync_type: input.sync_type,
      limit: input.limit,
    });
  }

  async gitHistory(input: GitHistoryInput): Promise<GitHistoryResponse> {
    const params = new URLSearchParams();
    if (input.type) params.set("type", input.type);
    if (input.repository_id) params.set("repository_id", input.repository_id);
    if (input.repo) params.set("repo", input.repo);
    if (input.space_id) params.set("space_id", input.space_id);
    if (input.limit) params.set("limit", input.limit.toString());
    if (input.offset) params.set("offset", input.offset.toString());
    return this.request<GitHistoryResponse>(
      "GET",
      `/functions/v1/git-history?${params.toString()}`,
    );
  }

  // ============ Snapshots ============

  async snapshotCreate(
    input: SnapshotCreateInput,
  ): Promise<SnapshotCreateResponse> {
    return this.request<SnapshotCreateResponse>(
      "POST",
      "/functions/v1/snapshots",
      {
        space_id: input.space_id,
        name: input.name,
        description: input.description,
      },
    );
  }

  async snapshotList(spaceId?: string): Promise<SnapshotListResponse> {
    const params = new URLSearchParams();
    if (spaceId) params.set("space_id", spaceId);
    const queryString = params.toString();
    const path = `/functions/v1/snapshots${queryString ? `?${queryString}` : ""}`;
    return this.request<SnapshotListResponse>("GET", path);
  }

  async snapshotRestore(
    input: SnapshotRestoreInput,
  ): Promise<SnapshotRestoreResponse> {
    return this.request<SnapshotRestoreResponse>(
      "POST",
      "/functions/v1/snapshots",
      {
        action: "restore",
        snapshot_id: input.snapshot_id,
        mode: input.mode,
      },
    );
  }

  async snapshotDelete(
    input: SnapshotDeleteInput,
  ): Promise<{ success: boolean; message: string }> {
    return this.request(
      "DELETE",
      `/functions/v1/snapshots?id=${input.snapshot_id}`,
    );
  }

  // ============ Import/Export ============

  async exportSpace(input: ExportInput): Promise<ExportResponse> {
    const params = new URLSearchParams();
    params.set("space_id", input.space_id);
    params.set("format", input.format || "json");
    return this.request<ExportResponse>(
      "GET",
      `/functions/v1/export?${params.toString()}`,
    );
  }

  async importToSpace(input: ImportInput): Promise<ImportResponse> {
    return this.request<ImportResponse>("POST", "/functions/v1/import", {
      space_id: input.space_id,
      format: input.format,
      data: input.data,
      items: input.items,
    });
  }

  // ============ Batch Operations ============

  async ingestBatchItems(input: IngestBatchInput): Promise<IngestResponse> {
    const spaceId = this.getSpaceId(input.space_id);

    return this.request<IngestResponse>("POST", "/functions/v1/ingest", {
      space_id: spaceId,
      items: input.items.map((item) => ({
        content: item.content,
        title: item.title,
        source_type: item.source_type ?? "manual",
        source_uri: item.source_uri,
        tags: item.tags ?? [],
        category: item.category,
      })),
      options: {
        deduplicate: true,
        chunk_large_content: true,
      },
    });
  }

  async deleteBatch(input: DeleteBatchInput): Promise<DeleteBatchResponse> {
    return this.request<DeleteBatchResponse>(
      "POST",
      "/functions/v1/delete-batch",
      {
        space_id: input.space_id,
        filter: input.filter,
        dry_run: input.dry_run ?? true,
      },
    );
  }

  // ============ Project Linking ============

  /**
   * Link the current directory to a ContextForge project
   */
  async linkProject(
    projectName?: string,
    createNew = false,
  ): Promise<LinkProjectResponse> {
    let project: Project | null = null;

    if (projectName) {
      if (createNew) {
        // Create a new project
        project = await this.createProject({ name: projectName });
      } else {
        // Find existing project by name
        project = await this.findProjectByName(projectName);
        if (!project) {
          throw new ApiClientError(
            `Project not found: ${projectName}`,
            404,
            "PROJECT_NOT_FOUND",
          );
        }
      }
    }

    if (!project) {
      // If no project name provided, we need to list projects for user to choose
      // This will be handled by the tool - return available projects
      const projects = await this.listProjects();
      if (projects.length === 0) {
        throw new ApiClientError(
          "No projects found. Create a project first or use create_new: true",
          404,
          "NO_PROJECTS",
        );
      }
      // Return first project as suggestion, tool will handle the interaction
      throw new ApiClientError(
        "Please specify a project name to link",
        400,
        "PROJECT_NAME_REQUIRED",
        {
          available_projects: projects.map((p) => ({
            id: p.id,
            name: p.name,
            slug: p.slug,
          })),
        },
      );
    }

    // Write the config file
    const config: ProjectLinkConfig = {
      project_id: project.id,
      project_name: project.name,
      linked_at: new Date().toISOString(),
    };

    const configPath = writeProjectLinkConfig(config);

    return {
      success: true,
      linked: true,
      project: {
        id: project.id,
        name: project.name,
        slug: project.slug,
      },
      config_path: configPath,
      message: `Project "${project.name}" linked to this directory`,
    };
  }

  /**
   * Unlink the current directory from any ContextForge project
   */
  unlinkProject(): { success: boolean; message: string; config_path: string } {
    const configPath = getConfigFilePath();
    const removed = removeProjectLinkConfig();

    if (!removed) {
      return {
        success: false,
        message: "No project linked to this directory",
        config_path: configPath,
      };
    }

    return {
      success: true,
      message: "Project unlinked from this directory",
      config_path: configPath,
    };
  }

  /**
   * Get the currently linked project for this directory
   */
  async getCurrentProject(): Promise<CurrentProjectResponse> {
    const config = readProjectLinkConfig();
    const configPath = getConfigFilePath();

    if (!config) {
      return {
        linked: false,
        message:
          "No project linked to this directory. Use memory_link_project to link one.",
      };
    }

    // Verify the project still exists and get its details
    try {
      const project = await this.findProjectByName(config.project_name);
      if (!project) {
        return {
          linked: false,
          config_path: configPath,
          message: `Linked project "${config.project_name}" no longer exists. Use memory_link_project to link a new one.`,
        };
      }

      // Get spaces in this project
      const spaces = await this.listSpaces(project.id);

      return {
        linked: true,
        project: {
          id: project.id,
          name: project.name,
          slug: project.slug,
          space_count: spaces.length,
        },
        config_path: configPath,
        spaces: spaces.map((s) => ({
          id: s.id,
          name: s.name,
          slug: s.slug,
        })),
        message: `This directory is linked to project "${project.name}" with ${spaces.length} space(s)`,
      };
    } catch {
      return {
        linked: true,
        project: {
          id: config.project_id,
          name: config.project_name,
          slug: config.project_name.toLowerCase().replace(/\s+/g, "-"),
        },
        config_path: configPath,
        message: `This directory is linked to project "${config.project_name}" (unable to verify remotely)`,
      };
    }
  }

  /**
   * Get the linked project ID if any (for use in other methods)
   */
  getLinkedProjectId(): string | undefined {
    const config = readProjectLinkConfig();
    return config?.project_id;
  }

  // ============ Tasks ============

  /**
   * List tasks assigned to the current user
   */
  async listTasks(input: {
    status?: string;
    project_id?: string;
    scope?: string;
    limit?: number;
  }): Promise<{ issues: any[]; total: number }> {
    // Use linked project if no project_id specified
    const projectId = input.project_id || this.getLinkedProjectId();

    const params = new URLSearchParams();
    if (input.status) params.set("status", input.status); // API defaults to 'pending' if not specified
    if (projectId) params.set("project_id", projectId);
    if (input.scope) params.set("scope", input.scope);
    if (input.limit) params.set("limit", input.limit.toString());

    const response = await fetch(
      `${this.baseUrl}/functions/v1/issues?${params.toString()}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
      },
    );

    if (!response.ok) {
      const errorData = (await response
        .json()
        .catch(() => ({ message: response.statusText }))) as {
        error?: string;
        message?: string;
        code?: string;
      };
      throw new ApiClientError(
        errorData.error || errorData.message || "Failed to list tasks",
        response.status,
        errorData.code || "tasks_error",
      );
    }

    return response.json() as Promise<{ issues: any[]; total: number }>;
  }

  /**
   * Update the status of a task
   * Supports both UUID and short_id (6 alphanumeric chars)
   */
  async updateTaskStatus(
    issueId: string,
    status: "pending" | "in_progress" | "resolved",
  ): Promise<{ success: boolean; issue: any }> {
    // Detect if issueId is a short_id (6 alphanumeric chars) or UUID
    const isShortId = /^[a-z0-9]{6}$/i.test(issueId) && !issueId.includes("-");

    const body: Record<string, string> = { status };
    let url = `${this.baseUrl}/functions/v1/issues`;

    if (isShortId) {
      // Pass short_id in body for Edge Function to resolve
      body.short_id = issueId;
    } else {
      // Pass UUID in query param
      url += `?id=${issueId}`;
    }

    const response = await fetch(url, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorData = (await response
        .json()
        .catch(() => ({ message: response.statusText }))) as {
        error?: string;
        message?: string;
        code?: string;
      };
      throw new ApiClientError(
        errorData.error || errorData.message || "Failed to update task",
        response.status,
        errorData.code || "tasks_error",
      );
    }

    return response.json() as Promise<{ success: boolean; issue: any }>;
  }

  /**
   * Get the next recommended task to work on
   */
  async getNextTask(): Promise<{
    issue: any | null;
    reason: string;
    pending_count: number;
  }> {
    // Get pending tasks sorted by priority
    const { issues } = await this.listTasks({ status: "pending", limit: 10 });

    if (!issues || issues.length === 0) {
      return {
        issue: null,
        reason: "No pending tasks",
        pending_count: 0,
      };
    }

    // Sort by priority (urgent > high > medium > low) then by due date
    const priorityOrder: Record<string, number> = {
      urgent: 0,
      high: 1,
      medium: 2,
      low: 3,
    };
    const sorted = issues.sort((a: any, b: any) => {
      const priorityDiff =
        (priorityOrder[a.priority] ?? 3) - (priorityOrder[b.priority] ?? 3);
      if (priorityDiff !== 0) return priorityDiff;

      // Then by due date (earliest first)
      if (a.due_date && b.due_date) {
        return new Date(a.due_date).getTime() - new Date(b.due_date).getTime();
      }
      if (a.due_date) return -1;
      if (b.due_date) return 1;

      return 0;
    });

    const nextIssue = sorted[0];
    let reason = `Highest priority task (${nextIssue.priority})`;

    if (nextIssue.due_date) {
      const dueDate = new Date(nextIssue.due_date);
      const today = new Date();
      const daysUntilDue = Math.ceil(
        (dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
      );

      if (daysUntilDue <= 0) {
        reason = "OVERDUE - this task needs immediate attention";
      } else if (daysUntilDue <= 2) {
        reason = `Due soon (${daysUntilDue} day${daysUntilDue === 1 ? "" : "s"})`;
      }
    }

    return {
      issue: nextIssue,
      reason,
      pending_count: issues.length,
    };
  }

  /**
   * Create a new task
   */
  async createTask(input: {
    title: string;
    description?: string;
    project_id?: string;
    project_name?: string;
    priority?: string;
    assignee_email?: string;
    due_date?: string;
    tags?: string[];
    space_id?: string;
  }): Promise<{ success: boolean; issue: any }> {
    // Resolve project_id from name if needed
    let projectId = input.project_id;
    if (!projectId && input.project_name) {
      projectId = await this.resolveProjectId(input.project_name);
    }
    // If no project specified, use linked project
    if (!projectId) {
      projectId = this.getLinkedProjectId();
    }

    const response = await fetch(`${this.baseUrl}/functions/v1/issues`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        title: input.title,
        description: input.description,
        project_id: projectId,
        priority: input.priority || "medium",
        assignee_email: input.assignee_email,
        due_date: input.due_date,
        tags: input.tags,
        space_id: input.space_id,
      }),
    });

    if (!response.ok) {
      const errorData = (await response
        .json()
        .catch(() => ({ message: response.statusText }))) as {
        error?: string;
        message?: string;
        code?: string;
      };
      throw new ApiClientError(
        errorData.error || errorData.message || "Failed to create task",
        response.status,
        errorData.code || "tasks_error",
      );
    }

    return response.json() as Promise<{ success: boolean; issue: any }>;
  }

  /**
   * Update a task's fields (title, description, status, priority, tags, due_date, assignee)
   * Supports both UUID and short_id for identification
   */
  async updateTask(input: {
    issue_id?: string;
    short_id?: string;
    title?: string;
    description?: string;
    status?: string;
    priority?: string;
    tags?: string[];
    due_date?: string | null;
    assignee_email?: string;
  }): Promise<{ success: boolean; issue: any }> {
    const body: Record<string, any> = {};

    // Set identification
    if (input.short_id) {
      body.short_id = input.short_id;
    }

    // Set updatable fields
    if (input.title !== undefined) body.title = input.title;
    if (input.description !== undefined) body.description = input.description;
    if (input.status !== undefined) body.status = input.status;
    if (input.priority !== undefined) body.priority = input.priority;
    if (input.tags !== undefined) body.tags = input.tags;
    if (input.due_date !== undefined) body.due_date = input.due_date;
    if (input.assignee_email !== undefined)
      body.assignee_email = input.assignee_email;

    // Build URL with UUID if provided
    let url = `${this.baseUrl}/functions/v1/issues`;
    if (input.issue_id && !input.short_id) {
      url += `?id=${input.issue_id}`;
    }

    const response = await fetch(url, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorData = (await response
        .json()
        .catch(() => ({ message: response.statusText }))) as {
        error?: string;
        message?: string;
        code?: string;
      };
      throw new ApiClientError(
        errorData.error || errorData.message || "Failed to update task",
        response.status,
        errorData.code || "tasks_error",
      );
    }

    return response.json() as Promise<{ success: boolean; issue: any }>;
  }

  /**
   * Assign a task to a collaborator by email
   */
  async assignTask(input: {
    issue_id?: string;
    short_id?: string;
    issue_title?: string;
    assignee_email: string;
  }): Promise<{ success: boolean; issue: any }> {
    const response = await fetch(`${this.baseUrl}/functions/v1/issues`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        id: input.issue_id,
        short_id: input.short_id,
        title: input.issue_title,
        action: "assign",
        assignee_email: input.assignee_email,
      }),
    });

    if (!response.ok) {
      const errorData = (await response
        .json()
        .catch(() => ({ message: response.statusText }))) as {
        error?: string;
        message?: string;
        code?: string;
      };
      throw new ApiClientError(
        errorData.error || errorData.message || "Failed to assign task",
        response.status,
        errorData.code || "tasks_error",
      );
    }

    return response.json() as Promise<{ success: boolean; issue: any }>;
  }

  /**
   * Resolve a task by searching for it by title
   */
  async resolveTaskByName(
    title: string,
  ): Promise<{ success: boolean; issue: any }> {
    // First, find the task by title
    const { issues } = await this.listTasks({ status: "all", limit: 100 });

    const titleLower = title.toLowerCase();
    const matchingIssue = issues?.find(
      (i: any) =>
        i.title.toLowerCase().includes(titleLower) ||
        i.title.toLowerCase() === titleLower,
    );

    if (!matchingIssue) {
      throw new ApiClientError(
        `No task found matching "${title}"`,
        404,
        "task_not_found",
      );
    }

    // Now resolve it
    return this.updateTaskStatus(matchingIssue.id, "resolved");
  }

  /**
   * List comments on a task
   */
  async listComments(issueId: string): Promise<{ comments: any[]; total: number }> {
    const params = new URLSearchParams();
    params.set("action", "list_comments");
    params.set("issue_id", issueId);

    const response = await fetch(
      `${this.baseUrl}/functions/v1/issues?${params.toString()}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
      },
    );

    if (!response.ok) {
      const errorData = (await response
        .json()
        .catch(() => ({ message: response.statusText }))) as {
        error?: string;
        message?: string;
        code?: string;
      };
      throw new ApiClientError(
        errorData.error || errorData.message || "Failed to list comments",
        response.status,
        errorData.code || "tasks_error",
      );
    }

    return response.json() as Promise<{ comments: any[]; total: number }>;
  }

  /**
   * Add a comment to a task
   */
  async addComment(
    issueId: string,
    content: string,
  ): Promise<{ success: boolean; comment: any; issue: any }> {
    const response = await fetch(`${this.baseUrl}/functions/v1/issues`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        action: "add_comment",
        issue_id: issueId,
        content,
      }),
    });

    if (!response.ok) {
      const errorData = (await response
        .json()
        .catch(() => ({ message: response.statusText }))) as {
        error?: string;
        message?: string;
        code?: string;
      };
      throw new ApiClientError(
        errorData.error || errorData.message || "Failed to add comment",
        response.status,
        errorData.code || "tasks_error",
      );
    }

    return response.json() as Promise<{
      success: boolean;
      comment: any;
      issue: any;
    }>;
  }

  /**
   * List collaborators on a project
   */
  async listCollaborators(input: {
    project_id?: string;
    project_name?: string;
  }): Promise<{
    project: { id: string; name: string } | null;
    collaborators: any[];
  }> {
    // Resolve project_id from name if needed
    let projectId = input.project_id;
    if (!projectId && input.project_name) {
      projectId = await this.resolveProjectId(input.project_name);
    }
    // If no project specified, use linked project
    if (!projectId) {
      projectId = this.getLinkedProjectId();
    }

    const params = new URLSearchParams();
    if (projectId) params.set("project_id", projectId);

    const response = await fetch(
      `${this.baseUrl}/functions/v1/collaborators?${params.toString()}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
      },
    );

    if (!response.ok) {
      const errorData = (await response
        .json()
        .catch(() => ({ message: response.statusText }))) as {
        error?: string;
        message?: string;
        code?: string;
      };
      throw new ApiClientError(
        errorData.error || errorData.message || "Failed to list collaborators",
        response.status,
        errorData.code || "collaborators_error",
      );
    }

    return response.json() as Promise<{
      project: { id: string; name: string } | null;
      collaborators: any[];
    }>;
  }

  /**
   * Delete a task by ID or short_id (soft delete)
   */
  async deleteTask(
    issueId: string,
  ): Promise<{ id: string; short_id: string; title: string }> {
    // Detect if issueId is a short_id (6 alphanumeric chars) or UUID
    const isShortId = /^[a-z0-9]{6}$/i.test(issueId) && !issueId.includes("-");

    const params = new URLSearchParams();
    if (isShortId) {
      params.set("short_id", issueId);
    } else {
      params.set("id", issueId);
    }

    const response = await fetch(
      `${this.baseUrl}/functions/v1/issues?${params.toString()}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
      },
    );

    if (!response.ok) {
      const errorData = (await response
        .json()
        .catch(() => ({ message: response.statusText }))) as {
        error?: string;
        message?: string;
        code?: string;
      };
      throw new ApiClientError(
        errorData.error || errorData.message || "Failed to delete task",
        response.status,
        errorData.code || "tasks_error",
      );
    }

    return response.json() as Promise<{
      id: string;
      short_id: string;
      title: string;
    }>;
  }

  /**
   * Share a project with a collaborator by email
   */
  async shareProject(input: {
    email: string;
    project_id?: string;
    project_name?: string;
    message?: string;
  }): Promise<{
    success: boolean;
    invitation: {
      id: string;
      email: string;
      expires_at: string;
      project_id: string;
      project_name: string;
    };
    invite_url: string;
    message: string;
  }> {
    // Resolve project_id from name if needed
    let projectId = input.project_id;
    if (!projectId && input.project_name) {
      projectId = await this.resolveProjectId(input.project_name);
    }
    // If no project specified, use linked project
    if (!projectId) {
      projectId = this.getLinkedProjectId();
    }

    if (!projectId) {
      throw new ApiClientError(
        "Project ID is required. Specify project_id, project_name, or link a project.",
        400,
        "project_required",
      );
    }

    const response = await fetch(`${this.baseUrl}/functions/v1/invitations`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: input.email,
        project_id: projectId,
        message: input.message,
      }),
    });

    if (!response.ok) {
      const errorData = (await response
        .json()
        .catch(() => ({ message: response.statusText }))) as {
        message?: string;
        code?: string;
        error?: string;
      };
      throw new ApiClientError(
        errorData.error || errorData.message || "Failed to share project",
        response.status,
        errorData.code || "invitation_error",
      );
    }

    return response.json() as Promise<{
      success: boolean;
      invitation: {
        id: string;
        email: string;
        expires_at: string;
        project_id: string;
        project_name: string;
      };
      invite_url: string;
      message: string;
    }>;
  }

  // ============ Skills ============

  async listSkills(input: { project_id: string }): Promise<any[]> {
    const res = await this.request<{ data?: any[] } | any[]>(
      "GET",
      `/functions/v1/skills-crud?project_id=${encodeURIComponent(input.project_id)}`,
    );
    if (Array.isArray(res)) return res;
    return res?.data ?? [];
  }

  async getSkill(input: { id: string }): Promise<any> {
    const res = await this.request<{ data?: any } | any>(
      "GET",
      `/functions/v1/skills-crud?id=${encodeURIComponent(input.id)}`,
    );
    return (res as any)?.data ?? res;
  }

  async createSkill(input: any): Promise<any> {
    const res = await this.request<{ data?: any } | any>(
      "POST",
      "/functions/v1/skills-crud",
      input,
    );
    return (res as any)?.data ?? res;
  }

  async updateSkill(input: any): Promise<any> {
    const res = await this.request<{ data?: any } | any>(
      "PATCH",
      "/functions/v1/skills-crud",
      input,
    );
    return (res as any)?.data ?? res;
  }

  async deleteSkill(input: { id: string }): Promise<any> {
    const res = await this.request<{ data?: any } | any>(
      "DELETE",
      `/functions/v1/skills-crud?id=${encodeURIComponent(input.id)}`,
    );
    return (res as any)?.data ?? res;
  }

  async runSkill(input: {
    skill_id: string;
    input_params?: any;
  }): Promise<any> {
    const res = await this.request<{ data?: any } | any>(
      "POST",
      "/functions/v1/skill-execute",
      { ...input, trigger_type: "mcp" },
    );
    return (res as any)?.data ?? res;
  }

  // ============ Routines ============

  async listRoutines(input: { project_id: string }): Promise<any[]> {
    const res = await this.request<{ data?: any[] } | any[]>(
      "GET",
      `/functions/v1/routines-crud?project_id=${encodeURIComponent(input.project_id)}`,
    );
    if (Array.isArray(res)) return res;
    return res?.data ?? [];
  }

  async getRoutine(input: { id: string }): Promise<any> {
    const res = await this.request<{ data?: any } | any>(
      "GET",
      `/functions/v1/routines-crud?id=${encodeURIComponent(input.id)}`,
    );
    return (res as any)?.data ?? res;
  }

  async createRoutine(input: {
    project_id: string;
    skill_id: string;
    name: string;
    schedule_preset?: "hourly" | "daily" | "weekly" | "monthly" | "custom";
    cron_expression?: string;
    timezone?: string;
    input_params?: Record<string, unknown>;
  }): Promise<any> {
    const presetCron: Record<string, string> = {
      hourly: "0 * * * *",
      daily: "0 9 * * *",
      weekly: "0 9 * * 1",
      monthly: "0 9 1 * *",
    };
    const preset = input.schedule_preset ?? "custom";
    const cron =
      preset === "custom" ? input.cron_expression : presetCron[preset];
    if (!cron) {
      throw new Error(
        "cron_expression is required when schedule_preset=custom",
      );
    }
    // The cron route recomputes next_run_at on every fire. For the initial
    // value, set it to now+1 minute so the first cron tick recomputes it
    // to the next valid time based on the cron expression + timezone.
    const nextRun = new Date(Date.now() + 60_000).toISOString();
    const res = await this.request<{ data?: any } | any>(
      "POST",
      "/functions/v1/routines-crud",
      {
        project_id: input.project_id,
        skill_id: input.skill_id,
        name: input.name,
        cron_expression: cron,
        schedule_preset: preset,
        timezone: input.timezone ?? "UTC",
        input_params: input.input_params ?? {},
        enabled: true,
        next_run_at: nextRun,
      },
    );
    return (res as any)?.data ?? res;
  }

  async updateRoutine(input: {
    id: string;
    name?: string;
    schedule_preset?: "hourly" | "daily" | "weekly" | "monthly" | "custom";
    cron_expression?: string;
    timezone?: string;
    input_params?: Record<string, unknown>;
  }): Promise<any> {
    const { id, ...rest } = input;
    const res = await this.request<{ data?: any } | any>(
      "PATCH",
      `/functions/v1/routines-crud?id=${encodeURIComponent(id)}`,
      rest,
    );
    return (res as any)?.data ?? res;
  }

  async toggleRoutine(input: {
    id: string;
    enabled: boolean;
  }): Promise<any> {
    const res = await this.request<{ data?: any } | any>(
      "PATCH",
      `/functions/v1/routines-crud?id=${encodeURIComponent(input.id)}`,
      { enabled: input.enabled },
    );
    return (res as any)?.data ?? res;
  }

  async deleteRoutine(input: { id: string }): Promise<any> {
    const res = await this.request<{ data?: any } | any>(
      "DELETE",
      `/functions/v1/routines-crud?id=${encodeURIComponent(input.id)}`,
    );
    return (res as any)?.data ?? res;
  }

  async runRoutineNow(input: { id: string }): Promise<any> {
    const routine = (await this.getRoutine(input)) as {
      id: string;
      skill_id: string;
      input_params: Record<string, unknown> | null;
    };
    const res = await this.request<{ data?: any } | any>(
      "POST",
      "/functions/v1/skill-execute",
      {
        skill_id: routine.skill_id,
        input_params: routine.input_params ?? {},
        trigger_type: "scheduled",
        routine_id: routine.id,
      },
    );
    return (res as any)?.data ?? res;
  }

  // ============ Session presence ============

  async registerSession(input: {
    project_id?: string;
    label?: string;
    focus?: string;
  }): Promise<AgentSession> {
    const response = await this.request<{ session: AgentSession }>(
      "POST",
      "/functions/v1/sessions",
      input,
    );
    return response.session;
  }

  async updateSession(
    sessionId: string,
    input: { focus?: string; label?: string } = {},
  ): Promise<AgentSession> {
    const response = await this.request<{ session: AgentSession }>(
      "PATCH",
      `/functions/v1/sessions/${sessionId}`,
      input,
    );
    return response.session;
  }

  async listSessions(
    options: { projectId?: string; includeStale?: boolean } = {},
  ): Promise<AgentSession[]> {
    const params = new URLSearchParams();
    if (options.projectId) params.set("project_id", options.projectId);
    if (options.includeStale) params.set("include_stale", "true");
    const qs = params.toString();
    const response = await this.request<{ sessions: AgentSession[] }>(
      "GET",
      `/functions/v1/sessions${qs ? `?${qs}` : ""}`,
    );
    return response.sessions ?? [];
  }

  async endSession(sessionId: string): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>(
      "DELETE",
      `/functions/v1/sessions/${sessionId}`,
    );
  }
}
