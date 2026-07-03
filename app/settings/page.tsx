"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Save,
  Lock,
  Globe,
  KeyRound,
  Layers,
  FolderSync,
  RefreshCw,
  Network,
  GitBranch,
  Download,
  Check,
  Info,
} from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardBody, CardHeader } from "@/components/Card";
import Field from "@/components/Field";
import SyncDiff from "@/components/SyncDiff";
import Markdown from "@/components/Markdown";
import type { SpecDiff } from "@/lib/spec-diff";
import {
  loadSettings,
  saveSettings,
  SETTINGS_CHANGED_EVENT,
  type Settings,
} from "@/lib/storage";
import {
  ENV_OPTIONS,
  ENV_PRESETS,
  defaultContextPathFor,
  type EnvName,
} from "@/lib/env";
import { listApiSummaries } from "@/lib/specs";
import {
  getSpecsDir,
  setSpecsDir as persistSpecsDir,
  getGitlabConfigPublic,
  saveGitlabConfig,
} from "@/lib/config";
import { copySpecs } from "@/lib/sync";
import { listReleases, syncFromGitlab } from "@/lib/gitlab";
import {
  getLatestRelease,
  compareVersions,
  pickInstallerAsset,
  type LatestRelease,
} from "@/lib/github";
import { openUrl } from "@/lib/opener";
import { useAppVersion, useSpecsTag, specsTagLabel } from "@/hooks/use-app-info";
import { pickDirectory } from "@/lib/dialog";
import { cn } from "@/lib/utils";

type SpecsStatus =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "syncing" }
  | { kind: "ok"; message: string }
  | { kind: "error"; message: string };

// State of the in-app GitHub update check.
type UpdateStatus =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "current" }
  | { kind: "available"; latest: LatestRelease }
  | { kind: "error"; message: string };

interface Release {
  tag: string;
  name: string;
  releasedAt?: string;
  hasBundle: boolean;
}

// How many of the latest releases to preview before the user opts into the
// full list.
const RELEASES_PREVIEW = 3;

function formatReleaseDate(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString("fr-FR", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      });
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings>({
    environment: "dev",
    baseUrl: "",
    tokenUrl: "",
    clientId: "",
    clientSecret: "",
  });
  const [saved, setSaved] = useState(false);
  const [apis, setApis] = useState<{ id: string; title: string }[]>([]);
  const [specsDir, setSpecsDir] = useState("");
  const [resolvedSpecsDir, setResolvedSpecsDir] = useState("");
  const [configError, setConfigError] = useState<string | null>(null);
  const [specsStatus, setSpecsStatus] = useState<SpecsStatus>({ kind: "idle" });
  // Diffs persist past the status message's 3s auto-dismiss so the user can
  // read what moved; cleared at the start of the next sync.
  const [specsDiffs, setSpecsDiffs] = useState<SpecDiff[]>([]);
  const [gitlabProject, setGitlabProject] = useState("");
  const [gitlabHost, setGitlabHost] = useState("");
  const [gitlabToken, setGitlabToken] = useState("");
  const [gitlabHasToken, setGitlabHasToken] = useState(false);
  const [releases, setReleases] = useState<Release[]>([]);
  const [loadingReleases, setLoadingReleases] = useState(false);
  const [releasesTotal, setReleasesTotal] = useState<number | null>(null);
  const [releasesHasMore, setReleasesHasMore] = useState(false);
  const [releasesAll, setReleasesAll] = useState(false);
  // Whether an auto-load has been attempted for the current token (guards the
  // auto-load effect against retry loops when a load fails).
  const [releasesLoaded, setReleasesLoaded] = useState(false);
  const [selectedTag, setSelectedTag] = useState("");
  const [gitlabStatus, setGitlabStatus] = useState<SpecsStatus>({
    kind: "idle",
  });
  const [gitlabDiffs, setGitlabDiffs] = useState<SpecDiff[]>([]);

  useEffect(() => {
    setSettings(loadSettings());
    listApiSummaries()
      .then((list) => setApis(list.map((a) => ({ id: a.id, title: a.title }))))
      .catch(() => {
        /* ignore — per-API config simply won't list any API */
      });
    getSpecsDir()
      .then((dir) => {
        setSpecsDir(dir);
        setResolvedSpecsDir(dir);
      })
      .catch(() => {
        /* ignore — Settings page still usable without spec config */
      });
    getGitlabConfigPublic()
      .then((data) => {
        setGitlabProject(data.projectPath ?? "");
        setGitlabHost(data.host ?? "");
        setGitlabHasToken(Boolean(data.hasToken));
      })
      .catch(() => {
        /* ignore — GitLab sync simply stays unconfigured */
      });
  }, []);

  // Reflect settings saved elsewhere in the same tab (e.g. the request
  // builder's "save context path" button) without a reload.
  useEffect(() => {
    const sync = () => setSettings(loadSettings());
    window.addEventListener(SETTINGS_CHANGED_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(SETTINGS_CHANGED_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  useEffect(() => {
    if (specsStatus.kind !== "ok") return;
    const timer = window.setTimeout(
      () => setSpecsStatus({ kind: "idle" }),
      3000,
    );
    return () => window.clearTimeout(timer);
  }, [specsStatus]);

  useEffect(() => {
    if (gitlabStatus.kind !== "ok") return;
    const timer = window.setTimeout(
      () => setGitlabStatus({ kind: "idle" }),
      3000,
    );
    return () => window.clearTimeout(timer);
  }, [gitlabStatus]);

  const onSave = () => {
    saveSettings(settings);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1500);
    toast.success("Paramètres enregistrés");
  };

  const onBrowseSpecsDir = async () => {
    try {
      const dir = await pickDirectory("Choisir le dossier des specs OpenAPI");
      if (dir) setSpecsDir(dir);
    } catch {
      /* dialog unavailable outside Tauri — the text field still works */
    }
  };

  const onSaveSpecsPath = async () => {
    setSpecsStatus({ kind: "saving" });
    try {
      await persistSpecsDir(specsDir);
      setResolvedSpecsDir(specsDir);
      setConfigError(null);
      setSpecsStatus({
        kind: "ok",
        message: `Chemin enregistré : ${specsDir}`,
      });
    } catch (e) {
      setSpecsStatus({ kind: "error", message: String(e) });
    }
  };

  const onSyncSpecs = async () => {
    setSpecsStatus({ kind: "syncing" });
    setSpecsDiffs([]);
    try {
      const result = await copySpecs(specsDir || undefined);
      if (result.missing) {
        setSpecsStatus({
          kind: "error",
          message:
            "Dossier source introuvable. Vérifiez le chemin et réessayez.",
        });
        return;
      }
      const apis = result.copied;
      const detail = apis.length
        ? ` — ${apis.join(", ")}`
        : " (aucun bundle v1 trouvé)";
      setSpecsDiffs(result.diffs);
      setSpecsStatus({
        kind: "ok",
        message: `Synchronisé : ${apis.length} API${apis.length > 1 ? "s" : ""}${detail}`,
      });
    } catch (e) {
      setSpecsStatus({ kind: "error", message: String(e) });
    }
  };

  const onSaveGitlab = async () => {
    setGitlabStatus({ kind: "saving" });
    try {
      // Empty token is omitted, preserving the stored one.
      const data = await saveGitlabConfig({
        projectPath: gitlabProject,
        token: gitlabToken,
      });
      setGitlabProject(data.projectPath ?? gitlabProject);
      setGitlabHost(data.host ?? gitlabHost);
      setGitlabHasToken(Boolean(data.hasToken));
      setGitlabToken("");
      // Reset the list so the auto-load effect re-previews releases for the
      // (possibly changed) project.
      setReleases([]);
      setReleasesTotal(null);
      setReleasesHasMore(false);
      setReleasesAll(false);
      setReleasesLoaded(false);
      setSelectedTag("");
      setGitlabStatus({ kind: "ok", message: "Connexion GitLab enregistrée." });
    } catch (e) {
      setGitlabStatus({ kind: "error", message: (e as Error).message });
    }
  };

  // Loads the latest releases. `all=false` previews just the latest few;
  // `all=true` fetches the full list. Keeps the current selection if it's
  // still present, else preselects the newest release that has a bundle.
  const loadReleases = useCallback(async (all: boolean) => {
    setLoadingReleases(true);
    setGitlabStatus({ kind: "idle" });
    try {
      const data = await listReleases(all ? undefined : RELEASES_PREVIEW);
      const list: Release[] = data.releases ?? [];
      setReleases(list);
      setReleasesTotal(typeof data.total === "number" ? data.total : null);
      setReleasesHasMore(Boolean(data.hasMore));
      setReleasesAll(all);
      setSelectedTag((prev) =>
        prev && list.some((r) => r.tag === prev)
          ? prev
          : (list.find((r) => r.hasBundle)?.tag ?? ""),
      );
      if (list.length === 0) {
        setGitlabStatus({
          kind: "error",
          message: "Aucune release trouvée pour ce projet.",
        });
      }
    } catch (e) {
      setGitlabStatus({ kind: "error", message: (e as Error).message });
    } finally {
      setLoadingReleases(false);
      setReleasesLoaded(true);
    }
  }, []);

  // Preview the latest releases automatically once a token is known (on mount
  // or right after one is saved), so the picker is ready without an extra
  // click. The `releasesLoaded` flag ensures this fires once per token, even
  // if the load fails — no retry loop.
  useEffect(() => {
    if (gitlabHasToken && !releasesLoaded) loadReleases(false);
  }, [gitlabHasToken, releasesLoaded, loadReleases]);

  const onSyncGitlab = async () => {
    if (!selectedTag) return;
    setGitlabStatus({ kind: "syncing" });
    setGitlabDiffs([]);
    try {
      const data = await syncFromGitlab(selectedTag);
      const copied = data.copied;
      setGitlabDiffs(data.diffs);
      setGitlabStatus({
        kind: "ok",
        message: `Synchronisé depuis ${selectedTag} : ${copied.length} API${
          copied.length > 1 ? "s" : ""
        }${copied.length ? ` — ${copied.join(", ")}` : ""}`,
      });
    } catch (e) {
      setGitlabStatus({ kind: "error", message: (e as Error).message });
    }
  };

  const setApiPath = (apiId: string, value: string) => {
    setSettings((prev) => {
      const apiPaths = { ...(prev.apiPaths ?? {}) };
      const trimmed = value.trim();
      if (trimmed) apiPaths[apiId] = trimmed;
      else delete apiPaths[apiId];
      return { ...prev, apiPaths };
    });
  };

  const isCustom = settings.environment === "custom";
  const presetHost =
    settings.environment === "custom"
      ? null
      : ENV_PRESETS[settings.environment].host;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="text-xl font-semibold">Paramètres</h1>
      <p className="text-muted-foreground text-sm">
        La configuration (source des specs, connexion GitLab, identifiants
        OAuth2 et environnement) est stockée localement sur cette machine par
        l&apos;application (tauri-plugin-store). Le client secret et le token
        sont envoyés directement à la passerelle, sans transiter par un serveur.
      </p>

      <AboutUpdateCard />

      <Card>
        <CardHeader>
          <FolderSync className="text-muted-foreground size-3.5" />
          <span className="font-semibold">Source des specs OpenAPI</span>
        </CardHeader>
        <CardBody className="space-y-3 p-4">
          {configError && (
            <Alert variant="warn">
              <AlertDescription>{configError}</AlertDescription>
            </Alert>
          )}
          <Field
            label="Chemin du dossier"
            hint="Dossier contenant les sous-dossiers <api>/v1/openapi.bundle.yaml. Stocké localement par l'application."
          >
            <div className="flex items-center gap-1.5">
              <Input
                value={specsDir}
                onChange={(e) => setSpecsDir(e.target.value)}
                placeholder={resolvedSpecsDir || "/chemin/vers/openapi/dist"}
                className="font-mono"
                spellCheck={false}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={onBrowseSpecsDir}
                className="h-9 shrink-0 text-xs"
              >
                <FolderSync className="size-3" /> Parcourir
              </Button>
            </div>
          </Field>
          {resolvedSpecsDir && !specsDir && (
            <p className="text-muted-foreground text-[11px]">
              Chemin actuellement résolu (variable d&apos;environnement ou
              valeur par défaut) :{" "}
              <code className="font-mono">{resolvedSpecsDir}</code>
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={onSaveSpecsPath}
              disabled={specsStatus.kind === "saving" || !specsDir.trim()}
              className="text-xs"
            >
              <Save className="size-3" /> Enregistrer le chemin
            </Button>
            <Button
              variant="gradient"
              size="sm"
              onClick={onSyncSpecs}
              disabled={specsStatus.kind === "syncing"}
              className="text-xs"
            >
              <RefreshCw
                className={cn(
                  "size-3",
                  specsStatus.kind === "syncing" && "animate-spin",
                )}
              />
              Synchroniser maintenant
            </Button>
          </div>
          {(specsStatus.kind === "ok" || specsStatus.kind === "error") && (
            <p
              className={cn(
                "text-xs",
                specsStatus.kind === "error"
                  ? "text-destructive"
                  : "text-emerald-700 dark:text-emerald-400",
              )}
            >
              {specsStatus.message}
            </p>
          )}
          <SyncDiff diffs={specsDiffs} />
          <p className="text-muted-foreground text-[11px]">
            Les specs synchronisées sont écrites dans le dossier de données de
            l&apos;application et rechargées sans redémarrage.
          </p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <GitBranch className="text-muted-foreground size-3.5" />
          <span className="font-semibold">
            Synchroniser depuis une release GitLab
          </span>
        </CardHeader>
        <CardBody className="space-y-3 p-4">
          <p className="text-muted-foreground text-xs">
            Télécharge le <code>bundle.zip</code> de la release choisie et en
            extrait les contrats OpenAPI dans le stockage local des specs, puis
            rafraîchit le cache. Le token est conservé localement par
            l&apos;application.
          </p>

          <Field
            label="Projet GitLab"
            hint="Chemin group/projet ou identifiant numérique."
          >
            <Input
              value={gitlabProject}
              onChange={(e) => setGitlabProject(e.target.value)}
              placeholder="packsolutions/openapi"
              className="font-mono"
              spellCheck={false}
            />
          </Field>
          <Field
            label="Token d'accès"
            hint="Personal/Project Access Token avec le scope read_api. Laissez vide pour conserver le token déjà enregistré."
          >
            <Input
              type="password"
              value={gitlabToken}
              onChange={(e) => setGitlabToken(e.target.value)}
              placeholder={
                gitlabHasToken ? "•••••••• — déjà enregistré" : "glpat-…"
              }
              className="font-mono"
              autoComplete="off"
              spellCheck={false}
            />
          </Field>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={onSaveGitlab}
              disabled={
                gitlabStatus.kind === "saving" ||
                (!gitlabProject.trim() && !gitlabToken.trim())
              }
              className="text-xs"
            >
              <Save className="size-3" /> Enregistrer la connexion
            </Button>
            {gitlabHasToken && gitlabStatus.kind !== "saving" && (
              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
                <Check className="size-3" /> Token enregistré
              </span>
            )}
          </div>

          {!gitlabHasToken ? (
            <p className="text-muted-foreground text-[11px]">
              Enregistrez un token pour charger la liste des releases.
            </p>
          ) : (
            <div className="space-y-2 border-t pt-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium">
                  Release à synchroniser
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => loadReleases(releasesAll)}
                  disabled={loadingReleases}
                  className="text-muted-foreground h-auto gap-1 px-1.5 py-1 text-[11px]"
                >
                  <RefreshCw
                    className={cn("size-3", loadingReleases && "animate-spin")}
                  />
                  Rafraîchir
                </Button>
              </div>

              {releases.length > 0 ? (
                <>
                  <Select value={selectedTag} onValueChange={setSelectedTag}>
                    <SelectTrigger className="font-mono">
                      <SelectValue placeholder="Choisir un tag" />
                    </SelectTrigger>
                    <SelectContent>
                      {releases.map((r) => (
                        <SelectItem
                          key={r.tag}
                          value={r.tag}
                          disabled={!r.hasBundle}
                        >
                          {r.tag}
                          {r.releasedAt
                            ? ` · ${formatReleaseDate(r.releasedAt)}`
                            : ""}
                          {!r.hasBundle ? " · pas de bundle.zip" : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                    <p className="text-muted-foreground text-[11px]">
                      {releasesAll
                        ? `${releases.length} release${releases.length > 1 ? "s" : ""}`
                        : `${releases.length} dernière${
                            releases.length > 1 ? "s" : ""
                          }${releasesTotal != null ? ` sur ${releasesTotal}` : ""}`}
                    </p>
                    {releasesHasMore && !releasesAll && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => loadReleases(true)}
                        disabled={loadingReleases}
                        className="text-primary h-auto px-1.5 py-1 text-[11px]"
                      >
                        Charger toutes les releases
                      </Button>
                    )}
                  </div>

                  <Button
                    variant="gradient"
                    size="sm"
                    onClick={onSyncGitlab}
                    disabled={!selectedTag || gitlabStatus.kind === "syncing"}
                    className="w-full text-xs sm:w-auto"
                  >
                    <Download
                      className={cn(
                        "size-3",
                        gitlabStatus.kind === "syncing" && "animate-spin",
                      )}
                    />
                    Synchroniser ce tag
                  </Button>
                </>
              ) : (
                loadingReleases && (
                  <p className="text-muted-foreground text-[11px]">
                    Chargement des releases…
                  </p>
                )
              )}
            </div>
          )}

          {(gitlabStatus.kind === "ok" || gitlabStatus.kind === "error") && (
            <p
              className={cn(
                "text-xs",
                gitlabStatus.kind === "error"
                  ? "text-destructive"
                  : "text-emerald-700 dark:text-emerald-400",
              )}
            >
              {gitlabStatus.message}
            </p>
          )}
          <SyncDiff diffs={gitlabDiffs} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader>
          <Layers className="text-muted-foreground size-3.5" />
          <span className="font-semibold">Environnement</span>
        </CardHeader>
        <CardBody className="space-y-3 p-4">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {ENV_OPTIONS.map((env) => (
              <EnvOption
                key={env}
                env={env}
                active={settings.environment === env}
                onSelect={() =>
                  setSettings({ ...settings, environment: env })
                }
              />
            ))}
          </div>
          {settings.environment !== "custom" && (
            <div className="bg-muted/40 rounded-md p-3 text-xs">
              <div className="font-semibold">URLs utilisées</div>
              <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-[11px]">
                <dt className="text-muted-foreground">
                  base/&lt;api&gt;
                </dt>
                <dd>
                  {ENV_PRESETS[settings.environment].baseUrlFor("<api>")}
                </dd>
                <dt className="text-muted-foreground">token</dt>
                <dd className="break-all">
                  {ENV_PRESETS[settings.environment].tokenUrl}
                </dd>
              </dl>
            </div>
          )}
        </CardBody>
      </Card>

      {apis.length > 0 && (
        <Card>
          <CardHeader>
            <Network className="text-muted-foreground size-3.5" />
            <span className="font-semibold">Context paths des APIs</span>
          </CardHeader>
          <CardBody className="space-y-3 p-4">
            <p className="text-muted-foreground text-xs">
              Segment de chemin sous lequel chaque API est exposée sur la
              passerelle (ex. <code>documents</code>). Laissez vide pour utiliser
              le chemin par défaut. S&apos;applique aux passerelles dev/rec.
            </p>
            {apis.map((api) => {
              const value = settings.apiPaths?.[api.id] ?? "";
              const fallback = defaultContextPathFor(api.id);
              const effective = (value.trim() || fallback).replace(
                /^\/+|\/+$/g,
                "",
              );
              return (
                <Field
                  key={api.id}
                  label={api.title}
                  hint={
                    presetHost
                      ? effective
                        ? `${presetHost}/${effective}`
                        : `${presetHost} (racine)`
                      : "Aperçu indisponible en environnement Personnalisé."
                  }
                >
                  <Input
                    value={value}
                    onChange={(e) => setApiPath(api.id, e.target.value)}
                    placeholder={fallback ? `(${fallback})` : "(racine)"}
                    className="font-mono"
                    spellCheck={false}
                  />
                </Field>
              );
            })}
          </CardBody>
        </Card>
      )}

      {isCustom && (
        <Card>
          <CardHeader>
            <Globe className="text-muted-foreground size-3.5" />
            <span className="font-semibold">URLs personnalisées</span>
          </CardHeader>
          <CardBody className="space-y-3 p-4">
            <Field
              label="Base URL"
              hint="Préfixe des appels API. Laissez vide pour utiliser la valeur du contrat (servers[0].url)."
            >
              <Input
                type="url"
                value={settings.baseUrl}
                onChange={(e) =>
                  setSettings({ ...settings, baseUrl: e.target.value })
                }
                placeholder="https://api.exemple.com"
              />
            </Field>
            <Field
              label="Token URL"
              hint="Endpoint OAuth2 Client Credentials. Laissez vide pour utiliser celui déclaré dans la spec."
            >
              <Input
                type="url"
                value={settings.tokenUrl}
                onChange={(e) =>
                  setSettings({ ...settings, tokenUrl: e.target.value })
                }
                placeholder="https://iam.exemple.com/oauth/token"
              />
            </Field>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader>
          <Lock className="text-muted-foreground size-3.5" />
          <span className="font-semibold">Identifiants client OAuth2</span>
        </CardHeader>
        <CardBody className="space-y-3 p-4">
          <Field label="Client ID" required>
            <Input
              value={settings.clientId}
              onChange={(e) =>
                setSettings({ ...settings, clientId: e.target.value })
              }
              className="font-mono"
              autoComplete="username"
            />
          </Field>
          <Field
            label="Client Secret"
            hint="Conservé localement sur cette machine par l'application, sans transiter par un serveur. À ne pas saisir sur une machine partagée."
            required
          >
            <Input
              type="password"
              value={settings.clientSecret}
              onChange={(e) =>
                setSettings({ ...settings, clientSecret: e.target.value })
              }
              className="font-mono"
              autoComplete="current-password"
            />
          </Field>
        </CardBody>
      </Card>

      <div className="flex items-center gap-3">
        <Button variant="gradient" onClick={onSave}>
          <Save className="size-3.5" /> Enregistrer
        </Button>
        {saved && (
          <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
            <KeyRound className="size-3" /> Enregistré
          </span>
        )}
      </div>
    </div>
  );
}

// App version + loaded APIs tag, plus the lightweight GitHub update check:
// fetch the latest release, compare against the running version, and — when a
// newer one exists — show its changelog and a button that opens the platform
// installer's download URL in the system browser (manual install).
function AboutUpdateCard() {
  const appVersion = useAppVersion();
  const specsTag = useSpecsTag();
  const [status, setStatus] = useState<UpdateStatus>({ kind: "idle" });

  const onCheck = async () => {
    setStatus({ kind: "checking" });
    try {
      const latest = await getLatestRelease();
      const newer = compareVersions(latest.tag, appVersion) > 0;
      setStatus(newer ? { kind: "available", latest } : { kind: "current" });
    } catch (e) {
      setStatus({ kind: "error", message: (e as Error).message });
    }
  };

  const onDownload = async (latest: LatestRelease) => {
    const asset = pickInstallerAsset(latest.assets);
    try {
      await openUrl(asset?.url ?? latest.htmlUrl);
    } catch (e) {
      toast.error("Ouverture du lien impossible", {
        description: (e as Error).message,
      });
    }
  };

  return (
    <Card>
      <CardHeader>
        <Info className="text-muted-foreground size-3.5" />
        <span className="font-semibold">À propos &amp; mises à jour</span>
      </CardHeader>
      <CardBody className="space-y-3 p-4">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
          <dt className="text-muted-foreground">Version de l&apos;application</dt>
          <dd className="font-mono">{appVersion ? `v${appVersion}` : "—"}</dd>
          <dt className="text-muted-foreground">APIs chargées</dt>
          <dd className="font-mono">
            {specsTagLabel(specsTag)}
            {specsTag?.releasedAt && (
              <span className="text-muted-foreground ml-2 font-sans text-[11px]">
                · release du {formatReleaseDate(specsTag.releasedAt)}
              </span>
            )}
          </dd>
        </dl>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onCheck}
            disabled={status.kind === "checking"}
            className="text-xs"
          >
            <RefreshCw
              className={cn(
                "size-3",
                status.kind === "checking" && "animate-spin",
              )}
            />
            Rechercher des mises à jour
          </Button>
          {status.kind === "current" && (
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
              <Check className="size-3" /> Vous êtes à jour.
            </span>
          )}
        </div>

        {status.kind === "error" && (
          <p className="text-destructive text-xs">{status.message}</p>
        )}

        {status.kind === "available" && (
          <div className="border-primary/30 bg-primary/5 space-y-2 rounded-md border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-semibold">
                Version {status.latest.tag} disponible
              </span>
              <Button
                variant="gradient"
                size="sm"
                onClick={() => onDownload(status.latest)}
                className="text-xs"
              >
                <Download className="size-3" /> Télécharger
              </Button>
            </div>
            {status.latest.body && (
              <div className="max-h-72 overflow-y-auto border-t pt-2">
                <Markdown content={status.latest.body} collapsible />
              </div>
            )}
            <p className="text-muted-foreground text-[11px]">
              Le programme d&apos;installation s&apos;ouvre dans votre navigateur
              ; lancez-le puis relancez PackRest une fois installé.
            </p>
          </div>
        )}
      </CardBody>
    </Card>
  );
}

function EnvOption({
  env,
  active,
  onSelect,
}: {
  env: EnvName;
  active: boolean;
  onSelect: () => void;
}) {
  const meta =
    env === "custom"
      ? {
          label: "Personnalisé",
          description: "Renseignez vos propres URLs.",
        }
      : {
          label: ENV_PRESETS[env].label,
          description: ENV_PRESETS[env].description,
        };
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex flex-col gap-1 rounded-md border p-3 text-left text-xs transition",
        active
          ? "border-primary bg-primary/5 text-foreground ring-primary/20 ring-2"
          : "border-input bg-card text-foreground hover:border-foreground/40",
      )}
    >
      <span className="font-semibold">{meta.label}</span>
      <span className="text-muted-foreground text-[11px]">
        {meta.description}
      </span>
    </button>
  );
}
