import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";
import Markdown from "@/components/Markdown";
import { cn } from "@/lib/utils";

interface Props {
  label: ReactNode;
  hint?: ReactNode;
  required?: boolean;
  children: ReactNode;
  className?: string;
}

export default function Field({
  label,
  hint,
  required,
  children,
  className = "",
}: Props) {
  return (
    <div className={cn("space-y-1", className)}>
      <Label className="text-xs font-semibold">
        {label}
        {required && (
          <span className="text-destructive ml-0.5" aria-hidden>
            *
          </span>
        )}
      </Label>
      <div>{children}</div>
      <FieldHint hint={hint} />
    </div>
  );
}

// Renders a field description. OpenAPI `description`s are Markdown: multi-line
// docs (headings, bullet lists, code spans from a block scalar) get full
// block rendering — collapsible and at the compact "dense" scale so they stay
// subtle. Single-line strings that still carry Markdown syntax (inline code,
// bold, links) render inline so the markup isn't shown literally. Plain
// one-liners keep the tiny hint style. Non-string nodes pass through as-is.
export function FieldHint({ hint }: { hint?: ReactNode }) {
  if (hint == null || hint === "") return null;
  if (typeof hint === "string" && looksLikeMarkdown(hint)) {
    if (hint.includes("\n")) {
      return (
        <div className="mt-1">
          <Markdown content={hint} collapsible dense />
        </div>
      );
    }
    return (
      <p className="text-muted-foreground text-[10px]">
        <Markdown content={hint} inline />
      </p>
    );
  }
  return <p className="text-muted-foreground text-[10px]">{hint}</p>;
}

// Heuristic: does this string contain Markdown worth rendering rather than
// showing verbatim? Multi-line text, inline `code`, **bold**, or [links](…).
function looksLikeMarkdown(s: string): boolean {
  return (
    s.includes("\n") ||
    /`[^`]+`/.test(s) ||
    /\*\*[^*]+\*\*/.test(s) ||
    /\[[^\]]+\]\([^)]+\)/.test(s)
  );
}
