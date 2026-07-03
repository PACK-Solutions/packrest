"use client";

import { cn } from "@/lib/utils";

// A thin progress bar. Pass `value` (0–100) for a determinate bar; omit it for
// an indeterminate one (a segment sliding across), used when the total isn't
// measurable — e.g. a network upload through the Tauri HTTP plugin.
export function Progress({
  value,
  className,
}: {
  value?: number;
  className?: string;
}) {
  const indeterminate = value == null;
  const pct = indeterminate ? 0 : Math.max(0, Math.min(100, value));
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : Math.round(pct)}
      className={cn(
        "bg-muted relative h-1.5 w-full overflow-hidden rounded-full",
        className,
      )}
    >
      <div
        className={cn(
          "bg-primary h-full rounded-full",
          indeterminate
            ? "w-1/3 animate-[progress-slide_1.2s_ease-in-out_infinite]"
            : "transition-[width] duration-200",
        )}
        style={indeterminate ? undefined : { width: `${pct}%` }}
      />
    </div>
  );
}

export default Progress;
