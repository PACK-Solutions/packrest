// Design tokens that go *beyond* shadcn's neutral semantic tokens — namely
// status tones (info/success/warn/danger) and the per-API hue themes.
//
// shadcn covers `bg-card`, `bg-muted`, `border-border`, etc. for the app
// chrome. Anything that's intrinsically colorful (a 200 OK badge, a
// "Contract" API ring) lives here so the colors are centralized.
//
// Single source of truth: components/ui/badge.tsx, StatusBadge,
// ScopeSelector and Card all pull their tone class strings from
// `TONE_CLASSES` below — do not duplicate the Tailwind literals
// elsewhere. Dark-mode shades are tuned for WCAG AA on solid surfaces.

import {
  FileSignature,
  User,
  FileText,
  ScrollText,
  MessageSquareWarning,
  Webhook,
  CreditCard,
  Package,
  Box,
  type LucideIcon,
} from "lucide-react";

export type StatusTone = "neutral" | "info" | "success" | "warn" | "danger";

export interface ToneClasses {
  soft: string;
  softStrong: string;
  border: string;
  text: string;
  dot: string;
}

export const TONE_CLASSES: Record<StatusTone, ToneClasses> = {
  neutral: {
    soft: "bg-muted/40",
    softStrong: "bg-muted",
    border: "border-border",
    text: "text-foreground",
    dot: "bg-muted-foreground",
  },
  info: {
    soft: "bg-sky-50 dark:bg-sky-900/30",
    softStrong: "bg-sky-100 dark:bg-sky-900/40",
    border: "border-sky-200 dark:border-sky-800/60",
    text: "text-sky-900 dark:text-sky-100",
    dot: "bg-sky-500 dark:bg-sky-400",
  },
  success: {
    soft: "bg-emerald-50 dark:bg-emerald-900/30",
    softStrong: "bg-emerald-100 dark:bg-emerald-900/40",
    border: "border-emerald-200 dark:border-emerald-800/60",
    text: "text-emerald-900 dark:text-emerald-100",
    dot: "bg-emerald-500 dark:bg-emerald-400",
  },
  warn: {
    soft: "bg-amber-50 dark:bg-amber-900/30",
    softStrong: "bg-amber-100 dark:bg-amber-900/40",
    border: "border-amber-300 dark:border-amber-700/70",
    text: "text-amber-900 dark:text-amber-50",
    dot: "bg-amber-500 dark:bg-amber-400",
  },
  danger: {
    soft: "bg-rose-50 dark:bg-rose-900/30",
    softStrong: "bg-rose-100 dark:bg-rose-900/40",
    border: "border-rose-200 dark:border-rose-800/60",
    text: "text-rose-900 dark:text-rose-100",
    dot: "bg-rose-500 dark:bg-rose-400",
  },
};

export function toneClasses(tone: StatusTone): ToneClasses {
  return TONE_CLASSES[tone];
}

// Legacy shape kept for backward compatibility with <Card tone="…">.
// Reads from TONE_CLASSES so a tweak there flows everywhere.
export interface StatusToken {
  tone: StatusTone;
  soft: string;
  border: string;
  textStrong: string;
}

export const TONE: Record<StatusTone, StatusToken> = {
  neutral: {
    tone: "neutral",
    soft: TONE_CLASSES.neutral.soft,
    border: TONE_CLASSES.neutral.border,
    textStrong: TONE_CLASSES.neutral.text,
  },
  info: {
    tone: "info",
    soft: TONE_CLASSES.info.soft,
    border: TONE_CLASSES.info.border,
    textStrong: TONE_CLASSES.info.text,
  },
  success: {
    tone: "success",
    soft: TONE_CLASSES.success.soft,
    border: TONE_CLASSES.success.border,
    textStrong: TONE_CLASSES.success.text,
  },
  warn: {
    tone: "warn",
    soft: TONE_CLASSES.warn.soft,
    border: TONE_CLASSES.warn.border,
    textStrong: TONE_CLASSES.warn.text,
  },
  danger: {
    tone: "danger",
    soft: TONE_CLASSES.danger.soft,
    border: TONE_CLASSES.danger.border,
    textStrong: TONE_CLASSES.danger.text,
  },
};

export function toneForStatusCode(code: number): StatusToken {
  if (code === 0) return TONE.neutral;
  if (code >= 200 && code < 300) return TONE.success;
  if (code >= 300 && code < 400) return TONE.info;
  if (code >= 400 && code < 500) return TONE.warn;
  if (code >= 500) return TONE.danger;
  return TONE.neutral;
}

// Per-API theme — keyed by the folder name under dist/. Each API keeps a
// distinct hue so sidebar items and home cards remain visually anchored,
// but shades are desaturated (100/700 light, 900/30 + 200 dark) so the
// chrome reads as professional rather than playful.
export interface ApiTheme {
  label: string;
  icon: LucideIcon;
  ring: string;
  bg: string;
  bgSoft: string;
  text: string;
  border: string;
}

export const API_THEME: Record<string, ApiTheme> = {
  contract: {
    label: "Contract",
    icon: FileSignature,
    ring: "ring-emerald-500/25 dark:ring-emerald-400/25",
    bg: "bg-emerald-100 dark:bg-emerald-900/40",
    bgSoft: "bg-emerald-50 dark:bg-emerald-900/30",
    text: "text-emerald-800 dark:text-emerald-200",
    border: "border-emerald-200/80 dark:border-emerald-800/60",
  },
  person: {
    label: "Person",
    icon: User,
    ring: "ring-sky-500/25 dark:ring-sky-400/25",
    bg: "bg-sky-100 dark:bg-sky-900/40",
    bgSoft: "bg-sky-50 dark:bg-sky-900/30",
    text: "text-sky-800 dark:text-sky-200",
    border: "border-sky-200/80 dark:border-sky-800/60",
  },
  document: {
    label: "Document",
    icon: FileText,
    ring: "ring-indigo-500/25 dark:ring-indigo-400/25",
    bg: "bg-indigo-100 dark:bg-indigo-900/40",
    bgSoft: "bg-indigo-50 dark:bg-indigo-900/30",
    text: "text-indigo-800 dark:text-indigo-200",
    border: "border-indigo-200/80 dark:border-indigo-800/60",
  },
  "order-book": {
    label: "Order Book",
    icon: ScrollText,
    ring: "ring-violet-500/25 dark:ring-violet-400/25",
    bg: "bg-violet-100 dark:bg-violet-900/40",
    bgSoft: "bg-violet-50 dark:bg-violet-900/30",
    text: "text-violet-800 dark:text-violet-200",
    border: "border-violet-200/80 dark:border-violet-800/60",
  },
  "service-request": {
    label: "Service Request",
    icon: MessageSquareWarning,
    ring: "ring-rose-500/25 dark:ring-rose-400/25",
    bg: "bg-rose-100 dark:bg-rose-900/40",
    bgSoft: "bg-rose-50 dark:bg-rose-900/30",
    text: "text-rose-800 dark:text-rose-200",
    border: "border-rose-200/80 dark:border-rose-800/60",
  },
  webhook: {
    label: "Webhook",
    icon: Webhook,
    ring: "ring-fuchsia-500/25 dark:ring-fuchsia-400/25",
    bg: "bg-fuchsia-100 dark:bg-fuchsia-900/40",
    bgSoft: "bg-fuchsia-50 dark:bg-fuchsia-900/30",
    text: "text-fuchsia-800 dark:text-fuchsia-200",
    border: "border-fuchsia-200/80 dark:border-fuchsia-800/60",
  },
  "payment-method": {
    label: "Payment Method",
    icon: CreditCard,
    ring: "ring-teal-500/25 dark:ring-teal-400/25",
    bg: "bg-teal-100 dark:bg-teal-900/40",
    bgSoft: "bg-teal-50 dark:bg-teal-900/30",
    text: "text-teal-800 dark:text-teal-200",
    border: "border-teal-200/80 dark:border-teal-800/60",
  },
  product: {
    label: "Product",
    icon: Package,
    ring: "ring-amber-500/25 dark:ring-amber-400/25",
    bg: "bg-amber-100 dark:bg-amber-900/40",
    bgSoft: "bg-amber-50 dark:bg-amber-900/30",
    text: "text-amber-800 dark:text-amber-200",
    border: "border-amber-200/80 dark:border-amber-800/60",
  },
};

// kebab/snake id -> Title Case, e.g. "payment-method" -> "Payment Method".
// Used as a last-resort label so an unknown API never shows a raw kebab id.
function humanizeId(id: string): string {
  return id
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function apiTheme(id: string): ApiTheme {
  return (
    API_THEME[id] ?? {
      label: humanizeId(id),
      icon: Box,
      ring: "ring-muted-foreground/30",
      bg: "bg-muted",
      bgSoft: "bg-muted",
      text: "text-foreground",
      border: "border-border",
    }
  );
}
