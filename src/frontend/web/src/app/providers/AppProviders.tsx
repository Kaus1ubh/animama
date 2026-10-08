import type { ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";

import { RuntimePlatformProvider } from "@/platform/RuntimePlatformProvider";
import { Toaster } from "@/ui/components/sonner";
import { ThemeProvider } from "@/ui/theme/theme-provider";
import {
  RuntimeAdmissionProvider,
  useRuntimeAdmission,
} from "../runtime/RuntimeAdmissionProvider";
import { RuntimeOwnerProvider } from "../runtime/RuntimeOwnerContext";
import type { RuntimeController } from "../runtime/runtime-controller";

type AppProvidersProps = {
  children: ReactNode;
  controller: RuntimeController;
};

export function AppProviders({ children, controller }: AppProvidersProps) {
  return (
    <ThemeProvider>
      <RuntimePlatformProvider>
        <RuntimeAdmissionProvider controller={controller}>
          <ApplicationSession>{children}</ApplicationSession>
        </RuntimeAdmissionProvider>
      </RuntimePlatformProvider>
    </ThemeProvider>
  );
}

function ApplicationSession({ children }: { children: ReactNode }) {
  const { admission, scope, queryClient, reconnecting } = useRuntimeAdmission();
  return (
    <QueryClientProvider client={queryClient}>
      {admission.status === "ready" && scope ? (
        <RuntimeOwnerProvider
          key={admission.session.key}
          ownerId={admission.session.owner.id}
          sessionKey={admission.session.key}
          capabilities={admission.capabilities}
          transport={{ baseUrl: scope.transport.baseUrl, fetch: scope.fetch }}
        >
          {reconnecting && (
            <div
              role="status"
              className="bg-background text-foreground border-b px-4 py-2 text-sm"
            >
              Reconnecting to Animama. Your draft is retained; requests are
              paused.
            </div>
          )}
          {children}
          <Toaster />
        </RuntimeOwnerProvider>
      ) : (
        children
      )}
    </QueryClientProvider>
  );
}
