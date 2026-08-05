// Synthesize a request body FROM the OpenAPI contract, and report when a
// hand-written body no longer fits it.
//
// Why this exists: the parcours used to carry one hand-typed body literal per
// step (lib/parcours-auto.ts's AUTO_PLAN), with a comment claiming they mirror
// the synced contracts. Nothing enforced that, so when v0.0.79 turned
// `beneficiary_clause` from a string into `{content, date_of_effect}` the
// parcours kept sending a string and every contract step 422'd. Walking the
// dereferenced schema instead means a renamed field, a newly required field or
// another scalar→object change is followed automatically; `validateAgainstSchema`
// covers the rest by making the drift loud.
//
// Pure and domain-free on purpose: the French/insurance knowledge lives in the
// hint registry (lib/parcours-hints.ts), so this module stays unit-testable
// without a spec, and the request tester's form generator and this generator
// normalize schemas the SAME way (lib/schema-normalize.ts) instead of drifting
// apart.

import type { JsonSchema } from "@/lib/types";
import {
  mergeAllOf,
  collapseNullableVariants,
  isReadOnly,
} from "@/lib/schema-normalize";
import { formatPath, isPlainObject, parsePath, type PathSeg } from "@/lib/json-path";
import { toLocalIsoDate } from "@/lib/fake-fields";

/** This node contributes nothing: read-only, omitted, or unrepresentable. */
const OMIT = Symbol("omit");
type Sampled = unknown | typeof OMIT;

/** Returned by a hint to LEAVE THE PROPERTY OUT rather than fall back to a
 *  schema-derived value.
 *
 *  It matters for ids. A required `bank_account_id` the parcours context cannot
 *  supply yet would otherwise be filled with a placeholder string (or, for
 *  `format: uuid`, a random uuid) — a value that looks valid and points at
 *  nothing, so the API answers something obscure instead of "field required".
 *  Omitting keeps the old, honest behaviour. */
export const SAMPLE_SKIP = Symbol("sample-skip");

/** A domain value for a node the schema alone can't fill sensibly.
 *
 *  Match precedence is `path` > `name` > `format`, so the two `date_of_effect`
 *  fields of a contract payload can differ even though both are
 *  `{type: string, format: date}`: the contract's own is today, while
 *  `beneficiary_clause.date_of_effect` must be strictly in the future. */
export interface SampleHint {
  /** Full dotted path from the body root, e.g. "beneficiary_clause.content".
   *  Array indices are matched with `[]` (`allocations.funds[].fund_id`). */
  path?: string;
  /** Property name at any depth, e.g. "iban". */
  name?: string;
  /** String `format`, e.g. "uuid". */
  format?: string;
  value: (schema: JsonSchema, path: string) => unknown;
}

export interface SampleOptions {
  hints?: SampleHint[];
  /** "required" (default) reproduces what the parcours has always sent — the
   *  required set — so no step starts posting optional fields the server may
   *  reject. "all" also fills optional properties. */
  include?: "required" | "all";
  /** Paths to leave out entirely, for a field a step deliberately omits (the
   *  periodic premium's `dates.date_of_start`). */
  omit?: string[];
  /** Injected so tests are deterministic. */
  now?: Date;
}

// --- helpers ----------------------------------------------------------------

function normalize(schema: JsonSchema): JsonSchema {
  return collapseNullableVariants(mergeAllOf(schema));
}

/** The single type of a node, ignoring the `null` member of a union type. */
function typeOf(schema: JsonSchema): string | undefined {
  const t = schema.type;
  if (Array.isArray(t)) return t.find((x) => x !== "null");
  return t;
}

/** A free-form map (`additionalProperties` object, no declared `properties`) —
 *  the same test SchemaField uses to render a key/value editor. */
function isMapSchema(schema: JsonSchema): boolean {
  const hasProps = !!schema.properties && Object.keys(schema.properties).length > 0;
  return (
    !hasProps &&
    !!schema.additionalProperties &&
    typeof schema.additionalProperties === "object"
  );
}

/** The path used for hint matching: array indices collapse to `[]` so one hint
 *  covers every row of a list. */
function hintPath(segs: PathSeg[]): string {
  let out = "";
  for (const s of segs) {
    if (typeof s === "number") out += "[]";
    else out += out ? `.${s}` : s;
  }
  return out;
}

function lastName(segs: PathSeg[]): string | undefined {
  for (let i = segs.length - 1; i >= 0; i--) {
    const s = segs[i];
    if (typeof s === "string") return s;
  }
  return undefined;
}

function findHint(
  hints: SampleHint[] | undefined,
  schema: JsonSchema,
  segs: PathSeg[],
): SampleHint | undefined {
  if (!hints?.length) return undefined;
  const path = hintPath(segs);
  const name = lastName(segs);
  return (
    hints.find((h) => h.path && h.path === path) ??
    hints.find((h) => h.name && h.name === name) ??
    (schema.format
      ? hints.find((h) => h.format && h.format === schema.format)
      : undefined)
  );
}

function uuidV4(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  // Fallback for a runtime without WebCrypto (never the Tauri webview, but the
  // unit tests must not depend on it either).
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = Math.floor(Math.random() * 16);
    return (ch === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// The digit-only patterns these contracts use for postal codes, TINs and
// national ids: `^\d{5}$`, `^\d{9,12}$`, `^\d+$`. A richer pattern cannot be
// satisfied generically — `validateAgainstSchema` then reports the mismatch
// rather than letting the value go out silently.
const DIGITS_PATTERN = /^\^?\\d(?:\{(\d+)(?:,(\d+))?\}|\+)\$?$/;

function digitsForPattern(schema: JsonSchema): string | undefined {
  if (!schema.pattern) return undefined;
  const m = schema.pattern.match(DIGITS_PATTERN);
  if (!m) return undefined;
  const wanted = Math.max(
    m[1] ? Number(m[1]) : 1,
    schema.minLength ?? 0,
    1,
  );
  const len = schema.maxLength !== undefined ? Math.min(wanted, schema.maxLength) : wanted;
  return "1".repeat(len);
}

/** A placeholder for a plain string, sized into [minLength, maxLength].
 *
 *  A digit-only `pattern` is honoured (otherwise the name-derived placeholder
 *  would violate it — a postal_code came out as "posta"). Anything else falls
 *  back to the property name, so the request panel shows which field a value
 *  came from; a pattern that name cannot satisfy is reported as a
 *  constraint-violation instead of failing opaquely at the API. */
function placeholder(segs: PathSeg[], schema: JsonSchema): string {
  const digits = digitsForPattern(schema);
  if (digits !== undefined) return digits;
  let s = lastName(segs) ?? "sample";
  const min = schema.minLength ?? 0;
  const max = schema.maxLength;
  while (s.length < min) s += "-x";
  if (max !== undefined && s.length > max) s = s.slice(0, max);
  return s;
}

function sampleNumber(schema: JsonSchema): number {
  const step = schema.multipleOf && schema.multipleOf > 0 ? schema.multipleOf : 0;
  let v = 0;
  if (schema.minimum !== undefined) v = schema.minimum;
  else if (schema.exclusiveMinimum !== undefined)
    v = schema.exclusiveMinimum + (step || 1);
  if (schema.maximum !== undefined) v = Math.min(v, schema.maximum);
  if (schema.exclusiveMaximum !== undefined)
    v = Math.min(v, schema.exclusiveMaximum - (step || 1));
  if (step) v = Math.round(v / step) * step;
  if (typeOf(schema) === "integer") v = Math.round(v);
  // A tightened bound pair can push the rounded value back out of range; the
  // lower bound is the one a server checks first, so it wins.
  if (schema.minimum !== undefined && v < schema.minimum) v = schema.minimum;
  return v;
}

/** A value the schema itself supplies. Applies to everything EXCEPT computed
 *  date formats: `date`/`date-time` examples in these contracts are fixed
 *  calendar dates (`example: 2026-09-01`) that go stale as the release ages,
 *  and a clause date that is no longer in the future is a 422. */
function schemaSupplied(schema: JsonSchema): unknown {
  const computedFormat = schema.format === "date" || schema.format === "date-time";
  if (schema.default !== undefined && !computedFormat) return schema.default;
  if (schema.example !== undefined && !computedFormat) return schema.example;
  return undefined;
}

function fitsType(value: unknown, schema: JsonSchema): boolean {
  const t = typeOf(schema);
  if (!t) return true;
  switch (t) {
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number";
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    case "array":
      return Array.isArray(value);
    case "object":
      return isPlainObject(value);
    default:
      return true;
  }
}

// --- generation -------------------------------------------------------------

const MAX_DEPTH = 12;

/** Synthesize a value for a dereferenced schema. Returns `undefined` when the
 *  schema yields nothing at all (all-readOnly, or absent). */
export function sampleFromSchema(
  schema: JsonSchema | undefined,
  opts: SampleOptions = {},
): unknown {
  if (!schema) return undefined;
  const now = opts.now ?? new Date();
  const out = sampleNode(schema, [], { ...opts, now }, true, 0);
  return out === OMIT ? undefined : out;
}

function sampleNode(
  raw: JsonSchema,
  segs: PathSeg[],
  opts: SampleOptions & { now: Date },
  required: boolean,
  depth: number,
): Sampled {
  if (depth > MAX_DEPTH) return OMIT;
  const path = formatPath(segs);
  if (opts.omit?.includes(path) || opts.omit?.includes(hintPath(segs))) return OMIT;

  const schema = normalize(raw);
  // Server-managed: never part of a request body. Checked on the raw schema too,
  // since `readOnly` can sit on an allOf branch.
  if (isReadOnly(raw) || schema.readOnly) return OMIT;

  // A domain hint outranks everything the schema could tell us, but only when
  // it actually fits the node — so a stale hint degrades to the schema value
  // instead of producing an invalid body.
  const hint = findHint(opts.hints, schema, segs);
  if (hint) {
    const v = hint.value(schema, path);
    if (v === SAMPLE_SKIP) return OMIT;
    if (v === null && schema.nullable) return null;
    // Accepted only when the contract can hold it: a hint that has fallen behind
    // (wrong type, or a value the enum no longer lists) degrades to the
    // schema-derived value instead of producing an invalid body.
    if (v !== undefined && v !== null && fitsType(v, schema)) {
      if (!schema.enum?.length || schema.enum.includes(v as never)) return v;
    }
  }

  if (schema.const !== undefined) return schema.const;

  if (schema.enum?.length) {
    const members: unknown[] = schema.enum.filter((v) => v !== null);
    if (!members.length) return OMIT;
    const supplied = schemaSupplied(schema);
    if (supplied !== undefined && members.includes(supplied)) return supplied;
    return members[0];
  }

  // A union that survived `collapseNullableVariants` has several real branches:
  // take the first that yields something.
  const variants = schema.oneOf ?? schema.anyOf;
  if (variants?.length) {
    for (const v of variants) {
      const out = sampleNode(v, segs, opts, required, depth + 1);
      if (out !== OMIT) return out;
    }
    return OMIT;
  }

  const type = typeOf(schema) ?? inferType(schema);

  switch (type) {
    case "object": {
      // A free-form map: no declared properties to fill, and inventing keys
      // would be guesswork. An empty object is the honest sample.
      if (isMapSchema(schema)) return required ? {} : OMIT;
      const props = schema.properties ?? {};
      const req = new Set(schema.required ?? []);
      const obj: Record<string, unknown> = {};
      for (const [name, sub] of Object.entries(props)) {
        const isRequired = req.has(name);
        if (opts.include !== "all" && !isRequired) continue;
        const v = sampleNode(sub, [...segs, name], opts, isRequired, depth + 1);
        if (v === OMIT) continue;
        // Under `include: "all"` an optional object whose own properties are all
        // optional collapses to `{}` — noise, not data.
        if (!isRequired && isPlainObject(v) && !Object.keys(v).length) continue;
        obj[name] = v;
      }
      if (!required && !Object.keys(obj).length) return OMIT;
      return obj;
    }
    case "array": {
      const items = schema.items;
      if (!items) return required ? [] : OMIT;
      // A required array with no `minItems` still needs one row to be useful: an
      // empty list carries no data. Under `include: "all"` an optional array gets
      // one too — "all" means fill everything.
      let want = Math.max(
        schema.minItems ?? 0,
        required || opts.include === "all" ? 1 : 0,
      );
      if (schema.maxItems !== undefined) want = Math.min(want, schema.maxItems);
      const rows: unknown[] = [];
      for (let i = 0; i < want; i++) {
        const v = sampleNode(items, [...segs, i], opts, true, depth + 1);
        if (v !== OMIT) rows.push(v);
      }
      if (!required && !rows.length) return OMIT;
      return rows;
    }
    case "boolean": {
      const supplied = schemaSupplied(schema);
      return typeof supplied === "boolean" ? supplied : false;
    }
    case "integer":
    case "number": {
      const supplied = schemaSupplied(schema);
      return typeof supplied === "number" ? supplied : sampleNumber(schema);
    }
    case "string": {
      switch (schema.format) {
        case "date":
          return toLocalIsoDate(opts.now);
        case "date-time":
          return opts.now.toISOString();
        case "uuid":
          return uuidV4();
        case "email":
          return "contact@example.com";
      }
      const supplied = schemaSupplied(schema);
      if (typeof supplied === "string") return supplied;
      return placeholder(segs, schema);
    }
    case "null":
      return OMIT;
    default:
      // No type and nothing to infer one from: a `{}` schema (what `deref`
      // returns for a recursive re-entry) or an unsupported keyword.
      return OMIT;
  }
}

function inferType(schema: JsonSchema): string | undefined {
  if (schema.properties || schema.additionalProperties) return "object";
  if (schema.items) return "array";
  return undefined;
}

// --- schema lookup ----------------------------------------------------------

/** The schema of the leaf a path addresses, or undefined when the contract
 *  declares nothing there. Mirrors `getAtPath` over the schema instead of the
 *  value, so a seed mapping can be typed against the contract. */
export function schemaAtPath(
  root: JsonSchema | undefined,
  path: string,
): JsonSchema | undefined {
  let cur: JsonSchema | undefined = root;
  for (const seg of parsePath(path)) {
    if (!cur) return undefined;
    cur = childSchema(normalize(cur), seg);
  }
  return cur;
}

function childSchema(schema: JsonSchema, seg: PathSeg): JsonSchema | undefined {
  const variants = schema.oneOf ?? schema.anyOf;
  if (variants?.length) {
    for (const v of variants) {
      const hit = childSchema(normalize(v), seg);
      if (hit) return hit;
    }
    return undefined;
  }
  if (typeof seg === "number") return schema.items;
  const declared = schema.properties?.[seg];
  if (declared) return declared;
  return typeof schema.additionalProperties === "object"
    ? schema.additionalProperties
    : undefined;
}

// --- coercion ---------------------------------------------------------------

/** Fit a string (every parcours context value is stored as one) to a leaf's
 *  declared type, so seeding a numeric or boolean leaf doesn't post a string.
 *  Unparseable input is returned untouched — the drift validator reports it
 *  rather than this silently inventing a 0. */
export function coerceToSchema(
  value: string,
  schema: JsonSchema | undefined,
): unknown {
  if (!schema) return value;
  const eff = normalize(schema);
  const variants = eff.oneOf ?? eff.anyOf;
  if (variants?.length) {
    for (const v of variants) {
      const out = coerceToSchema(value, v);
      if (typeof out !== "string" || typeOf(normalize(v)) === "string") return out;
    }
    return value;
  }
  if (eff.enum?.length) {
    const hit = eff.enum.find((m) => String(m) === value);
    return hit !== undefined ? hit : value;
  }
  switch (typeOf(eff)) {
    case "integer":
    case "number": {
      const n = Number(value);
      return value.trim() !== "" && Number.isFinite(n) ? n : value;
    }
    case "boolean":
      if (value === "true") return true;
      if (value === "false") return false;
      return value;
    default:
      return value;
  }
}

// --- drift detection --------------------------------------------------------

export type SchemaIssueKind =
  | "unknown-property"
  | "type-mismatch"
  | "missing-required"
  | "enum-violation"
  | "read-only-property"
  /** A string outside the contract's `pattern` / length bounds — including one
   *  this module generated itself, which is the case a silent 422 hid before. */
  | "constraint-violation";

export interface SchemaIssue {
  kind: SchemaIssueKind;
  /** Path within the body; "" for the root. */
  path: string;
  message: string;
}

/** Check a body against its request schema. Not a full JSON Schema validator —
 *  it reports the four drift shapes that actually bite when a contract changes
 *  under a hand-written body: a property the schema no longer declares, a
 *  property whose type changed, a newly required property, and a value outside
 *  an enum (plus a read-only property that shouldn't be sent at all).
 *
 *  Runs at runtime because the specs live in `$APPDATA/specs`, not in the repo,
 *  so no CI check can see the real contracts. */
export function validateAgainstSchema(
  value: unknown,
  schema: JsonSchema | undefined,
): SchemaIssue[] {
  if (!schema || value === undefined) return [];
  const issues: SchemaIssue[] = [];
  check(value, schema, [], issues, 0);
  return issues;
}

function checkStringConstraints(
  value: string,
  schema: JsonSchema,
  path: string,
  issues: SchemaIssue[],
): void {
  const where = path || "body";
  if (schema.pattern) {
    let re: RegExp | null = null;
    try {
      re = new RegExp(schema.pattern);
    } catch {
      re = null; // an unsupported regex flavour is not the request's fault
    }
    if (re && !re.test(value))
      issues.push({
        kind: "constraint-violation",
        path,
        message: `${where} : « ${value} » ne respecte pas le format du contrat (${schema.pattern})`,
      });
  }
  if (schema.minLength !== undefined && value.length < schema.minLength)
    issues.push({
      kind: "constraint-violation",
      path,
      message: `${where} : ${value.length} caractère(s), le contrat en exige au moins ${schema.minLength}`,
    });
  if (schema.maxLength !== undefined && value.length > schema.maxLength)
    issues.push({
      kind: "constraint-violation",
      path,
      message: `${where} : ${value.length} caractère(s), le contrat en autorise au plus ${schema.maxLength}`,
    });
}

function typeName(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}

function check(
  value: unknown,
  raw: JsonSchema,
  segs: PathSeg[],
  issues: SchemaIssue[],
  depth: number,
): void {
  if (depth > MAX_DEPTH) return;
  const path = formatPath(segs);
  const schema = normalize(raw);
  if (value === null) {
    // `nullable` survives collapseNullableVariants; an explicit null elsewhere
    // is a type mismatch the server would reject.
    if (!schema.nullable && typeOf(schema) !== "null")
      issues.push({
        kind: "type-mismatch",
        path,
        message: `${path || "body"} : null n'est pas autorisé ici`,
      });
    return;
  }

  const variants = schema.oneOf ?? schema.anyOf;
  if (variants?.length) {
    // Valid as soon as ONE branch accepts it; only report when none does, and
    // then without the per-branch noise.
    const ok = variants.some((v) => {
      const local: SchemaIssue[] = [];
      check(value, v, segs, local, depth + 1);
      return local.length === 0;
    });
    if (!ok)
      issues.push({
        kind: "type-mismatch",
        path,
        message: `${path || "body"} : aucune variante du contrat n'accepte cette valeur`,
      });
    return;
  }

  const type = typeOf(schema) ?? inferType(schema);
  if (type && !fitsType(value, schema)) {
    issues.push({
      kind: "type-mismatch",
      path,
      message: `${path || "body"} : le contrat attend ${type}, la requête envoie ${typeName(value)}`,
    });
    return; // recursing into a mismatched shape only produces noise
  }

  if (schema.enum?.length && !schema.enum.includes(value as never)) {
    issues.push({
      kind: "enum-violation",
      path,
      message: `${path || "body"} : « ${String(value)} » n'est pas une valeur du contrat (${schema.enum.join(", ")})`,
    });
    return;
  }

  if (typeof value === "string") checkStringConstraints(value, schema, path, issues);

  if (type === "object" && isPlainObject(value)) {
    const props = schema.properties ?? {};
    const known = Object.keys(props).length > 0;
    // `additionalProperties` as a SCHEMA also permits extras (of that type), not
    // just `true` — a schema carrying both `properties` and an
    // `additionalProperties` object was previously reported as forbidding them.
    const freeForm =
      isMapSchema(schema) ||
      schema.additionalProperties === true ||
      typeof schema.additionalProperties === "object";
    for (const [k, v] of Object.entries(value)) {
      const sub = props[k];
      if (!sub) {
        if (known && !freeForm)
          issues.push({
            kind: "unknown-property",
            path: formatPath([...segs, k]),
            message: `${formatPath([...segs, k])} : propriété absente du contrat`,
          });
        continue;
      }
      // A read-only DISCRIMINATOR echoed at its only legal value is harmless —
      // `fiscal_type: FRENCH_RESIDENCY` is `readOnly` + `const` and the API has
      // always been given it explicitly. Anything else read-only is drift.
      if (isReadOnly(sub) && normalize(sub).const !== v)
        issues.push({
          kind: "read-only-property",
          path: formatPath([...segs, k]),
          message: `${formatPath([...segs, k])} : propriété en lecture seule, à ne pas envoyer`,
        });
      check(v, sub, [...segs, k], issues, depth + 1);
    }
    for (const r of schema.required ?? []) {
      if (value[r] === undefined && !isReadOnly(props[r] ?? {}))
        issues.push({
          kind: "missing-required",
          path: formatPath([...segs, r]),
          message: `${formatPath([...segs, r])} : propriété requise par le contrat, absente de la requête`,
        });
    }
    return;
  }

  if (type === "array" && Array.isArray(value) && schema.items) {
    value.forEach((v, i) => check(v, schema.items!, [...segs, i], issues, depth + 1));
  }
}
