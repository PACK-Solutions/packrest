"use client";

// Shared hooks for the "what am I running" info shown in the sidebar footer and
// the Settings "À propos" card: the app version and which GitLab release the
// loaded specs came from. Extracted so both consumers share one loader (and one
// SPECS_CHANGED_EVENT subscription) instead of each re-implementing it.

import { useEffect, useState } from "react";
import { getAppVersion } from "@/lib/app-version";
import { getSpecsTag, type SpecsTag } from "@/lib/config";
import { SPECS_CHANGED_EVENT } from "@/lib/specs";

// Display label for the loaded specs' release: local-directory syncs have no
// tag and read as "locales".
export function specsTagLabel(tag: SpecsTag | null): string {
  return tag?.tag ?? "locales";
}

// The running app version (immutable per process — getAppVersion memoizes it).
export function useAppVersion(): string {
  const [version, setVersion] = useState("");
  useEffect(() => {
    let cancelled = false;
    getAppVersion().then((v) => {
      if (!cancelled) setVersion(v);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  return version;
}

// The GitLab release tag the loaded specs came from, refreshed after any sync
// (SPECS_CHANGED_EVENT fires once a sync busts the spec cache).
export function useSpecsTag(): SpecsTag | null {
  const [tag, setTag] = useState<SpecsTag | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      getSpecsTag().then((t) => {
        if (!cancelled) setTag(t);
      });
    };
    load();
    window.addEventListener(SPECS_CHANGED_EVENT, load);
    return () => {
      cancelled = true;
      window.removeEventListener(SPECS_CHANGED_EVENT, load);
    };
  }, []);
  return tag;
}
