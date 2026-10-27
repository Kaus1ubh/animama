import { useTranslation } from "react-i18next";

/** Intercept Vite's import failure before the router attempts an automatic reload. */
export function subscribeToAppFileErrors(
  target: EventTarget,
  onFailure: () => void,
): () => void {
  const handleFailure = (event: Event) => {
    event.preventDefault();
    onFailure();
  };
  target.addEventListener("vite:preloadError", handleFailure);
  return () => target.removeEventListener("vite:preloadError", handleFailure);
}

/** A stale chunk or failed route offers a user-controlled reload, never a loop. */
export function PageLoadError() {
  const { t } = useTranslation("app");
  return (
    <main className="bg-background text-foreground min-h-app mt-(--app-titlebar-height) flex items-center justify-center px-6">
      <section className="border-border bg-card max-w-md space-y-4 rounded-2xl border p-6 text-center">
        <h1 className="text-lg font-semibold">{t("pageLoadError.title")}</h1>
        <p className="text-muted-foreground text-sm">
          {t("pageLoadError.description")}
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm"
        >
          {t("pageLoadError.reload")}
        </button>
      </section>
    </main>
  );
}
