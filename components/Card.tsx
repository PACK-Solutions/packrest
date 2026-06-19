// Backward-compat wrappers around shadcn's Card that keep the original
// `tone` prop. Existing callers can keep using <Card>/<CardHeader>/<CardBody>
// and pick up the tonal accent. Internally everything is shadcn primitives,
// driven by the design tokens from globals.css.

import type { ReactNode } from "react";
import {
  Card as ShadcnCard,
  CardContent,
  CardHeader as ShadcnCardHeader,
} from "@/components/ui/card";
import { TONE, type StatusTone } from "@/lib/design";
import { cn } from "@/lib/utils";

export type CardTone = StatusTone;

interface CardProps {
  tone?: CardTone;
  className?: string;
  children: ReactNode;
}

export function Card({ tone, className = "", children }: CardProps) {
  const border = tone ? TONE[tone].border : "";
  return <ShadcnCard className={cn(border, className)}>{children}</ShadcnCard>;
}

interface CardHeaderProps {
  tone?: CardTone;
  className?: string;
  children: ReactNode;
}

export function CardHeader({
  tone,
  className = "",
  children,
}: CardHeaderProps) {
  const tonal = tone
    ? cn(TONE[tone].soft, TONE[tone].border, TONE[tone].textStrong)
    : "bg-muted/40 text-foreground";
  return (
    <ShadcnCardHeader
      className={cn(
        "flex flex-row flex-wrap items-center gap-2 border-b py-2.5",
        tonal,
        className,
      )}
    >
      {children}
    </ShadcnCardHeader>
  );
}

export function CardBody({
  className = "p-3",
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return <CardContent className={cn("!px-3 !pb-3", className)}>{children}</CardContent>;
}
