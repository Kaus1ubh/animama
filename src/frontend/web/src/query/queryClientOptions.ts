import type { DefaultOptions } from "@tanstack/react-query";

export const queryClientOptions: DefaultOptions = {
  queries: {
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  },
};
