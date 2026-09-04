import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  CORE_TOOL_NAMES,
  MAX_CORE_TOOLS,
  SYNONYMS,
  categoryOf,
  splitTools,
  searchTools,
  visibleTools,
  buildGatewayTool,
  type ToolDef,
} from "../src/tool-registry.js";

const SRC = readFileSync(join(__dirname, "..", "src", "index.ts"), "utf8");

/** Every tool declared in index.ts, as {name, description} pairs. */
function declaredTools(): ToolDef[] {
  const start = SRC.indexOf("const TOOLS");
  const open = SRC.indexOf("[", start);
  let depth = 0;
  let block = "";
  for (let k = open; k < SRC.length; k++) {
    if (SRC[k] === "[") depth++;
    else if (SRC[k] === "]") {
      depth--;
      if (depth === 0) {
        block = SRC.slice(open, k + 1);
        break;
      }
    }
  }
  const marks = [...block.matchAll(/name:\s*"([a-z_]+)"/g)];
  return marks.map((m, i) => {
    const from = m.index!;
    const to = i + 1 < marks.length ? marks[i + 1].index! : block.length;
    const slice = block.slice(from, to);
    const desc = slice.match(/description:\s*\n?\s*"((?:[^"\\]|\\.)*)"/);
    return { name: m[1], description: desc ? desc[1] : "", inputSchema: {} };
  });
}

describe("core size guard", () => {
  it("keeps the visible core at or under the ceiling", () => {
    // This is a hard gate, not a guideline. The whole saving of this change
    // erodes if tools drift back one "obviously essential" addition at a time.
    expect(CORE_TOOL_NAMES.length).toBeLessThanOrEqual(MAX_CORE_TOOLS);
  });

  it("exposes 11 tools in lean mode", () => {
    expect(CORE_TOOL_NAMES.length + 1).toBe(11);
  });
});

describe("reachability", () => {
  const all = declaredTools();
  const { core, hidden } = splitTools(all);

  it("accounts for every declared tool", () => {
    expect(core.length + hidden.length).toBe(all.length);
    expect(all.length).toBe(69);
  });

  it("splits 10 core and 59 hidden", () => {
    expect(core).toHaveLength(10);
    expect(hidden).toHaveLength(59);
  });

  it("finds EVERY hidden tool by its own name — enumerated, not sampled", () => {
    const unreachable = hidden.filter(
      (t) => !searchTools(hidden, t.name.replace(/_/g, " "), 5).some((m) => m.name === t.name),
    );
    expect(unreachable.map((t) => t.name)).toEqual([]);
  });

  it("assigns every hidden tool to correct categories by prefix", () => {
    // Verify actual classification: not just that categoryOf returns something,
    // but that it maps correctly per prefix. This is unfalsifiable if we just
    // check against a hardcoded list of 8 items that match categoryOf's branches.
    const categorized = hidden.reduce(
      (acc, t) => {
        const cat = categoryOf(t.name);
        acc[cat] = (acc[cat] || []).concat(t.name);
        return acc;
      },
      {} as Record<string, string[]>,
    );

    // memory_git_* → git
    for (const name of categorized.git || []) {
      expect(name.startsWith("memory_git_")).toBe(true);
    }

    // memory_snapshot_* → snapshots
    for (const name of categorized.snapshots || []) {
      expect(name.startsWith("memory_snapshot_")).toBe(true);
    }

    // memory_* (but not git_ or snapshot_) → memory
    for (const name of categorized.memory || []) {
      expect(name.startsWith("memory_")).toBe(true);
      expect(name.startsWith("memory_git_")).toBe(false);
      expect(name.startsWith("memory_snapshot_")).toBe(false);
    }

    // tasks_* → tasks
    for (const name of categorized.tasks || []) {
      expect(name.startsWith("tasks_")).toBe(true);
    }

    // skills_* → skills
    for (const name of categorized.skills || []) {
      expect(name.startsWith("skills_")).toBe(true);
    }

    // routines_* → routines
    for (const name of categorized.routines || []) {
      expect(name.startsWith("routines_")).toBe(true);
    }

    // session_* → sessions
    for (const name of categorized.sessions || []) {
      expect(name.startsWith("session_")).toBe(true);
    }

    // Everything else (collaborators, project_*) → collaboration
    for (const name of categorized.collaboration || []) {
      expect(
        !name.startsWith("memory_") &&
        !name.startsWith("tasks_") &&
        !name.startsWith("skills_") &&
        !name.startsWith("routines_") &&
        !name.startsWith("session_"),
      ).toBe(true);
    }
  });

  it("finds at least one tool for every category term", () => {
    const categories = [...new Set(hidden.map((t) => categoryOf(t.name)))];
    for (const c of categories) {
      expect(searchTools(hidden, c, 5).length).toBeGreaterThan(0);
    }
  });

  it("exercises synonyms: each hidden tool with SYNONYMS entry is findable by synonym", () => {
    const failedSynonyms: string[] = [];
    for (const t of hidden) {
      if (SYNONYMS[t.name]) {
        // For each synonym of this tool, search using that synonym
        for (const syn of SYNONYMS[t.name]) {
          const results = searchTools(hidden, syn, 5);
          if (!results.some((m) => m.name === t.name)) {
            failedSynonyms.push(`${t.name}: synonym "${syn}" did not find it`);
          }
        }
      }
    }
    expect(failedSynonyms).toEqual([]);
  });

  it("verifies visibleTools exposes 11 in lean mode (10 core + gateway)", () => {
    const visible = visibleTools(hidden.concat(core), {});
    expect(visible).toHaveLength(11);
  });

  it("verifies visibleTools returns all 69 in full mode (no gateway)", () => {
    const visible = visibleTools(hidden.concat(core), { CONTEXTFORGE_TOOLS: "full" });
    expect(visible).toHaveLength(69);
  });

  it("verifies gateway is present in lean mode and absent in full mode", () => {
    const lean = visibleTools(hidden.concat(core), {});
    const full = visibleTools(hidden.concat(core), { CONTEXTFORGE_TOOLS: "full" });
    expect(lean.some((t) => t.name === "cf_tools")).toBe(true);
    expect(full.some((t) => t.name === "cf_tools")).toBe(false);
  });

  it("no SYNONYMS key points at a core tool", () => {
    const deadSynonyms = Object.keys(SYNONYMS).filter((k) => CORE_TOOL_NAMES.includes(k));
    expect(deadSynonyms).toEqual([]);
  });
});

describe("search relevance", () => {
  const all = declaredTools();
  const { hidden } = splitTools(all);

  // Spanish queries from the probe, tuned and verified against production behavior
  const ES = [
    ["exportar todo mi conocimiento", "memory_export"],
    ["importar datos de un fichero", "memory_import"],
    ["mover un item a otro espacio", "memory_move_item"],
    ["crear un espacio nuevo", "memory_create_space"],
    ["borrar varios items de golpe", "memory_delete_batch"],
    ["ver estadisticas", "memory_stats"],
    ["conectar un repositorio", "memory_git_connect"],
    ["restaurar una copia anterior", "memory_snapshot_restore"],
    ["asignar la tarea a alguien", "tasks_assign"],
    ["cerrar la tarea", "tasks_resolve"],
    ["comentar en una tarea", "tasks_add_comment"],
    ["listar mis skills", "skills_list"],
    ["desactivar una rutina", "routines_toggle"],
    ["ver quien colabora", "collaborators_list"],
    ["relacionar dos recuerdos", "memory_relate"],
    ["terminar la sesion", "session_end"],
  ];

  // English queries from the probe
  const EN = [
    ["export my knowledge", "memory_export"],
    ["connect a repository", "memory_git_connect"],
    ["assign this task", "tasks_assign"],
    ["turn off a routine", "routines_toggle"],
    ["relate two memories", "memory_relate"],
    ["end the session", "session_end"],
  ];

  it("finds expected Spanish queries in top 5 results", () => {
    const misses: string[] = [];
    for (const [query, expected] of ES) {
      const results = searchTools(hidden, query, 5).map((t) => t.name);
      if (!results.includes(expected)) {
        misses.push(`"${query}" -> want ${expected}, got ${results.slice(0, 2).join(", ") || "NOTHING"}`);
      }
    }
    expect(misses).toEqual([]);
  });

  it("finds expected English queries in top 5 results", () => {
    const misses: string[] = [];
    for (const [query, expected] of EN) {
      const results = searchTools(hidden, query, 5).map((t) => t.name);
      if (!results.includes(expected)) {
        misses.push(`"${query}" -> want ${expected}, got ${results.slice(0, 2).join(", ") || "NOTHING"}`);
      }
    }
    expect(misses).toEqual([]);
  });
});
