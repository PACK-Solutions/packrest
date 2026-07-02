// Server-side generator: turn a loaded OpenAPI spec into a Bruno collection
// (opencollection 1.0.0) tree, mirroring the layout of ../openapi/bruno:
//
//   <api>/v1/opencollection.yml
//   <api>/v1/environments/{Dev,Rec}.yml
//   <api>/v1/<tag>/folder.yml
//   <api>/v1/<tag>/<Request name>.yml
//
// Returns file contents keyed by path relative to the collection dir; the
// export route zips them.

import { loadSpec, listEndpoints, extractOAuth2, type EndpointEntry } from "./specs";
import {
  extractBodyExamples,
  extractParameterExample,
  defaultFromSchema,
} from "./example-extractor";
import { ENV_PRESETS, resolveBaseUrl, resolveTokenUrl } from "./env";
import {
  brunoOAuth2,
  serializeOpenCollectionYml,
  serializeEnvironmentYml,
  serializeFolderYml,
  serializeRequestYml,
  type BrunoEnvironment,
  type BrunoParam,
  type BrunoRequest,
} from "./bruno";
import type { OpenApiDocument } from "./types";

export interface BrunoCollectionFiles {
  /** Base directory the files should live under in the zip, e.g. "contract/v1". */
  dir: string;
  /** Path relative to `dir` → UTF-8 file content. */
  files: Record<string, string>;
}

const NO_BODY_METHODS = new Set(["GET", "HEAD", "DELETE"]);

export async function buildBrunoCollection(
  apiId: string,
): Promise<BrunoCollectionFiles | null> {
  const doc = await loadSpec(apiId);
  if (!doc) return null;

  const endpoints = listEndpoints(doc, apiId);
  const oauth = extractOAuth2(doc);
  const scope = Object.keys(oauth?.flows.clientCredentials?.scopes ?? {}).join(
    " ",
  );

  const files: Record<string, string> = {};

  files["opencollection.yml"] = serializeOpenCollectionYml({
    name: doc.info.title,
    headers: [{ name: "Accept", value: "*/*" }],
    auth: brunoOAuth2(scope),
  });

  files["environments/Dev.yml"] = serializeEnvironmentYml(
    environmentFor(apiId, "dev", doc),
  );
  files["environments/Rec.yml"] = serializeEnvironmentYml(
    environmentFor(apiId, "rec", doc),
  );

  // One folder per tag, preserving discovery order.
  const byTag = new Map<string, EndpointEntry[]>();
  for (const e of endpoints) {
    if (!byTag.has(e.tag)) byTag.set(e.tag, []);
    byTag.get(e.tag)!.push(e);
  }

  let folderSeq = 1;
  for (const [tag, items] of byTag) {
    const folderDir = safeSegment(tag);
    files[`${folderDir}/folder.yml`] = serializeFolderYml({
      name: tag,
      seq: folderSeq++,
    });
    let seq = 1;
    const used = new Set<string>();
    for (const e of items) {
      const req = endpointToBrunoRequest(e);
      req.seq = seq++;
      const fileName = uniqueName(used, safeSegment(req.name));
      files[`${folderDir}/${fileName}.yml`] = serializeRequestYml(req);
    }
  }

  return { dir: `${apiId}/v1`, files };
}

function endpointToBrunoRequest(e: EndpointEntry): BrunoRequest {
  const op = e.operation;
  const merged = [...(e.pathItem.parameters ?? []), ...(op.parameters ?? [])];

  const params: BrunoParam[] = [];
  const seen = new Set<string>();
  for (const p of merged) {
    if (p.in !== "path" && p.in !== "query") continue;
    const key = `${p.in}:${p.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    params.push({
      name: p.name,
      value: String(extractParameterExample(p) ?? ""),
      type: p.in,
      description: p.description,
    });
  }

  // OpenAPI `{param}` -> Bruno `:param`.
  const url = `{{baseUrl}}${e.path.replace(/\{([^}]+)\}/g, ":$1")}`;

  let body: BrunoRequest["body"];
  if (!NO_BODY_METHODS.has(e.method.toUpperCase())) {
    const schema = op.requestBody?.content?.["application/json"]?.schema;
    if (schema) {
      const examples = extractBodyExamples(op);
      const value = examples.length
        ? examples[0].value
        : defaultFromSchema(schema);
      if (value !== undefined) {
        body = { type: "json", data: JSON.stringify(value, null, 2) };
      }
    }
  }

  return {
    name: op.summary?.trim() || e.operationId,
    tags: [e.tag],
    method: e.method.toUpperCase(),
    url,
    params: params.length ? params : undefined,
    body,
    docs: op.description?.trim() || undefined,
  };
}

function environmentFor(
  apiId: string,
  env: "dev" | "rec",
  doc: OpenApiDocument,
): BrunoEnvironment {
  const specDefault = doc.servers?.[0]?.url ?? "";
  const specTokenUrl =
    extractOAuth2(doc)?.flows.clientCredentials?.tokenUrl ?? "";
  const tokenUrl = resolveTokenUrl(env, "", specTokenUrl);
  return {
    name: env === "dev" ? "Dev" : "Rec",
    variables: [
      { name: "host", value: ENV_PRESETS[env].host },
      { name: "baseUrl", value: resolveBaseUrl(apiId, env, "", specDefault) },
      { name: "oauth_client_id", value: "pack-solutions" },
      {
        name: "oauth_client_secret",
        value: "{{process.env.OAUTH_CLIENT_SECRET}}",
      },
      { name: "oauth_token_url", value: tokenUrl },
      { name: "oauth_refresh_url", value: tokenUrl },
    ],
  };
}

// Filesystem-safe segment for folder/file names. Bruno keeps spaces (e.g.
// "List contracts.yml"), so only path separators and control characters are
// stripped.
function safeSegment(name: string): string {
  const cleaned = name.replace(/[/\\]+/g, "-").trim();
  return cleaned || "unnamed";
}

function uniqueName(used: Set<string>, base: string): string {
  let name = base;
  let n = 2;
  while (used.has(name)) name = `${base} (${n++})`;
  used.add(name);
  return name;
}
