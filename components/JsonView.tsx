"use client";

import { Fragment, useState, type ReactNode } from "react";
import {
  ChevronDown,
  ChevronRight,
  Braces,
  Brackets,
  Hash,
  Quote,
  ToggleLeft,
  Circle,
  ExternalLink,
} from "lucide-react";
import { CODE_SURFACE } from "@/lib/design";
import { cn } from "@/lib/utils";

// Both views render onto the same dark background (bg-slate-900/950) so the
// palette is light-on-dark in BOTH themes — this is intentional for code
// blocks, mirroring most JSON viewers.
const COLOR = {
  key: "text-sky-300",
  index: "text-slate-500",
  string: "text-emerald-300",
  number: "text-amber-300",
  boolean: "text-violet-300",
  null: "text-slate-500 italic",
  punct: "text-slate-400",
  meta: "text-slate-500",
  link: "text-amber-200 underline decoration-amber-400/50 underline-offset-2 hover:decoration-amber-300",
  linkTemplated: "text-amber-300/70 italic",
} as const;

// Resolver: given a JSON path + value, return a clickable URL (or null).
// Used to render HAL `href` strings as `<a>` tags inside the tree.
export type LinkResolver = (
  path: readonly string[],
  value: unknown,
) => string | null;

// Optional click interceptor: when set, clicking a link calls this
// instead of opening the URL. Cmd/ctrl/shift-click still falls back to the
// native href so users can escape to a new tab if they want. The `path`
// arg lets callers derive a label (e.g. HAL rel) from where the link
// lived in the tree.
export type LinkClickHandler = (
  url: string,
  path: readonly string[],
) => void;

// Predicate to flag a string leaf as a non-clickable link marker — used to
// style templated HAL hrefs in italic. Keeps JsonView agnostic of HAL.
export type TemplatedDetector = (
  path: readonly string[],
  value: string,
) => boolean;

// ---- Flat colored view ----

interface HighlightedProps {
  value: unknown;
  className?: string;
  linkResolver?: LinkResolver;
  onLinkClick?: LinkClickHandler;
  templatedDetector?: TemplatedDetector;
}

// Renders parsed JSON as syntax-highlighted, multi-line text.
// Non-JSON strings fall through to a plain rendering.
export function JsonHighlighted({
  value,
  className = "",
  linkResolver,
  onLinkClick,
  templatedDetector,
}: HighlightedProps) {
  return (
    <pre
      className={cn(
        CODE_SURFACE,
        "scrollbar-thin max-h-[60vh] overflow-auto p-3 text-xs leading-relaxed",
        className,
      )}
    >
      {renderHighlighted(value, 0, [], linkResolver, onLinkClick, templatedDetector)}
    </pre>
  );
}

function renderHighlighted(
  value: unknown,
  indent: number,
  path: readonly string[],
  linkResolver?: LinkResolver,
  onLinkClick?: LinkClickHandler,
  templatedDetector?: TemplatedDetector,
): ReactNode {
  const inner = "  ".repeat(indent + 1);
  const outer = "  ".repeat(indent);

  if (value === null) {
    return <span className={COLOR.null}>null</span>;
  }
  if (typeof value === "boolean") {
    return <span className={COLOR.boolean}>{String(value)}</span>;
  }
  if (typeof value === "number") {
    return <span className={COLOR.number}>{String(value)}</span>;
  }
  if (typeof value === "string") {
    const url = linkResolver?.(path, value) ?? null;
    if (url) {
      return (
        <HalAnchor
          url={url}
          text={JSON.stringify(value)}
          path={path}
          onLinkClick={onLinkClick}
        />
      );
    }
    if (templatedDetector?.(path, value)) {
      // Templated href — render with the "link" hue but italic and
      // non-interactive so the user can tell it needs filling in.
      return (
        <span className={COLOR.linkTemplated}>{JSON.stringify(value)}</span>
      );
    }
    return <span className={COLOR.string}>{JSON.stringify(value)}</span>;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className={COLOR.punct}>[]</span>;
    return (
      <>
        <span className={COLOR.punct}>[</span>
        {"\n"}
        {value.map((item, i) => (
          <Fragment key={i}>
            {inner}
            {renderHighlighted(
              item,
              indent + 1,
              [...path, String(i)],
              linkResolver,
              onLinkClick,
              templatedDetector,
            )}
            {i < value.length - 1 && <span className={COLOR.punct}>,</span>}
            {"\n"}
          </Fragment>
        ))}
        {outer}
        <span className={COLOR.punct}>]</span>
      </>
    );
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return <span className={COLOR.punct}>{"{}"}</span>;
    return (
      <>
        <span className={COLOR.punct}>{"{"}</span>
        {"\n"}
        {entries.map(([k, v], i) => (
          <Fragment key={k}>
            {inner}
            <span className={COLOR.key}>{JSON.stringify(k)}</span>
            <span className={COLOR.punct}>: </span>
            {renderHighlighted(
              v,
              indent + 1,
              [...path, k],
              linkResolver,
              onLinkClick,
              templatedDetector,
            )}
            {i < entries.length - 1 && <span className={COLOR.punct}>,</span>}
            {"\n"}
          </Fragment>
        ))}
        {outer}
        <span className={COLOR.punct}>{"}"}</span>
      </>
    );
  }
  return <span className={COLOR.null}>{String(value)}</span>;
}

// Shared anchor for clickable links. When `onLinkClick` is supplied, a
// plain left-click is intercepted (preventDefault + handler); cmd/ctrl/
// shift-click still falls through to the native href so the user can
// escape to a new tab when needed.
function HalAnchor({
  url,
  text,
  path,
  onLinkClick,
  extraClass,
}: {
  url: string;
  text: string;
  path: readonly string[];
  onLinkClick?: LinkClickHandler;
  extraClass?: string;
}) {
  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (!onLinkClick) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    onLinkClick(url, path);
  };
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer noopener"
      className={`${COLOR.link}${extraClass ? " " + extraClass : ""}`}
      title={onLinkClick ? `Suivre ${url}` : `Ouvrir ${url}`}
      onClick={handleClick}
    >
      {text}
      <ExternalLink size={10} className="ml-0.5 inline align-[-1px]" />
    </a>
  );
}

// ---- Foldable tree view ----
//
// Renders the value as a real tree: indent guides, chevrons, type icons,
// and *no JSON syntax* — no braces, brackets, quotes around keys, or
// colons. Keys are shown plainly; array entries are labelled "[0]", "[1]".

interface TreeProps {
  value: unknown;
  className?: string;
  // Levels open by default. Level 0 is the root's children.
  defaultOpenDepth?: number;
  linkResolver?: LinkResolver;
  onLinkClick?: LinkClickHandler;
  templatedDetector?: TemplatedDetector;
}

export function JsonTree({
  value,
  className = "",
  defaultOpenDepth = 2,
  linkResolver,
  onLinkClick,
  templatedDetector,
}: TreeProps) {
  const isObject = value !== null && typeof value === "object";

  return (
    <div
      className={cn(
        CODE_SURFACE,
        "scrollbar-thin max-h-[60vh] overflow-auto p-3 font-mono text-[12px] leading-6",
        className,
      )}
    >
      {!isObject ? (
        <LeafRow
          value={value}
          path={[]}
          linkResolver={linkResolver}
          onLinkClick={onLinkClick}
          templatedDetector={templatedDetector}
        />
      ) : (
        <BranchChildren
          value={value}
          depth={0}
          defaultOpenDepth={defaultOpenDepth}
          path={[]}
          linkResolver={linkResolver}
          onLinkClick={onLinkClick}
          templatedDetector={templatedDetector}
        />
      )}
    </div>
  );
}

// One row per primitive / branch. Leaves and branches share spacing so
// chevron-less rows still align with chevron rows in the same column.
function TreeNode({
  value,
  label,
  isIndex,
  depth,
  defaultOpenDepth,
  path,
  linkResolver,
  onLinkClick,
  templatedDetector,
}: {
  value: unknown;
  label: string;
  isIndex: boolean;
  depth: number;
  defaultOpenDepth: number;
  path: readonly string[];
  linkResolver?: LinkResolver;
  onLinkClick?: LinkClickHandler;
  templatedDetector?: TemplatedDetector;
}) {
  const isObject = value !== null && typeof value === "object";
  if (!isObject) {
    return (
      <LeafRow
        label={label}
        isIndex={isIndex}
        value={value}
        path={path}
        linkResolver={linkResolver}
        onLinkClick={onLinkClick}
        templatedDetector={templatedDetector}
      />
    );
  }
  return (
    <BranchRow
      value={value}
      label={label}
      isIndex={isIndex}
      depth={depth}
      defaultOpenDepth={defaultOpenDepth}
      path={path}
      linkResolver={linkResolver}
      onLinkClick={onLinkClick}
      templatedDetector={templatedDetector}
    />
  );
}

function LeafRow({
  label,
  isIndex,
  value,
  path,
  linkResolver,
  onLinkClick,
  templatedDetector,
}: {
  label?: string;
  isIndex?: boolean;
  value: unknown;
  path: readonly string[];
  linkResolver?: LinkResolver;
  onLinkClick?: LinkClickHandler;
  templatedDetector?: TemplatedDetector;
}) {
  const Icon = leafIcon(value);
  return (
    <div className="group flex items-center gap-2 rounded px-1 py-0.5 transition hover:bg-slate-800/40">
      {/* Chevron slot — kept empty so leaf rows align with branch rows */}
      <span className="inline-block w-3.5 shrink-0" aria-hidden />
      <Icon size={11} className="shrink-0 text-slate-500" aria-hidden />
      {label !== undefined && (
        <span className={isIndex ? COLOR.index : COLOR.key}>{label}</span>
      )}
      <PrimitiveValue
        value={value}
        path={path}
        linkResolver={linkResolver}
        onLinkClick={onLinkClick}
        templatedDetector={templatedDetector}
      />
    </div>
  );
}

function BranchRow({
  value,
  label,
  isIndex,
  depth,
  defaultOpenDepth,
  path,
  linkResolver,
  onLinkClick,
  templatedDetector,
}: {
  value: object;
  label?: string;
  isIndex?: boolean;
  depth: number;
  defaultOpenDepth: number;
  path: readonly string[];
  linkResolver?: LinkResolver;
  onLinkClick?: LinkClickHandler;
  templatedDetector?: TemplatedDetector;
}) {
  const isArray = Array.isArray(value);
  const count = isArray
    ? (value as unknown[]).length
    : Object.keys(value).length;
  const [open, setOpen] = useState(count > 0 && depth < defaultOpenDepth);

  // Empty branch — render flat, no chevron.
  if (count === 0) {
    const Icon = isArray ? Brackets : Braces;
    return (
      <div className="flex items-center gap-2 px-1 py-0.5">
        <span className="inline-block w-3.5 shrink-0" aria-hidden />
        <Icon size={11} className="shrink-0 text-slate-500" aria-hidden />
        {label !== undefined && (
          <span className={isIndex ? COLOR.index : COLOR.key}>{label}</span>
        )}
        <span className="text-[11px] italic text-slate-500">
          {isArray ? "tableau vide" : "objet vide"}
        </span>
      </div>
    );
  }

  const Icon = isArray ? Brackets : Braces;
  const meta = isArray
    ? `${count} élément${count > 1 ? "s" : ""}`
    : `${count} clé${count > 1 ? "s" : ""}`;

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="group flex w-full items-center gap-2 rounded px-1 py-0.5 text-left transition hover:bg-slate-800/40"
      >
        <span className="inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center text-slate-400 transition group-hover:text-slate-200">
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>
        <Icon
          size={11}
          className={`shrink-0 ${isArray ? "text-violet-400" : "text-sky-400"}`}
          aria-hidden
        />
        {label !== undefined && (
          <span className={isIndex ? COLOR.index : COLOR.key}>{label}</span>
        )}
        <span className="text-[10px] uppercase tracking-wider text-slate-500">
          {meta}
        </span>
      </button>
      {open && (
        <div className="ml-[7px] border-l border-dashed border-slate-700/60 pl-3">
          <BranchChildren
            value={value}
            depth={depth + 1}
            defaultOpenDepth={defaultOpenDepth}
            path={path}
            linkResolver={linkResolver}
            onLinkClick={onLinkClick}
            templatedDetector={templatedDetector}
          />
        </div>
      )}
    </div>
  );
}

function BranchChildren({
  value,
  depth,
  defaultOpenDepth,
  path,
  linkResolver,
  onLinkClick,
  templatedDetector,
}: {
  value: object;
  depth: number;
  defaultOpenDepth: number;
  path: readonly string[];
  linkResolver?: LinkResolver;
  onLinkClick?: LinkClickHandler;
  templatedDetector?: TemplatedDetector;
}) {
  const isArray = Array.isArray(value);
  const entries = isArray
    ? (value as unknown[]).map((v, i) => [String(i), v] as [string, unknown])
    : Object.entries(value as Record<string, unknown>);

  return (
    <>
      {entries.map(([k, v]) => (
        <TreeNode
          key={k}
          value={v}
          label={isArray ? `[${k}]` : k}
          isIndex={isArray}
          depth={depth}
          defaultOpenDepth={defaultOpenDepth}
          path={[...path, k]}
          linkResolver={linkResolver}
          onLinkClick={onLinkClick}
          templatedDetector={templatedDetector}
        />
      ))}
    </>
  );
}

function PrimitiveValue({
  value,
  path,
  linkResolver,
  onLinkClick,
  templatedDetector,
}: {
  value: unknown;
  path: readonly string[];
  linkResolver?: LinkResolver;
  onLinkClick?: LinkClickHandler;
  templatedDetector?: TemplatedDetector;
}) {
  if (value === null) return <span className={COLOR.null}>null</span>;
  if (typeof value === "boolean")
    return <span className={COLOR.boolean}>{String(value)}</span>;
  if (typeof value === "number")
    return <span className={COLOR.number}>{String(value)}</span>;
  if (typeof value === "string") {
    const url = linkResolver?.(path, value) ?? null;
    if (url) {
      return (
        <HalAnchor
          url={url}
          text={value}
          path={path}
          onLinkClick={onLinkClick}
          extraClass="break-all"
        />
      );
    }
    if (templatedDetector?.(path, value)) {
      return (
        <span className={`${COLOR.linkTemplated} break-all`}>{value}</span>
      );
    }
    return (
      <span className={`${COLOR.string} break-all`}>
        {value === "" ? (
          <span className="italic text-slate-500">(chaîne vide)</span>
        ) : (
          value
        )}
      </span>
    );
  }
  return <span className={COLOR.null}>{String(value)}</span>;
}

function leafIcon(value: unknown) {
  if (value === null) return Circle;
  if (typeof value === "boolean") return ToggleLeft;
  if (typeof value === "number") return Hash;
  if (typeof value === "string") return Quote;
  return Circle;
}

// ---- Helper ----

// Try to parse `body` as JSON when it's a string. Used by callers so that
// JSON-encoded text responses still get highlighted/structured rendering.
// Returns the parsed value, or the original `body` if parsing fails.
export function parseIfJsonString(body: unknown): unknown {
  if (typeof body !== "string") return body;
  const trimmed = body.trim();
  if (!trimmed) return body;
  if (!/^[{[]/.test(trimmed)) return body;
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}
