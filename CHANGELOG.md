# Changelog

## 0.13.2

- **The objective hook ignores Claude Code system turns.** Background-task notifications (`<task-notification>…`), `<system-reminder>` blocks and similar are delivered to the `UserPromptSubmit` hook like prompts; one showed up as "Latest request before compaction". Prompts that are a tagged block (start with an XML-like opening tag and contain a closing tag) are no longer logged, and `recall` ignores such entries in logs written by the previous script; a prompt that merely begins with markup ("<div> is not centered, fix it") is still logged. The script is now v2; re-run `npx contextforge-mcp init` to replace it (it only touches what changed).
- **The relevance search gets the same deadline as every other stage.** It kept a 4-second cap from 0.13.0, stricter than the 6-second per-stage deadlines added in 0.13.1, so on a slow backend it was the only stage that timed out while the rest of the block still arrived. It now shares the 6-second deadline. The local event (`~/.contextforge-mcp/recall-events.jsonl`) records why the stage came back the way it did — `relevant_outcome`: `hits`, `empty`, `timeout`, `error` or `skipped` — plus its duration, and `recall --stats` prints how many recalls timed out there.
- **Existing projects are told once about the objective hook.** If `.claude/settings.json` runs the post-compaction recall hook but `.claude/hooks/contextforge-objective.cjs` is missing or older than the current version, the first tool response of a session carries a one-line tip to run `npx contextforge-mcp init`. Shown once per project per script version; `CONTEXTFORGE_DISABLE_INIT_HINT=1` disables it like the existing init tip.

## 0.13.1

- **Recall never comes back empty because one request was slow.** Each remote stage of `recall` (listing the project's spaces, each space's recent items, pending tasks, the relevance search) now has its own 6-second deadline and degrades to "nothing from this stage"; the block is built from whatever arrived, and the session objective (local) is always printed. Before, a single slow call tripped the one global 8-second deadline and the hook printed nothing at all — measured on a 21-space project, 2 of 4 real post-compaction runs came back empty. The global deadline is now a 12-second last resort. Consequence for failures: if only the memories call fails, tasks still print (mirroring the existing "only tasks fail" behavior); if everything fails and there is no local session log, the output is still empty.

## 0.13.0

- **Recall now restores the session objective.** `init` writes a tiny, dependency-free hook script at `.claude/hooks/contextforge-objective.cjs` and adds a `UserPromptSubmit` hook that runs it with plain `node` (~50 ms per prompt; `npx` would cost 0.4–0.8 s). The script appends each prompt (600-char cap, slash commands skipped) to `~/.contextforge-mcp/sessions/<session_id>.jsonl` on your machine; the log is never uploaded. After a compaction, `recall` prints the session's first real request and the latest request before the cut, so the agent no longer restarts the plan from "working on auth changes". Logs are pruned after 14 days; remove the `UserPromptSubmit` group from `.claude/settings.json` to opt out.
- **Recall adds memories relevant to the current work, whatever their age.** The block was only the 10 most recent memories; a decision made 40 memories ago never came back. `recall` now builds a query from the session objective, the git branch, the last 3 commit subjects and up to 8 changed files, runs a semantic search over the linked project (in parallel with the recent/tasks fetches) and prints up to 5 hits above score 0.4 in a "Relevant to current work" section ahead of the recent ones (deduplicated). Worst-case block stays around 4 KB, injected once per compaction, never pinned. This is one metered query per compaction: it runs only when there is a session objective or a non-default git branch, it has its own 4 s deadline (a slow search degrades to "no relevant hits" instead of dropping the block), and `CONTEXTFORGE_RECALL_RELEVANCE=0` disables it. The objective text (≤600 chars) is sent as the query, like any `memory_query`; it is not stored.
- **`contextforge-mcp recall --stats`.** Local-only measurement of the hook: how many recalls ran in the last 30 days, how many had an objective or relevant hits, how many were followed by a `memory_query` within 15 minutes, and the median delay. Data lives in `~/.contextforge-mcp/recall-events.jsonl` / `recall-followups.jsonl`; nothing is uploaded. Numbers are approximate: a query is matched to the latest recall in the same directory.
- `recall` reads the hook's stdin (bounded to 300 ms, TTY-safe) to learn the Claude Code `session_id`; a manual run still works and falls back to the newest session log for the current directory.
- Backward compatible: with no session log, no git repository and no relevant hits the block is byte-identical to 0.12.0 (pinned by a test). Re-run `npx contextforge-mcp init` once per project to add the new hook; it only adds what is missing.

## 0.12.0

- **Memories now survive Claude Code compaction.** `init` installs a `SessionStart` hook (matcher `compact`) in `.claude/settings.json` that runs the new `contextforge-mcp recall` subcommand after every compaction and re-injects the linked project's 10 most recent memories and up to 5 pending tasks into the context. The hook never blocks a session: with no key, no linked project, a network error, or after 8 s it prints nothing and exits 0.
- New CLI subcommand `contextforge-mcp recall`. Resolves the API key from `CONTEXTFORGE_API_KEY`, then `~/.claude.json`, then `<cwd>/.mcp.json`.
- `init` is still idempotent per section, and the hook is merged into an existing `settings.json` without touching other keys or hooks.

## 0.11.0

- **Default tool surface reduced from 69 to 11.** The server now exposes 10 core tools — `memory_query`, `memory_ingest`, `memory_check_freshness`, `memory_confirm`, `memory_correct`, `memory_forget`, `tasks_list`, `tasks_what_next`, `session_list`, `memory_help` — plus one gateway tool, `cf_tools`. No capability was removed: all 59 other tools remain fully callable, either directly by name (`cf_tools({ name, args })`) or by natural-language search (`cf_tools({ query })`), which matches against tool names, categories, and a hand-written synonym map and returns full, ready-to-call schemas for the best matches. Search covers both English and Spanish (e.g. "olvidar un recuerdo viejo" surfaces `memory_forget`).
- New `CONTEXTFORGE_TOOLS` environment variable. Default is `lean` (the 11-tool surface above); set to `full` to restore the exact pre-0.11.0 behavior of exposing all 69 tools directly.
- Why: at 69 tools, ContextForge alone exceeded Cursor's 40-tool cap and contributed to the accuracy degradation several clients show past ~50 tools, on top of the ~15,000 tokens of schema loaded into every session's context. The lean default measures at ~3,500 tokens (~77% reduction) while every tool stays one `cf_tools` call away.
- `init`-generated `CLAUDE.md`/`.cursorrules` rules and the server's `initialize` instructions no longer name now-hidden tools directly; they route through `cf_tools` instead (e.g. "call `cf_tools` with query 'link project'").

## 0.7.0

- New `memory_move_item` tool — move a knowledge item to a different space by id or title, with the target space given by name or UUID. Completes the topic-organization feature: memory auto-organizes into topic spaces (0.6.0) and mis-filed items can now be moved. Cross-project moves within your org are allowed. (Requires the `move-item` backend endpoint to be deployed.)

## 0.6.0

- Topic-based memory organization. The `initialize` `instructions` now tell the model to route each save into the best-matching existing space (`memory_list_spaces`) and to create a new space (`memory_create_space`) only for a clearly new major area — so knowledge lands in a small set of broad, folder-like spaces (API, Frontend, Infra, Bugs, Decisions…) instead of one undifferentiated dump. Behavior-only; reuses existing tools. (Moving items between spaces — `memory_move_item` — ships in a later release.)

## 0.5.2

- The `initialize` `instructions` now also steer **writes**: the model is told to save to ContextForge proactively (not only when the user says "remember") and to prefer ContextForge over any built-in or file-based memory for both reading and writing. Closes the gap where a client without a CLAUDE.md rule saved work to local file-memory instead of ContextForge.
- New `contextforge-mcp --version` command (also `-v`, `-V`, `version`) prints the installed MCP version and exits, so clients can check what they are running.

## 0.5.1

- The MCP `initialize` response now returns a server-level `instructions` block. Clients that honor it (Claude Desktop, Claude Code, and others) inject it into the model on connect, so ContextForge memory is used automatically at the start of a session — no need to edit `CLAUDE.md`, `.cursorrules`, or any per-tool settings.
- Applies to existing users too: no re-`init` and no config changes — you get it once your client resolves this version (automatic with `npx -y contextforge-mcp`).

## 0.4.2

- `init` now writes a third section, **Startup Context**, so Claude Code and Cursor load a short ContextForge project summary (overview, open tasks, live sessions) at the start of every conversation.
- Existing users are nudged once to re-run `npx contextforge-mcp init` to pick up the new section; re-running only appends what is missing.

## 0.4.1

Onboarding & reliability fixes so new users get a working, honest experience.

### Setup
- One canonical install command everywhere: `claude mcp add contextforge -s user -e CONTEXTFORGE_API_KEY=<key> -- npx -y contextforge-mcp`. Persists the key and needs no global install (previous instructions could break on the next session).
- The setup wizard now validates your API key against the backend before configuring, and reports a clear error if it's rejected.

### Saving to memory
- Accurate ingest feedback: distinguishes **saved** / **already exists (duplicate)** / **failed (with the real reason)** instead of reporting failures as duplicates.
- Warns when an item was saved but is not yet searchable (embedding pending).
- Batch ingest no longer reports "0 items" as success.
- New optional `deduplicate: false` on `memory_ingest` to force-save even when identical content exists.

### Errors
- Actionable error messages (invalid key, quota, etc.) instead of raw codes — the friendly-message system now works for all backend error shapes.
- Warns at startup (stderr) if your API key is already rejected, instead of appearing connected and then failing on every tool call.

## 0.4.0

- init hints, MCPB desktop bundle.
