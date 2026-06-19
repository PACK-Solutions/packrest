import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";
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
      {hint && <p className="text-muted-foreground text-[10px]">{hint}</p>}
    </div>
  );
}
