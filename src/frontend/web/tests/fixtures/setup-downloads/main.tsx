import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { LocalRuntimeProvider } from "@/app/local-runtime/LocalRuntimeProvider";
import { RuntimePlatformProvider } from "@/platform/RuntimePlatformProvider";
import { Route } from "@/routes/setup";
import type { FeaturePackStatus } from "../../../../shared/desktop-runtime";
import "@/index.css";

// Only native IPC is simulated. Runtime readiness, form, secure-key panel, model
// controls, queries and mutations use production code with intercepted HTTP.
const invoke = (method: string, args?: unknown) =>
  (
    window as unknown as {
      fixtureNative(method: string, args?: unknown): Promise<unknown>;
    }
  ).fixtureNative(method, args);
const listeners = new Set<(pack: FeaturePackStatus) => void>();
const emit = (pack: FeaturePackStatus) => {
  for (const listener of listeners) listener(pack);
};
Object.assign(window, {
  animamaDesktop: {
    version: 2,
    isDesktop: true,
    platform: "darwin",
    windowRole: "main",
    runtime: {
      onStatus: () => () => undefined,
      status: async () => ({ state: "ready", origin: window.location.origin }),
    },
    credentials: {
      list: () => invoke("credentials"),
      apply: (changes: unknown) => invoke("credentials.apply", changes),
    },
    featurePacks: {
      list: () => invoke("packs"),
      install: async (id: string) => {
        const pack = ((await invoke("packs")) as FeaturePackStatus[]).find(
          (item: FeaturePackStatus) => item.id === id,
        );
        emit({ ...pack, state: "downloading", progress: 0.1 });
        await invoke("install", id);
        emit(
          ((await invoke("packs")) as FeaturePackStatus[]).find(
            (item: FeaturePackStatus) => item.id === id,
          ),
        );
      },
      remove: (id: string) => invoke("remove", id),
      cancel: (id: string) => invoke("cancel", id),
      onProgress: (listener: (pack: FeaturePackStatus) => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
  },
});
const client = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});
const rootRoute = createRootRoute({ component: Outlet });
const setupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/setup",
  component: Route.options.component,
});
const completedRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/a",
  component: () => <p>Setup complete</p>,
});
const router = createRouter({
  routeTree: rootRoute.addChildren([setupRoute, completedRoute]),
  history: createMemoryHistory({ initialEntries: ["/setup"] }),
});
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={client}>
    <RuntimePlatformProvider>
      <LocalRuntimeProvider>
        <RouterProvider router={router} />
      </LocalRuntimeProvider>
    </RuntimePlatformProvider>
  </QueryClientProvider>,
);
