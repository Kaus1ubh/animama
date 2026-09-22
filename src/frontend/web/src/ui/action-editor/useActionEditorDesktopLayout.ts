import { useCallback, useMemo, useSyncExternalStore } from "react";

/** Match the editor's Tailwind lg layout without mounting its hidden canvas. */
export function useActionEditorDesktopLayout(): boolean {
  const media = useMemo(
    () =>
      typeof window === "undefined"
        ? null
        : window.matchMedia("(min-width: 1024px)"),
    [],
  );
  const subscribe = useCallback(
    (onChange: () => void) => {
      media?.addEventListener("change", onChange);
      return () => media?.removeEventListener("change", onChange);
    },
    [media],
  );
  return useSyncExternalStore(
    subscribe,
    () => media?.matches ?? true,
    () => true,
  );
}
