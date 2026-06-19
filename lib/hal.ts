// HAL (Hypertext Application Language, RFC draft / IANA media type
// `application/hal+json`) helpers: extract `_links` (and `_embedded._links`)
// from a JSON payload and resolve hrefs against the API base.
//
// HAL conventions:
//   - `_links`     : map of relation → link object (or array of link objects)
//   - `_embedded`  : map of relation → embedded resource (or array thereof)
//   - link object  : { href, templated?, title?, type?, deprecation?, name?,
//                     profile?, hreflang? }
//
// Templated links (RFC 6570 URI Templates, e.g. `/users/{id}`) are flagged
// but not made clickable — the user has to expand them first.

export interface HalLink {
  rel: string;
  href: string;
  title?: string;
  type?: string;
  templated?: boolean;
  deprecation?: string;
  name?: string;
  profile?: string;
  // Path within the response body to the embedded resource that hosts
  // this link. Empty for top-level _links. Used to group links by context.
  context: string[];
}

type LinkResolver = (
  path: readonly string[],
  value: unknown,
) => string | null;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function asLink(value: unknown): Omit<HalLink, "rel" | "context"> | null {
  if (!isPlainObject(value)) return null;
  if (typeof value.href !== "string") return null;
  return {
    href: value.href,
    templated: value.templated === true,
    title: typeof value.title === "string" ? value.title : undefined,
    type: typeof value.type === "string" ? value.type : undefined,
    deprecation:
      typeof value.deprecation === "string" ? value.deprecation : undefined,
    name: typeof value.name === "string" ? value.name : undefined,
    profile: typeof value.profile === "string" ? value.profile : undefined,
  };
}

function isProbablyTemplated(href: string): boolean {
  return /\{[^}]+\}/.test(href);
}

// Walks HAL containers (`_links` + `_embedded`) only — HAL keeps links on
// resource roots and inside embedded resources, never under arbitrary
// domain properties. Skipping non-HAL keys avoids walking large response
// bodies needlessly.
export function extractHalLinks(value: unknown): HalLink[] {
  const out: HalLink[] = [];
  walk(value, [], out);
  return out;
}

function walk(value: unknown, context: string[], out: HalLink[]): void {
  if (!isPlainObject(value)) return;
  const links = value._links;
  if (isPlainObject(links)) {
    for (const [rel, raw] of Object.entries(links)) {
      if (Array.isArray(raw)) {
        raw.forEach((entry) => {
          const link = asLink(entry);
          if (link) out.push({ rel, context: [...context], ...link });
        });
      } else {
        const link = asLink(raw);
        if (link) out.push({ rel, context: [...context], ...link });
      }
    }
  }
  const embedded = value._embedded;
  if (isPlainObject(embedded)) {
    for (const [rel, raw] of Object.entries(embedded)) {
      if (Array.isArray(raw)) {
        raw.forEach((item, i) =>
          walk(item, [...context, "_embedded", rel, String(i)], out),
        );
      } else {
        walk(raw, [...context, "_embedded", rel], out);
      }
    }
  }
}

// Resolves a (possibly relative) HAL href against the API base URL.
//
// Important: `baseUrl` MUST be the API base (e.g.
// `https://gateway.example.com/person`), NOT the full request URL. Hrefs
// returned by HAL APIs typically look like `/individuals/{id}` — they're
// absolute paths but mounted under the API's prefix. `new URL` would
// resolve `/individuals/...` against the host root (dropping `/person`),
// so we prepend the base path manually when the href starts with `/`.
export function resolveHalHref(href: string, baseUrl: string): string {
  if (!href) return href;
  if (/^https?:\/\//i.test(href)) return href;
  if (!baseUrl) return href;
  try {
    const base = new URL(baseUrl);
    if (href.startsWith("/")) {
      const basePath = base.pathname.replace(/\/$/, "");
      return base.origin + basePath + href;
    }
    // Bare relative href ("users/42") — resolve against the API base as if
    // it were a directory, so we don't lose its last segment.
    const baseAsDir = baseUrl.endsWith("/") ? baseUrl : baseUrl + "/";
    return new URL(href, baseAsDir).toString();
  } catch {
    return href;
  }
}

// Used by JsonView: given a leaf string at a JSON path, return its
// clickable URL or null. Recognises any `href` whose path crosses a
// `_links` segment; templated hrefs (containing `{x}`) are skipped.
export function makeHalLinkResolver(baseUrl: string): LinkResolver {
  return (path, value) => {
    if (typeof value !== "string") return null;
    if (path[path.length - 1] !== "href") return null;
    if (!path.includes("_links")) return null;
    if (isProbablyTemplated(value)) return null;
    return resolveHalHref(value, baseUrl);
  };
}

// Predicate consumed by JsonView (as `templatedDetector` prop) to style
// templated hrefs distinctly even though they aren't clickable.
export function isHalHrefPath(path: readonly string[]): boolean {
  return path[path.length - 1] === "href" && path.includes("_links");
}

// Human-friendly label for a HAL link based on its JSON path. Used by the
// follow stack to render the breadcrumb.
//
// Examples:
//   ["_links", "next", "href"]                              → "next"
//   ["_embedded", "items", "0", "_links", "self", "href"]   → "items[0].self"
//   ["_embedded", "orders", "_links", "first", "href"]      → "orders.first"
export function pathToHalLabel(path: readonly string[]): string {
  if (path[path.length - 1] !== "href") return "lien";
  const linksIdx = path.lastIndexOf("_links");
  if (linksIdx === -1) return "lien";
  const rel = path[linksIdx + 1] ?? "lien";
  const beforeLinks = path.slice(0, linksIdx);
  if (beforeLinks.length === 0) return rel;
  const formatted: string[] = [];
  for (const seg of beforeLinks) {
    if (seg === "_embedded") continue;
    if (/^\d+$/.test(seg) && formatted.length > 0) {
      formatted[formatted.length - 1] = `${formatted[formatted.length - 1]}[${seg}]`;
    } else {
      formatted.push(seg);
    }
  }
  return formatted.length > 0 ? `${formatted.join(".")}.${rel}` : rel;
}

// Same idea, but starting from a HalLink (the Liens tab knows the rel and
// context directly without going through a JSON path).
export function halLinkLabel(link: HalLink): string {
  if (link.context.length === 0) return link.rel;
  const formatted: string[] = [];
  for (const seg of link.context) {
    if (seg === "_embedded") continue;
    if (/^\d+$/.test(seg) && formatted.length > 0) {
      formatted[formatted.length - 1] = `${formatted[formatted.length - 1]}[${seg}]`;
    } else {
      formatted.push(seg);
    }
  }
  return formatted.length > 0 ? `${formatted.join(".")}.${link.rel}` : link.rel;
}
