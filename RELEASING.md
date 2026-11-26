# Releasing contextforge-mcp

1. Bump `version` in `package.json`, `package-lock.json` and `server.json`, and add a `CHANGELOG.md` entry.
2. `npm test` and `npm run build`. Then integration-test the client against the edge functions before publishing.
3. `npm publish`, then `mcp-publisher publish` once npm serves the new version.
4. **Claude Desktop extension:**
   - Run `npm run mcpb`. It writes `contextforge-mcp-<version>.mcpb` and runs `mcpb validate`.
   - Copy it to `contextforge.mcpb`.
   - Attach it to the version's GitHub release: `gh release create v<version> contextforge.mcpb` (or `gh release upload v<version> contextforge.mcpb --clobber`).

   The onboarding wizard downloads `releases/latest/download/contextforge.mcpb`. If this step is skipped, new Claude Desktop users get the previous version, and the button breaks if no release has the asset.
5. Glama: create the matching release in the Glama UI.
