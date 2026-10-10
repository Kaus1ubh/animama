import type { LibrarySharingFlow } from "@/lib/content-sharing/types";
import { FileArchive } from "lucide-react";
import { Button } from "@/ui/components/button";
import {
  SharingAnimaDetails,
  SharingItemRow,
  SharingNonPortableItems,
  SharingRequiredItems,
} from "./SharingPackageDetails";
import { sharingSize } from "./sharingPresentation";

/** Review is a whole-package decision; resolved names are fixed by the server. */
export function ContentImportReview({ flow }: { flow: LibrarySharingFlow }) {
  const review = flow.importReview;
  if (!review) return <p role="status">Preparing your import review…</p>;
  const items = review.items.map((item) => ({
    id: item.entry_id,
    name: item.name,
    kind: item.kind,
    selected: item.selected,
    originalName: item.original_name,
  }));
  const renamed = items.some((item) => item.name !== item.originalName);
  return (
    <>
      <ol
        aria-label="Import progress"
        className="text-muted-foreground mx-auto flex items-center gap-4 text-sm"
      >
        <li>1 · Choose file</li>
        <li
          aria-current="step"
          className="bg-primary/15 text-foreground rounded-full px-3 py-1.5"
        >
          2 · Review
        </li>
      </ol>
      <div className="flex flex-wrap items-center gap-3 rounded-xl border p-4">
        <FileArchive
          aria-hidden="true"
          className="text-muted-foreground size-8 shrink-0"
        />
        <div className="min-w-0 flex-1">
          <p className="font-medium break-words">{review.filename}</p>
          <p className="text-muted-foreground mt-1 text-sm">
            {sharingSize(review.size_bytes)} · {review.selected_count} selected
            {review.required_count > 0
              ? ` · ${review.required_count} required ${review.required_count === 1 ? "dependency" : "dependencies"}`
              : null}
          </p>
        </div>
        {!flow.commitPending ? (
          <Button
            variant="ghost"
            onClick={flow.discardImport}
            disabled={flow.busy}
          >
            Change file
          </Button>
        ) : null}
      </div>
      <section className="space-y-3">
        <h3 className="text-lg font-semibold">
          {review.anima ? "Add a new Anima" : "Add to your Library"}
        </h3>
        {review.anima ? (
          <SharingAnimaDetails anima={review.anima} items={items} />
        ) : (
          <div className="divide-y rounded-xl border">
            {items
              .filter((item) => item.selected)
              .map((item) => (
                <SharingItemRow key={item.id} item={item}>
                  <span className="text-muted-foreground shrink-0 rounded-full border px-2 py-1 text-xs">
                    {item.name === item.originalName ? "New" : "Renamed"}
                  </span>
                </SharingItemRow>
              ))}
          </div>
        )}
        <SharingRequiredItems items={items.filter((item) => !item.selected)} />
        <SharingNonPortableItems items={review.non_portable ?? []} />
      </section>
      <p className="text-muted-foreground border-t pt-4 text-sm">
        {renamed
          ? "Some names already exist. The automatic names shown above keep every imported item separate."
          : "Every item is added as an independent copy. Existing content is kept."}
      </p>
      {flow.error && !flow.commitPending ? (
        <Button
          variant="outline"
          className="w-fit"
          disabled={flow.busy}
          onClick={flow.refreshImport}
        >
          Refresh review
        </Button>
      ) : null}
      <footer className="bg-popover sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-4 border-t py-4">
        <p className="text-muted-foreground max-w-xs text-sm">
          {review.anima
            ? "Creates a fresh companion with the reviewed content and configuration."
            : "Content is added to your Library. It won’t be equipped automatically."}
        </p>
        <div className="flex flex-wrap gap-2">
          {flow.commitPending ? (
            <Button onClick={flow.recover} disabled={flow.busy}>
              Check import status
            </Button>
          ) : (
            <>
              <Button
                onClick={flow.commitImport}
                disabled={flow.busy || Boolean(flow.error)}
              >
                {flow.busy
                  ? "Importing…"
                  : review.anima
                    ? "Import Anima"
                    : `Import ${review.selected_count} ${review.selected_count === 1 ? "item" : "items"}`}
              </Button>
            </>
          )}
        </div>
      </footer>
    </>
  );
}
