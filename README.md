# ContextForge MCP — Persistent Memory for Claude, Cursor & Copilot

[![npm version](https://img.shields.io/npm/v/contextforge-mcp.svg)](https://www.npmjs.com/package/contextforge-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](https://nodejs.org)
[![Glama MCP](https://glama.ai/mcp/servers/alfredoizdev/contextforge-mcp/badges/score.svg)](https://glama.ai/mcp/servers/alfredoizdev/contextforge-mcp)

> Give Claude Code, Cursor, and GitHub Copilot **persistent memory across sessions** via the Model Context Protocol (MCP). Stop re-explaining your project every time.

ContextForge MCP is an open-source MCP server that connects your AI coding assistants to **long-term, searchable memory**. Decisions, architecture notes, debugging context, and project knowledge stay available across every session — across every tool that supports MCP.

- 🧠 **Persistent memory** — your AI remembers everything across sessions, days, and weeks
- 🔍 **Semantic search** — find knowledge by meaning, not keywords
- 🔗 **One memory, every tool** — Claude Code, Cursor, Copilot, Claude Desktop, Windsurf
- 🐙 **Git integration** — sync commits and PRs automatically
- ✅ **Task tracking** — issues, assignments, and project status
- 👥 **Team collaboration** — share projects and memory with your team
- 🆓 **Free tier** — get started without a credit card

---

## Quick Start

### 1. Install

```bash
npm install -g contextforge-mcp
```

### 2. Get your API key

1. Go to **[contextforge.dev](https://contextforge.dev)**
2. Sign up (free tier available)
3. Settings → API Keys → **Generate API Key**
4. Copy your key (starts with `cf_`)

### 3. Connect to your AI tool

#### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "contextforge": {
      "command": "contextforge-mcp",
      "env": {
        "CONTEXTFORGE_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

Restart Claude Desktop.

#### Claude Code (CLI)

```bash
claude mcp add contextforge \
  -e CONTEXTFORGE_API_KEY=your-api-key-here \
  -- contextforge-mcp
```

Restart Claude Code and run `/mcp` to verify it's connected.

#### Cursor

Add to your Cursor MCP settings:

```json
{
  "mcpServers": {
    "contextforge": {
      "command": "npx",
      "args": ["contextforge-mcp"],
      "env": {
        "CONTEXTFORGE_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

#### GitHub Copilot (VS Code)

Add to your Copilot MCP config:

```json
{
  "servers": {
    "contextforge": {
      "command": "npx",
      "args": ["contextforge-mcp"],
      "env": {
        "CONTEXTFORGE_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

### 4. Initialize your project (required)

Set up your project so your AI editor knows to use ContextForge memory:

```bash
npx contextforge-mcp init
```

By default, `init` auto-detects which editor your project uses and writes:

- `CLAUDE.md` for Claude Code (signals: existing `CLAUDE.md` or `.claude/` directory)
- `.cursorrules` for Cursor (signals: existing `.cursorrules` or `.cursor/` directory)

If no editor is detected, both files are generated.

**Without this step, your AI will silently ignore ContextForge for memory queries** — even though the MCP is connected — because the built-in auto-memory wins by default.

#### Override with `--editor`

| Flag | Behavior |
|---|---|
| `--editor=claude` | Generate only `CLAUDE.md` |
| `--editor=cursor` | Generate only `.cursorrules` |
| `--editor=all` | Generate both, skip detection |

Re-running `init` is idempotent — files that already contain our marker are left untouched.

---

## Available Tools

ContextForge provides tools for **Knowledge Management**, **GitHub Integration**, **Issue Tracking**, and **Collaboration**.

### Knowledge Management

| Tool | Description |
|------|-------------|
| `memory_ingest` | Save knowledge to memory |
| `memory_query` | Search your knowledge semantically |
| `memory_list_items` | List all stored items |
| `memory_delete` | Remove specific items |
| `memory_ingest_batch` | Save multiple items at once |
| `memory_delete_batch` | Delete items by filter |

### Spaces & Projects

| Tool | Description |
|------|-------------|
| `memory_list_spaces` | List your spaces |
| `memory_create_space` | Create a new space |
| `memory_delete_space` | Delete a space |
| `memory_move_space` | Move space to project |
| `memory_list_projects` | List your projects |
| `memory_create_project` | Create a new project |
| `memory_delete_project` | Delete a project |
| `memory_link_project` | Link directory to project |
| `memory_unlink_project` | Unlink directory |
| `memory_current_project` | Show linked project |

### GitHub Integration

| Tool | Description |
|------|-------------|
| `memory_git_connect` | Connect a GitHub repo |
| `memory_git_list` | List connected repos |
| `memory_git_activate` | Activate/deactivate webhook |
| `memory_git_sync` | Import existing history |
| `memory_git_commits` | List synced commits |
| `memory_git_prs` | List synced PRs |
| `memory_git_disconnect` | Disconnect a repo |

### Issue Tracking

| Tool | Description |
|------|-------------|
| `issues_list` | List your issues |
| `issues_create` | Create a new issue |
| `issues_start` | Mark as in progress |
| `issues_resolve` | Mark as resolved |
| `issues_resolve_by_name` | Resolve by title |
| `issues_assign` | Assign to collaborator |
| `issues_what_next` | Get recommendation |

### Collaboration

| Tool | Description |
|------|-------------|
| `project_share` | Share project by email |
| `collaborators_list` | List collaborators |

### Snapshots & Export

| Tool | Description |
|------|-------------|
| `memory_snapshot_create` | Create a backup |
| `memory_snapshot_list` | List all snapshots |
| `memory_snapshot_restore` | Restore from backup |
| `memory_snapshot_delete` | Delete a snapshot |
| `memory_export` | Export to JSON/MD/CSV |
| `memory_import` | Import from file |

### Utility

| Tool | Description |
|------|-------------|
| `memory_stats` | View usage statistics |
| `memory_relate` | Link two items |
| `memory_help` | Show help |

---

## Natural Language Examples

You don't need to memorize commands — just talk naturally to your AI:

```
# Knowledge
"Save this: we use PostgreSQL for the main database"
"What database do we use?"
"List my spaces"

# GitHub
"Connect my repo github.com/myuser/myproject"
"What commits did I make today?"
"Show PRs merged this week"

# Issues
"Create an issue: Update the login page design"
"What's pending?"
"What should I work on next?"
"Mark the login issue as done"
```

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `CONTEXTFORGE_API_KEY` | Yes | Your API key from the dashboard |
| `CONTEXTFORGE_API_URL` | No | API endpoint (defaults to production) |
| `CONTEXTFORGE_DEFAULT_SPACE` | No | Default space for operations |

---

## How it works

ContextForge MCP is a thin client that translates Model Context Protocol tool calls into authenticated HTTP requests against the ContextForge API. Your knowledge is stored, indexed (semantic embeddings), and retrieved on the server side — the MCP client itself is stateless.

This means:
- **No infra to manage** — no local databases, no embeddings to run, no vector stores to maintain
- **Works everywhere your AI works** — same memory across Claude Code, Cursor, Copilot, etc.
- **Team collaboration** — shared projects sync in real time

---

## Dashboard

Manage your memory visually at **[contextforge.dev](https://contextforge.dev)**:

- View and organize your knowledge
- Search and filter memories
- Manage API keys and billing
- Track issues and collaborate
- Export and backup data

---

## Development

```bash
# Clone and install
git clone https://github.com/alfredoizdev/contextforge-mcp.git
cd contextforge-mcp
npm install

# Build
npm run build

# Run tests
npm test

# Watch mode
npm run dev
```

---

## Contributing

Issues and pull requests are welcome at **[github.com/alfredoizdev/contextforge-mcp](https://github.com/alfredoizdev/contextforge-mcp)**.

---

## Support

- 📖 [Documentation](https://contextforge.dev/docs)
- 🐛 [Report Issues](https://github.com/alfredoizdev/contextforge-mcp/issues)
- 💬 Questions: support@contextforge.app

---

## License

MIT © [Alfredo Izquierdo](https://github.com/alfredoizdev)
