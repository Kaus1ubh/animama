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
import "@/index.css";

// Only native IPC is simulated. Runtime readiness, form, secure-key panel, model
// controls, queries and mutations use production code with intercepted HTTP.
const invoke = (method: string, args?: unknown) =>
  (
    window as unknown as {
      fixtureNative(method: string, args?: unknown): Promise<unknown>;
    }
  ).fixtureNative(method, args);
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
    // Speech models install through backend model assets; the desktop's
    // remaining packs are not part of setup.
    featurePacks: {
      list: async () => [],
      install: async () => undefined,
      remove: async () => undefined,
      cancel: async () => undefined,
      onProgress: () => () => undefined,
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
  path: "/",
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
