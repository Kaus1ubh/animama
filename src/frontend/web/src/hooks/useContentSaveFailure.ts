import { useCallback, useState } from "react";

import {
  ContentSaveApiError,
  toContentSaveApiError,
} from "@/lib/content/contentSaveErrors";

/** Keep one creator's actionable save message and control target in sync. */
export function useContentSaveFailure() {
  const [failure, setFailure] = useState<ContentSaveApiError | null>(null);

  const capture = useCallback((cause: unknown) => {
    const normalized = toContentSaveApiError(cause);
    setFailure(normalized);
    return normalized;
  }, []);

  const setMessage = useCallback(
    (message: string, field: string | null = null) => {
      setFailure(new ContentSaveApiError(null, null, message, null, {}, field));
    },
    [],
  );

  const clear = useCallback(() => setFailure(null), []);
  const clearField = useCallback(
    (field: string) =>
      setFailure((current) => (current?.field === field ? null : current)),
    [],
  );

  return {
    capture,
    clear,
    clearField,
    error: failure?.message ?? null,
    errorField: failure?.field ?? null,
    setMessage,
  };
}
