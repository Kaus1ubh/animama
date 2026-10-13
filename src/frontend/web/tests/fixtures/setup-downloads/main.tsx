import { createRoot } from "react-dom/client";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from "@tanstack/react-router";
import { AppProviders } from "@/app/providers/AppProviders";
import { createLocalComposition } from "@/app/local-runtime/local-composition";
import { RuntimeController } from "@/app/runtime/runtime-controller";
import { useRuntimeAdmission } from "@/app/runtime/RuntimeAdmissionProvider";
import { Route } from "@/routes/setup";
import { FirstRunAgeConfirmation } from "@/app/local-runtime/setup/FirstRunAgeConfirmation";
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
const controller = new RuntimeController(createLocalComposition());
const rootRoute = createRootRoute({ component: Outlet });
const setupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/setup",
  component: Route.options.component,
});
function Completion() {
  const { admission } = useRuntimeAdmission();
  return admission.status === "ready" && admission.onboardingRequired ? (
    <FirstRunAgeConfirmation />
  ) : (
    <p>Setup complete</p>
  );
}
const completedRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: Completion,
});
const animaRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/$animaId",
  component: Completion,
});
const router = createRouter({
  routeTree: rootRoute.addChildren([setupRoute, completedRoute, animaRoute]),
  history: createMemoryHistory({ initialEntries: ["/setup"] }),
});
function FixtureRouter() {
  const { admission } = useRuntimeAdmission();
  return admission.status === "ready" ? (
    <RouterProvider router={router} />
  ) : (
    <p>Preparing local runtime</p>
  );
}
createRoot(document.getElementById("root")!).render(
  <AppProviders controller={controller}>
    <FixtureRouter />
  </AppProviders>,
);
