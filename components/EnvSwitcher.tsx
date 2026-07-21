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
import {
  PRESET_IDS,
  ENV_PRESETS,
  isPreset,
  type EnvId,
  type EnvPresetName,
} from "@/lib/env";
import {
  loadSettings,
  saveSettings,
  SETTINGS_CHANGED_EVENT,
  type CustomEnv,
} from "@/lib/storage";
import { clearToken } from "@/lib/token";
import { cn } from "@/lib/utils";
import { readableTextColor } from "@/lib/design";

type BadgeTone = "info" | "warn" | "neutral";

// Short uppercase label for the topbar badge; the full label goes in the
// dropdown items. Presets are fixed; a custom env uses its (truncated) name.
const PRESET_SHORT: Record<EnvPresetName, string> = {
  dev: "DEV",
  rec: "RECETTE",
};

const PRESET_TONE: Record<EnvPresetName, BadgeTone> = {
  dev: "info",
  rec: "warn",
};

function fullLabel(env: EnvId, customEnvs: CustomEnv[]): string {
  if (isPreset(env)) return ENV_PRESETS[env].label;
  return customEnvs.find((e) => e.id === env)?.name ?? "Personnalisé";
}

function shortLabel(env: EnvId, customEnvs: CustomEnv[]): string {
  if (isPreset(env)) return PRESET_SHORT[env];
  const name = customEnvs.find((e) => e.id === env)?.name?.trim();
  return (name || "Perso").toUpperCase().slice(0, 10);
}

function tone(env: EnvId): BadgeTone {
  return isPreset(env) ? PRESET_TONE[env] : "neutral";
}

// The custom env's badge color (undefined for presets, which use tones).
function envColor(env: EnvId, customEnvs: CustomEnv[]): string | undefined {
  if (isPreset(env)) return undefined;
  return customEnvs.find((e) => e.id === env)?.color;
}

// Always-visible environment indicator that doubles as a quick-switcher.
// Reads the active environment from settings and re-syncs on
// SETTINGS_CHANGED_EVENT so it stays in step with the Settings page.
export function EnvSwitcher() {
  const [settings, setSettings] = React.useState(loadSettings);

  React.useEffect(() => {
    const sync = () => setSettings(loadSettings());
    sync();
    window.addEventListener(SETTINGS_CHANGED_EVENT, sync);
    return () => window.removeEventListener(SETTINGS_CHANGED_EVENT, sync);
  }, []);

  const environment = settings.environment;
  const customEnvs = settings.customEnvs;
  const activeColor = envColor(environment, customEnvs);

  // Switching mirrors the Settings save logic: a token is issued by (and valid
  // only for) one environment's auth server, so drop the cached one on change.
  const switchTo = (env: EnvId) => {
    const s = loadSettings();
    if (s.environment === env) return;
    saveSettings({ ...s, environment: env });
    clearToken();
    toast.success(`Environnement : ${fullLabel(env, s.customEnvs)}`);
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
          variant={activeColor ? "outline" : tone(environment)}
          style={
            activeColor
              ? {
                  backgroundColor: activeColor,
                  borderColor: activeColor,
                  color: readableTextColor(activeColor),
                }
              : undefined
          }
          aria-label={`Environnement actif : ${fullLabel(environment, customEnvs)}. Cliquer pour changer.`}
        >
          <button
            type="button"
            className="cursor-pointer font-bold uppercase tracking-wide"
          >
            {shortLabel(environment, customEnvs)}
            <ChevronDown className="opacity-70" />
          </button>
        </Badge>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Environnement</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup
          value={environment}
          onValueChange={(v) => switchTo(v as EnvId)}
        >
          {[...PRESET_IDS, ...customEnvs.map((e) => e.id)].map((env) => (
            <DropdownMenuRadioItem
              key={env}
              value={env}
              className={cn(env === environment && "font-semibold")}
            >
              <span className="flex items-center gap-1.5">
                {envColor(env, customEnvs) && (
                  <span
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: envColor(env, customEnvs) }}
                  />
                )}
                {fullLabel(env, customEnvs)}
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
