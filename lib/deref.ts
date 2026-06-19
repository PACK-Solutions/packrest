// In-place dereferencer for OpenAPI bundles. The repo's bundler (Redocly)
// inlines external file refs but leaves internal `#/components/...` refs
// intact for size reasons. The form generator and example extractor walk
// JSON Schemas directly and don't follow refs, so we resolve them once on
// load and hand back a fully concrete tree.
//
// Cycles are very rare in OpenAPI but possible (a schema embedding itself
// through a recursive child). We break them by leaving the deepest ref
// untouched on the second pass — the form will render that leaf as an
// empty object instead of looping.

type AnyObj = Record<string, unknown>;

function resolveRef(root: AnyObj, ref: string): unknown {
  if (!ref.startsWith("#/")) return undefined;
  const parts = ref
    .slice(2)
    .split("/")
    .map((p) => p.replace(/~1/g, "/").replace(/~0/g, "~"));
  let node: unknown = root;
  for (const p of parts) {
    if (node === null || typeof node !== "object") return undefined;
    node = (node as AnyObj)[p];
  }
  return node;
}

export function dereference<T extends object>(doc: T): T {
  const root = doc as unknown as AnyObj;
  const seenRefs = new Set<string>();

  const visit = (node: unknown): unknown => {
    if (node === null || typeof node !== "object") return node;
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        node[i] = visit(node[i]);
      }
      return node;
    }
    const obj = node as AnyObj;
    if (typeof obj.$ref === "string") {
      const ref = obj.$ref;
      if (seenRefs.has(ref)) {
        // Cycle: keep the ref so we don't loop forever. The form renderer
        // tolerates an empty object here.
        return {};
      }
      seenRefs.add(ref);
      const target = resolveRef(root, ref);
      const resolved = visit(structuredClone(target));
      seenRefs.delete(ref);
      // Preserve any sibling keys (OpenAPI 3.1 / JSON Schema 2020-12 allow
      // them — e.g. a $ref alongside `description`).
      const siblings: AnyObj = {};
      for (const [k, v] of Object.entries(obj)) {
        if (k !== "$ref") siblings[k] = visit(v);
      }
      if (resolved && typeof resolved === "object" && !Array.isArray(resolved)) {
        return { ...(resolved as AnyObj), ...siblings };
      }
      return resolved ?? siblings;
    }
    for (const k of Object.keys(obj)) {
      obj[k] = visit(obj[k]);
    }
    return obj;
  };

  return visit(root) as T;
}
