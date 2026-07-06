// Generic, schema-agnostic humanization helpers for the readable ("Lisible")
// response tree. These make raw JSON friendlier for non-technical users:
// de-camelCased key labels, localized dates, and French boolean/null wording.
// Intentionally NOT spec-driven — see the tree in components/JsonView.tsx.

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const ISO_DATE_RE =
  /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/;

// Date-only values parse as UTC midnight; format them in UTC too so they
// don't slip to the previous day in negative-offset timezones.
const DATE_FMT = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "long",
  timeZone: "UTC",
});
const DATE_TIME_FMT = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "long",
  timeStyle: "short",
});

// Display label for an object key. Turns `firstName` → "First Name",
// `date_naissance` → "Date Naissance", `codeINSEE` → "Code INSEE",
// `_links` → "Links". Only reformats — it cannot translate.
export function humanizeKey(key: string): string {
  const words = key
    .replace(/^_+/, "") // strip HAL-style leading underscore(s)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2") // camelCase boundary
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2") // acronym → word boundary
    .replace(/[_-]+/g, " ") // snake_case / kebab-case
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return key;
  return words
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// Returns a localized French date for a strict ISO 8601 string, else null.
// Deliberately strict to avoid mangling version strings, ids, or partial
// dates. Guards JS's lenient Date parsing by re-checking the year.
export function formatMaybeDate(value: string): string | null {
  if (!ISO_DATE_RE.test(value)) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  // The regex guarantees a leading 4-digit year; make sure Date didn't drift
  // (e.g. "2024-02-31" rolling into March).
  const year = Number(value.slice(0, 4));
  const parsedYear = DATE_ONLY_RE.test(value)
    ? date.getUTCFullYear()
    : date.getFullYear();
  if (parsedYear !== year) return null;
  return DATE_ONLY_RE.test(value)
    ? DATE_FMT.format(date)
    : DATE_TIME_FMT.format(date);
}

export const NULL_LABEL = "Aucune valeur";

export function booleanLabel(value: boolean): string {
  return value ? "Oui" : "Non";
}
