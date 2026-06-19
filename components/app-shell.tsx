"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  FolderOpen,
  Menu,
  RefreshCw,
  Settings as SettingsIcon,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import ThemeToggle from "@/components/ThemeToggle";
import { apiTheme } from "@/lib/design";
import { cn } from "@/lib/utils";

export interface NavApiSummary {
  id: string;
  title: string;
}

interface Props {
  apis: NavApiSummary[];
  children: React.ReactNode;
}

// Two-tier shell:
//   • sticky top bar     — brand, global actions (sync, theme), mobile hamburger
//   • desktop sidebar    — APIs + Tools navigation
// On mobile the sidebar collapses behind the hamburger; the top bar keeps
// brand + theme visible. Tuned for the professional B2B look — no
// gradients on chrome, low-chroma surfaces.
export function AppShell({ apis, children }: Props) {
  const [open, setOpen] = React.useState(false);
  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex min-h-screen flex-col">
        <TopBar
          apis={apis}
          mobileOpen={open}
          onMobileOpenChange={setOpen}
        />
        <div className="flex flex-1 flex-col md:flex-row">
          <aside className="bg-sidebar text-sidebar-foreground border-sidebar-border hidden w-64 shrink-0 flex-col border-r md:flex">
            <NavBody apis={apis} />
          </aside>
          <main className="min-w-0 flex-1 p-4 md:p-6">{children}</main>
        </div>
      </div>
    </TooltipProvider>
  );
}

function TopBar({
  apis,
  mobileOpen,
  onMobileOpenChange,
}: {
  apis: NavApiSummary[];
  mobileOpen: boolean;
  onMobileOpenChange: (v: boolean) => void;
}) {
  return (
    <header className="bg-background border-border sticky top-0 z-40 flex h-14 items-center gap-2 border-b px-3 md:px-4">
      <Sheet open={mobileOpen} onOpenChange={onMobileOpenChange}>
        <SheetTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Ouvrir le menu"
            className="md:hidden"
          >
            <Menu className="size-5" />
          </Button>
        </SheetTrigger>
        <SheetContent
          side="left"
          className="bg-sidebar text-sidebar-foreground w-72 p-0"
        >
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <NavBody apis={apis} onNavigate={() => onMobileOpenChange(false)} />
        </SheetContent>
      </Sheet>
      <Brand />
      <div className="ml-auto flex items-center gap-1">
        <SyncButton />
        <ThemeToggle variant="icon" />
      </div>
    </header>
  );
}

function SyncButton() {
  const [busy, setBusy] = React.useState(false);
  const handleClick = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/sync-specs", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error("Synchronisation échouée", {
          description: data?.error_description ?? `HTTP ${res.status}`,
        });
        return;
      }
      const count =
        typeof data?.copied === "number"
          ? `${data.copied} spec${data.copied > 1 ? "s" : ""}`
          : "Specs";
      toast.success(`${count} synchronisée(s)`, {
        description: data?.source ?? undefined,
      });
    } catch (e) {
      toast.error("Synchronisation échouée", {
        description: (e as Error).message,
      });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Synchroniser les specs"
          onClick={handleClick}
          disabled={busy}
        >
          <RefreshCw className={cn("size-4", busy && "animate-spin")} />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">Synchroniser les specs</TooltipContent>
    </Tooltip>
  );
}

function NavBody({
  apis,
  onNavigate,
}: {
  apis: NavApiSummary[];
  onNavigate?: () => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <ScrollArea className="flex-1 px-3 pt-4 pb-3">
        <Section title="APIs">
          {apis.length === 0 ? (
            <p className="text-muted-foreground px-2 py-1 text-xs">
              Aucune spec trouvée. Lancez{" "}
              <code className="bg-muted rounded px-1">npm run sync-specs</code>.
            </p>
          ) : (
            apis.map((api) => {
              const theme = apiTheme(api.id);
              return (
                <NavLink
                  key={api.id}
                  href={`/${api.id}`}
                  label={api.title}
                  icon={theme.icon}
                  iconBg={cn(theme.bg, theme.text)}
                  onNavigate={onNavigate}
                />
              );
            })
          )}
        </Section>
        <Separator className="my-3" />
        <Section title="Outils">
          <NavLink
            href="/collections"
            label="Collections"
            icon={FolderOpen}
            onNavigate={onNavigate}
          />
          <NavLink
            href="/settings"
            label="Paramètres"
            icon={SettingsIcon}
            onNavigate={onNavigate}
          />
        </Section>
      </ScrollArea>
    </div>
  );
}

function Brand() {
  return (
    <Link
      href="/"
      className="group flex items-center gap-2.5 rounded-md leading-tight outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <PackRestMark className="size-8 shrink-0 transition-transform group-hover:scale-[1.05]" />
      <span className="text-foreground text-base font-semibold tracking-tight">
        PackRest
      </span>
    </Link>
  );
}

// Brand mark — eight-petal yellow flower, matching the favicon (app/icon.svg)
// but with filled yellow petals so it reads as "fleur jaune" at small sizes.
function PackRestMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={className}
      aria-hidden
      focusable="false"
    >
      <g
        fill="#facc15"
        stroke="#a16207"
        strokeWidth={1.4}
        strokeLinejoin="round"
      >
        <ellipse cx="16" cy="6.5" rx="3.2" ry="4.2" />
        <ellipse cx="16" cy="25.5" rx="3.2" ry="4.2" />
        <ellipse cx="6.5" cy="16" rx="4.2" ry="3.2" />
        <ellipse cx="25.5" cy="16" rx="4.2" ry="3.2" />
        <ellipse
          cx="9.3"
          cy="9.3"
          rx="3.2"
          ry="4.2"
          transform="rotate(-45 9.3 9.3)"
        />
        <ellipse
          cx="22.7"
          cy="9.3"
          rx="3.2"
          ry="4.2"
          transform="rotate(45 22.7 9.3)"
        />
        <ellipse
          cx="9.3"
          cy="22.7"
          rx="3.2"
          ry="4.2"
          transform="rotate(45 9.3 22.7)"
        />
        <ellipse
          cx="22.7"
          cy="22.7"
          rx="3.2"
          ry="4.2"
          transform="rotate(-45 22.7 22.7)"
        />
      </g>
      <circle
        cx="16"
        cy="16"
        r="4"
        fill="#a16207"
        stroke="#713f12"
        strokeWidth={1.2}
      />
    </svg>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-0.5">
      <div className="text-muted-foreground px-2 pt-1 pb-1 text-[10px] font-semibold uppercase tracking-wider">
        {title}
      </div>
      {children}
    </div>
  );
}

function NavLink({
  href,
  label,
  icon: Icon,
  iconBg,
  onNavigate,
}: {
  href: string;
  label: string;
  icon: LucideIcon;
  iconBg?: string;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(href + "/");
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          href={href}
          onClick={onNavigate}
          className={cn(
            "group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors",
            active
              ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
              : "text-sidebar-foreground hover:bg-sidebar-accent/60",
          )}
        >
          <span
            className={cn(
              "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded",
              iconBg ?? "text-muted-foreground",
            )}
          >
            <Icon size={13} />
          </span>
          <span className="truncate">{label}</span>
        </Link>
      </TooltipTrigger>
      <TooltipContent side="right" className="md:hidden">
        {label}
      </TooltipContent>
    </Tooltip>
  );
}
