"use client";

import * as React from "react";

import { bootstrapStorage } from "@/lib/storage";
import { seedSpecsIfEmpty } from "@/lib/specs-fs";

// Startup gate. Hydrates the synchronous storage cache from tauri-plugin-store
// and seeds the writable spec store from the bundled specs on first launch,
// *before* any page renders — so `loadSettings()` / `loadToken()` never read
// stale defaults and the API list is populated. Renders a brief splash until
// ready.
export function TauriProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      await bootstrapStorage();
      try {
        await seedSpecsIfEmpty();
      } catch {
        // seeding is best-effort; the app still opens (empty API list)
      }
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
