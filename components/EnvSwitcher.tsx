"use client";

import * as React from "react";
import { ChevronDown } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ENV_OPTIONS, ENV_PRESETS, type EnvName } from "@/lib/env";
import {
  loadSettings,
  saveSettings,
  SETTINGS_CHANGED_EVENT,
} from "@/lib/storage";
import { clearToken } from "@/lib/token";
import { cn } from "@/lib/utils";

type BadgeTone = "info" | "warn" | "neutral";

// Short uppercase label for the topbar badge; the full preset label goes in
// the dropdown items.
const SHORT_LABEL: Record<EnvName, string> = {
  dev: "DEV",
  rec: "RECETTE",
  custom: "PERSO",
};

const TONE: Record<EnvName, BadgeTone> = {
  dev: "info",
  rec: "warn",
  custom: "neutral",
};

function fullLabel(env: EnvName): string {
  return env === "custom" ? "Personnalisé" : ENV_PRESETS[env].label;
}

// Always-visible environment indicator that doubles as a quick-switcher.
// Reads the active environment from settings and re-syncs on
// SETTINGS_CHANGED_EVENT so it stays in step with the Settings page.
export function EnvSwitcher() {
  const [environment, setEnvironment] = React.useState<EnvName>("dev");

  React.useEffect(() => {
    const sync = () => setEnvironment(loadSettings().environment);
    sync();
    window.addEventListener(SETTINGS_CHANGED_EVENT, sync);
    return () => window.removeEventListener(SETTINGS_CHANGED_EVENT, sync);
  }, []);

  // Switching mirrors the Settings save logic: a token is issued by (and valid
  // only for) one environment's auth server, so drop the cached one on change.
  const switchTo = (env: EnvName) => {
    const s = loadSettings();
    if (s.environment === env) return;
    saveSettings({ ...s, environment: env });
    clearToken();
    toast.success(`Environnement : ${fullLabel(env)}`);
  };

  return (
    // modal={false}: a modal menu locks body scroll (react-remove-scroll),
    // which removes the scrollbar and — in the WebKit webview, where media
    // queries exclude the scrollbar width — can push the viewport past the
    // `xl` breakpoint, flipping the request grid from one to two columns.
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Badge
          asChild
          variant={TONE[environment]}
          aria-label={`Environnement actif : ${fullLabel(environment)}. Cliquer pour changer.`}
        >
          <button
            type="button"
            className="cursor-pointer font-bold uppercase tracking-wide"
          >
            {SHORT_LABEL[environment]}
            <ChevronDown className="opacity-70" />
          </button>
        </Badge>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Environnement</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup
          value={environment}
          onValueChange={(v) => switchTo(v as EnvName)}
        >
          {ENV_OPTIONS.map((env) => (
            <DropdownMenuRadioItem
              key={env}
              value={env}
              className={cn(env === environment && "font-semibold")}
            >
              {fullLabel(env)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
