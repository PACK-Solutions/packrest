"use client";

import { useEffect, useState } from "react";
import { KeyRound, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { TokenState } from "@/lib/storage";

interface Props {
  token: TokenState | null;
  onCleared?: () => void;
}

// Compact bearer-token status pill. Re-renders every second to update the
// countdown; the actual token value is owned by the parent so there's only
// one source of truth.
export default function TokenStatus({ token, onCleared }: Props) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  if (!token) {
    return (
      <Badge variant="neutral" className="gap-1.5 rounded-full">
        <KeyRound className="size-3" /> Aucun token
      </Badge>
    );
  }

  const secondsLeft = Math.max(0, Math.floor((token.expiresAt - now) / 1000));
  const expired = secondsLeft === 0;
  return (
    <Badge
      variant={expired ? "danger" : "success"}
      className="gap-1.5 rounded-full"
      title={`scope: ${token.scope ?? "(non renvoyé)"}`}
    >
      <KeyRound className="size-3" />
      {expired ? "expiré" : `${secondsLeft}s`}
      {onCleared && (
        <button
          type="button"
          onClick={onCleared}
          className="ml-1 inline-flex h-3.5 w-3.5 items-center justify-center rounded-full transition hover:bg-white/40 dark:hover:bg-white/10"
          aria-label="Effacer le token"
        >
          <X className="size-2.5" />
        </button>
      )}
    </Badge>
  );
}
