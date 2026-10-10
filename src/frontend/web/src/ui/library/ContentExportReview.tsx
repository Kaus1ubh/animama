import type { LibrarySharingFlow } from "@/lib/content-sharing/types";
import { Button } from "@/ui/components/button";
import {
  SharingAnimaDetails,
  SharingItemRow,
  SharingNonPortableItems,
  SharingRequiredItems,
} from "./SharingPackageDetails";
import { sharingSize } from "./sharingPresentation";

/** Only the prepared immutable manifest is shown at the final download step. */
export function ContentExportReview({ flow }: { flow: LibrarySharingFlow }) {
  const review = flow.exportReview;
  if (!review) return <p role="status">Preparing your package…</p>;
  const roots = new Set(review.manifest.root_entry_ids ?? []);
  const items = review.manifest.entries.map((item) => ({
    id: item.package_entry_id,
    name: item.display_name,
    kind: item.kind,
    selected: roots.has(item.package_entry_id),
  }));
  return (
    <>
      {review.manifest.anima ? (
        <>
          <SharingAnimaDetails anima={review.manifest.anima} items={items} />
          <SharingRequiredItems items={items} />
        </>
      ) : (
        <section className="space-y-3">
          <h3 className="text-lg font-semibold">Your package</h3>
          <p className="text-muted-foreground">
            {review.selected_count} selected{" "}
            {review.selected_count === 1 ? "item" : "items"}
            {review.required_count > 0
              ? ` · ${review.required_count} required ${review.required_count === 1 ? "dependency" : "dependencies"}`
              : null}
          </p>
          <div className="divide-y rounded-xl border">
            {items
              .filter((item) => item.selected)
              .map((item) => (
                <SharingItemRow key={item.id} item={item} />
              ))}
          </div>
          <SharingRequiredItems
            items={items.filter((item) => !item.selected)}
          />
        </section>
      )}
      <SharingNonPortableItems
        items={(review.manifest.non_portable_references ?? []).map(
          (reference) => ({
            name: reference.display_name,
            kind: reference.kind,
          }),
        )}
      />
      {flow.downloadStarted && !flow.notice ? (
        <p role="status" className="bg-muted rounded-xl p-4">
          Download started. Check your browser’s downloads for the file.
        </p>
      ) : null}
      {flow.error ? (
        <Button
          variant="outline"
          onClick={flow.back}
          disabled={flow.busy}
          className="w-fit"
        >
          Return to selection
        </Button>
      ) : null}
      <footer className="bg-popover sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-4 border-t py-4">
        <p className="min-w-0 text-sm">
          <span className="block font-medium break-words">
            {review.filename}
          </span>
          <span className="text-muted-foreground">
            {sharingSize(review.size_bytes)}
          </span>
        </p>
        <div className="flex gap-2">
          <Button
            disabled={flow.busy || Boolean(flow.error)}
            onClick={flow.download}
          >
            {review.manifest.anima ? "Export Anima" : "Download package"}
          </Button>
        </div>
      </footer>
    </>
  );
}
