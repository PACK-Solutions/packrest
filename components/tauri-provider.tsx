"use client";

import * as React from "react";

import { bootstrapStorage } from "@/lib/storage";
import { bootstrapIdCollector } from "@/lib/id-collector";

// Startup gate. Hydrates the synchronous storage cache from tauri-plugin-store
// *before* any page renders — so `loadSettings()` / `loadToken()` never read
// stale defaults. The spec store is populated only by sync (GitLab / local);
// on a fresh install the app opens to the empty state. Renders a brief splash
// until ready.
export function TauriProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      await bootstrapStorage();
      await bootstrapIdCollector();
      if (!cancelled) setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-muted-foreground animate-pulse text-sm">
          Chargement…
        </div>
      </div>
    );
  }
  return <>{children}</>;
}
