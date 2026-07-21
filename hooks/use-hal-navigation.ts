// HAL `_links` navigation for RequestBuilder. Stateless behavior hook: the
// follow stack itself lives in useRequestExecution (run() clears it, so the
// result-view state is one machine), and this hook mutates it via functional
// updates — so it never needs the stack *value*, keeping hook composition
// acyclic. Owns the FollowEntry type (imported by useRequestExecution + the
// component) and the follow-fetch + slice logic.

import { useCallback, useRef } from "react";
import { executeRequest, type ProxyResponse } from "@/lib/http";
import { isCustomEnvActive, type SavedHeader } from "@/lib/storage";

// One entry per HAL follow. Responses are cached so Précédent / breadcrumb
// jumps don't re-fetch (avoids spamming the gateway when navigating back).
export interface FollowEntry {
  url: string;
  label: string;
  response: ProxyResponse;
}

export function useHalNavigation(params: {
  buildLiveHeaders: (customHeaders: SavedHeader[]) => Record<string, string>;
  customHeaders: SavedHeader[];
  setFollowStack: React.Dispatch<React.SetStateAction<FollowEntry[]>>;
  setRunning: React.Dispatch<React.SetStateAction<boolean>>;
  setError: React.Dispatch<React.SetStateAction<string | null>>;
}) {
  const { buildLiveHeaders, customHeaders, setFollowStack, setRunning, setError } =
    params;

  // followLink reads customHeaders (+ buildLiveHeaders) at call time; keep them
  // in a latest-ref so the callback stays referentially stable across renders.
  const latestRef = useRef({ buildLiveHeaders, customHeaders });
  latestRef.current = { buildLiveHeaders, customHeaders };

  // Follow a HAL link in-app: fire a GET via the proxy with the current
  // Authorization header. On success, push the result onto followStack
  // (which becomes the displayed response). On error, leave the stack
  // untouched so the user stays on the previous valid view.
  const followLink = useCallback(
    async (url: string, label: string) => {
      setRunning(true);
      setError(null);
      try {
        const { buildLiveHeaders, customHeaders } = latestRef.current;
        const res = await executeRequest({
          method: "GET",
          url,
          headers: buildLiveHeaders(customHeaders),
          body: undefined,
          custom: isCustomEnvActive(),
        });
        setFollowStack((s) => [...s, { url, label, response: res }]);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setRunning(false);
      }
    },
    [setFollowStack, setRunning, setError],
  );

  // Pop the top of the stack — caches mean no re-fetch. Clears any error
  // so the previous response shows cleanly.
  const navBack = useCallback(() => {
    setError(null);
    setFollowStack((s) => s.slice(0, -1));
  }, [setFollowStack, setError]);

  // Truncate the stack so segment `index` becomes the top — used by the
  // breadcrumb when the user clicks an earlier rel.
  const navJumpTo = useCallback(
    (index: number) => {
      setError(null);
      setFollowStack((s) => s.slice(0, index + 1));
    },
    [setFollowStack, setError],
  );

  // Clear the entire follow stack — back to the operation's own response.
  const navToOperation = useCallback(() => {
    setError(null);
    setFollowStack([]);
  }, [setFollowStack, setError]);

  return { followLink, navBack, navJumpTo, navToOperation };
}
