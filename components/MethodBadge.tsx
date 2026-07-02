import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type MethodVariant = "info" | "success" | "warn" | "danger" | "neutral";

const METHOD_VARIANT: Record<string, MethodVariant> = {
  GET: "info",
  POST: "success",
  PUT: "warn",
  PATCH: "warn",
  DELETE: "danger",
  HEAD: "neutral",
  OPTIONS: "neutral",
};

interface Props {
  method: string;
  size?: "sm" | "md";
  className?: string;
}

// HTTP method pill — distinct hue per verb (GET=sky, POST=emerald, etc.)
// so a long endpoint list scans easily.
export default function MethodBadge({
  method,
  size = "sm",
  className = "",
}: Props) {
  const variant = METHOD_VARIANT[method.toUpperCase()] ?? "neutral";
  return (
    <Badge
      variant={variant}
      className={cn(
        "rounded-md font-bold uppercase tracking-wide",
        size === "sm" ? "text-[10px] px-1.5 py-0.5" : "text-xs px-2 py-0.5",
        className,
      )}
    >
      {method.toUpperCase()}
    </Badge>
  );
}
