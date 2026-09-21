import {
  HeadContent,
  Link,
  Outlet,
  ScrollRestoration,
  Scripts,
  createRootRouteWithContext,
} from "@tanstack/react-router";
import { RouteView } from "@web/app/components/RouteView";
import type { AppRouterContext } from "@web/app/router-context";

function RootLayout() {
  return (
    <>
      <HeadContent />
      <ScrollRestoration />
      <Outlet />
      <Scripts />
    </>
  );
}

function NotFoundView() {
  return (
    <RouteView
      eyebrow="Not found"
      title="This route has not been migrated."
      description="The root shell is in place, but this path does not map to one of the first migration placeholders."
      items={[
        "Keep the route URLs stable as features move over from Next.js.",
        "Add migrated routes under src/routes in small vertical slices.",
      ]}
      actions={
        <Link to="/" className="action-link">
          Return home
        </Link>
      }
    />
  );
}

export const Route = createRootRouteWithContext<AppRouterContext>()({
  head: () => ({
    meta: [
      { title: "Animama" },
      {
        name: "description",
        content: "Animama, your AI avatar companion.",
      },
    ],
  }),
  component: RootLayout,
  notFoundComponent: NotFoundView,
});
