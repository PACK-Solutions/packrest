// Request execution + result-view state for RequestBuilder. Owns the whole
// "what's shown in the response panel" state machine — response, error,
// running, uploading, and the HAL followStack — because they mutate together
// (run() resets the stack; HAL follow/back write error/running). Keeping them
// in one hook makes the data flow one-directional (this hook → useHalNavigation)
// and lets run() clear the stack without cross-hook setter passing.
//
// No "use client" directive: this module is only imported by the client-side
// RequestBuilder, so it inherits that boundary. (The directive would trip
// Next's RSC "serializable props" check on the callback params.)

import { useCallback, useRef, useState } from "react";
import { executeRequest, type ProxyResponse } from "@/lib/http";
import { recordCreatedId } from "@/lib/id-collector";
import { buildMultipart } from "@/lib/multipart";
import { isCustomEnvActive, type SavedHeader } from "@/lib/storage";
import type { OpenApiOperation, JsonSchema } from "@/lib/types";
import type { FollowEntry } from "./use-hal-navigation";

export function useRequestExecution(params: {
  method: string;
  composedUrl: string;
  isMultipart: boolean;
  bodySchema: JsonSchema | undefined;
  bodyValue: unknown;
  files: Record<string, File | null>;
  customHeaders: SavedHeader[];
  buildLiveHeaders: (customHeaders: SavedHeader[]) => Record<string, string>;
  apiId: string;
  operationId: string;
  operation: OpenApiOperation;
  path: string;
}) {
  // Operation's own response (set by run). The current displayed response is
  // either this or the top of `followStack` if non-empty.
  const [response, setResponse] = useState<ProxyResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  // True while a multipart request with at least one file is in flight. The
  // Tauri HTTP plugin can't report upload byte progress, so we show an
  // indeterminate bar rather than a fake percentage.
  const [uploading, setUploading] = useState(false);
  // HAL navigation: every "Suivre" pushes a {url, label, response} entry;
  // back/jump pops without re-fetching (each response is cached).
  const [followStack, setFollowStack] = useState<FollowEntry[]>([]);

  // run() reads many frequently-changing inputs (+ the current `running` flag);
  // hold them in latest-refs so the callback is referentially stable with `[]`
  // deps (the keyboard shortcut depends on it directly, replacing the old
  // runRef indirection).
  const latestRef = useRef(params);
  latestRef.current = params;
  const runningRef = useRef(running);
  runningRef.current = running;

  const run = useCallback(async () => {
    const p = latestRef.current;
    // Re-entrancy guard — the keyboard shortcut bypasses the button's
    // `disabled`, so hammering ⌘+Entrée must not double-run.
    if (runningRef.current) return;
    const wantsBody = !["GET", "HEAD"].includes(p.method.toUpperCase());
    const hasUpload =
      p.isMultipart && wantsBody && Object.values(p.files).some(Boolean);
    setRunning(true);
    setUploading(hasUpload);
    setError(null);
    setResponse(null);
    setFollowStack([]);
    try {
      const headers = p.buildLiveHeaders(p.customHeaders);
      const res = await executeRequest({
        method: p.method,
        url: p.composedUrl,
        headers,
        body:
          wantsBody && !p.isMultipart && p.bodySchema
            ? ((p.bodyValue ?? {}) as object)
            : undefined,
        multipart:
          p.isMultipart && wantsBody
            ? await buildMultipart(p.bodyValue, p.files)
            : undefined,
        custom: isCustomEnvActive(),
      });
      setResponse(res);
      // ID collector: a POST that created a resource returns its id in the JSON
      // body's `id` field. Capture it so it can be reused across APIs. The 2xx
      // guard skips the network-error case (status 0, non-object body).
      const bodyId =
        res.body && typeof res.body === "object" && !Array.isArray(res.body)
          ? (res.body as Record<string, unknown>).id
          : undefined;
      if (
        p.method.toUpperCase() === "POST" &&
        res.status >= 200 &&
        res.status < 300 &&
        (typeof bodyId === "string" || typeof bodyId === "number") &&
        String(bodyId).trim()
      ) {
        recordCreatedId({
          apiId: p.apiId,
          operationId: p.operationId,
          method: p.method,
          id: String(bodyId).trim(),
          label: p.operation.summary?.trim() || p.path,
        });
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
      setUploading(false);
    }
  }, []);

  // Derived result-view: when the follow stack is non-empty the user is "off"
  // the operation, so the shown response + the "effective" request (used by
  // curl / Bruno export / the response header) describe the followed GET.
  const isFollowing = followStack.length > 0;
  const top = isFollowing ? followStack[followStack.length - 1] : null;
  const currentResponse: ProxyResponse | null = top ? top.response : response;
  const effective = {
    url: top ? top.url : params.composedUrl,
    method: top ? "GET" : params.method,
    body: top ? undefined : params.bodyValue,
    defaultName: top
      ? `GET ${top.label}`
      : `${params.method.toUpperCase()} ${params.path}`,
  };

  return {
    response,
    error,
    running,
    uploading,
    followStack,
    isFollowing,
    currentResponse,
    effective,
    run,
    setFollowStack,
    setRunning,
    setError,
  };
}
