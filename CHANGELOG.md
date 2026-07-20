# Changelog

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
