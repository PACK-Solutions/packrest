"use client";

// Backward-compat wrapper around shadcn's Tabs. The legacy API (a `tabs`
// array, optional controlled `activeId`, an `onChange` callback) is
// preserved so existing callers keep working unchanged.

import { useEffect, useState, type ReactNode } from "react";
import {
  Tabs as ShadcnTabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export interface TabSpec {
  id: string;
  label: string;
  icon?: ReactNode;
  count?: number;
  content: ReactNode;
}

interface Props {
  tabs: TabSpec[];
  defaultId?: string;
  activeId?: string;
  onChange?: (id: string) => void;
  // At xl, stretch to fill the parent flex column and scroll each tab's
  // content internally (used by the fixed-height response panel).
  fill?: boolean;
  // Keep every tab's content mounted (hidden when inactive) instead of Radix's
  // default unmount-on-inactive. Needed when an inactive tab hosts fields that
  // must run on mount — e.g. a `const` discriminator in the body form that
  // self-emits its value (SchemaField's ConstField). Without this, opening on
  // the Paramètres tab sends a body missing that discriminator.
  mountAll?: boolean;
}

export default function Tabs({
  tabs,
  defaultId,
  activeId,
  onChange,
  fill = false,
  mountAll = false,
}: Props) {
  const [internal, setInternal] = useState(defaultId ?? tabs[0]?.id);
  const active = activeId ?? internal;

  // Reset to defaultId when the active tab disappears (e.g. switching ops).
  useEffect(() => {
    if (
      activeId === undefined &&
      defaultId &&
      !tabs.find((t) => t.id === internal)
    ) {
      setInternal(defaultId);
    }
  }, [activeId, defaultId, internal, tabs]);

  if (!tabs.length) return null;

  return (
    <ShadcnTabs
      value={active}
      onValueChange={(id) => {
        setInternal(id);
        onChange?.(id);
      }}
      className={fill ? "xl:min-h-0 xl:flex-1" : undefined}
    >
      <TabsList>
        {tabs.map((t) => (
          <TabsTrigger key={t.id} value={t.id} className="gap-1.5">
            {t.icon && <span aria-hidden>{t.icon}</span>}
            <span>{t.label}</span>
            {typeof t.count === "number" && t.count > 0 && (
              <Badge
                variant={active === t.id ? "default" : "secondary"}
                className="ml-1 h-4 min-w-[18px] px-1.5 text-[10px]"
              >
                {t.count}
              </Badge>
            )}
          </TabsTrigger>
        ))}
      </TabsList>
      {tabs.map((t) => (
        <TabsContent
          key={t.id}
          value={t.id}
          forceMount={mountAll ? true : undefined}
          className={cn(
            fill ? "scrollbar-thin pt-2 xl:min-h-0 xl:overflow-y-auto" : "pt-2",
            // Under forceMount Radix keeps the panel visible even when
            // inactive, so hide inactive panels ourselves.
            mountAll && "data-[state=inactive]:hidden",
          )}
        >
          {t.content}
        </TabsContent>
      ))}
    </ShadcnTabs>
  );
}
