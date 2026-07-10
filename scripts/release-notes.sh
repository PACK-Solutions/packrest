#!/usr/bin/env bash
# Print the GitHub Release notes (Markdown) for a given tag to stdout.
#
#   scripts/release-notes.sh v0.6.3
#
# Builds a grouped changelog from the Conventional-Commit subjects between the
# previous release tag and TAG. The `chore(release): bump ...` commit is
# dropped. Consumed by .github/workflows/build.yml as the tauri-action
# `releaseBody`; also runnable locally for a dry-run.
set -euo pipefail

TAG="${1:?usage: release-notes.sh <tag>}"

# Previous release tag reachable from TAG's parent; empty on the first release.
PREV="$(git describe --tags --abbrev=0 "${TAG}^" 2>/dev/null || true)"

if [ -n "$PREV" ]; then
  RANGE="${PREV}..${TAG}"
else
  RANGE="$TAG"
fi

feats=""
fixes=""
others=""

# %s = commit subject. Read line-by-line; NUL isn't needed since subjects are
# single-line.
while IFS= read -r subject; do
  [ -n "$subject" ] || continue
  # Skip the release-bump commit(s).
  case "$subject" in
    "chore(release)"*) continue ;;
  esac

  # Split "type(scope): description" → type / scope / description.
  # Tolerates an optional "!" breaking-change marker (e.g. feat!: ...).
  header="${subject%%:*}"          # "type(scope)" or "type"
  desc="${subject#*: }"            # "description"
  if [ "$desc" = "$subject" ]; then
    # No ": " separator — keep the whole subject as the description.
    desc="$subject"
    header=""
  fi

  type="${header%%(*}"             # strip "(scope)" if present
  type="${type%!}"                 # strip trailing "!"

  scope=""
  case "$header" in
    *"("*")"*)
      scope="${header#*(}"         # "scope)..."
      scope="${scope%%)*}"         # "scope"
      ;;
  esac

  if [ -n "$scope" ]; then
    line="- ${scope}: ${desc}"
  else
    line="- ${desc}"
  fi

  case "$type" in
    feat) feats="${feats}${line}"$'\n' ;;
    fix)  fixes="${fixes}${line}"$'\n' ;;
    *)    others="${others}${line}"$'\n' ;;
  esac
# `--format` is newline-terminated (unlike `--pretty=format:`, which omits the
# trailing newline and would make `read` drop the last commit).
done < <(git log --format='%s' "$RANGE")

printf '## PackRest %s\n' "$TAG"

if [ -z "$feats" ] && [ -z "$fixes" ] && [ -z "$others" ]; then
  printf '\n_Maintenance release._\n'
  exit 0
fi

if [ -n "$feats" ]; then
  printf '\n### ✨ Features\n%s' "$feats"
fi
if [ -n "$fixes" ]; then
  printf '\n### 🐛 Fixes\n%s' "$fixes"
fi
if [ -n "$others" ]; then
  printf '\n### 🔧 Other\n%s' "$others"
fi
