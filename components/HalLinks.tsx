"use client";

import { useMemo } from "react";
import { ArrowRight, Copy, Link2 } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { halLinkLabel, resolveHalHref, type HalLink } from "@/lib/hal";

interface Props {
  links: HalLink[];
  apiBaseUrl: string;
  // Full URL of the resource that produced these links (the displayed
  // response's request URL). Used to resolve bare-relative hrefs.
  currentUrl?: string;
  // Called with `(url, label)` — label is a short human-friendly name for
  // the navigation breadcrumb (e.g. `next`, `items[0].self`).
  onFollow?: (url: string, label: string) => void;
}

// Pretty path: ["_embedded", "items", "0"] → "_embedded.items[0]"
function formatContext(context: string[]): string {
  if (context.length === 0) return "";
  let out = "";
  for (const seg of context) {
    if (/^\d+$/.test(seg)) out += `[${seg}]`;
    else if (out === "") out = seg;
    else out += `.${seg}`;
  }
  return out;
}

export default function HalLinks({
  links,
  apiBaseUrl,
  currentUrl,
  onFollow,
}: Props) {
  // Group by context so embedded resources visually separate from the
  // root document's links.
  const groups = useMemo(() => {
    const m = new Map<string, HalLink[]>();
    for (const link of links) {
      const key = formatContext(link.context);
      const arr = m.get(key);
      if (arr) arr.push(link);
      else m.set(key, [link]);
    }
    return [...m.entries()];
  }, [links]);

  if (links.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        Aucun lien HAL trouvé dans la réponse.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {groups.map(([context, items]) => (
        <section key={context || "_root"} className="space-y-1.5">
          <h4 className="text-muted-foreground text-[10px] font-semibold uppercase tracking-wider">
            {context === "" ? "Ressource principale" : context}
          </h4>
          <ul className="divide-border/60 border-border divide-y rounded-md border">
            {items.map((link, i) => (
              <li key={`${link.rel}-${i}`} className="px-3 py-2">
                <LinkRow
                  link={link}
                  apiBaseUrl={apiBaseUrl}
                  currentUrl={currentUrl}
                  onFollow={onFollow}
                />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function LinkRow({
  link,
  apiBaseUrl,
  currentUrl,
  onFollow,
}: {
  link: HalLink;
  apiBaseUrl: string;
  currentUrl?: string;
  onFollow?: (url: string, label: string) => void;
}) {
  const resolved = link.templated
    ? link.href
    : resolveHalHref(link.href, apiBaseUrl, currentUrl);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <Link2 className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
        <code className="text-foreground text-xs font-semibold">{link.rel}</code>
        {link.templated && (
          <Badge variant="warn" className="text-[10px]">
            templated
          </Badge>
        )}
        {link.deprecation && (
          <Badge variant="danger" className="text-[10px]">
            deprecated
          </Badge>
        )}
        {link.type && (
          <Badge variant="neutral" className="font-mono text-[10px]">
            {link.type}
          </Badge>
        )}
        {link.name && (
          <span className="text-muted-foreground text-[11px]">
            <span className="font-semibold">name</span> = {link.name}
          </span>
        )}
        <div className="ml-auto flex shrink-0 gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={() => {
              navigator.clipboard.writeText(resolved).then(
                () => toast.success("URL copiée"),
                () => toast.error("Échec de la copie"),
              );
            }}
          >
            <Copy className="size-3" /> Copier
          </Button>
          {!link.templated && onFollow && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => onFollow(resolved, halLinkLabel(link))}
              title={`Suivre ${resolved}`}
            >
              <ArrowRight className="size-3" /> Suivre
            </Button>
          )}
        </div>
      </div>
      {link.title && (
        <p className="text-muted-foreground pl-5 text-xs">{link.title}</p>
      )}
      <code
        className={
          link.templated
            ? "text-muted-foreground pl-5 font-mono text-[11px] italic break-all"
            : "text-foreground pl-5 font-mono text-[11px] break-all"
        }
      >
        {link.templated ? link.href : resolved}
      </code>
      {link.deprecation && (
        <p className="text-muted-foreground pl-5 text-[11px]">
          Déprécié : voir{" "}
          <a
            href={link.deprecation}
            target="_blank"
            rel="noreferrer noopener"
            className="text-primary underline"
          >
            {link.deprecation}
          </a>
        </p>
      )}
    </div>
  );
}
