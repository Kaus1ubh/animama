import { useTranslation } from "react-i18next";
import { useFormatters } from "@animama/product-ui/i18n";
import type { LibrarySharingFlow } from "@/lib/content-sharing/types";
import { Button } from "@/ui/components/button";
import {
  SharingAnimaDetails,
  SharingItemRow,
  SharingNonPortableItems,
  SharingRequiredItems,
} from "./SharingPackageDetails";

/** Only the prepared immutable manifest is shown at the final download step. */
export function ContentExportReview({ flow }: { flow: LibrarySharingFlow }) {
  const { t } = useTranslation("library");
  const formatters = useFormatters();
  const review = flow.exportReview;
  if (!review)
    return <p role="status">{t("sharing.export.preparingPackage")}</p>;
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
          <h3 className="text-lg font-semibold">{t("sharing.yourPackage")}</h3>
          <p className="text-muted-foreground">
            {[
              t("sharing.selectedItems", { count: review.selected_count }),
              review.required_count > 0
                ? t("sharing.requiredDependencies", {
                    count: review.required_count,
                  })
                : null,
            ]
              .filter(Boolean)
              .join(" · ")}
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
          {t("sharing.export.downloadStarted")}
        </p>
      ) : null}
      {flow.error ? (
        <Button
          variant="outline"
          onClick={flow.back}
          disabled={flow.busy}
          className="w-fit"
        >
          {t("sharing.export.returnToSelection")}
        </Button>
      ) : null}
      <footer className="bg-popover sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-4 border-t py-4">
        <p className="min-w-0 text-sm">
          <span className="block font-medium break-words">
            {review.filename}
          </span>
          <span className="text-muted-foreground">
            {formatters.fileSize(review.size_bytes)}
          </span>
        </p>
        <div className="flex gap-2">
          <Button
            disabled={flow.busy || Boolean(flow.error)}
            onClick={flow.download}
          >
            {review.manifest.anima
              ? t("sharing.export.exportAnima")
              : t("sharing.export.download")}
          </Button>
        </div>
      </footer>
    </>
  );
}
