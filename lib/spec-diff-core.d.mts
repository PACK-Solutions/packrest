// Hand-written types for the plain-JS core (lib/spec-diff-core.mjs). Keeps
// allowJs:false intact while lib/spec-diff.ts re-exports the typed surface.
// The surface is tiny; `npm run typecheck` catches signature drift at the
// re-export boundary.

export interface SpecDiff {
  api: string;
  status: "added" | "updated" | "unchanged";
  fromVersion?: string;
  toVersion?: string;
  /** "GET /factures" entries, sorted. */
  endpointsAdded: string[];
  endpointsRemoved: string[];
  /** Operation object changed (params, body, responses, scopes, summary…). */
  endpointsChanged: string[];
  scopesAdded: string[];
  scopesRemoved: string[];
}

export interface ParsedDoc {
  version?: string;
  /** "METHOD /path" -> stable JSON of the operation object. */
  operations: Map<string, string>;
  scopes: Set<string>;
}

export const HTTP_METHODS: string[];

export function stableStringify(value: unknown): string;

export function parseDoc(text: string): ParsedDoc | null;

export function diffSpec(
  api: string,
  oldYaml: string | null,
  newYaml: string,
): SpecDiff;
