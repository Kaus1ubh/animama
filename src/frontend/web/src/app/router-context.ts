import type { QueryClient } from "@tanstack/react-query";
import type { RuntimeCapabilities } from "@animama/runtime-contracts";

export type AppRouterContext = {
  queryClient: QueryClient;
  capabilities?: RuntimeCapabilities;
};
