import { QueryClient } from "@tanstack/react-query";

import { queryClientOptions } from "@/query/queryClientOptions";

export const queryClient = new QueryClient({
  defaultOptions: queryClientOptions,
});
