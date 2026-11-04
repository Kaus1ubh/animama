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
import { getI18n, useTranslation } from "react-i18next";
import { RouteView } from "@/app/components/RouteView";
import type { AppRouterContext } from "@/app/router-context";
import { useRuntimeAdmission } from "@/app/runtime/RuntimeAdmissionProvider";
import {
  unavailableReasonText,
  unavailableRouteReason,
} from "@/app/runtime/route-admission";

function RootLayout() {
  const { t } = useTranslation("app");
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
          eyebrow={t("unavailable.eyebrow")}
          title={t("unavailable.title")}
          description={unavailableReasonText(reason, t)}
          actions={
            <Link to="/" className="action-link">
              {t("unavailable.returnHome")}
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
  const { t } = useTranslation("app");
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
      eyebrow={t("notFound.eyebrow")}
      title={reason ? t("unavailable.title") : t("notFound.title")}
      description={
        reason ? unavailableReasonText(reason, t) : t("notFound.description")
      }
      actions={
        <Link to="/" className="action-link">
          {t("unavailable.returnHome")}
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
  head: () => {
    // Worded when the route matches, in the active UI Locale.
    const t = getI18n().getFixedT(null, "app");
    return {
      meta: [
        { title: "Animama" },
        { name: "description", content: t("meta.description") },
      ],
    };
  },
  component: RootLayout,
  notFoundComponent: NotFoundView,
});
