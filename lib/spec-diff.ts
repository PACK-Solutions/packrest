// Structural diff between two versions of an OpenAPI bundle, computed at sync
// time by capturing the previous public/specs/<api>.yaml before it's
// overwritten. Both sync paths (lib/sync.ts, lib/gitlab.ts) call diffSpec so
// the UI can report what actually moved instead of just "synced N".
//
// The algorithm lives once in lib/spec-diff-core.mjs (plain ESM) so the
// build-time CLI (scripts/copy-specs.mjs, plain node) and this runtime path
// share a single implementation. Typed via lib/spec-diff-core.d.ts.
export { diffSpec } from "./spec-diff-core.mjs";
export type { SpecDiff } from "./spec-diff-core.mjs";
