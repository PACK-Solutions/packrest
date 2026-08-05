// Leaf-path addressing for request bodies and response bodies.
//
// The parcours used to describe a body as a flat map of top-level field names,
// which made a nested contract property unrepresentable: when the contract API
// turned `beneficiary_clause` from a string into
// `{content, date_of_effect}`, no seed mapping could express it. Paths fix that
// once, for seeds (`beneficiary_clause.content`), for draft staleness
// comparison, for the RequestBuilder's seed merge, and for response capture
// (`beneficiary_clauses[-1].content` — the clause in force is the LAST entry of
// an array sorted by date_of_effect ascending, hence the negative index).
//
// Deliberately not a JSONPath implementation: no wildcards, no filters, no
// recursive descent. Just the addressing the parcours needs, kept small enough
// to reason about.

export type PathSeg = string | number;

/** Split a path into segments. An array index is ONLY ever bracket notation —
 *  `funds[0].fund_id`, and `[-1]` for the last element. A dotted segment is
 *  always an object key, even a wholly-numeric one.
 *
 *  Reading a bare `a.0` as an index would make `formatPath` non-invertible: it
 *  emits object keys bare, so `{"1": "a"}` flattened to `"1"` and read back
 *  became the array `["a"]`, silently turning a map into a list and losing the
 *  key. Bracket-only keeps the grammar unambiguous in both directions. */
export function parsePath(path: string): PathSeg[] {
  const out: PathSeg[] = [];
  for (const part of path.split(".")) {
    if (!part) continue;
    // "b[0][1]" → "b", 0, 1
    const m = part.match(/^([^[\]]*)((?:\[-?\d+\])*)$/);
    if (!m) {
      out.push(part);
      continue;
    }
    const [, head, brackets] = m;
    if (head) out.push(head);
    if (brackets)
      for (const b of brackets.matchAll(/\[(-?\d+)\]/g)) out.push(Number(b[1]));
  }
  return out;
}

/** Render segments back to a path. Indices use bracket notation so the result
 *  round-trips through `parsePath`. */
export function formatPath(segs: PathSeg[]): string {
  let out = "";
  for (const s of segs) {
    if (typeof s === "number") out += `[${s}]`;
    else out += out ? `.${s}` : s;
  }
  return out;
}

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Resolve a possibly-negative index against a length. Returns -1 when it
 *  cannot be resolved (empty array). */
function resolveIndex(idx: number, length: number): number {
  const i = idx < 0 ? length + idx : idx;
  return i >= 0 && i < length ? i : -1;
}

export function getAtPath(root: unknown, path: string): unknown {
  let cur: unknown = root;
  for (const seg of parsePath(path)) {
    if (cur == null) return undefined;
    if (typeof seg === "number") {
      if (!Array.isArray(cur)) return undefined;
      const i = resolveIndex(seg, cur.length);
      if (i < 0) return undefined;
      cur = cur[i];
    } else {
      if (!isPlainObject(cur)) return undefined;
      cur = cur[seg];
    }
  }
  return cur;
}

/** Immutably write `value` at `path`, creating the containers along the way —
 *  an object for a string segment, an array for an index one. A container of
 *  the wrong kind is replaced, so the caller decides (before calling) whether
 *  overwriting is allowed. A negative index resolves against the current
 *  length, falling back to 0 on an absent/empty array. */
export function setAtPath<T>(root: T, path: string, value: unknown): T {
  const segs = parsePath(path);
  if (!segs.length) return value as T;

  const write = (node: unknown, depth: number): unknown => {
    const seg = segs[depth];
    const last = depth === segs.length - 1;
    if (typeof seg === "number") {
      const arr = Array.isArray(node) ? [...node] : [];
      const i = seg < 0 ? Math.max(0, arr.length + seg) : seg;
      arr[i] = last ? value : write(arr[i], depth + 1);
      // A sparse hole would serialise as null; fill it with an empty object so
      // a seed addressing `funds[1].x` on an empty array stays valid JSON.
      for (let k = 0; k < arr.length; k++) if (arr[k] === undefined) arr[k] = {};
      return arr;
    }
    const obj = isPlainObject(node) ? { ...node } : {};
    obj[seg] = last ? value : write(obj[seg], depth + 1);
    return obj;
  };

  return write(root, 0) as T;
}

/** Immutably remove the value at `path`. Containers left empty are kept — an
 *  empty object is meaningful in a body, and pruning would surprise callers
 *  that rebuild a body path by path. */
export function deleteAtPath<T>(root: T, path: string): T {
  const segs = parsePath(path);
  if (!segs.length) return root;

  const drop = (node: unknown, depth: number): unknown => {
    const seg = segs[depth];
    const last = depth === segs.length - 1;
    if (typeof seg === "number") {
      if (!Array.isArray(node)) return node;
      const i = resolveIndex(seg, node.length);
      if (i < 0) return node;
      const arr = [...node];
      if (last) arr.splice(i, 1);
      else arr[i] = drop(arr[i], depth + 1);
      return arr;
    }
    if (!isPlainObject(node)) return node;
    if (!(seg in node)) return node;
    const obj = { ...node };
    if (last) delete obj[seg];
    else obj[seg] = drop(obj[seg], depth + 1);
    return obj;
  };

  return drop(root, 0) as T;
}

/** True for a value that has no children to walk into: a primitive, or an EMPTY
 *  container — an empty object/array carries intent (an explicitly cleared list)
 *  and must be treated as a value in its own right. */
export function isLeafValue(value: unknown): boolean {
  if (Array.isArray(value)) return value.length === 0;
  if (isPlainObject(value)) return Object.keys(value).length === 0;
  return true;
}

/** Every leaf of a value, keyed by its path.
 *
 *  Intended for values whose object keys are AUTHOR-CONTROLLED (a seed body
 *  built from `SeedMapping` paths). A key containing a `.` cannot be
 *  distinguished from a nesting level once rendered into a string, so do not
 *  flatten-then-rebuild arbitrary user input — walk it structurally instead
 *  (see `pruneSeededLeaves` in lib/parcours.ts). */
export function flattenLeaves(value: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const walk = (node: unknown, segs: PathSeg[]): void => {
    if (Array.isArray(node)) {
      if (!node.length) out[formatPath(segs)] = [];
      else node.forEach((v, i) => walk(v, [...segs, i]));
      return;
    }
    if (isPlainObject(node)) {
      const keys = Object.keys(node);
      if (!keys.length) out[formatPath(segs)] = {};
      else for (const k of keys) walk(node[k], [...segs, k]);
      return;
    }
    // A top-level primitive has no path; callers handle that case themselves.
    if (segs.length) out[formatPath(segs)] = node;
  };
  walk(value, []);
  return out;
}

/** Merge layers left to right. Plain objects merge recursively; arrays and
 *  primitives are REPLACED wholesale by the later layer.
 *
 *  Arrays are not merged element-wise on purpose: an allocation list whose
 *  rates must total 100% is only ever correct as a whole, so a later layer
 *  overriding it must replace it, not blend into it. `undefined` in a later
 *  layer is skipped (it means "no opinion"), while an explicit `null` wins. */
export function deepMerge(...layers: unknown[]): unknown {
  let acc: unknown = undefined;
  for (const layer of layers) {
    if (layer === undefined) continue;
    if (isPlainObject(acc) && isPlainObject(layer)) {
      const next: Record<string, unknown> = { ...acc };
      for (const [k, v] of Object.entries(layer)) {
        if (v === undefined) continue;
        next[k] = k in next ? deepMerge(next[k], v) : v;
      }
      acc = next;
    } else {
      acc = layer;
    }
  }
  return acc;
}
