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
  return (
    <main className="bg-background text-foreground flex min-h-screen items-center justify-center px-6">
      <section className="border-border bg-card max-w-md space-y-4 rounded-2xl border p-6 text-center">
        <h1 className="text-lg font-semibold">The page could not load</h1>
        <p className="text-muted-foreground text-sm">
          Reload to get the current app files and try again. Unsaved changes on
          this page may be lost.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm"
        >
          Reload page
        </button>
      </section>
    </main>
  );
}
