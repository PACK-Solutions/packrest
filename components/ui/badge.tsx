import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";
import { TONE_CLASSES } from "@/lib/design";

// Tone variants pull their colours from TONE_CLASSES (lib/design.ts) so
// any palette tweak there propagates here automatically.
const toneVariant = (tone: keyof typeof TONE_CLASSES) => {
  const t = TONE_CLASSES[tone];
  return `${t.softStrong} ${t.border} ${t.text}`;
};

const badgeVariants = cva(
  "inline-flex items-center justify-center gap-1 rounded-md border px-2 py-0.5 text-xs font-semibold w-fit whitespace-nowrap transition-[color,background-color] [&>svg]:size-3 [&>svg]:pointer-events-none",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground",
        destructive:
          "border-transparent bg-destructive text-destructive-foreground",
        outline: "text-foreground",
        info: toneVariant("info"),
        success: toneVariant("success"),
        warn: toneVariant("warn"),
        danger: toneVariant("danger"),
        neutral: "border-border bg-muted text-muted-foreground",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function Badge({
  className,
  variant,
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "span";
  return (
    <Comp
      data-slot="badge"
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
