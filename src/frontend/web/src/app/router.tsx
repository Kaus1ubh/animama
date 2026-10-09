import { createRouter, RouterProvider } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import { useRuntimeAdmission } from "./runtime/RuntimeAdmissionProvider";
import type { AppRouterContext } from "./router-context";
import { AdmissionScreen } from "./runtime/AdmissionScreen";
import { useRuntimePlatform } from "@/platform/RuntimePlatformProvider";
import { routeTree } from "@web/routeTree.gen";
import {
  PageLoadError,
  subscribeToAppFileErrors,
} from "@/ui/app/PageLoadError";

export function createAppRouter(context: AppRouterContext) {
  return createRouter({
    routeTree,
    context,
    defaultPreload: "intent",
    scrollRestoration: true,
    defaultErrorComponent: PageLoadError,
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}

export function AppRouter() {
  const [appFileError, setAppFileError] = useState(false);
  useEffect(
    () => subscribeToAppFileErrors(window, () => setAppFileError(true)),
    [],
  );
  const { admission, controller, composition, account } = useRuntimeAdmission();
  const platform = useRuntimePlatform();
  const queryClient = useQueryClient();
  const capabilities =
    admission.status === "ready" ? admission.capabilities : undefined;
  const router = useMemo(() => createAppRouter({ queryClient }), [queryClient]);
  const isDesktopAuxiliaryWindow =
    platform.kind === "desktop" &&
    (platform.desktopBridge.windowRole === "pip" ||
      platform.desktopBridge.windowRole === "quick-chat");
  if (appFileError) return <PageLoadError />;
  if (admission.status !== "ready") {
    if (isDesktopAuxiliaryWindow)
      return <div className="h-screen w-screen bg-transparent" />;
    return (
      <AdmissionScreen
        admission={admission}
        hosted={composition.kind === "hosted"}
        signOutIncomplete={account.signOutIncomplete}
        retry={() => {
          // An unfinished sign-out is retried, never replaced by readmission.
          void (account.signOutIncomplete
            ? controller.signOut()
            : controller.refresh(admission.status === "recovery"));
        }}
        signIn={composition.accountActions?.signIn}
        openAccount={
          account.canOpenAccount
            ? composition.accountActions?.openAccount
            : undefined
        }
        signOut={
          composition.accountActions
            ? () => {
                void controller.signOut();
              }
            : undefined
        }
      />
    );
  }

  return (
    <RouterProvider
      router={router}
      context={{
        queryClient,
        capabilities,
      }}
    />
  );
}
