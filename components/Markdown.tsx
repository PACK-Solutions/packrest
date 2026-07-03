"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

interface Props {
  content?: string | null;
  className?: string;
  // When true, render without block-level wrappers — bold/code/em only,
  // suitable for a tag line shown next to a title. Multi-paragraph input
  // is flattened. Default false (full block rendering).
  inline?: boolean;
  // When true and the content has sections (level-2 headings or a second
  // level-1 heading), only the preamble is shown by default and the rest
  // is hidden behind a "Voir plus" toggle. No-op for `inline`.
  collapsible?: boolean;
  // When true, block text renders at the muted, extra-small "field hint" scale
  // instead of the default body scale — so an OpenAPI description used as a
  // form-field hint stays subtle rather than competing with the field label.
  dense?: boolean;
}

const blockComponents: Components = {
  p: ({ children }) => (
    <p className="text-foreground text-sm leading-relaxed [&:not(:last-child)]:mb-2">
      {children}
    </p>
  ),
  strong: ({ children }) => (
    <strong className="text-foreground font-semibold">{children}</strong>
  ),
  em: ({ children }) => <em className="italic">{children}</em>,
  code: ({ children, className }) => {
    const isBlock = className?.startsWith("language-");
    if (isBlock) {
      return (
        <code className="bg-muted text-foreground block overflow-x-auto rounded-md p-2 font-mono text-xs">
          {children}
        </code>
      );
    }
    return (
      <code className="bg-muted text-foreground rounded px-1 py-0.5 font-mono text-[0.85em]">
        {children}
      </code>
    );
  },
  pre: ({ children }) => (
    <pre className="bg-muted text-foreground my-2 overflow-x-auto rounded-md p-2 font-mono text-xs">
      {children}
    </pre>
  ),
  ul: ({ children }) => (
    <ul className="text-foreground my-2 ml-5 list-disc space-y-0.5 text-sm">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="text-foreground my-2 ml-5 list-decimal space-y-0.5 text-sm">
      {children}
    </ol>
  ),
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="text-primary underline underline-offset-2 hover:no-underline"
    >
      {children}
    </a>
  ),
  h1: ({ children }) => (
    <h3 className="text-foreground mt-3 mb-1 text-base font-semibold">
      {children}
    </h3>
  ),
  h2: ({ children }) => (
    <h4 className="text-foreground mt-3 mb-1 text-sm font-semibold">
      {children}
    </h4>
  ),
  h3: ({ children }) => (
    <h5 className="text-foreground mt-2 mb-1 text-sm font-semibold">
      {children}
    </h5>
  ),
  h4: ({ children }) => (
    <h6 className="text-foreground mt-2 mb-1 text-sm font-semibold">
      {children}
    </h6>
  ),
  blockquote: ({ children }) => (
    <blockquote className="text-muted-foreground border-border my-2 border-l-2 pl-3 text-sm italic">
      {children}
    </blockquote>
  ),
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto">
      <table className="border-border w-full border-collapse border text-xs">
        {children}
      </table>
    </div>
  ),
  th: ({ children }) => (
    <th className="bg-muted border-border border px-2 py-1 text-left font-semibold">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border-border border px-2 py-1">{children}</td>
  ),
  hr: () => <hr className="border-border my-3" />,
};

// Compact variant: same structure, smaller + muted text so a description
// rendered as a form-field hint reads as a subtle sub-label. Headings, lists
// and paragraphs all drop to text-xs / muted-foreground.
const denseComponents: Components = {
  ...blockComponents,
  p: ({ children }) => (
    <p className="text-muted-foreground text-xs leading-relaxed [&:not(:last-child)]:mb-1.5">
      {children}
    </p>
  ),
  ul: ({ children }) => (
    <ul className="text-muted-foreground my-1.5 ml-4 list-disc space-y-0.5 text-xs">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="text-muted-foreground my-1.5 ml-4 list-decimal space-y-0.5 text-xs">
      {children}
    </ol>
  ),
  h1: ({ children }) => (
    <h3 className="text-foreground mt-2 mb-0.5 text-xs font-semibold">
      {children}
    </h3>
  ),
  h2: ({ children }) => (
    <h4 className="text-foreground mt-2 mb-0.5 text-xs font-semibold">
      {children}
    </h4>
  ),
  h3: ({ children }) => (
    <h5 className="text-foreground mt-1.5 mb-0.5 text-xs font-semibold">
      {children}
    </h5>
  ),
  h4: ({ children }) => (
    <h6 className="text-foreground mt-1.5 mb-0.5 text-xs font-semibold">
      {children}
    </h6>
  ),
};

// Same component map, but block elements collapse to fragments so the
// output stays a single inline run. Bold/code/em/link still style.
const inlineComponents: Components = {
  ...blockComponents,
  p: ({ children }) => <>{children}</>,
  ul: ({ children }) => <>{children}</>,
  ol: ({ children }) => <>{children}</>,
  li: ({ children }) => <span>{children} </span>,
  h1: ({ children }) => <strong>{children}</strong>,
  h2: ({ children }) => <strong>{children}</strong>,
  h3: ({ children }) => <strong>{children}</strong>,
  h4: ({ children }) => <strong>{children}</strong>,
  blockquote: ({ children }) => <>{children}</>,
  pre: ({ children }) => <>{children}</>,
};

// Splits a Markdown block at its first "section boundary" so the overview
// can be shown by default while the rest is folded.
//
// Heuristic, in order:
//   1. First line starting with `## ` (level-2 heading) — most common
//      structure: `# Title \n intro... \n ## Section1 \n ...`
//   2. Otherwise, the *second* line starting with `# ` (level-1 heading) —
//      handles docs that use # for sections too.
//   3. Otherwise, no fold.
//
// Returns trimmed strings; `rest === null` means "nothing to fold".
function splitOverview(content: string): {
  overview: string;
  rest: string | null;
} {
  const lines = content.split("\n");
  // Pass 1: first sub-heading of any level (## … ######) — skip line 0, which
  // may be the doc's # title. Catching ### too lets catalogs that jump
  // straight to level-3 sections still fold.
  for (let i = 1; i < lines.length; i++) {
    if (/^#{2,6}\s/.test(lines[i])) {
      return {
        overview: lines.slice(0, i).join("\n").trim(),
        rest: lines.slice(i).join("\n").trim(),
      };
    }
  }
  // Pass 2: second # heading.
  let firstH1 = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^#\s/.test(lines[i])) {
      if (firstH1 === -1) {
        firstH1 = i;
      } else {
        return {
          overview: lines.slice(0, i).join("\n").trim(),
          rest: lines.slice(i).join("\n").trim(),
        };
      }
    }
  }
  return { overview: content, rest: null };
}

export default function Markdown({
  content,
  className,
  inline = false,
  collapsible = false,
  dense = false,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  if (!content) return null;
  const components = inline
    ? inlineComponents
    : dense
      ? denseComponents
      : blockComponents;
  const Wrapper = inline ? "span" : "div";

  if (!inline && collapsible) {
    const { overview, rest } = splitOverview(content);
    if (rest) {
      return (
        <Wrapper className={cn("space-y-2", className)}>
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
            {overview}
          </ReactMarkdown>
          {expanded && (
            <div className="space-y-1">
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
                {rest}
              </ReactMarkdown>
            </div>
          )}
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            className="text-primary hover:text-primary/80 inline-flex items-center gap-1 rounded text-xs font-medium underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {expanded ? (
              <>
                <ChevronUp className="size-3" /> Voir moins
              </>
            ) : (
              <>
                <ChevronDown className="size-3" /> Voir la doc complète
              </>
            )}
          </button>
        </Wrapper>
      );
    }
  }

  return (
    <Wrapper className={cn(inline ? "" : "space-y-1", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </Wrapper>
  );
}
