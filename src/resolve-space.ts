import type { ProjectLinkConfig } from "./types.js";

/** Minimal surface this module needs from ApiClient — kept narrow so it's
 * trivial to fake in tests without constructing a real ApiClient. */
export interface SpaceResolutionApi {
  listSpaces(
    projectId?: string,
    spaceType?: "regular" | "git" | "all",
  ): Promise<Array<{ id: string }>>;
  createSpace(input: {
    name: string;
    description: string;
    project_id: string;
  }): Promise<{ id: string }>;
}

/** Returns the linked project's first "regular" space id, or `null` if it
 * has none yet. Never creates anything — shared by both the write-capable
 * and read-only resolvers below. */
async function findFirstRegularSpace(
  apiClient: Pick<SpaceResolutionApi, "listSpaces">,
  projectId: string,
): Promise<string | null> {
  const spaces = await apiClient.listSpaces(projectId, "regular");
  return spaces.length > 0 ? spaces[0].id : null;
}

/**
 * Resolves the default space_id for a linked project when no explicit
 * space_id was supplied — the first "regular" space in the linked project,
 * creating a "Default" space if none exists yet. Mirrors memory_ingest's
 * fallback behavior exactly.
 *
 * WRITE-CAPABLE: this may call apiClient.createSpace(), which enforces the
 * org's space quota and notifies collaborators. Only use this for flows
 * that are actually about to write a memory (memory_ingest). Read-only
 * flows (memory_check_freshness) MUST use
 * resolveLinkedProjectSpaceIdReadOnly instead — see its docstring.
 */
export async function resolveLinkedProjectSpaceId(
  apiClient: SpaceResolutionApi,
  linkedConfig: ProjectLinkConfig | null,
): Promise<string | undefined> {
  if (!linkedConfig) return undefined;

  const existing = await findFirstRegularSpace(
    apiClient,
    linkedConfig.project_id,
  );
  if (existing) return existing;

  const defaultSpace = await apiClient.createSpace({
    name: "Default",
    description: "Default space for the project",
    project_id: linkedConfig.project_id,
  });
  return defaultSpace.id;
}

/**
 * READ-ONLY variant for memory_check_freshness: resolves the linked
 * project's first "regular" space id the same way memory_ingest does, but
 * NEVER creates a space. Returns `null` when no project is linked, or when
 * the linked project has no spaces yet.
 *
 * memory_check_freshness is a passive, read-only check that runs
 * automatically at every session start. It must never trigger
 * apiClient.createSpace() — that POST enforces the org's space quota (can
 * 403 "quota_exceeded_spaces") and notifies every project collaborator,
 * which is unacceptable as a side effect of a background freshness check
 * for a project that has no memories to check anyway.
 *
 * Callers: if this returns `null` AND a project IS linked, there is no
 * space to check — short-circuit with an empty "no stale memories" result
 * instead of calling the backend. If no project is linked, `null` here
 * means "let the backend fall back to its org-default behavior."
 */
export async function resolveLinkedProjectSpaceIdReadOnly(
  apiClient: Pick<SpaceResolutionApi, "listSpaces">,
  linkedConfig: ProjectLinkConfig | null,
): Promise<string | null> {
  if (!linkedConfig) return null;
  return findFirstRegularSpace(apiClient, linkedConfig.project_id);
}
