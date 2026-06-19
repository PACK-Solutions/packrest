import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { StatusTone } from "@/lib/design";

function variantForStatus(code: number): StatusTone {
  if (code === 0) return "neutral";
  if (code >= 200 && code < 300) return "success";
  if (code >= 300 && code < 400) return "info";
  if (code >= 400 && code < 500) return "warn";
  if (code >= 500) return "danger";
  return "neutral";
}

const DOT_COLOR: Record<StatusTone, string> = {
  neutral: "bg-muted-foreground",
  info: "bg-sky-500 dark:bg-sky-400",
  success: "bg-emerald-500 dark:bg-emerald-400",
  warn: "bg-amber-500 dark:bg-amber-400",
  danger: "bg-rose-500 dark:bg-rose-400",
};

interface Props {
  code?: number;
  label?: string;
  tone?: StatusTone;
  size?: "sm" | "md";
  withDot?: boolean;
  className?: string;
}

export default function StatusBadge({
  code,
  label,
  tone,
  size = "sm",
  withDot = true,
  className = "",
}: Props) {
  const resolved =
    tone ?? (code !== undefined ? variantForStatus(code) : "neutral");
  const text = label ?? (code !== undefined ? String(code) : "");
  return (
    <Badge
      variant={resolved}
      className={cn(
        "rounded-full",
        size === "sm" ? "text-[10px] px-1.5 py-0.5" : "text-xs px-2 py-0.5",
        className,
      )}
    >
      {withDot && (
        <span
          className={cn("h-1.5 w-1.5 rounded-full", DOT_COLOR[resolved])}
          aria-hidden
        />
      )}
      {text}
    </Badge>
  );
}
