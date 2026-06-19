import { Plus, Minus, Pencil } from "lucide-react";

import MethodBadge from "@/components/MethodBadge";
import { TONE_CLASSES, apiTheme } from "@/lib/design";
import type { SpecDiff } from "@/lib/spec-diff";
import { cn } from "@/lib/utils";

// Renders the per-API structural diff returned by a spec sync (local or
// GitLab). Changed APIs get a card each; unchanged ones collapse into one
// muted line so the signal isn't drowned out.

const STATUS_LABEL: Record<SpecDiff["status"], string> = {
  added: "Ajoutée",
  updated: "Mise à jour",
  unchanged: "Inchangée",
};

const STATUS_TONE: Record<SpecDiff["status"], keyof typeof TONE_CLASSES> = {
  added: "success",
  updated: "info",
  unchanged: "neutral",
};

// "GET /factures" -> a method badge + monospace path.
function EndpointRow({
  entry,
  kind,
}: {
  entry: string;
  kind: "added" | "removed" | "changed";
}) {
  const space = entry.indexOf(" ");
  const method = space > 0 ? entry.slice(0, space) : "";
  const path = space > 0 ? entry.slice(space + 1) : entry;
  const Icon = kind === "added" ? Plus : kind === "removed" ? Minus : Pencil;
  const tone =
    kind === "added" ? "success" : kind === "removed" ? "danger" : "warn";
  return (
    <li className="flex items-center gap-1.5 text-xs">
      <Icon className={cn("size-3 shrink-0", TONE_CLASSES[tone].text)} />
      {method && <MethodBadge method={method} size="sm" />}
      <code className="text-muted-foreground truncate">{path}</code>
    </li>
  );
}

function ScopeChips({
  scopes,
  kind,
}: {
  scopes: string[];
  kind: "added" | "removed";
}) {
  if (scopes.length === 0) return null;
  const tone = kind === "added" ? "success" : "danger";
  const sign = kind === "added" ? "+" : "−";
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="text-muted-foreground text-[11px]">Scopes :</span>
      {scopes.map((s) => (
        <span
          key={s}
          className={cn(
            "rounded border px-1.5 py-0.5 font-mono text-[11px]",
            TONE_CLASSES[tone].soft,
            TONE_CLASSES[tone].border,
            TONE_CLASSES[tone].text,
          )}
        >
          {sign} {s}
        </span>
      ))}
    </div>
  );
}

function DiffCard({ diff }: { diff: SpecDiff }) {
  const tone = TONE_CLASSES[STATUS_TONE[diff.status]];
  const versionMoved =
    diff.fromVersion &&
    diff.toVersion &&
    diff.fromVersion !== diff.toVersion;
  return (
    <div className={cn("space-y-2 rounded-md border p-3", tone.border, tone.soft)}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">{apiTheme(diff.api).label}</span>
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-[11px] font-medium",
            tone.softStrong,
            tone.text,
          )}
        >
          {STATUS_LABEL[diff.status]}
        </span>
        {versionMoved && (
          <span className="text-muted-foreground font-mono text-[11px]">
            {diff.fromVersion} → {diff.toVersion}
          </span>
        )}
      </div>

      {(diff.endpointsAdded.length > 0 ||
        diff.endpointsRemoved.length > 0 ||
        diff.endpointsChanged.length > 0) && (
        <ul className="space-y-1">
          {diff.endpointsAdded.map((e) => (
            <EndpointRow key={`a-${e}`} entry={e} kind="added" />
          ))}
          {diff.endpointsRemoved.map((e) => (
            <EndpointRow key={`r-${e}`} entry={e} kind="removed" />
          ))}
          {diff.endpointsChanged.map((e) => (
            <EndpointRow key={`c-${e}`} entry={e} kind="changed" />
          ))}
        </ul>
      )}

      <ScopeChips scopes={diff.scopesAdded} kind="added" />
      <ScopeChips scopes={diff.scopesRemoved} kind="removed" />
    </div>
  );
}

export default function SyncDiff({ diffs }: { diffs: SpecDiff[] }) {
  if (!diffs || diffs.length === 0) return null;

  const changed = diffs.filter((d) => d.status !== "unchanged");
  const unchanged = diffs.filter((d) => d.status === "unchanged");

  return (
    <div className="space-y-2">
      <p className="text-muted-foreground text-[11px] font-medium uppercase tracking-wide">
        Ce qui a changé
      </p>
      {changed.length === 0 ? (
        <p className="text-muted-foreground text-xs">
          Aucun changement — les contrats synchronisés sont identiques.
        </p>
      ) : (
        changed.map((d) => <DiffCard key={d.api} diff={d} />)
      )}
      {unchanged.length > 0 && (
        <p className="text-muted-foreground text-[11px]">
          {unchanged.length} API{unchanged.length > 1 ? "s" : ""} inchangée
          {unchanged.length > 1 ? "s" : ""} :{" "}
          {unchanged.map((d) => apiTheme(d.api).label).join(", ")}
        </p>
      )}
    </div>
  );
}
