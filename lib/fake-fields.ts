// Fake-but-valid sample values for common French subscription fields, used by
// the topbar "Générateur de champs" tool. Each field has a checksum (IBAN,
// RIB key, NIR key, SIREN/SIRET Luhn) that the generated value satisfies, so it
// passes format + checksum validation — the data is otherwise fictitious.
//
// Pure module (no React / no Tauri): Math.random is fine here, these are
// throwaway test values, not anything security-sensitive.

function digits(n: number): string {
  let s = "";
  for (let i = 0; i < n; i++) s += Math.floor(Math.random() * 10);
  return s;
}

// Remainder mod 97 of an arbitrarily long numeric string (IBAN / RIB / NIR).
function mod97(numStr: string): number {
  let rem = 0;
  for (let i = 0; i < numStr.length; i++) {
    rem = (rem * 10 + (numStr.charCodeAt(i) - 48)) % 97;
  }
  return rem;
}

// Check digit that makes `numberWithoutCheck` + digit satisfy the Luhn formula.
function luhnCheckDigit(numberWithoutCheck: string): number {
  let sum = 0;
  let double = true; // the appended digit is position 1, so the last existing digit doubles
  for (let i = numberWithoutCheck.length - 1; i >= 0; i--) {
    let d = numberWithoutCheck.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return (10 - (sum % 10)) % 10;
}

// French RIB key: 97 - ((89·banque + 15·guichet + 3·compte) mod 97), all-digit
// account only (no letter transposition needed).
function ribKey(banque: string, guichet: string, compte: string): string {
  const x = (89 * mod97(banque) + 15 * mod97(guichet) + 3 * mod97(compte)) % 97;
  return String(97 - x).padStart(2, "0");
}

export function frIban(): string {
  const banque = digits(5);
  const guichet = digits(5);
  const compte = digits(11);
  const bban = banque + guichet + compte + ribKey(banque, guichet, compte); // 23
  // IBAN check: move "FR00" to the end, FR→1527, then 98 - (mod 97).
  const check = 98 - mod97(bban + "1527" + "00");
  return "FR" + String(check).padStart(2, "0") + bban; // 27 chars
}

export function bic(): string {
  const letter = () => String.fromCharCode(65 + Math.floor(Math.random() * 26));
  const alnum = () =>
    "ABCDEFGHIJKLMNPQRSTUVWXYZ0123456789"[Math.floor(Math.random() * 35)];
  return letter() + letter() + letter() + letter() + "FR" + alnum() + alnum();
}

// French NIR (numéro de sécurité sociale) : 13 digits + 2-digit key.
function nir(): string {
  const sex = Math.random() < 0.5 ? "1" : "2";
  const year = digits(2);
  const month = String(1 + Math.floor(Math.random() * 12)).padStart(2, "0");
  const dept = String(1 + Math.floor(Math.random() * 95)).padStart(2, "0");
  const commune = String(1 + Math.floor(Math.random() * 990)).padStart(3, "0");
  const order = String(1 + Math.floor(Math.random() * 999)).padStart(3, "0");
  const base = sex + year + month + dept + commune + order; // 13
  const key = String(97 - mod97(base)).padStart(2, "0"); // 97 - (NIR mod 97)
  return base + key; // 15
}

function siren(): string {
  const base = digits(8);
  return base + luhnCheckDigit(base); // 9, Luhn-valid
}

function siret(): string {
  const base = siren() + digits(4); // 13
  return base + luhnCheckDigit(base); // 14, Luhn-valid
}

export interface FieldGenerator {
  key: string;
  label: string;
  generate: () => string;
}

export const FIELD_GENERATORS: FieldGenerator[] = [
  { key: "iban", label: "IBAN (FR)", generate: frIban },
  { key: "bic", label: "BIC", generate: bic },
  { key: "nir", label: "N° de sécurité sociale", generate: nir },
  { key: "siren", label: "SIREN", generate: siren },
  { key: "siret", label: "SIRET", generate: siret },
];

export function generateAll(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of FIELD_GENERATORS) out[f.key] = f.generate();
  return out;
}

// --- random-but-plausible French identity/address/amount values -------------
// Used by the Parcours auto-fill (lib/parcours-auto.ts). Not exposed in
// FIELD_GENERATORS: the topbar tool only offers checksum-bearing formats.

function pick<T>(pool: readonly T[]): T {
  return pool[Math.floor(Math.random() * pool.length)];
}

const FIRST_NAMES = [
  "Camille", "Léa", "Chloé", "Manon", "Julie", "Emma", "Sarah", "Laura",
  "Pauline", "Marion", "Claire", "Lucie", "Élise", "Margaux", "Inès",
  "Charlotte", "Amandine", "Sophie", "Mathilde", "Anaïs",
  "Lucas", "Hugo", "Louis", "Jules", "Thomas", "Arthur", "Nathan", "Gabriel",
  "Raphaël", "Léo", "Paul", "Antoine", "Maxime", "Alexandre", "Clément",
  "Baptiste", "Quentin", "Romain", "Nicolas", "Julien",
] as const;

const LAST_NAMES = [
  "Martin", "Bernard", "Dubois", "Thomas", "Robert", "Richard", "Petit",
  "Durand", "Leroy", "Moreau", "Simon", "Laurent", "Lefebvre", "Michel",
  "Garcia", "David", "Bertrand", "Roux", "Vincent", "Fournier", "Morel",
  "Girard", "Andre", "Lefevre", "Mercier", "Dupont", "Lambert", "Bonnet",
  "Francois", "Martinez", "Legrand", "Garnier", "Faure", "Rousseau", "Blanc",
  "Guerin", "Muller", "Henry", "Roussel", "Nicolas",
] as const;

export function frFirstName(): string {
  return pick(FIRST_NAMES);
}

export function frLastName(): string {
  return pick(LAST_NAMES);
}

// Local-timezone YYYY-MM-DD (toISOString would shift the day around midnight).
export function toLocalIsoDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Random date of birth for an adult aged 18–80 (uniform over days).
export function adultBirthDate(): string {
  const now = new Date();
  const youngest = new Date(now.getFullYear() - 18, now.getMonth(), now.getDate());
  const oldest = new Date(now.getFullYear() - 80, now.getMonth(), now.getDate());
  const t = oldest.getTime() + Math.random() * (youngest.getTime() - oldest.getTime());
  return toLocalIsoDate(new Date(t));
}

const STREET_NAMES = [
  "de la République", "Victor Hugo", "des Lilas", "du Général de Gaulle",
  "Jean Jaurès", "Pasteur", "des Écoles", "de la Gare", "du Moulin",
  "des Tilleuls", "Saint-Michel", "de Verdun", "des Acacias", "Carnot",
  "de la Fontaine",
] as const;

export function frStreetLine(): string {
  const n = 1 + Math.floor(Math.random() * 120);
  const kind = pick(["rue", "avenue", "boulevard"] as const);
  return `${n} ${kind} ${pick(STREET_NAMES)}`;
}

// Coherent real city / postal-code pairs.
const CITY_POSTALS = [
  { city: "Paris", postalCode: "75011" },
  { city: "Lyon", postalCode: "69003" },
  { city: "Marseille", postalCode: "13006" },
  { city: "Toulouse", postalCode: "31000" },
  { city: "Nice", postalCode: "06000" },
  { city: "Nantes", postalCode: "44000" },
  { city: "Strasbourg", postalCode: "67000" },
  { city: "Montpellier", postalCode: "34000" },
  { city: "Bordeaux", postalCode: "33000" },
  { city: "Lille", postalCode: "59000" },
  { city: "Rennes", postalCode: "35000" },
  { city: "Reims", postalCode: "51100" },
  { city: "Le Havre", postalCode: "76600" },
  { city: "Saint-Étienne", postalCode: "42000" },
  { city: "Toulon", postalCode: "83000" },
  { city: "Grenoble", postalCode: "38000" },
  { city: "Dijon", postalCode: "21000" },
  { city: "Angers", postalCode: "49000" },
  { city: "Nîmes", postalCode: "30000" },
  { city: "Clermont-Ferrand", postalCode: "63000" },
] as const;

export function frCityPostal(): { city: string; postalCode: string } {
  return pick(CITY_POSTALS);
}

// Random whole-euro amount in [minEuros, maxEuros], returned in cents
// (matches the Amount schema: value in cents with scale 2).
export function randomAmountCents(minEuros: number, maxEuros: number): number {
  const euros = minEuros + Math.floor(Math.random() * (maxEuros - minEuros + 1));
  return euros * 100;
}
