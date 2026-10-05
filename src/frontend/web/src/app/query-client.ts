import { QueryClient } from "@tanstack/react-query";

import { queryClientOptions } from "@/query/queryClientOptions";

export function createAppQueryClient() {
  return new QueryClient({ defaultOptions: queryClientOptions });
}
