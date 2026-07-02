// Minimal OpenAPI 3.1 type surface used by PackRest. Bundles are fully
// dereferenced (no $ref) so we keep the type narrow on purpose: it's not
// a full openapi-types replacement, just enough to drive the UI.

export interface OpenApiInfo {
  title: string;
  description?: string;
  version: string;
}

export interface OpenApiServer {
  url: string;
  description?: string;
}

export interface OpenApiTag {
  name: string;
  description?: string;
}

export interface OpenApiParameter {
  name: string;
  in: "path" | "query" | "header" | "cookie";
  required?: boolean;
  description?: string;
  schema?: JsonSchema;
  example?: unknown;
  examples?: Record<string, OpenApiExample>;
}

export interface OpenApiExample {
  summary?: string;
  description?: string;
  value?: unknown;
}

export interface OpenApiMediaType {
  schema?: JsonSchema;
  example?: unknown;
  examples?: Record<string, OpenApiExample>;
  // Per-property encoding (multipart/form-data). We only read `contentType`
  // (a comma-separated allow-list) to drive a file input's `accept`.
  encoding?: Record<string, { contentType?: string }>;
}

export interface OpenApiRequestBody {
  description?: string;
  required?: boolean;
  content?: Record<string, OpenApiMediaType>;
}

export interface OpenApiResponse {
  description?: string;
  headers?: Record<string, { description?: string; schema?: JsonSchema }>;
  content?: Record<string, OpenApiMediaType>;
}

export interface OpenApiOperation {
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  parameters?: OpenApiParameter[];
  requestBody?: OpenApiRequestBody;
  responses?: Record<string, OpenApiResponse>;
  security?: Array<Record<string, string[]>>;
  deprecated?: boolean;
}

export type HttpMethodLower =
  | "get"
  | "post"
  | "put"
  | "patch"
  | "delete"
  | "head"
  | "options";

export const HTTP_METHODS: HttpMethodLower[] = [
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "head",
  "options",
];

export type PathItem = {
  [K in HttpMethodLower]?: OpenApiOperation;
} & {
  parameters?: OpenApiParameter[];
  summary?: string;
  description?: string;
};

export interface OAuth2Scheme {
  type: "oauth2";
  flows: {
    clientCredentials?: {
      tokenUrl: string;
      refreshUrl?: string;
      scopes: Record<string, string>;
    };
    authorizationCode?: {
      authorizationUrl: string;
      tokenUrl: string;
      scopes: Record<string, string>;
    };
  };
}

export type SecurityScheme =
  | OAuth2Scheme
  | { type: "http"; scheme: string; bearerFormat?: string }
  | { type: "apiKey"; in: string; name: string }
  | { type: string; [k: string]: unknown };

export interface OpenApiDocument {
  openapi: string;
  info: OpenApiInfo;
  servers?: OpenApiServer[];
  tags?: OpenApiTag[];
  paths: Record<string, PathItem>;
  components?: {
    securitySchemes?: Record<string, SecurityScheme>;
    schemas?: Record<string, JsonSchema>;
  };
}

// JSON Schema subset used by the form generator. OpenAPI 3.1 == JSON Schema
// 2020-12, but we only care about the keywords we actually render.
export interface JsonSchema {
  type?: "string" | "number" | "integer" | "boolean" | "object" | "array" | "null" | string[];
  title?: string;
  description?: string;
  format?: string;
  enum?: unknown[];
  const?: unknown;
  default?: unknown;
  example?: unknown;
  examples?: unknown[];
  // string
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  // number
  minimum?: number;
  maximum?: number;
  multipleOf?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  // object
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean | JsonSchema;
  // array
  items?: JsonSchema;
  minItems?: number;
  maxItems?: number;
  // composition
  oneOf?: JsonSchema[];
  anyOf?: JsonSchema[];
  allOf?: JsonSchema[];
  discriminator?: { propertyName: string; mapping?: Record<string, string> };
  // flags
  readOnly?: boolean;
  writeOnly?: boolean;
  nullable?: boolean;
}

export interface ApiSummary {
  id: string;
  title: string;
  description?: string;
  version: string;
  serverUrl?: string;
  scopes: Record<string, string>;
  tokenUrl?: string;
}
