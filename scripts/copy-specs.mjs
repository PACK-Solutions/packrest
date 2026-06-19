#!/usr/bin/env node
// Copies bundled OpenAPI specs from <source>/<api>/v1/openapi.bundle.yaml
// into packrest/public/specs/<api>.yaml. Source resolution order is shared
// with lib/sync.ts via lib/sync-constants.json:
//   1. .packrest.config.json -> specsDir (at repo root)
//   2. PACKREST_SPECS_DIR env var
//   3. Default: ../openapi/dist (relative to packrest/)
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");
const DEST = path.join(REPO_ROOT, "public", "specs");

const constantsPath = path.join(REPO_ROOT, "lib", "sync-constants.json");
const { ENV_VAR_NAME, CONFIG_FILENAME, DEFAULT_RELATIVE_PARTS } = JSON.parse(
  await fs.readFile(constantsPath, "utf8"),
);

const CONFIG_FILE = path.join(REPO_ROOT, CONFIG_FILENAME);
const DEFAULT_SOURCE = path.resolve(REPO_ROOT, ...DEFAULT_RELATIVE_PARTS);

async function resolveSource() {
  try {
    const raw = await fs.readFile(CONFIG_FILE, "utf8");
    const cfg = JSON.parse(raw);
    if (cfg && typeof cfg.specsDir === "string" && cfg.specsDir.trim()) {
      return path.resolve(cfg.specsDir);
    }
  } catch {
    // missing or malformed — fall through
  }
  const env = process.env[ENV_VAR_NAME];
  if (env && env.trim()) return path.resolve(env);
  return DEFAULT_SOURCE;
}

async function main() {
  const source = await resolveSource();
  let entries;
  try {
    entries = await fs.readdir(source, { withFileTypes: true });
  } catch {
    console.warn(
      `[copy-specs] source not found at ${source}. Set "specsDir" in ${CONFIG_FILENAME} or ${ENV_VAR_NAME}. Skipping.`,
    );
    return;
  }

  await fs.mkdir(DEST, { recursive: true });

  const apis = entries.filter((e) => e.isDirectory()).map((e) => e.name);
  const copied = [];
  const skipped = [];
  for (const api of apis) {
    const src = path.join(source, api, "v1", "openapi.bundle.yaml");
    try {
      const content = await fs.readFile(src, "utf8");
      await fs.writeFile(path.join(DEST, `${api}.yaml`), content);
      copied.push(api);
    } catch {
      skipped.push(api);
    }
  }
  console.log(
    `[copy-specs] copied ${copied.length} bundle(s) from ${source} to ${DEST}`,
  );
  if (skipped.length) {
    console.log(`[copy-specs]   no v1 bundle in: ${skipped.join(", ")}`);
  }
}

main().catch((err) => {
  console.error("[copy-specs] failed:", err);
  process.exit(1);
});
