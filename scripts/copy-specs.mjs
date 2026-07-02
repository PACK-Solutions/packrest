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
import yaml from "js-yaml";

// Structural spec diff — plain-JS mirror of lib/spec-diff.ts (this script runs
// under plain `node` and can't import TS). Keep the two in step, like the copy
// logic they sit beside.
const HTTP_METHODS = ["get", "post", "put", "patch", "delete", "head", "options"];

function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys
    .map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`)
    .join(",")}}`;
}

function parseDoc(text) {
  let doc;
  try {
    doc = yaml.load(text);
  } catch {
    return null;
  }
  if (!doc || typeof doc !== "object") return null;
  const operations = new Map();
  for (const [pathKey, item] of Object.entries(doc.paths ?? {})) {
    if (!item || typeof item !== "object") continue;
    for (const method of HTTP_METHODS) {
      const op = item[method];
      if (!op) continue;
      operations.set(`${method.toUpperCase()} ${pathKey}`, stableStringify(op));
    }
  }
  const scopes = new Set();
  for (const scheme of Object.values(doc.components?.securitySchemes ?? {})) {
    const s = scheme?.flows?.clientCredentials?.scopes;
    if (s && typeof s === "object") {
      for (const name of Object.keys(s)) scopes.add(name);
    }
  }
  const version = typeof doc.info?.version === "string" ? doc.info.version : undefined;
  return { version, operations, scopes };
}

function diffSpec(api, oldYaml, newYaml) {
  const next = parseDoc(newYaml);
  const base = {
    api,
    endpointsAdded: [],
    endpointsRemoved: [],
    endpointsChanged: [],
    scopesAdded: [],
    scopesRemoved: [],
  };
  if (oldYaml == null || oldYaml.trim() === "") {
    return { ...base, status: "added", toVersion: next?.version };
  }
  const prev = parseDoc(oldYaml);
  if (!prev || !next) {
    return {
      ...base,
      status: "updated",
      fromVersion: prev?.version,
      toVersion: next?.version,
    };
  }
  const endpointsAdded = [...next.operations.keys()].filter(
    (k) => !prev.operations.has(k),
  );
  const endpointsRemoved = [...prev.operations.keys()].filter(
    (k) => !next.operations.has(k),
  );
  const endpointsChanged = [...next.operations.keys()].filter(
    (k) => prev.operations.has(k) && prev.operations.get(k) !== next.operations.get(k),
  );
  const scopesAdded = [...next.scopes].filter((s) => !prev.scopes.has(s));
  const scopesRemoved = [...prev.scopes].filter((s) => !next.scopes.has(s));
  const changed =
    endpointsAdded.length ||
    endpointsRemoved.length ||
    endpointsChanged.length ||
    scopesAdded.length ||
    scopesRemoved.length ||
    prev.version !== next.version;
  return {
    ...base,
    status: changed ? "updated" : "unchanged",
    fromVersion: prev.version,
    toVersion: next.version,
    endpointsAdded,
    endpointsRemoved,
    endpointsChanged,
    scopesAdded,
    scopesRemoved,
  };
}

function summarizeDiff(d) {
  if (d.status === "added") {
    return `nouvelle API${d.toVersion ? ` (v${d.toVersion})` : ""}`;
  }
  const plural = (n) => (n > 1 ? "s" : "");
  const parts = [];
  if (d.endpointsAdded.length)
    parts.push(`${d.endpointsAdded.length} ajouté${plural(d.endpointsAdded.length)}`);
  if (d.endpointsRemoved.length)
    parts.push(`${d.endpointsRemoved.length} supprimé${plural(d.endpointsRemoved.length)}`);
  if (d.endpointsChanged.length)
    parts.push(`${d.endpointsChanged.length} modifié${plural(d.endpointsChanged.length)}`);
  const scopeCount = d.scopesAdded.length + d.scopesRemoved.length;
  if (scopeCount) parts.push(`${scopeCount} scope${plural(scopeCount)}`);
  const ver =
    d.fromVersion && d.toVersion && d.fromVersion !== d.toVersion
      ? ` (v${d.fromVersion} → v${d.toVersion})`
      : "";
  return `${parts.length ? parts.join(", ") : "modifiée"}${ver}`;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");
const DEST = path.join(REPO_ROOT, "public", "specs");

const constantsPath = path.join(REPO_ROOT, "lib", "sync-constants.json");
const { ENV_VAR_NAME, CONFIG_FILENAME, DEFAULT_RELATIVE_PARTS, EXCLUDED_APIS } =
  JSON.parse(await fs.readFile(constantsPath, "utf8"));

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

  const apis = entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    // Deprecated / merged APIs are never copied (e.g. payment-method, whose
    // endpoints moved into person).
    .filter((name) => !EXCLUDED_APIS.includes(name));
  const copied = [];
  const skipped = [];
  const diffs = [];
  for (const api of apis) {
    const src = path.join(source, api, "v1", "openapi.bundle.yaml");
    try {
      const content = await fs.readFile(src, "utf8");
      const destFile = path.join(DEST, `${api}.yaml`);
      // Capture the previously-synced bundle before overwriting so we can
      // report what moved. Missing file → null → the API reads as "added".
      const previous = await fs.readFile(destFile, "utf8").catch(() => null);
      await fs.writeFile(destFile, content);
      copied.push(api);
      diffs.push(diffSpec(api, previous, content));
    } catch {
      skipped.push(api);
    }
  }
  console.log(
    `[copy-specs] copied ${copied.length} bundle(s) from ${source} to ${DEST}`,
  );
  // Report what changed (nothing deleted: an <api>.yaml dropped from the
  // source stays — so removals show only within a resynced API).
  const changed = diffs.filter((d) => d.status !== "unchanged");
  for (const d of changed.sort((a, b) => a.api.localeCompare(b.api))) {
    console.log(`[copy-specs]   ${d.api}: ${summarizeDiff(d)}`);
  }
  const unchanged = diffs.length - changed.length;
  if (unchanged) {
    console.log(`[copy-specs]   ${unchanged} unchanged`);
  }
  if (skipped.length) {
    console.log(`[copy-specs]   no v1 bundle in: ${skipped.join(", ")}`);
  }
}

main().catch((err) => {
  console.error("[copy-specs] failed:", err);
  process.exit(1);
});
