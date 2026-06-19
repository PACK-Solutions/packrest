// Postman Collection v2.1 import / export.
// Reference: https://schema.getpostman.com/json/collection/v2.1.0/collection.json

import type { SavedCollection, SavedRequest, SavedHeader } from "./storage";
import { newId } from "./storage";

const SCHEMA_V21 =
  "https://schema.getpostman.com/json/collection/v2.1.0/collection.json";

interface PostmanUrl {
  raw?: string;
  protocol?: string;
  host?: string[] | string;
  path?: string[] | string;
  query?: Array<{ key: string; value?: string; disabled?: boolean }>;
}

interface PostmanHeader {
  key: string;
  value: string;
  disabled?: boolean;
  type?: string;
}

interface PostmanItem {
  name: string;
  request: {
    method: string;
    header?: PostmanHeader[];
    url: PostmanUrl | string;
    body?: {
      mode?: string;
      raw?: string;
      options?: { raw?: { language?: string } };
    };
    auth?: {
      type: string;
      bearer?: Array<{ key: string; value: string; type?: string }>;
    };
    description?: string;
  };
}

interface PostmanCollectionV21 {
  info: {
    _postman_id?: string;
    name: string;
    description?: string;
    schema: string;
  };
  item: PostmanItem[];
  variable?: Array<{ key: string; value: string }>;
}

export function toPostmanV21(collection: SavedCollection): PostmanCollectionV21 {
  const baseUrl = collection.baseUrl ?? "";
  return {
    info: {
      _postman_id: collection.id,
      name: collection.name,
      description: collection.description,
      schema: SCHEMA_V21,
    },
    item: collection.requests.map((r) => requestToItem(r, baseUrl)),
    variable: baseUrl ? [{ key: "baseUrl", value: baseUrl }] : undefined,
  };
}

function requestToItem(req: SavedRequest, baseUrl: string): PostmanItem {
  const url = absoluteToPostmanUrl(req.url, baseUrl);
  return {
    name: req.name,
    request: {
      method: req.method.toUpperCase(),
      header: req.headers
        .filter((h) => h.enabled !== false && h.key)
        .map((h) => ({ key: h.key, value: h.value })),
      url,
      body:
        req.body?.mode === "raw" && req.body.raw
          ? {
              mode: "raw",
              raw: req.body.raw,
              options: {
                raw: { language: languageForMediaType(req.body.mediaType) },
              },
            }
          : undefined,
    },
  };
}

function absoluteToPostmanUrl(url: string, baseUrl: string): PostmanUrl {
  // Replace exact baseUrl prefix with the {{baseUrl}} variable so the
  // exported collection stays portable.
  let working = url;
  let usedVariable = false;
  if (baseUrl && working.startsWith(baseUrl)) {
    working = `{{baseUrl}}${working.slice(baseUrl.length)}`;
    usedVariable = true;
  }
  const [pathAndQuery, fragment] = working.split("#");
  const [pathPart, queryPart] = pathAndQuery.split("?");
  const out: PostmanUrl = { raw: working };

  if (usedVariable) {
    out.host = ["{{baseUrl}}"];
    out.path = pathPart.replace(/^\{\{baseUrl\}\}\/?/, "").split("/").filter(Boolean);
  } else {
    try {
      const u = new URL(pathPart);
      out.protocol = u.protocol.replace(":", "");
      out.host = u.host.split(".");
      out.path = u.pathname.split("/").filter(Boolean);
    } catch {
      out.path = pathPart.split("/").filter(Boolean);
    }
  }

  if (queryPart) {
    out.query = queryPart.split("&").map((kv) => {
      const [k, v] = kv.split("=");
      return {
        key: decodeURIComponent(k),
        value: v !== undefined ? decodeURIComponent(v) : "",
      };
    });
  }
  // fragment intentionally not preserved (Postman doesn't model it).
  void fragment;
  return out;
}

function languageForMediaType(mt: string | undefined): string {
  if (!mt) return "json";
  if (mt.includes("json")) return "json";
  if (mt.includes("xml")) return "xml";
  if (mt.includes("yaml")) return "yaml";
  return "text";
}

export function fromPostmanV21(json: unknown): SavedCollection {
  if (!json || typeof json !== "object") {
    throw new Error("Le fichier n'est pas un objet JSON valide.");
  }
  const obj = json as Partial<PostmanCollectionV21>;
  if (!obj.info?.schema || !obj.info.schema.includes("v2.1.0")) {
    throw new Error(
      "Schéma Postman incompatible — seule la version v2.1 est supportée.",
    );
  }
  const baseUrl =
    obj.variable?.find((v) => v.key === "baseUrl")?.value ?? "";
  const items = Array.isArray(obj.item) ? obj.item : [];
  return {
    id: obj.info._postman_id ?? newId("col"),
    name: obj.info.name,
    description: obj.info.description,
    baseUrl,
    requests: items.map((it) => itemToRequest(it, baseUrl)),
  };
}

function itemToRequest(item: PostmanItem, baseUrl: string): SavedRequest {
  const r = item.request;
  const headers: SavedHeader[] = (r.header ?? []).map((h) => ({
    key: h.key,
    value: h.value,
    enabled: h.disabled !== true,
  }));
  const url = postmanUrlToAbsolute(r.url, baseUrl);
  const body =
    r.body?.mode === "raw"
      ? {
          mode: "raw" as const,
          raw: r.body.raw,
          mediaType:
            r.body.options?.raw?.language === "json"
              ? "application/json"
              : undefined,
        }
      : undefined;
  return {
    id: newId("req"),
    name: item.name,
    method: r.method.toUpperCase(),
    url,
    headers,
    body,
  };
}

function postmanUrlToAbsolute(
  url: PostmanUrl | string,
  baseUrl: string,
): string {
  if (typeof url === "string") {
    return url.replace(/\{\{baseUrl\}\}/g, baseUrl);
  }
  if (url.raw) return url.raw.replace(/\{\{baseUrl\}\}/g, baseUrl);
  const protocol = url.protocol ? `${url.protocol}://` : "";
  const host = Array.isArray(url.host) ? url.host.join(".") : url.host ?? "";
  const pathParts = Array.isArray(url.path)
    ? url.path
    : url.path
      ? [url.path]
      : [];
  const pathStr = pathParts.length ? "/" + pathParts.join("/") : "";
  const queryStr = url.query?.length
    ? "?" +
      url.query
        .filter((q) => q.disabled !== true)
        .map(
          (q) =>
            `${encodeURIComponent(q.key)}${q.value !== undefined ? `=${encodeURIComponent(q.value)}` : ""}`,
        )
        .join("&")
    : "";
  const assembled = `${protocol}${host}${pathStr}${queryStr}`;
  return assembled.replace(/\{\{baseUrl\}\}/g, baseUrl);
}
