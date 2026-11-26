import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The Claude Desktop extension (.mcpb) is a one-click install from the
// onboarding wizard. It must always talk to production: the only thing the
// user supplies is their API key.
const manifest = JSON.parse(
  readFileSync(join(__dirname, "..", "mcpb", "manifest.template.json"), "utf-8"),
);

describe("mcpb manifest template", () => {
  it("maps the user's API key to CONTEXTFORGE_API_KEY", () => {
    expect(manifest.server.mcp_config.env.CONTEXTFORGE_API_KEY).toBe("${user_config.api_key}");
  });

  it("never sets CONTEXTFORGE_API_URL, so installs always reach production", () => {
    expect("CONTEXTFORGE_API_URL" in manifest.server.mcp_config.env).toBe(false);
  });

  it("asks for the key as a required, sensitive field", () => {
    expect(manifest.user_config.api_key.sensitive).toBe(true);
    expect(manifest.user_config.api_key.required).toBe(true);
  });

  it("requires the same Node version as package.json engines", () => {
    expect(manifest.compatibility.runtimes.node).toBe(">=20.0.0");
  });
});
