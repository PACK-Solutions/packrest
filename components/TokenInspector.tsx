"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Copy, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { decodeJwt, scopesFromClaims } from "@/lib/jwt";
import type { TokenState } from "@/lib/storage";
import { cn } from "@/lib/utils";
import { CODE_SURFACE } from "@/lib/design";

interface Props {
  token: TokenState | null;
}

export default function TokenInspector({ token }: Props) {
  const [open, setOpen] = useState(false);
  const [reveal, setReveal] = useState(false);
  const decoded = useMemo(
    () => (token ? decodeJwt(token.accessToken) : null),
    [token],
  );
  if (!token) return null;
  const scopes = decoded ? scopesFromClaims(decoded.payload) : [];

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="bg-muted/40 rounded-md border"
    >
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="hover:bg-muted/60 flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-xs font-semibold transition-colors"
        >
          {open ? (
            <ChevronDown className="size-3.5" />
          ) : (
            <ChevronRight className="size-3.5" />
          )}
          Inspecter le token
          {scopes.length > 0 ? (
            <span className="ml-2 inline-flex flex-wrap gap-1">
              {scopes.map((s) => (
                <Badge
                  key={s}
                  variant="success"
                  className="font-mono text-[10px]"
                >
                  {s}
                </Badge>
              ))}
            </span>
          ) : decoded ? (
            <Badge variant="warn" className="ml-2 text-[10px]">
              aucun scope dans le JWT
            </Badge>
          ) : (
            <Badge variant="neutral" className="ml-2 text-[10px]">
              token opaque (pas un JWT)
            </Badge>
          )}
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-2 border-t p-3 text-xs">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground font-mono text-[11px]">
            access_token
          </span>
          <Button
            variant="outline"
            size="sm"
            className="h-6 px-2 text-[10px]"
            onClick={() => setReveal((v) => !v)}
          >
            {reveal ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
            {reveal ? "Masquer" : "Afficher"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-6 px-2 text-[10px]"
            onClick={() =>
              navigator.clipboard.writeText(token.accessToken).then(
                () => toast.success("Token copié"),
                () => toast.error("Échec de la copie"),
              )
            }
          >
            <Copy className="size-3" /> Copier
          </Button>
        </div>
        <pre
          className={cn(
            CODE_SURFACE,
            "max-h-32 overflow-auto p-2 font-mono text-[10px] leading-relaxed",
          )}
        >
          {reveal
            ? token.accessToken
            : `${token.accessToken.slice(0, 20)}…${token.accessToken.slice(-12)}`}
        </pre>
        {decoded && (
          <>
            <ClaimsTable
              title="payload"
              claims={decoded.payload as Record<string, unknown>}
              highlight={[
                "scope",
                "scp",
                "aud",
                "iss",
                "sub",
                "exp",
                "iat",
              ]}
            />
          </>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

function ClaimsTable({
  title,
  claims,
  highlight,
}: {
  title: string;
  claims: Record<string, unknown>;
  highlight: string[];
}) {
  const entries = Object.entries(claims);
  return (
    <div>
      <div className="text-muted-foreground mb-1 font-mono text-[11px]">
        {title}
      </div>
      <table className="w-full text-left text-[11px]">
        <tbody className="divide-border/40 divide-y font-mono">
          {entries.map(([k, v]) => {
            const hi = highlight.includes(k);
            const display =
              k === "exp" || k === "iat" || k === "nbf"
                ? `${v} (${new Date((v as number) * 1000).toLocaleString()})`
                : typeof v === "string"
                  ? v
                  : JSON.stringify(v);
            return (
              <tr key={k}>
                <td
                  className={cn(
                    "py-1 pr-3 align-top",
                    hi ? "text-foreground font-bold" : "text-muted-foreground",
                  )}
                >
                  {k}
                </td>
                <td className="break-all py-1">{display}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
