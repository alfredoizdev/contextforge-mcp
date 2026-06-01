# `contextforge-mcp init` — Cursor Support Design

**Date:** 2026-05-31
**Status:** Approved for planning

## Goal

Extend `contextforge-mcp init` so it sets up the memory rules file for **Cursor** (`.cursorrules`) in addition to the existing **Claude Code** support (`CLAUDE.md`). Default behavior auto-detects which editor(s) the project uses; an explicit `--editor` flag overrides detection. Reduces onboarding friction for Cursor users from "read docs and write rules manually" to one command.

## Non-Goals

- No support for other AI clients (Copilot, Codex, Cline, Continue, etc.) in this iteration.
- No interactive prompt (`init` stays scriptable / non-TTY-safe).
- No migration of existing `.cursorrules` content beyond appending our marked section.
- No new MCP tool. This is a CLI-only change.
- No automatic `memory_link_project` invocation. The rules file tells the AI to suggest linking, but `init` itself doesn't call the MCP server.

## Detection Heuristics

Project-level signals take precedence over global signals.

| Editor | Trigger condition (any one signal in CWD) |
|---|---|
| **Cursor** | `<cwd>/.cursor/` exists (directory) **OR** `<cwd>/.cursorrules` exists (file) |
| **Claude Code** | `<cwd>/CLAUDE.md` exists (file) **OR** `<cwd>/.claude/` exists (directory) |

**No editor detected:** generate both files. Zero friction — user deletes the one they don't use.

**Both editors detected:** generate both files.

## CLI Surface

```bash
contextforge-mcp init                  # auto-detect (default)
contextforge-mcp init --editor=cursor  # force only Cursor
contextforge-mcp init --editor=claude  # force only Claude
contextforge-mcp init --editor=all     # force both, skip detection
```

Invalid `--editor=<other>` exits with code 1 and an error message listing valid values.

`--dry-run` flag is out of scope (YAGNI).

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `src/init.ts` | MODIFY | Refactor to dispatch per-editor. Export `CLAUDE_TEMPLATE`, new `CURSOR_TEMPLATE`, `detectEditors()`, updated `runInit()`. |
| `tests/init.test.ts` | MODIFY | Add cases for Cursor write/append/already-present, detection heuristics, explicit `--editor` flag, invalid editor error. Keep all existing Claude tests passing. |
| `src/index.ts` (or wherever CLI entry resolves `init` subcommand) | MODIFY (small) | Parse new `--editor=<value>` arg and pass it through to `runInitCLI`. |

No new files. Same package, same `bin` entry (`contextforge-mcp init`).

## Templates

### `CLAUDE_TEMPLATE` (renamed from `INIT_TEMPLATE`, content unchanged)

Stays exactly as-is — same marker, same content, same routing rules. Only the export name changes for clarity now that there are two templates.

### `CURSOR_TEMPLATE` (new)

Same tone and routing table as Claude's, minus the `~/.claude/projects/...` warning section that doesn't apply to Cursor. Marker is a markdown comment so it remains hidden if `.cursorrules` is rendered. Approximately 30 lines.

```markdown
<!-- contextforge-mcp:init -->

# ContextForge MCP — Memory Rules

This project uses the **ContextForge MCP** (`contextforge` server) for persistent memory.

## Rules — apply in this exact order

When the user asks ANYTHING about memory, decisions, project context, tasks, past conversations, or "what did we discuss":

1. **DO** call `mcp__contextforge__*` tools FIRST, BEFORE generating any response.
2. **DO NOT** answer from scratch when persistent memory might already have the answer.

## Tool routing — which MCP tool for which question

| User asks about... | MUST call first |
|---|---|
| "what did we decide", "remember", "did we", "we discussed" | `mcp__contextforge__memory_query` |
| "what should I do", "what's next", "tasks", "pending" | `mcp__contextforge__tasks_what_next` and/or `mcp__contextforge__tasks_list` |
| "what project is this", "what do you know about my project" | `mcp__contextforge__memory_current_project` |
| "save this", "remember this", "note that" | `mcp__contextforge__memory_ingest` |
| "what's in my memory", "list my saved items" | `mcp__contextforge__memory_list_items` |

## After calling the MCP tool

- If the MCP returns results → answer the user using ONLY that information.
- If the MCP returns nothing (empty result, not "no project linked") → THEN say "I don't have memory about that yet, do you want to save it now?"
- If the MCP says "no project linked" → suggest `mcp__contextforge__memory_link_project`.

This rule is non-negotiable.
```

The marker (`<!-- contextforge-mcp:init -->`) is identical to the CLAUDE.md marker — same idempotency mechanism.

## API Changes in `init.ts`

### Before

```ts
export function runInit(cwd: string): InitResult { ... }
export function runInitCLI(cwd: string): InitResult { ... }
export interface InitResult { action: InitAction; path: string }
```

### After

```ts
export type Editor = "claude" | "cursor";
export interface InitOptions {
  editor?: Editor | "all"; // undefined means "auto-detect"
}

export function detectEditors(cwd: string): Editor[];
export function runInit(cwd: string, options?: InitOptions): InitResult[];
export function runInitCLI(cwd: string, options?: InitOptions): InitResult[];
export interface InitResult {
  editor: Editor;          // which template was applied
  action: InitAction;      // "created" | "appended" | "already-present"
  path: string;
}
```

`runInit` returns an array — one entry per file processed. The shape of a single entry stays familiar (`{action, path}` plus `editor`).

**Breaking change:** the existing return shape `InitResult` becomes `InitResult[]`. Acceptable because (a) the package is pre-1.0 (currently 0.1.81), (b) the only documented use site is the CLI inside this package, and (c) we bump version to 0.2.0 (minor pre-1.0, signaling shape change).

## Data Flow

```
contextforge-mcp init [--editor=X]
  └─ parse --editor flag (or undefined)
     └─ resolve target editors:
        - "all" → [claude, cursor]
        - "claude" → [claude]
        - "cursor" → [cursor]
        - undefined →
            detected = detectEditors(cwd)
            return detected.length > 0 ? detected : [claude, cursor]
     └─ for each editor in resolved:
        - write/append the corresponding template to its file
        - collect InitResult
     └─ print summary (one line per file: created / appended / already-present)
```

## Error Handling

- `--editor=foo` (invalid value): exit code 1, stderr message `Invalid --editor value: foo. Valid: claude, cursor, all.`
- File write fails (permission, disk): bubble up the fs error. Don't try to roll back the other file if the first one already wrote — partial success is OK and the marker keeps subsequent runs idempotent.
- `runInit` called with bogus `options.editor` value via TS API: TS type system catches it; runtime fallback throws an `Error`.

## Idempotency

Each file uses the same marker `<!-- contextforge-mcp:init -->`. Re-running `init` on a project that's already initialized:
- Both files present with marker → both report `already-present`, no writes.
- Only `CLAUDE.md` marked, `.cursorrules` missing (e.g. project later adopts Cursor) → next `init` run appends to or creates `.cursorrules` only.
- Marker missing but file exists → append the marked block at the end, preserving existing content.

## Testing Plan

`tests/init.test.ts` (Vitest, already in package). Pure-logic tests using a temp dir (`os.tmpdir()` + cleanup), no real fs side effects in user dirs.

| # | Test | Setup | Assert |
|---|---|---|---|
| 1 | existing: Claude-only auto-detect | cwd has `CLAUDE.md` only | `runInit(cwd)` returns 1 result with `editor: 'claude'` |
| 2 | existing: tests currently testing Claude create/append/already-present continue passing | unchanged | same `action` values, now scoped to `editor: 'claude'` |
| 3 | new: Cursor-only auto-detect via `.cursorrules` | cwd has empty `.cursorrules` | result has `editor: 'cursor'`, action `appended` (file exists, no marker) |
| 4 | new: Cursor-only auto-detect via `.cursor/` directory | cwd has empty `.cursor/` dir, no `.cursorrules` | result has `editor: 'cursor'`, action `created` |
| 5 | new: both editors detected | cwd has both `CLAUDE.md` and `.cursorrules` | results length 2, one per editor |
| 6 | new: neither detected → fallback to both | empty cwd | results length 2, both `created` |
| 7 | new: `--editor=cursor` overrides detection | cwd has `CLAUDE.md` but not `.cursorrules` | result has only `editor: 'cursor'`, action `created` |
| 8 | new: `--editor=all` writes both regardless | empty cwd, `editor: 'all'` | same as test 6 |
| 9 | new: idempotency on `.cursorrules` | run twice with `editor: 'cursor'` | second run returns `already-present` |
| 10 | new: invalid `--editor` value via CLI | mock argv `['init', '--editor=foo']` | exits non-zero, error message includes valid values |
| 11 | new: existing `.cursorrules` content preserved | seed `.cursorrules` with "my custom rule\n" | post-init file contains "my custom rule" AND the marker block |

## Components and Responsibilities

| Symbol | Type | What it does |
|---|---|---|
| `CLAUDE_TEMPLATE` | exported const | Markdown template appended to `CLAUDE.md`. Unchanged from current `INIT_TEMPLATE`. |
| `CURSOR_TEMPLATE` | exported const | Markdown template appended to `.cursorrules`. ~30 lines. |
| `INIT_MARKER` | exported const | `<!-- contextforge-mcp:init -->`. Shared between both templates for idempotency. Unchanged. |
| `detectEditors(cwd)` | exported function | Returns `Editor[]` based on detection signals. Pure (no fs writes). |
| `runInit(cwd, options?)` | exported function | Pure-logic orchestrator. Dispatches per editor, returns `InitResult[]`. |
| `runInitCLI(cwd, options?)` | exported function | Wraps `runInit` with colored console summary. Returns same array. |

## Migration Notes for Callers

The only known caller is the CLI entry point inside this same package. After this change:
- Callers reading `result.action` need to iterate or pick the relevant editor.
- Version bumps to **0.2.0** to signal the shape change.
- README updated to mention `--editor` flag.

## Open Questions (deferred to plan stage)

- Exact CLI arg parser. The current entry likely uses simple `process.argv` slicing. We may stay with that to avoid pulling in `commander` / `yargs` just for one flag.
- README updates — content for the README will be drafted as part of the plan, not the spec.
