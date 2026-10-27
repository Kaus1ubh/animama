import { useTranslation } from "react-i18next";
import { useFormatters } from "@animama/product-ui/i18n";
import type { LibrarySharingFlow } from "@/lib/content-sharing/types";
import { FileArchive } from "lucide-react";
import { Button } from "@/ui/components/button";
import {
  SharingAnimaDetails,
  SharingItemRow,
  SharingNonPortableItems,
  SharingRequiredItems,
} from "./SharingPackageDetails";

/** Review is a whole-package decision; resolved names are fixed by the server. */
export function ContentImportReview({ flow }: { flow: LibrarySharingFlow }) {
  const { t } = useTranslation("library");
  const formatters = useFormatters();
  const review = flow.importReview;
  if (!review)
    return <p role="status">{t("sharing.import.preparingReview")}</p>;
  const items = review.items.map((item) => ({
    id: item.entry_id,
    name: item.name,
    kind: item.kind,
    selected: item.selected,
    originalName: item.original_name,
  }));
  const renamed = items.some((item) => item.name !== item.originalName);
  // Avatars whose packaged wind or material setting this app cannot keep.
  const settingsNotStored = review.items
    .filter((item) => item.notices?.includes("avatar_setting_not_stored"))
    .map((item) => item.name);
  return (
    <>
      <ol
        aria-label={t("sharing.import.progress")}
        className="text-muted-foreground mx-auto flex items-center gap-4 text-sm"
      >
        <li>{t("sharing.import.steps.choose")}</li>
        <li
          aria-current="step"
          className="bg-primary/15 text-foreground rounded-full px-3 py-1.5"
        >
          {t("sharing.import.steps.review")}
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
            {[
              formatters.fileSize(review.size_bytes),
              t("sharing.import.selectedCount", {
                count: review.selected_count,
              }),
              review.required_count > 0
                ? t("sharing.requiredDependencies", {
                    count: review.required_count,
                  })
                : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        {!flow.commitPending ? (
          <Button
            variant="ghost"
            onClick={flow.discardImport}
            disabled={flow.busy}
          >
            {t("sharing.import.changeFile")}
          </Button>
        ) : null}
      </div>
      <section className="space-y-3">
        <h3 className="text-lg font-semibold">
          {review.anima
            ? t("sharing.import.addAnima")
            : t("sharing.import.addToLibrary")}
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
                    {item.name === item.originalName
                      ? t("sharing.import.new")
                      : t("sharing.import.renamed")}
                  </span>
                </SharingItemRow>
              ))}
          </div>
        )}
        <SharingRequiredItems items={items.filter((item) => !item.selected)} />
        <SharingNonPortableItems items={review.non_portable ?? []} />
        {settingsNotStored.length > 0 ? (
          <p className="border-warning/30 bg-warning/10 rounded-xl border p-4 text-sm">
            {t("sharing.import.avatarSettingsNotStored", {
              names: formatters.list(settingsNotStored),
            })}
          </p>
        ) : null}
      </section>
      <p className="text-muted-foreground border-t pt-4 text-sm">
        {renamed
          ? t("sharing.import.renamedNote")
          : t("sharing.import.copiesNote")}
      </p>
      {flow.error && !flow.commitPending ? (
        <Button
          variant="outline"
          className="w-fit"
          disabled={flow.busy}
          onClick={flow.refreshImport}
        >
          {t("sharing.import.refreshReview")}
        </Button>
      ) : null}
      <footer className="bg-popover sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-4 border-t py-4">
        <p className="text-muted-foreground max-w-xs text-sm">
          {review.anima
            ? t("sharing.import.animaNote")
            : t("sharing.import.contentNote")}
        </p>
        <div className="flex flex-wrap gap-2">
          {flow.commitPending ? (
            <Button onClick={flow.recover} disabled={flow.busy}>
              {t("sharing.import.checkStatus")}
            </Button>
          ) : (
            <>
              <Button
                onClick={flow.commitImport}
                disabled={flow.busy || Boolean(flow.error)}
              >
                {flow.busy
                  ? t("sharing.import.importing")
                  : review.anima
                    ? t("sharing.import.importAnima")
                    : t("sharing.import.importItems", {
                        count: review.selected_count,
                      })}
              </Button>
            </>
          )}
        </div>
      </footer>
    </>
  );
}
