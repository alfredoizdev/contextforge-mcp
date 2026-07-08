#!/usr/bin/env node
// Builds the MCPB desktop-extension bundle:
//   manifest (version + live tools list) + dist + production node_modules + icon
// Usage: npm run mcpb
import { spawn, execSync } from "node:child_process";
import {
  mkdirSync,
  rmSync,
  cpSync,
  copyFileSync,
  readFileSync,
  writeFileSync,
  statSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const STAGE = join(ROOT, "mcpb-build");

const log = (msg) => console.log(`[mcpb] ${msg}`);

// 1. Version comes from package.json — single source of truth.
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf-8"));
log(`version ${pkg.version}`);

// 2. Fresh compile so dist/ matches the source we're bundling.
log("building (tsc)...");
execSync("npm run build", { cwd: ROOT, stdio: "inherit" });

// 3. Ask the real server for its tools over stdio (MCP is newline-delimited
//    JSON-RPC). A dummy API key is fine: tools/list is static, no network.
log("querying tools/list over stdio...");
const tools = await new Promise((resolve, reject) => {
  const child = spawn("node", [join(ROOT, "dist", "index.js")], {
    env: { ...process.env, CONTEXTFORGE_API_KEY: "mcpb-build-dummy-key-0000" },
    stdio: ["pipe", "pipe", "ignore"],
  });
  const timeout = setTimeout(() => {
    child.kill();
    reject(new Error("tools/list timed out after 15s"));
  }, 15_000);
  let buf = "";
  child.stdout.on("data", (chunk) => {
    buf += chunk.toString();
    let idx;
    while ((idx = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, idx);
      buf = buf.slice(idx + 1);
      if (!line.trim()) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (msg.id === 2) {
        clearTimeout(timeout);
        child.kill();
        if (msg.error) {
          reject(new Error(`tools/list error: ${JSON.stringify(msg.error)}`));
        } else {
          resolve(
            msg.result.tools.map((t) => ({
              name: t.name,
              // First line only — manifest descriptions are directory copy,
              // not the full multi-paragraph tool prompt.
              description: (t.description || "").split("\n")[0].slice(0, 200),
            })),
          );
        }
      }
    }
  });
  child.on("error", reject);
  const send = (obj) => child.stdin.write(JSON.stringify(obj) + "\n");
  send({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "mcpb-builder", version: pkg.version },
    },
  });
  send({ jsonrpc: "2.0", method: "notifications/initialized" });
  send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
  child.stdin.end();
});
log(`${tools.length} tools discovered`);
if (tools.length < 10) {
  throw new Error(`suspiciously few tools (${tools.length}) — aborting`);
}

// 4. Render the manifest from the template.
const template = readFileSync(join(ROOT, "mcpb", "manifest.template.json"), "utf-8");
const manifest = template
  .replace('"__VERSION__"', JSON.stringify(pkg.version))
  .replace('"__TOOLS__"', JSON.stringify(tools, null, 2));
JSON.parse(manifest); // throws if the render broke the JSON

// 5. Stage a self-contained bundle dir.
log("staging...");
rmSync(STAGE, { recursive: true, force: true });
mkdirSync(STAGE, { recursive: true });
writeFileSync(join(STAGE, "manifest.json"), manifest);
copyFileSync(join(ROOT, "mcpb", "icon.png"), join(STAGE, "icon.png"));
cpSync(join(ROOT, "dist"), join(STAGE, "dist"), { recursive: true });
copyFileSync(join(ROOT, "package.json"), join(STAGE, "package.json"));
copyFileSync(join(ROOT, "package-lock.json"), join(STAGE, "package-lock.json"));
log("npm ci --omit=dev in staging...");
execSync("npm ci --omit=dev --ignore-scripts", { cwd: STAGE, stdio: "inherit" });

// 6. Validate + pack with the official CLI.
const out = join(ROOT, `contextforge-mcp-${pkg.version}.mcpb`);
log("validating manifest...");
execSync(`npx --yes @anthropic-ai/mcpb validate "${join(STAGE, "manifest.json")}"`, {
  stdio: "inherit",
});
log("packing...");
execSync(`npx --yes @anthropic-ai/mcpb pack "${STAGE}" "${out}"`, { stdio: "inherit" });
log(`done: ${out} (${(statSync(out).size / 1024 / 1024).toFixed(1)} MB)`);
