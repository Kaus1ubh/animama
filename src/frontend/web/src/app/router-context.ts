import type { QueryClient } from "@tanstack/react-query";

import { queryClient } from "@web/app/query-client";

export type AppRouterContext = {
  queryClient: QueryClient;
};

export const defaultRouterContext: AppRouterContext = {
  queryClient,
};
