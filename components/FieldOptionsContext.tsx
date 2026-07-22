"use client";

import { createContext, useContext, type ReactNode } from "react";

// Externally-supplied, name-keyed option lists that turn a plain string leaf in
// SchemaField into a searchable combobox (see FieldCombobox). This is the only
// injection point SchemaField has for domain data (e.g. a product's funds), and
// it is intentionally opt-in: the default value is an empty map, so any form
// that does not mount a provider (the standalone endpoint page, every parcours
// step without `fieldOptions`) renders exactly as before.
export type FieldOption = { value: string; label: string };

// Keyed by the leaf property NAME (e.g. "fund_id"), not a full path — SchemaField
// passes the property name down as `name`. Collisions (two unrelated leaves that
// share a name in one body) are avoided structurally: the provider is mounted
// only around a step that declares options for that specific field.
export type FieldOptionsMap = Record<string, FieldOption[]>;

const FieldOptionsContext = createContext<FieldOptionsMap>({});

export function FieldOptionsProvider({
  value,
  children,
}: {
  value: FieldOptionsMap;
  children: ReactNode;
}) {
  return (
    <FieldOptionsContext.Provider value={value}>
      {children}
    </FieldOptionsContext.Provider>
  );
}

export function useFieldOptions(name?: string): FieldOption[] | undefined {
  const map = useContext(FieldOptionsContext);
  return name ? map[name] : undefined;
}
