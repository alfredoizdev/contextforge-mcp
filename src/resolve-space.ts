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

/**
 * Resolves the default space_id for a linked project when no explicit
 * space_id was supplied — the first "regular" space in the linked project,
 * creating a "Default" space if none exists yet. Mirrors memory_ingest's
 * fallback behavior exactly.
 *
 * IMPORTANT: memory_check_freshness MUST resolve its space the same way, or
 * it ends up asking the backend about a different space than the one
 * memory_ingest actually wrote into (the freshness backend falls back to
 * the org's oldest space when no space_id is passed at all) — silently
 * returning zero candidates for every linked-project user.
 */
export async function resolveLinkedProjectSpaceId(
  apiClient: SpaceResolutionApi,
  linkedConfig: ProjectLinkConfig | null,
): Promise<string | undefined> {
  if (!linkedConfig) return undefined;

  const spaces = await apiClient.listSpaces(linkedConfig.project_id, "regular");
  if (spaces.length > 0) {
    return spaces[0].id;
  }

  const defaultSpace = await apiClient.createSpace({
    name: "Default",
    description: "Default space for the project",
    project_id: linkedConfig.project_id,
  });
  return defaultSpace.id;
}
