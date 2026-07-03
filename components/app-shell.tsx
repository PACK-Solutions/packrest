"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  FolderOpen,
  HelpCircle,
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
import { listApiSummaries, SPECS_CHANGED_EVENT } from "@/lib/specs";
import { copySpecs } from "@/lib/sync";
import { cn } from "@/lib/utils";

export interface NavApiSummary {
  id: string;
  title: string;
}

// Two-tier shell:
//   • sticky top bar     — brand, global actions (sync, theme), mobile hamburger
//   • desktop sidebar    — APIs + Tools navigation
// The API list is loaded client-side from the spec store and refreshed on
// SPECS_CHANGED_EVENT (fired after any sync busts the cache).
export function AppShell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = React.useState(false);
  const [apis, setApis] = React.useState<NavApiSummary[]>([]);

  React.useEffect(() => {
    let cancelled = false;
    const load = () => {
      listApiSummaries().then((list) => {
        if (!cancelled) setApis(list.map((a) => ({ id: a.id, title: a.title })));
      });
    };
    load();
    window.addEventListener(SPECS_CHANGED_EVENT, load);
    return () => {
      cancelled = true;
      window.removeEventListener(SPECS_CHANGED_EVENT, load);
    };
  }, []);

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex min-h-screen flex-col">
        <TopBar apis={apis} mobileOpen={open} onMobileOpenChange={setOpen} />
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
      const result = await copySpecs();
      if (result.missing) {
        toast.error("Synchronisation impossible", {
          description:
            "Aucun dossier source configuré. Renseignez-le dans Paramètres.",
        });
        return;
      }
      const n = result.copied.length;
      toast.success(`${n} spec${n > 1 ? "s" : ""} synchronisée(s)`, {
        description: result.source || undefined,
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
  const pathname = usePathname();
  const searchParams = useSearchParams();
  // An API is "active" while viewing its endpoint list or one of its endpoints.
  const activeApiId =
    pathname === "/api-view"
      ? searchParams.get("id")
      : pathname === "/endpoint"
        ? searchParams.get("api")
        : null;

  return (
    <div className="flex h-full flex-col">
      <ScrollArea className="flex-1 px-3 pt-4 pb-3">
        <Section title="APIs">
          {apis.length === 0 ? (
            <p className="text-muted-foreground px-2 py-1 text-xs">
              Aucune spec trouvée. Utilisez le bouton de synchronisation ou{" "}
              <Link href="/settings" className="underline">
                Paramètres
              </Link>
              .
            </p>
          ) : (
            apis.map((api) => {
              const theme = apiTheme(api.id);
              return (
                <NavLink
                  key={api.id}
                  href={`/api-view?id=${encodeURIComponent(api.id)}`}
                  label={api.title}
                  icon={theme.icon}
                  iconBg={cn(theme.bg, theme.text)}
                  active={activeApiId === api.id}
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
            label="Import Bruno"
            icon={FolderOpen}
            active={pathname === "/collections"}
            onNavigate={onNavigate}
          />
          <NavLink
            href="/settings"
            label="Paramètres"
            icon={SettingsIcon}
            active={pathname === "/settings"}
            onNavigate={onNavigate}
          />
          <NavLink
            href="/help"
            label="Aide & diagnostic"
            icon={HelpCircle}
            active={pathname === "/help"}
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

// Brand mark — same daisy as the corner watermark (white petals, gold outline
// and a two-tone amber centre) so the logo, favicon and filigrane all match.
function PackRestMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 200 200"
      className={className}
      aria-hidden
      focusable="false"
    >
      <g fill="#fcd34d" stroke="#b45309" strokeWidth={4} strokeLinejoin="round">
        {Array.from({ length: 18 }).map((_, i) => (
          <ellipse
            key={i}
            cx="100"
            cy="50"
            rx="11"
            ry="37"
            transform={`rotate(${i * 20} 100 100)`}
          />
        ))}
      </g>
      <circle cx="100" cy="100" r="27" fill="#92400e" />
      <circle cx="100" cy="100" r="14" fill="#fcd34d" />
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
  active,
  onNavigate,
}: {
  href: string;
  label: string;
  icon: LucideIcon;
  iconBg?: string;
  active: boolean;
  onNavigate?: () => void;
}) {
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
