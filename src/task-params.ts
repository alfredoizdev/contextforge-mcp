/**
 * Resolves a task ID from args, accepting multiple param names.
 * LLMs use various parameter names — we accept them all.
 */
export function resolveTaskId(args: any): string | undefined {
  return args?.issue_id || args?.task_id || args?.short_id || args?.id || args?.identifier;
}

/**
 * Resolves a task title from args, accepting multiple param names.
 * LLMs use various parameter names — we accept them all.
 */
export function resolveTaskTitle(args: any): string | undefined {
  return args?.title || args?.name || args?.issue_title || args?.identifier;
}

/**
 * Resolves any task identifier from args — UUID, short_id, or title.
 * Returns { type, value } so the caller knows how to use it.
 */
export function resolveTaskIdentifier(args: any): { type: "uuid" | "short_id" | "title"; value: string } | undefined {
  const value = args?.issue_id || args?.task_id || args?.short_id || args?.id || args?.identifier || args?.title || args?.name || args?.issue_title;
  if (!value) return undefined;

  const str = String(value).trim();
  if (!str) return undefined;

  // UUID pattern
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str)) {
    return { type: "uuid", value: str };
  }

  // Short ID pattern (6 alphanumeric chars)
  if (/^[a-z0-9]{5,8}$/i.test(str) && !str.includes(" ")) {
    return { type: "short_id", value: str };
  }

  // Everything else is treated as a title/name search
  return { type: "title", value: str };
}
