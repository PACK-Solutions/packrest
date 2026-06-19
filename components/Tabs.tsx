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
}

export default function Tabs({ tabs, defaultId, activeId, onChange }: Props) {
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
        <TabsContent key={t.id} value={t.id} className="pt-2">
          {t.content}
        </TabsContent>
      ))}
    </ShadcnTabs>
  );
}
