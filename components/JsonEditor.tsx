"use client";

import { useEffect, useMemo, useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

interface Props {
  value: unknown;
  onChange: (next: unknown) => void;
  rows?: number;
  className?: string;
}

// Plain textarea backed by JSON.parse. Validates on every keystroke and
// only propagates the parsed object upward when the JSON is well-formed —
// the textarea content stays editable while broken so the user can fix it.
export default function JsonEditor({
  value,
  onChange,
  rows = 12,
  className = "",
}: Props) {
  const serialized = useMemo(() => {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return "";
    }
  }, [value]);
  const [text, setText] = useState(serialized);
  const [error, setError] = useState<string | null>(null);

  // Sync external value into the textarea when it changes from outside
  // (e.g. example switch). Skip sync while user is typing valid JSON.
  useEffect(() => {
    setText(serialized);
    setError(null);
  }, [serialized]);

  const handle = (raw: string) => {
    setText(raw);
    if (raw.trim() === "") {
      setError(null);
      onChange(null);
      return;
    }
    try {
      const parsed = JSON.parse(raw);
      setError(null);
      onChange(parsed);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <div className={className}>
      <Textarea
        value={text}
        onChange={(e) => handle(e.target.value)}
        rows={rows}
        spellCheck={false}
        aria-invalid={error ? true : undefined}
        className={cn(
          "font-mono text-xs leading-relaxed shadow-inner",
          error && "border-destructive",
        )}
      />
      {error && (
        <p className="text-destructive mt-1 text-[11px]">
          JSON invalide&nbsp;: {error}
        </p>
      )}
    </div>
  );
}
