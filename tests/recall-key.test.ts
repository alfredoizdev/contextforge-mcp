import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { resolveApiKey, readMcpServerKey } from "../src/recall.js";

describe("resolveApiKey", () => {
  let home: string;
  let cwd: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "cf-recall-home-"));
    cwd = mkdtempSync(join(tmpdir(), "cf-recall-cwd-"));
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  });

  it("prefers CONTEXTFORGE_API_KEY from env", () => {
    writeFileSync(
      join(home, ".claude.json"),
      JSON.stringify({ mcpServers: { contextforge: { env: { CONTEXTFORGE_API_KEY: "from-claude-json" } } } }),
    );
    const key = resolveApiKey({ env: { CONTEXTFORGE_API_KEY: "from-env" }, homeDir: home, cwd });
    expect(key).toBe("from-env");
  });

  it("falls back to ~/.claude.json mcpServers.contextforge.env", () => {
    writeFileSync(
      join(home, ".claude.json"),
      JSON.stringify({ mcpServers: { contextforge: { env: { CONTEXTFORGE_API_KEY: "from-claude-json" } } } }),
    );
    const key = resolveApiKey({ env: {}, homeDir: home, cwd });
    expect(key).toBe("from-claude-json");
  });

  it("falls back to <cwd>/.mcp.json when ~/.claude.json has no key", () => {
    writeFileSync(
      join(cwd, ".mcp.json"),
      JSON.stringify({ mcpServers: { contextforge: { env: { CONTEXTFORGE_API_KEY: "from-mcp-json" } } } }),
    );
    const key = resolveApiKey({ env: {}, homeDir: home, cwd });
    expect(key).toBe("from-mcp-json");
  });

  it("accepts a server named with a contextforge prefix (e.g. contextforge-prod) when no exact match", () => {
    writeFileSync(
      join(home, ".claude.json"),
      JSON.stringify({ mcpServers: { "contextforge-prod": { env: { CONTEXTFORGE_API_KEY: "prefixed" } } } }),
    );
    expect(resolveApiKey({ env: {}, homeDir: home, cwd })).toBe("prefixed");
  });

  it("returns undefined when nothing is configured", () => {
    expect(resolveApiKey({ env: {}, homeDir: home, cwd })).toBeUndefined();
  });

  it("returns undefined on malformed JSON instead of throwing", () => {
    writeFileSync(join(home, ".claude.json"), "{ not json");
    expect(resolveApiKey({ env: {}, homeDir: home, cwd })).toBeUndefined();
  });
});

describe("readMcpServerKey", () => {
  it("returns undefined for a missing file", () => {
    expect(readMcpServerKey("/definitely/not/here.json")).toBeUndefined();
  });
});
