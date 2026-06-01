# `contextforge-mcp init` Cursor Support — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend `contextforge-mcp init` so it generates `.cursorrules` for Cursor in addition to `CLAUDE.md` for Claude Code, with auto-detection by default and a `--editor` flag override.

**Architecture:** Single-file refactor of `src/init.ts`. Rename the existing template, add a new Cursor template, add `detectEditors(cwd)`, refactor `runInit` to return `InitResult[]`, update CLI argv parsing in `src/index.ts`. Idempotency preserved via shared `INIT_MARKER`. Bump package to 0.2.0 due to API shape change.

**Tech Stack:** TypeScript (ESM), Node fs sync APIs, Vitest for tests.

**Branch:** `feat/init-cursor-support` (already checked out, has spec commit `f00d3c5`).

**Working directory:** `/Users/alfredoizquierdo/Desktop/MCP-APP/contextforge-mcp-public`

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `src/init.ts` | MODIFY | Two templates + `detectEditors()` + `runInit()` returns array + `runInitCLI()` handles array + argv parsing. |
| `tests/init.test.ts` | MODIFY | Update existing tests for new return shape, add Cursor tests, add detection tests, add CLI flag tests. |
| `src/index.ts` | MODIFY (lines 65-70) | Parse `--editor=<value>` from `process.argv[3]`, pass to `runInitCLI`. |
| `package.json` | MODIFY | Bump `version` to `0.2.0`. |
| `README.md` | MODIFY | Add `--editor` flag docs. |

---

## Task 1: Refactor templates — rename + add Cursor template

**Files:**
- Modify: `src/init.ts`
- Modify: `tests/init.test.ts` (only the imports that reference `INIT_TEMPLATE`)

This task is a pure refactor + addition. No behavior change yet for the single-editor flow. We rename `INIT_TEMPLATE` to `CLAUDE_TEMPLATE` for clarity now that there are two, and add `CURSOR_TEMPLATE`.

- [ ] **Step 1: In `src/init.ts`, rename the export**

Find at the top of `src/init.ts`:
```typescript
export const INIT_TEMPLATE = `${INIT_MARKER}
```

Change to:
```typescript
export const CLAUDE_TEMPLATE = `${INIT_MARKER}
```

Then find usages of `INIT_TEMPLATE` further down in the file (in `runInit`):
```typescript
writeFileSync(claudeMdPath, INIT_TEMPLATE);
...
const combined = trimmed + "\n" + INIT_TEMPLATE;
```

Replace both with `CLAUDE_TEMPLATE`.

- [ ] **Step 2: Add `CURSOR_TEMPLATE` constant**

Below `CLAUDE_TEMPLATE`, before the type/interface definitions, add:

```typescript
/** .cursorrules content appended (or written fresh) by `contextforge-mcp init`. */
export const CURSOR_TEMPLATE = `${INIT_MARKER}

# ContextForge MCP — Memory Rules

This project uses the **ContextForge MCP** (\`contextforge\` server) for persistent memory.

## Rules — apply in this exact order

When the user asks ANYTHING about memory, decisions, project context, tasks, past conversations, or "what did we discuss":

1. **DO** call \`mcp__contextforge__*\` tools FIRST, BEFORE generating any response.
2. **DO NOT** answer from scratch when persistent memory might already have the answer.

## Tool routing — which MCP tool for which question

| User asks about... | MUST call first |
|---|---|
| "what did we decide", "remember", "did we", "we discussed" | \`mcp__contextforge__memory_query\` |
| "what should I do", "what's next", "tasks", "pending" | \`mcp__contextforge__tasks_what_next\` and/or \`mcp__contextforge__tasks_list\` |
| "what project is this", "what do you know about my project" | \`mcp__contextforge__memory_current_project\` |
| "save this", "remember this", "note that" | \`mcp__contextforge__memory_ingest\` |
| "what's in my memory", "list my saved items" | \`mcp__contextforge__memory_list_items\` |

## After calling the MCP tool

- If the MCP returns results → answer the user using ONLY that information.
- If the MCP returns nothing (empty result, not "no project linked") → THEN say "I don't have memory about that yet, do you want to save it now?"
- If the MCP says "no project linked" → suggest \`mcp__contextforge__memory_link_project\`.

This rule is non-negotiable.
`;
```

- [ ] **Step 3: Update `tests/init.test.ts` import**

Find:
```typescript
import { runInit, INIT_MARKER, INIT_TEMPLATE } from "../src/init.js";
```

Change to:
```typescript
import { runInit, INIT_MARKER, CLAUDE_TEMPLATE } from "../src/init.js";
```

Then find the one usage `writeFileSync(claudeMdPath, INIT_TEMPLATE)` in the test "is idempotent when CLAUDE.md already has our section". Change to `writeFileSync(claudeMdPath, CLAUDE_TEMPLATE)`.

- [ ] **Step 4: Run tests — all 5 existing should still pass**

```bash
cd /Users/alfredoizquierdo/Desktop/MCP-APP/contextforge-mcp-public
npm test
```

Expected: `Test Files 1 passed, Tests 5 passed` (or however many vitest reports — but all green).

- [ ] **Step 5: Commit**

```bash
git add src/init.ts tests/init.test.ts
git commit -m "refactor(init): rename INIT_TEMPLATE to CLAUDE_TEMPLATE, add CURSOR_TEMPLATE"
```

---

## Task 2: Implement and test `detectEditors(cwd)`

**Files:**
- Modify: `src/init.ts` (add function)
- Modify: `tests/init.test.ts` (new describe block)

- [ ] **Step 1: Write failing tests for `detectEditors`**

In `tests/init.test.ts`, update the import line to also import the new function (which doesn't exist yet — that's the failure mode):

```typescript
import { runInit, INIT_MARKER, CLAUDE_TEMPLATE, detectEditors } from "../src/init.js";
```

Then `mkdirSync` and `Editor` type need imports:

```typescript
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from "fs";
```

At the bottom of the file, before the closing of the outer `describe`, add a new sibling `describe` block:

```typescript
describe("detectEditors", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "cf-detect-test-"));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it("detects claude when CLAUDE.md exists", () => {
    writeFileSync(join(tmp, "CLAUDE.md"), "# anything");
    expect(detectEditors(tmp)).toEqual(["claude"]);
  });

  it("detects claude when .claude/ directory exists", () => {
    mkdirSync(join(tmp, ".claude"));
    expect(detectEditors(tmp)).toEqual(["claude"]);
  });

  it("detects cursor when .cursorrules exists", () => {
    writeFileSync(join(tmp, ".cursorrules"), "");
    expect(detectEditors(tmp)).toEqual(["cursor"]);
  });

  it("detects cursor when .cursor/ directory exists", () => {
    mkdirSync(join(tmp, ".cursor"));
    expect(detectEditors(tmp)).toEqual(["cursor"]);
  });

  it("detects both editors when both signals present", () => {
    writeFileSync(join(tmp, "CLAUDE.md"), "");
    writeFileSync(join(tmp, ".cursorrules"), "");
    const result = detectEditors(tmp);
    expect(result).toContain("claude");
    expect(result).toContain("cursor");
    expect(result.length).toBe(2);
  });

  it("returns empty array when neither editor is detected", () => {
    expect(detectEditors(tmp)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
npm test
```

Expected: 6 new tests fail with `detectEditors is not a function` (or "not exported"). Existing 5 tests continue to pass.

- [ ] **Step 3: Implement `detectEditors` in `src/init.ts`**

Add this new exported function AFTER the `CURSOR_TEMPLATE` constant and BEFORE the `InitAction` / `InitResult` types:

```typescript
/** Editors that `init` can generate rules for. */
export type Editor = "claude" | "cursor";

/**
 * Detect which editors a project uses by checking for filesystem signals
 * in the given cwd. Returns an array; empty if no editor detected.
 *
 * Cursor signals: `.cursor/` directory OR `.cursorrules` file.
 * Claude signals: `CLAUDE.md` file OR `.claude/` directory.
 */
export function detectEditors(cwd: string): Editor[] {
  const detected: Editor[] = [];
  if (
    existsSync(join(cwd, "CLAUDE.md")) ||
    existsSync(join(cwd, ".claude"))
  ) {
    detected.push("claude");
  }
  if (
    existsSync(join(cwd, ".cursorrules")) ||
    existsSync(join(cwd, ".cursor"))
  ) {
    detected.push("cursor");
  }
  return detected;
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
npm test
```

Expected: All previous + 6 new detection tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/init.ts tests/init.test.ts
git commit -m "feat(init): add detectEditors() with claude/cursor heuristics"
```

---

## Task 3: Refactor `runInit` to return `InitResult[]` and dispatch per editor

**Files:**
- Modify: `src/init.ts` (replace `runInit` body, update `InitResult` type)
- Modify: `tests/init.test.ts` (update existing tests, add new ones)

This is the largest task. Existing tests need to handle the new array return. New tests cover Cursor flow + multi-editor + override.

- [ ] **Step 1: Update the `InitResult` type and `runInit` signature in `src/init.ts`**

Find the existing `InitResult` interface and the `runInit` function. Replace them with:

```typescript
export type InitAction = "created" | "appended" | "already-present";

export interface InitResult {
  editor: Editor;
  action: InitAction;
  path: string;
}

export interface InitOptions {
  /**
   * Force a specific editor or all of them. When undefined, the editors
   * are auto-detected via detectEditors(). If detection finds nothing,
   * both editors are generated as a zero-friction default.
   */
  editor?: Editor | "all";
}

const EDITOR_FILES: Record<Editor, { fileName: string; template: string }> = {
  claude: { fileName: "CLAUDE.md", template: CLAUDE_TEMPLATE },
  cursor: { fileName: ".cursorrules", template: CURSOR_TEMPLATE },
};

function resolveEditors(cwd: string, options?: InitOptions): Editor[] {
  if (options?.editor === "all") return ["claude", "cursor"];
  if (options?.editor === "claude" || options?.editor === "cursor") {
    return [options.editor];
  }
  const detected = detectEditors(cwd);
  return detected.length > 0 ? detected : ["claude", "cursor"];
}

function applyTemplate(
  cwd: string,
  editor: Editor,
): InitResult {
  const { fileName, template } = EDITOR_FILES[editor];
  const filePath = join(cwd, fileName);

  if (!existsSync(filePath)) {
    writeFileSync(filePath, template);
    return { editor, action: "created", path: filePath };
  }

  const existing = readFileSync(filePath, "utf-8");
  if (existing.includes(INIT_MARKER)) {
    return { editor, action: "already-present", path: filePath };
  }

  const trimmed = existing.endsWith("\n") ? existing : existing + "\n";
  const combined = trimmed + "\n" + template;
  writeFileSync(filePath, combined);
  return { editor, action: "appended", path: filePath };
}

/**
 * Pure-logic init: writes or appends the appropriate template to each
 * detected (or explicitly requested) editor's rules file in the given cwd.
 * Idempotent via INIT_MARKER sentinel.
 *
 * @returns one InitResult per editor processed.
 */
export function runInit(cwd: string, options?: InitOptions): InitResult[] {
  const editors = resolveEditors(cwd, options);
  return editors.map((editor) => applyTemplate(cwd, editor));
}
```

- [ ] **Step 2: Update existing tests in `tests/init.test.ts` for the new return shape**

The first 5 tests in the `describe("runInit", ...)` block currently treat `runInit(tmp)` as returning a single `InitResult`. They need to treat it as `InitResult[]` with one element (since the existing tests all have CLAUDE.md scenarios that auto-detect only Claude — except for the "creates a new" test which has empty cwd; that needs special handling below).

**5a. "creates a new CLAUDE.md when none exists"** — empty cwd means `detectEditors` returns `[]`, so the default falls back to BOTH editors. We need to constrain to Claude only for this legacy assertion. Update to:

```typescript
  it("creates a new CLAUDE.md when none exists", () => {
    const results = runInit(tmp, { editor: "claude" });
    expect(results).toHaveLength(1);
    expect(results[0].action).toBe("created");
    expect(results[0].editor).toBe("claude");
    expect(results[0].path).toBe(join(tmp, "CLAUDE.md"));
    expect(existsSync(results[0].path)).toBe(true);
    const written = readFileSync(results[0].path, "utf-8");
    expect(written).toContain(INIT_MARKER);
    expect(written).toContain("ContextForge MCP — Memory Rules");
  });
```

**5b. "appends to existing CLAUDE.md without our section"** — CLAUDE.md exists, so auto-detect catches it. Single result.

```typescript
  it("appends to existing CLAUDE.md without our section", () => {
    const claudeMdPath = join(tmp, "CLAUDE.md");
    const userContent = "# My Project\n\nSome user notes here.\n";
    writeFileSync(claudeMdPath, userContent);

    const results = runInit(tmp);
    expect(results).toHaveLength(1);
    expect(results[0].action).toBe("appended");
    expect(results[0].editor).toBe("claude");

    const written = readFileSync(claudeMdPath, "utf-8");
    expect(written).toContain("Some user notes here.");
    expect(written).toContain(INIT_MARKER);
    expect(written.indexOf("Some user notes here.")).toBeLessThan(
      written.indexOf(INIT_MARKER),
    );
  });
```

**5c. "is idempotent when CLAUDE.md already has our section"** — CLAUDE.md exists with marker:

```typescript
  it("is idempotent when CLAUDE.md already has our section", () => {
    const claudeMdPath = join(tmp, "CLAUDE.md");
    writeFileSync(claudeMdPath, CLAUDE_TEMPLATE);

    const results = runInit(tmp);
    expect(results).toHaveLength(1);
    expect(results[0].action).toBe("already-present");

    const written = readFileSync(claudeMdPath, "utf-8");
    const markerCount = written.split(INIT_MARKER).length - 1;
    expect(markerCount).toBe(1);
  });
```

**5d. "does not duplicate when called twice in a row"** — empty cwd would fall back to both editors. Constrain to claude:

```typescript
  it("does not duplicate when called twice in a row", () => {
    runInit(tmp, { editor: "claude" });
    const second = runInit(tmp, { editor: "claude" });
    expect(second).toHaveLength(1);
    expect(second[0].action).toBe("already-present");

    const written = readFileSync(join(tmp, "CLAUDE.md"), "utf-8");
    const markerCount = written.split(INIT_MARKER).length - 1;
    expect(markerCount).toBe(1);
  });
```

**5e. "normalizes trailing newline when appending"** — CLAUDE.md exists, auto-detect:

```typescript
  it("normalizes trailing newline when appending", () => {
    const claudeMdPath = join(tmp, "CLAUDE.md");
    writeFileSync(claudeMdPath, "# No trailing newline");

    runInit(tmp);

    const written = readFileSync(claudeMdPath, "utf-8");
    expect(written.startsWith("# No trailing newline\n")).toBe(true);
    expect(written).toContain(INIT_MARKER);
  });
```

- [ ] **Step 3: Add new tests covering Cursor and multi-editor flows**

Inside the SAME `describe("runInit", ...)` block, after the 5 existing tests, append:

```typescript
  it("creates .cursorrules with editor=cursor", () => {
    const results = runInit(tmp, { editor: "cursor" });
    expect(results).toHaveLength(1);
    expect(results[0].editor).toBe("cursor");
    expect(results[0].action).toBe("created");
    expect(results[0].path).toBe(join(tmp, ".cursorrules"));
    const written = readFileSync(results[0].path, "utf-8");
    expect(written).toContain(INIT_MARKER);
    expect(written).toContain("ContextForge MCP — Memory Rules");
  });

  it("appends to existing .cursorrules without marker", () => {
    const cursorRulesPath = join(tmp, ".cursorrules");
    writeFileSync(cursorRulesPath, "# my custom rule\n");

    const results = runInit(tmp);
    expect(results).toHaveLength(1);
    expect(results[0].editor).toBe("cursor");
    expect(results[0].action).toBe("appended");

    const written = readFileSync(cursorRulesPath, "utf-8");
    expect(written).toContain("# my custom rule");
    expect(written).toContain(INIT_MARKER);
    expect(written.indexOf("# my custom rule")).toBeLessThan(
      written.indexOf(INIT_MARKER),
    );
  });

  it("is idempotent on .cursorrules when marker present", () => {
    const cursorRulesPath = join(tmp, ".cursorrules");
    writeFileSync(cursorRulesPath, "# header\n\n" + INIT_MARKER + "\nbody\n");

    const results = runInit(tmp);
    expect(results).toHaveLength(1);
    expect(results[0].action).toBe("already-present");
  });

  it("writes both files when both editors detected", () => {
    writeFileSync(join(tmp, "CLAUDE.md"), "");
    writeFileSync(join(tmp, ".cursorrules"), "");

    const results = runInit(tmp);
    expect(results).toHaveLength(2);
    const editors = results.map((r) => r.editor).sort();
    expect(editors).toEqual(["claude", "cursor"]);
  });

  it("writes both files when neither editor detected (zero-friction fallback)", () => {
    const results = runInit(tmp);
    expect(results).toHaveLength(2);
    const editors = results.map((r) => r.editor).sort();
    expect(editors).toEqual(["claude", "cursor"]);
    expect(existsSync(join(tmp, "CLAUDE.md"))).toBe(true);
    expect(existsSync(join(tmp, ".cursorrules"))).toBe(true);
  });

  it("editor=all writes both regardless of detection", () => {
    writeFileSync(join(tmp, "CLAUDE.md"), "");
    const results = runInit(tmp, { editor: "all" });
    expect(results).toHaveLength(2);
  });

  it("editor=cursor overrides detection (CLAUDE.md present)", () => {
    writeFileSync(join(tmp, "CLAUDE.md"), "");
    const results = runInit(tmp, { editor: "cursor" });
    expect(results).toHaveLength(1);
    expect(results[0].editor).toBe("cursor");
    expect(existsSync(join(tmp, ".cursorrules"))).toBe(true);
  });
```

- [ ] **Step 4: Run all tests — verify all pass**

```bash
npm test
```

Expected: All 5 existing (modified) tests + 7 new runInit tests + 6 detectEditors tests = 18 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/init.ts tests/init.test.ts
git commit -m "feat(init): multi-editor support — runInit returns InitResult[] for claude + cursor"
```

---

## Task 4: Update `runInitCLI` + parse `--editor` from argv

**Files:**
- Modify: `src/init.ts` (replace `runInitCLI` body)
- Modify: `src/index.ts` (lines 65-70: parse `--editor`, pass to `runInitCLI`)

- [ ] **Step 1: Update `runInitCLI` in `src/init.ts`**

Replace the entire existing `runInitCLI` function with:

```typescript
/**
 * CLI wrapper — prints a friendly message per file and returns the results.
 * Caller is responsible for process.exit().
 */
export function runInitCLI(cwd: string, options?: InitOptions): InitResult[] {
  const results = runInit(cwd, options);
  const reset = "\x1b[0m";
  const green = "\x1b[32m";
  const yellow = "\x1b[33m";
  const dim = "\x1b[2m";

  for (const result of results) {
    const editorName = result.editor === "claude" ? "Claude Code" : "Cursor";
    switch (result.action) {
      case "created":
        console.log(
          `${green}✓ Created${reset} ${result.path}\n` +
            `  ${editorName} will now use ContextForge MCP for memory in this directory.\n`,
        );
        break;
      case "appended":
        console.log(
          `${green}✓ Appended ContextForge section to${reset} ${result.path}\n` +
            `  Your existing file was preserved; our memory rules were added.\n`,
        );
        break;
      case "already-present":
        console.log(
          `${yellow}ContextForge section is already present in${reset} ${result.path}\n` +
            `  ${dim}No changes made.${reset}\n`,
        );
        break;
    }
  }

  if (results.length > 1) {
    console.log(
      `${dim}Restart your editor(s) in this directory to pick up changes.${reset}`,
    );
  }

  return results;
}
```

- [ ] **Step 2: Update `src/index.ts` CLI subcommand block (lines 65-70)**

Find:
```typescript
// ============ CLI subcommand: `contextforge-mcp init` ============
// Must run BEFORE any MCP server setup, since this exits the process.
if (process.argv[2] === "init") {
  runInitCLI(process.cwd());
  process.exit(0);
}
```

Replace with:
```typescript
// ============ CLI subcommand: `contextforge-mcp init` ============
// Must run BEFORE any MCP server setup, since this exits the process.
if (process.argv[2] === "init") {
  const editorArg = process.argv
    .slice(3)
    .find((a) => a.startsWith("--editor="));

  const editorValue = editorArg ? editorArg.slice("--editor=".length) : undefined;

  if (
    editorValue !== undefined &&
    editorValue !== "claude" &&
    editorValue !== "cursor" &&
    editorValue !== "all"
  ) {
    console.error(
      `Invalid --editor value: ${editorValue}. Valid: claude, cursor, all.`,
    );
    process.exit(1);
  }

  runInitCLI(
    process.cwd(),
    editorValue ? { editor: editorValue as "claude" | "cursor" | "all" } : undefined,
  );
  process.exit(0);
}
```

- [ ] **Step 3: Typecheck**

```bash
cd /Users/alfredoizquierdo/Desktop/MCP-APP/contextforge-mcp-public
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 4: Manual smoke test via built CLI**

```bash
npm run build
# Test 1: empty dir → both files
TMP=$(mktemp -d) && (cd "$TMP" && node /Users/alfredoizquierdo/Desktop/MCP-APP/contextforge-mcp-public/dist/index.js init)
ls "$TMP"
# Expected: CLAUDE.md + .cursorrules both exist

# Test 2: --editor=cursor explicit
TMP2=$(mktemp -d) && (cd "$TMP2" && node /Users/alfredoizquierdo/Desktop/MCP-APP/contextforge-mcp-public/dist/index.js init --editor=cursor)
ls "$TMP2"
# Expected: only .cursorrules

# Test 3: invalid value → exit code 1
TMP3=$(mktemp -d) && (cd "$TMP3" && node /Users/alfredoizquierdo/Desktop/MCP-APP/contextforge-mcp-public/dist/index.js init --editor=vim)
echo "exit=$?"
# Expected: exit=1 plus stderr message
```

If any of those don't behave as expected, fix and re-run before committing.

- [ ] **Step 5: Commit**

```bash
git add src/init.ts src/index.ts
git commit -m "feat(init): CLI supports --editor flag and prints per-file results"
```

---

## Task 5: Version bump + README update

**Files:**
- Modify: `package.json` (version field)
- Modify: `README.md`

- [ ] **Step 1: Bump version in `package.json`**

Find:
```json
"version": "0.1.81",
```

Change to:
```json
"version": "0.2.0",
```

- [ ] **Step 2: Update README — add `--editor` flag docs**

Open `/Users/alfredoizquierdo/Desktop/MCP-APP/contextforge-mcp-public/README.md`. Find the section that documents `contextforge-mcp init` (search for `init` in the file). If a section exists, find it and add the flag table. If no section exists, add one near the top of the "Usage" section.

Append/insert this section content:

```markdown
### `init` — Generate memory rules for your editor

Set up your project so your AI editor knows to use ContextForge memory:

```bash
npx contextforge-mcp init
```

By default, `init` auto-detects which editor your project uses and writes:

- `CLAUDE.md` for Claude Code (signals: existing `CLAUDE.md` or `.claude/` directory)
- `.cursorrules` for Cursor (signals: existing `.cursorrules` or `.cursor/` directory)

If no editor is detected, both files are generated.

#### Override with `--editor`

| Flag | Behavior |
|---|---|
| `--editor=claude` | Generate only `CLAUDE.md` |
| `--editor=cursor` | Generate only `.cursorrules` |
| `--editor=all` | Generate both, skip detection |

Re-running `init` is idempotent — files that already contain our marker are left untouched.
```

- [ ] **Step 3: Run final test pass + build sanity check**

```bash
npm test && npm run build
```

Expected: all tests pass, build succeeds.

- [ ] **Step 4: Commit**

```bash
git add package.json README.md
git commit -m "chore(release): bump to 0.2.0 + document --editor flag"
```

---

## Task 6: Push branch

⚠️ **Requires explicit user confirmation before pushing.** Auto-PR workflow will create + merge the PR.

- [ ] **Step 1: Confirm with user**

Show summary: branch contains 5 commits (spec + 4 implementation). Ask: "OK to push `feat/init-cursor-support`?"

- [ ] **Step 2: Push**

```bash
cd /Users/alfredoizquierdo/Desktop/MCP-APP/contextforge-mcp-public
git push -u origin feat/init-cursor-support
```

- [ ] **Step 3: Confirm auto-PR created**

Check `https://github.com/alfredoizdev/contextforge-mcp/pulls` for the new PR. If `auto-pr.yml` doesn't exist in this repo (verify in `.github/workflows/`), user creates PR manually with `gh pr create` — but per project convention this should be automated.

- [ ] **Step 4: User publishes to npm after merge**

Per project memory: user runs auth'd commands. After merge, user executes:

```bash
npm publish
```

(Not part of automated plan steps — handing off to user.)

---

## Out of Scope (NOT in this PR)

Documented for awareness:

1. Other AI clients (Copilot, Codex, Cline, Continue, Cody, Aider).
2. `--dry-run` flag.
3. Automatic `memory_link_project` invocation during `init`.
4. Interactive prompts (deliberately avoided to keep `init` CI-friendly).
5. `.cursor/config.json` or other deeper Cursor configuration.
