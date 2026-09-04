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
 *
 * Covers all 59 hidden tools (excludes 10 core tools).
 */
export const SYNONYMS: Record<string, string[]> = {
  // Memory operations
  memory_export: ["exportar", "backup", "descargar", "download", "dump", "respaldo", "copia"],
  memory_import: ["importar", "restore", "cargar", "upload", "restaurar", "subir"],
  memory_move_item: ["mover", "move", "reorganize", "recolocar"],
  memory_create_space: ["carpeta", "folder", "organizar", "nuevo espacio"],
  memory_list_spaces: ["carpetas", "folders", "espacios", "organization"],
  memory_move_space: ["mover espacio", "move space", "reorganizar"],
  memory_delete_space: ["eliminar espacio", "delete space", "borrar carpeta"],
  memory_delete_project: ["eliminar proyecto", "delete project"],
  memory_relate: ["relacionar", "relate", "vincular", "link", "conectar"],
  memory_list_relationships: ["relaciones", "relationships", "vínculos"],
  memory_delete: ["borrar item", "delete item", "eliminar item"],
  memory_stats: ["estadísticas", "statistics", "stats", "información de uso"],
  memory_list_items: ["listar items", "list items", "ver conocimiento"],
  memory_get_item: ["obtener item", "get item", "recuperar"],
  memory_list_projects: ["listar proyectos", "list projects"],
  memory_create_project: ["crear proyecto", "new project", "proyecto"],
  memory_update: ["actualizar", "update", "editar"],
  memory_ingest_batch: ["ingerir lote", "ingest batch", "guardar varios"],
  memory_delete_batch: ["borrar varios", "delete batch", "eliminar múltiples"],
  memory_link_project: ["vincular proyecto", "link project"],
  memory_unlink_project: ["desvinrcular proyecto", "unlink project"],
  memory_current_project: ["proyecto actual", "current project"],

  // Git integration
  memory_git_sync: ["sincronizar", "sync", "pull", "actualizar repo"],
  memory_git_commits: ["commits", "historial", "history", "changes"],
  memory_git_prs: ["pull requests", "prs", "merge requests"],
  memory_git_connect: ["conectar repositorio", "connect repo", "vincular github"],
  memory_git_list: ["listar repositorios", "list repos", "mis repositorios"],
  memory_git_activate: ["activar repositorio", "activate repo"],
  memory_git_disconnect: ["desconectar repositorio", "disconnect repo"],

  // Snapshots / Backups
  memory_snapshot_create: ["backup", "punto de restauracion", "checkpoint", "respaldo", "crear snapshot"],
  memory_snapshot_restore: ["rollback", "revertir", "undo", "deshacer", "restaurar"],
  memory_snapshot_list: ["listar snapshots", "list snapshots", "backups"],
  memory_snapshot_delete: ["eliminar snapshot", "delete snapshot", "borrar copia"],

  // Tasks
  tasks_create: ["crear tarea", "todo", "pendiente", "nueva tarea", "crear"],
  tasks_resolve: ["cerrar tarea", "close task", "done", "completar", "terminar tarea", "cerrar"],
  tasks_assign: ["asignar", "assign", "delegar", "asignar tarea"],
  tasks_start: ["iniciar", "start", "comenzar", "empezar"],
  tasks_update: ["actualizar tarea", "update task"],
  tasks_resolve_by_name: ["cerrar por nombre", "resolve by name"],
  tasks_delete: ["eliminar tarea", "delete task", "borrar tarea"],
  tasks_list_comments: ["listar comentarios", "list comments"],
  tasks_add_comment: ["comentar en tarea", "comment on task", "agregar comentario", "comentar"],

  // Skills
  skills_run: ["ejecutar skill", "execute", "correr"],
  skills_list: ["listar skills", "list skills", "mis habilidades"],
  skills_get: ["obtener skill", "get skill"],
  skills_create: ["crear skill", "new skill"],
  skills_update: ["actualizar skill", "update skill"],
  skills_delete: ["eliminar skill", "delete skill"],

  // Routines / Schedules
  routines_create: ["cron", "programar", "schedule", "recurrente", "automatizar"],
  routines_list: ["listar rutinas", "list routines"],
  routines_get: ["obtener rutina", "get routine"],
  routines_update: ["actualizar rutina", "update routine"],
  routines_toggle: ["desactivar", "activate", "toggle", "activar rutina"],
  routines_run_now: ["ejecutar ahora", "run now"],
  routines_delete: ["eliminar rutina", "delete routine"],

  // Collaboration
  collaborators_list: ["colaboradores", "collaborators", "quién", "equipo"],
  project_share: ["compartir", "share", "invitar", "invite"],

  // Sessions
  session_update: ["actualizar sesión", "update session"],
  session_end: ["terminar sesión", "end session", "cerrar sesión"],
};

/**
 * Normalize accents and diacritics for case-insensitive comparison.
 * Converts é→e, á→a, etc., and lowercases the result.
 */
function normalizeAccents(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

/**
 * Ranked keyword search over the hidden tools.
 *
 * Scoring is deliberately coarse — with 59 candidates the ranking only has to
 * put the right tool in the top few, not produce a calibrated score.
 *
 * Supports bidirectional stem matching for Spanish/English terms, e.g.
 * "exportar" matches "export" segment via substring overlap.
 * Handles accented characters (Spanish: estadísticas vs estadisticas).
 */
export function searchTools<T extends ToolDef>(hidden: T[], query: string, limit = 5): T[] {
  const terms = query
    .toLowerCase()
    .split(/[^\p{L}\p{N}_]+/u)
    .filter((t) => t.length > 2)
    .map(normalizeAccents);
  if (terms.length === 0) return [];

  const scored = hidden.map((t) => {
    const name = t.name.toLowerCase();
    const segments = name.split("_");
    const category = categoryOf(t.name);
    const synonyms = normalizeAccents((SYNONYMS[t.name] ?? []).join(" "));
    const description = normalizeAccents(t.description);
    let score = 0;

    for (const term of terms) {
      // Name match: full string or bidirectional segment match
      if (name.includes(term)) {
        score += 10;
      } else {
        // Bidirectional stem matching: "exportar" matches "export"
        let segmentMatch = false;
        for (const seg of segments) {
          if ((seg.includes(term) || term.includes(seg)) && Math.min(seg.length, term.length) >= 3) {
            score += 10;
            segmentMatch = true;
            break;
          }
        }
        if (!segmentMatch) {
          if (synonyms.includes(term)) score += 8;
          else if (category === term) score += 6;
          else if (description.includes(term)) score += 1;
        }
      }
    }
    return { tool: t, score };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => {
      // Primary: score
      if (b.score !== a.score) return b.score - a.score;
      // Tie-breaker 1: shorter name is better (more specific)
      if (a.tool.name.length !== b.tool.name.length) return a.tool.name.length - b.tool.name.length;
      // Tie-breaker 2: alphabetical
      return a.tool.name.localeCompare(b.tool.name);
    })
    .slice(0, limit)
    .map((s) => s.tool);
}
