import type { ReactNode } from "react";
import { QueryClientProvider } from "@tanstack/react-query";

import { configureAnimaApiClient } from "@/lib/api/configureAnimaApiClient";
import { RuntimePlatformProvider } from "@/platform/RuntimePlatformProvider";
import { Toaster } from "@/ui/components/sonner";
import { ThemeProvider } from "@/ui/theme/theme-provider";
import { LocalRuntimeProvider } from "@web/app/local-runtime/LocalRuntimeProvider";
import { queryClient } from "@web/app/query-client";

configureAnimaApiClient();

type AppProvidersProps = {
  children: ReactNode;
};

export function AppProviders({ children }: AppProvidersProps) {
  return (
    <ThemeProvider>
      <RuntimePlatformProvider>
        <QueryClientProvider client={queryClient}>
          <LocalRuntimeProvider>
            {children}
            <Toaster />
          </LocalRuntimeProvider>
        </QueryClientProvider>
      </RuntimePlatformProvider>
    </ThemeProvider>
  );
}
