/**
 * Progressive tool disclosure.
 *
 * The server defines 69 tools. Exposing all of them costs ~15k tokens of
 * schemas in every client, pushes past Cursor's 40-tool cap and Claude Code's
 * 50-tool degradation threshold. This module splits them into a small always-
 * visible core and a hidden remainder reachable through one gateway tool.
 *
 * Kept in its own module (not index.ts) because index.ts calls main() at
 * import time and therefore cannot be imported by tests.
 */

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: unknown;
  annotations?: unknown;
}

/** The gateway through which every hidden tool is discovered and executed. */
export const GATEWAY_TOOL_NAME = "cf_tools";

/**
 * Tools that stay visible. Each earns its slot by being used on the agent's
 * own initiative rather than on explicit request — hiding any of them means
 * the behaviour simply stops happening.
 */
export const CORE_TOOL_NAMES: readonly string[] = [
  // Spontaneous recall and save — the core value proposition.
  "memory_query",
  "memory_ingest",
  // Governance — our differentiator, and named in already-installed CLAUDE.md.
  "memory_check_freshness",
  "memory_confirm",
  "memory_correct",
  "memory_forget",
  // Session-start ritual in generated CLAUDE.md.
  "tasks_list",
  "tasks_what_next",
  "session_list",
  // Recovery path when the agent is lost.
  "memory_help",
];

/**
 * Hard ceiling on the visible core. The saving from this whole change erodes
 * if tools drift back one "obviously essential" addition at a time, so this is
 * enforced by a test, not by convention.
 */
export const MAX_CORE_TOOLS = 15;

/** Groups a tool by name prefix. Order matters: the specific prefixes first. */
export function categoryOf(name: string): string {
  if (name.startsWith("memory_git_")) return "git";
  if (name.startsWith("memory_snapshot_")) return "snapshots";
  if (name.startsWith("memory_")) return "memory";
  if (name.startsWith("tasks_")) return "tasks";
  if (name.startsWith("skills_")) return "skills";
  if (name.startsWith("routines_")) return "routines";
  if (name.startsWith("session_")) return "sessions";
  return "collaboration";
}

/** Lean is the default; only an explicit "full" opts back into all 69 tools. */
export function isLeanMode(env: Record<string, string | undefined>): boolean {
  return (env.CONTEXTFORGE_TOOLS ?? "").toLowerCase() !== "full";
}

export function splitTools<T extends ToolDef>(all: T[]): { core: T[]; hidden: T[] } {
  const core: T[] = [];
  const hidden: T[] = [];
  for (const t of all) {
    if (CORE_TOOL_NAMES.includes(t.name)) core.push(t);
    else hidden.push(t);
  }
  return { core, hidden };
}

/**
 * Hand-written synonyms for tools whose intent has no lexical overlap with
 * their name. Bilingual on purpose: agents are prompted in Spanish here.
 * This map is the part most likely to need iteration after real use.
 */
export const SYNONYMS: Record<string, string[]> = {
  memory_forget: ["olvidar", "forget", "stale", "outdated", "obsolete", "no longer", "ya no aplica", "descartar"],
  memory_correct: ["corregir", "correct", "fix", "wrong", "incorrect", "equivocado", "arreglar"],
  memory_confirm: ["confirmar", "confirm", "verify", "still true", "sigue vigente", "validar"],
  memory_export: ["backup", "descargar", "download", "dump", "respaldo", "copia"],
  memory_import: ["restore", "cargar", "upload", "restaurar", "subir"],
  memory_move_item: ["mover", "move", "reorganize", "recolocar"],
  memory_create_space: ["carpeta", "folder", "organizar", "nuevo espacio"],
  memory_list_spaces: ["carpetas", "folders", "espacios", "organization"],
  memory_snapshot_create: ["backup", "punto de restauracion", "checkpoint", "respaldo"],
  memory_snapshot_restore: ["rollback", "revertir", "undo", "deshacer", "restaurar"],
  memory_git_sync: ["sincronizar", "sync", "pull", "actualizar repo"],
  memory_git_commits: ["commits", "historial", "history", "changes"],
  memory_git_prs: ["pull requests", "prs", "merge requests"],
  tasks_create: ["nueva tarea", "new issue", "todo", "pendiente"],
  tasks_resolve: ["cerrar", "close", "done", "completar", "terminar"],
  skills_run: ["ejecutar skill", "execute", "correr"],
  routines_create: ["cron", "programar", "schedule", "recurrente", "automatizar"],
  project_share: ["compartir", "share", "invitar", "invite"],
};

/**
 * Ranked keyword search over the hidden tools.
 *
 * Scoring is deliberately coarse — with 59 candidates the ranking only has to
 * put the right tool in the top few, not produce a calibrated score.
 */
export function searchTools<T extends ToolDef>(hidden: T[], query: string, limit = 5): T[] {
  const terms = query
    .toLowerCase()
    .split(/[^\p{L}\p{N}_]+/u)
    .filter((t) => t.length > 2);
  if (terms.length === 0) return [];

  const scored = hidden.map((t) => {
    const name = t.name.toLowerCase();
    const category = categoryOf(t.name);
    const synonyms = (SYNONYMS[t.name] ?? []).join(" ").toLowerCase();
    const description = t.description.toLowerCase();
    let score = 0;

    for (const term of terms) {
      if (name.includes(term)) score += 10;
      else if (synonyms.includes(term)) score += 8;
      else if (category === term) score += 6;
      else if (description.includes(term)) score += 1;
    }
    return { tool: t, score };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.tool);
}
