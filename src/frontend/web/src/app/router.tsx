import { createRouter, RouterProvider } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { useLocalRuntime } from "@web/app/local-runtime/LocalRuntimeProvider";
import { localRuntimeShellView } from "@web/app/local-runtime/runtime-shell";
import { defaultRouterContext } from "@web/app/router-context";
import { useRuntimePlatform } from "@/platform/RuntimePlatformProvider";
import { routeTree } from "@web/routeTree.gen";
import {
  PageLoadError,
  subscribeToAppFileErrors,
} from "@/ui/app/PageLoadError";

const router = createRouter({
  routeTree,
  context: defaultRouterContext,
  defaultPreload: "intent",
  scrollRestoration: true,
  defaultErrorComponent: PageLoadError,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

export function AppRouter() {
  const [appFileError, setAppFileError] = useState(false);
  useEffect(
    () => subscribeToAppFileErrors(window, () => setAppFileError(true)),
    [],
  );
  const { state, retry } = useLocalRuntime();
  const platform = useRuntimePlatform();
  const queryClient = useQueryClient();
  const isDesktopAuxiliaryWindow =
    platform.kind === "desktop" &&
    (platform.desktopBridge.windowRole === "pip" ||
      platform.desktopBridge.windowRole === "quick-chat");
  const shellView = localRuntimeShellView(
    state.status,
    isDesktopAuxiliaryWindow,
  );

  if (appFileError) return <PageLoadError />;

  if (shellView === "auxiliary-wait") {
    return <div className="h-screen w-screen bg-transparent" />;
  }

  if (shellView === "main-loading") {
    return (
      <main className="bg-background text-muted-foreground flex min-h-screen items-center justify-center px-6 text-sm">
        Preparing Animama…
      </main>
    );
  }

  if (shellView === "main-error" && state.status === "recoverable-error") {
    return (
      <main className="bg-background text-foreground flex min-h-screen items-center justify-center px-6">
        <section className="border-border bg-card max-w-md space-y-4 rounded-2xl border p-6 text-center shadow-sm">
          <h1 className="text-lg font-semibold">Local runtime unavailable</h1>
          <p className="text-muted-foreground text-sm">{state.message}</p>
          <button
            type="button"
            onClick={retry}
            className="bg-primary text-primary-foreground hover:bg-primary/90 rounded-md px-4 py-2 text-sm font-medium"
          >
            Try again
          </button>
        </section>
      </main>
    );
  }

  return (
    <RouterProvider
      router={router}
      context={{
        queryClient,
      }}
    />
  );
}
