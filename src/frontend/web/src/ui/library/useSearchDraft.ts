"use client";

import { useEffect, useRef, useState } from "react";

const SEARCH_DEBOUNCE_MS = 300;

/**
 * Text for a Library search box whose committed value lives in the URL. The
 * URL keeps only the trimmed query, so the box keeps its own draft (spaces
 * included) and commits it after typing pauses; a URL change from elsewhere,
 * such as Back, replaces the draft.
 */
export function useSearchDraft(
  committed: string | undefined,
  commit: (query: string | undefined) => void,
) {
  const [draft, setDraft] = useState(committed ?? "");
  // The query this box last committed; null until it commits one.
  const ownCommit = useRef<string | null>(null);

  useEffect(() => {
    // The box's own commit arriving in the URL leaves the draft alone, keeping
    // a trailing space or anything typed while the navigation was applied.
    if ((committed ?? "") === ownCommit.current) return;
    ownCommit.current = null;
    setDraft((current) =>
      current.trim() === (committed ?? "") ? current : (committed ?? ""),
    );
  }, [committed]);

  useEffect(() => {
    const normalized = draft.trim();
    if (normalized === (committed ?? "")) return;
    const timeout = window.setTimeout(() => {
      ownCommit.current = normalized;
      commit(normalized || undefined);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timeout);
  }, [commit, committed, draft]);

  return [draft, setDraft] as const;
}
