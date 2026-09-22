import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import type { PyContentCatalog } from "@/lib/content/catalogTypes";
import { queryKeys } from "@/query/keys";
import { refreshContentCatalogViews } from "./contentCatalogInvalidation";

function catalog(revision: string, scannedAt = "2026-09-20T00:00:00Z") {
  return {
    scan_required: false,
    items: [
      {
        item_id: "one",
        revision_sha256: revision,
        status: "valid",
        scanned_at: scannedAt,
      },
    ],
  } as PyContentCatalog;
}

describe("detected content changes", () => {
  it("refreshes mounted Library rows and expires inactive Appearance views only for this owner", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: Infinity } },
    });
    const key = queryKeys.gestures.list("owner", "", "all");
    client.setQueryData(key, ["Old gesture"]);
    client.setQueryData(queryKeys.poses.list("owner"), ["Old pose"]);
    client.setQueryData(queryKeys.appearanceImages.list("owner"), [
      "Old portrait",
    ]);
    client.setQueryData(queryKeys.gestures.list("other", "", "all"), [
      "Other owner",
    ]);
    const observer = new QueryObserver(client, {
      queryKey: key,
      queryFn: async () => ["Updated gesture"],
    });
    const unsubscribe = observer.subscribe(() => {});
    await refreshContentCatalogViews(
      client,
      "owner",
      catalog("old"),
      catalog("new"),
    );
    expect(observer.getCurrentResult().data).toEqual(["Updated gesture"]);
    expect(
      client.getQueryState(queryKeys.poses.list("owner"))?.isInvalidated,
    ).toBe(true);
    expect(
      client.getQueryState(queryKeys.appearanceImages.list("owner"))
        ?.isInvalidated,
    ).toBe(true);
    expect(
      client.getQueryState(queryKeys.gestures.list("other", "", "all"))
        ?.isInvalidated,
    ).toBe(false);
    unsubscribe();
    client.clear();
  });

  it("ignores scan timestamps but refreshes additions, removal and validation changes", async () => {
    const client = new QueryClient();
    const key = queryKeys.avatarCatalog.list("owner", "", "all", "name");
    client.setQueryData(key, ["Avatar"]);
    await refreshContentCatalogViews(
      client,
      "owner",
      catalog("same"),
      catalog("same", "later"),
    );
    expect(client.getQueryState(key)?.isInvalidated).toBe(false);
    await refreshContentCatalogViews(client, "owner", catalog("same"), {
      scan_required: false,
      items: [],
    });
    expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    client.setQueryData(key, ["Avatar"]);
    const invalid = catalog("same");
    invalid.items[0]!.status = "invalid";
    await refreshContentCatalogViews(client, "owner", catalog("same"), invalid);
    expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    client.clear();
  });
});
