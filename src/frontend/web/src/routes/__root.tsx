import {
  HeadContent,
  Link,
  Outlet,
  ScrollRestoration,
  Scripts,
  createRootRouteWithContext,
  useRouterState,
  notFound,
} from "@tanstack/react-router";
import { RouteView } from "@web/app/components/RouteView";
import type { AppRouterContext } from "@web/app/router-context";
import { useRuntimeAdmission } from "@web/app/runtime/RuntimeAdmissionProvider";
import { unavailableRouteReason } from "@web/app/runtime/route-admission";

function RootLayout() {
  const { admission } = useRuntimeAdmission();
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const reason =
    admission.status === "ready"
      ? unavailableRouteReason(pathname, admission.capabilities)
      : null;
  return (
    <>
      <HeadContent />
      <ScrollRestoration />
      {reason ? (
        <RouteView
          eyebrow="Unavailable"
          title="Unavailable here"
          description={reason}
          actions={
            <Link to="/" className="action-link">
              Return home
            </Link>
          }
        />
      ) : (
        <Outlet />
      )}
      <Scripts />
    </>
  );
}

function NotFoundView() {
  const { admission } = useRuntimeAdmission();
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const reason =
    admission.status === "ready"
      ? unavailableRouteReason(pathname, admission.capabilities)
      : null;
  return (
    <RouteView
      eyebrow="Not found"
      title={reason ? "Unavailable here" : "Page not found"}
      description={reason ?? "This address does not lead to an Animama page."}
      actions={
        <Link to="/" className="action-link">
          Return home
        </Link>
      }
    />
  );
}

export const Route = createRootRouteWithContext<AppRouterContext>()({
  beforeLoad: ({ context, location }) => {
    // Stop child admission (including local desktop redirects) before feature work starts.
    if (
      context.capabilities &&
      unavailableRouteReason(location.pathname, context.capabilities)
    )
      throw notFound({ routeId: "__root__" });
  },
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
