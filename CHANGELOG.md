# Changelog

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
