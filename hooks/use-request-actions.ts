// The three "describe the current request" actions for RequestBuilder — Bruno
// export, curl copy, and context-path save. None hold state; they read the live
// form values passed in. Kept out of the component so its body stays lean, and
// the Bruno-request assembly is split across small helpers so no single
// function trips the cognitive-complexity threshold.

import { toast } from "sonner";
import { saveText } from "@/lib/exporter";
import {
  serializeRequestYml,
  type BrunoHeader,
  type BrunoParam,
  type BrunoRequest,
} from "@/lib/bruno";
import { buildCurl, curlForm } from "@/lib/curl";
import { loadSettings, saveSettings, type SavedHeader } from "@/lib/storage";
import { contextPathFromBaseUrl, defaultContextPathFor } from "@/lib/env";
import type {
  OpenApiOperation,
  OpenApiParameter,
  JsonSchema,
} from "@/lib/types";

interface Effective {
  url: string;
  method: string;
  body: unknown;
  defaultName: string;
}

interface ActionInputs {
  apiId: string;
  operation: OpenApiOperation;
  pathParams: OpenApiParameter[];
  queryParams: OpenApiParameter[];
  paramValues: Record<string, string>;
  customHeaders: SavedHeader[];
  bodySchema: JsonSchema | undefined;
  bodyValue: unknown;
  files: Record<string, File | null>;
  isMultipart: boolean;
  isFollowing: boolean;
  selectedScopes: string[];
  effective: Effective;
  baseUrl: string;
  buildLiveHeaders: (customHeaders: SavedHeader[]) => Record<string, string>;
}

const wantsBodyFor = (method: string) =>
  !["GET", "HEAD"].includes(method.toUpperCase());

// Path + query params for the export. A followed HAL URL carries its params in
// the URL already, so none are emitted while navigating.
function buildExportParams(i: ActionInputs): BrunoParam[] {
  if (i.isFollowing) return [];
  const params: BrunoParam[] = [];
  for (const p of i.pathParams) {
    params.push({
      name: p.name,
      value: i.paramValues[p.name] ?? "",
      type: "path",
      description: p.description,
    });
  }
  for (const p of i.queryParams) {
    const value = i.paramValues[p.name] ?? "";
    if (value === "") continue;
    params.push({ name: p.name, value, type: "query", description: p.description });
  }
  return params;
}

function buildBrunoRequest(i: ActionInputs): BrunoRequest {
  const wantsBody = wantsBodyFor(i.effective.method);
  // Bruno's opencollection body model here is json/text only — a binary
  // multipart upload can't round-trip through the YAML. Export the request
  // shape without the body and note it so the user re-attaches the file in
  // Bruno rather than shipping a misleading JSON body.
  const asMultipart = wantsBody && i.isMultipart && !i.isFollowing;
  const docs = asMultipart
    ? [
        i.operation.summary,
        "⚠️ Requête multipart/form-data : ajoutez le fichier et les champs du formulaire dans Bruno (corps non exporté).",
      ]
        .filter(Boolean)
        .join("\n\n")
    : i.operation.summary;
  const params = buildExportParams(i);
  const headers: BrunoHeader[] = i.customHeaders
    .filter((h) => h.key)
    .map((h) => ({ name: h.key, value: h.value, disabled: h.enabled === false }));
  return {
    name: i.effective.defaultName,
    tags: [i.apiId],
    method: i.effective.method.toUpperCase(),
    url: i.effective.url,
    params: params.length ? params : undefined,
    headers: headers.length ? headers : undefined,
    body:
      !asMultipart && wantsBody && i.bodySchema
        ? { type: "json", data: JSON.stringify(i.effective.body ?? {}, null, 2) }
        : undefined,
    docs,
    // Carry the selected scopes so a single-request export round-trips them
    // (a followed HAL URL inherits auth, so no scopes there).
    scopes:
      !i.isFollowing && i.selectedScopes.length ? i.selectedScopes : undefined,
  };
}

function buildCurlCommand(i: ActionInputs): string {
  const headers = i.buildLiveHeaders(i.customHeaders);
  const wantsBody = wantsBodyFor(i.effective.method);
  // A multipart upload only applies to the operation request, not to a
  // followed GET (isFollowing collapses effective.method to GET).
  const asMultipart = wantsBody && i.isMultipart && !i.isFollowing;
  // Mirror run(): an op that declares a JSON body sends `{}` when empty, so the
  // preview must too (otherwise the curl omits the body upstream).
  const jsonBody =
    wantsBody && !asMultipart && i.bodySchema ? (i.effective.body ?? {}) : undefined;
  if (jsonBody !== undefined) {
    headers["Content-Type"] = headers["Content-Type"] ?? "application/json";
  }
  return buildCurl({
    method: i.effective.method,
    url: i.effective.url,
    headers,
    body: jsonBody !== undefined ? JSON.stringify(jsonBody, null, 2) : null,
    form: asMultipart ? curlForm(i.bodyValue, i.files) : undefined,
  });
}

export function useRequestActions(inputs: ActionInputs) {
  // Export the currently-composed request as a single Bruno request file (.yml).
  // Mirrors the "Copier en curl" mental model: what you export is what would be
  // sent (the operation request, or the followed URL when navigating).
  const exportBruno = () => {
    const req = buildBrunoRequest(inputs);
    const name = `${req.name.replace(/[/\\]+/g, "-").trim() || "request"}.yml`;
    saveText(name, serializeRequestYml(req), [
      { name: "Requête Bruno", extensions: ["yml"] },
    ]).then(
      (saved) => {
        if (saved) toast.success("Requête exportée (Bruno)");
      },
      (e) =>
        toast.error("Échec de l'export", { description: (e as Error).message }),
    );
  };

  const copyCurl = () => {
    const curl = buildCurlCommand(inputs);
    navigator.clipboard.writeText(curl).then(
      () => toast.success("Commande curl copiée"),
      () => toast.error("Échec de la copie"),
    );
  };

  // Persist the context path of the current API, derived from the edited base
  // URL. Preset envs only — the host stays the preset's, only the path segment
  // is stored (so it applies to both dev and rec).
  const saveContextPath = () => {
    const s = loadSettings();
    const ctx = contextPathFromBaseUrl(s.environment, inputs.baseUrl);
    if (ctx === null) {
      toast.info("Host non reconnu", {
        description:
          "Pour un host différent des passerelles dev/rec, utilisez l'environnement Personnalisé.",
      });
      return;
    }
    const apiPaths = { ...(s.apiPaths ?? {}) };
    // Don't persist an override that just restates the default.
    if (ctx === defaultContextPathFor(inputs.apiId)) delete apiPaths[inputs.apiId];
    else apiPaths[inputs.apiId] = ctx;
    saveSettings({ ...s, apiPaths });
    toast.success(`Context path enregistré pour « ${inputs.apiId} »`, {
      description: ctx ? `/${ctx}` : "(racine de la passerelle)",
    });
  };

  return { exportBruno, copyCurl, saveContextPath };
}
