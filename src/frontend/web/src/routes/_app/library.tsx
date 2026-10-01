import { createFileRoute, useNavigate } from "@tanstack/react-router";

import {
  compactContentLibrarySearch,
  normalizeContentLibrarySearch,
  shouldReplaceContentLibrarySearch,
  type ContentLibrarySearch,
  type ContentLibraryUrlSearch,
} from "@/lib/content/librarySearch";
import { LibraryPage } from "@/ui/library/LibraryPage";

export const Route = createFileRoute("/_app/library")({
  validateSearch: (search): ContentLibraryUrlSearch =>
    compactContentLibrarySearch(search),
  component: LibraryRoute,
});

function LibraryRoute() {
  const urlSearch = Route.useSearch();
  const search: ContentLibrarySearch = normalizeContentLibrarySearch(urlSearch);
  const navigate = useNavigate({ from: "/library" });
  return (
    <LibraryPage
      search={search}
      onSearchChange={(update) => {
        void navigate({
          replace: shouldReplaceContentLibrarySearch(update),
          search: (current) =>
            compactContentLibrarySearch({
              ...normalizeContentLibrarySearch(current),
              ...update,
            }),
        });
      }}
    />
  );
}
