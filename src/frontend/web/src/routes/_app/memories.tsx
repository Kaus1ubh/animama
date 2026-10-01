import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";

import {
  normalizeMemorySearch,
  type MemoryLibrarySearch,
} from "@/lib/memory-entries/library-search";
import {
  MemoryLibraryPage,
  type MemoryLibraryNavigationOptions,
} from "@/ui/memory/MemoryLibraryPage";

export const Route = createFileRoute("/_app/memories")({
  validateSearch: (search): MemoryLibrarySearch => {
    return normalizeMemorySearch(search);
  },
  beforeLoad: ({ search }) => {
    if (search.tab !== "uploads") return;
    throw redirect({
      to: "/library",
      search: { section: "chat-uploads" },
      replace: true,
    });
  },
  component: MemoriesRoute,
});

function MemoriesRoute() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/memories" });

  return (
    <MemoryLibraryPage
      search={search}
      onSearchChange={(next, options?: MemoryLibraryNavigationOptions) => {
        void navigate({
          replace: options?.replace ?? true,
          search: (current) => normalizeMemorySearch({ ...current, ...next }),
        });
      }}
    />
  );
}
