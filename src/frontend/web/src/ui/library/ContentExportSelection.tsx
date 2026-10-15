import { useState } from "react";
import { Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useFormatters } from "@animama/product-ui/i18n";
import { isNonPortable, nonPortableReason } from "@/lib/content/portability";
import type { LibrarySharingFlow } from "@/lib/content-sharing/types";
import { Button } from "@/ui/components/button";
import { Input } from "@/ui/components/input";
import { Checkbox } from "@/ui/components/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/components/tabs";
import {
  SharingAnimaDetails,
  SharingPrivacyNote,
  SharingItemIcon,
  SharingItemRow,
  SharingRequiredItems,
} from "./SharingPackageDetails";
import { sharingKindLabel } from "./sharingPresentation";

const CATEGORIES = ["all", "avatars", "actions", "fx"] as const;

/** Filtering only changes visible rows; selected identities belong to the flow. */
export function ContentExportSelection({ flow }: { flow: LibrarySharingFlow }) {
  const { t } = useTranslation("library");
  const formatters = useFormatters();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>("all");
  const categoryLabel = (value: (typeof CATEGORIES)[number]) => {
    switch (value) {
      case "all":
        return t("page.sections.all");
      case "avatars":
        return t("page.sections.avatars");
      case "actions":
        return t("page.sections.actions");
      case "fx":
        return t("page.sections.fx");
    }
  };
  const needle = query.trim().toLocaleLowerCase();
  const items = flow.items.filter(
    (item) =>
      (!needle ||
        `${item.name} ${item.description ?? ""}`
          .toLocaleLowerCase()
          .includes(needle)) &&
      (category === "all" ||
        (category === "avatars"
          ? item.kind === "avatar"
          : category === "actions"
            ? ["gesture", "reaction", "pose"].includes(item.kind)
            : item.kind.endsWith("_effect"))),
  );
  const summary = flow.summary;
  const packageItems =
    summary?.items.map((item) => ({ id: item.item_id, ...item })) ?? [];
  const count = summary?.selected_count ?? flow.selectedIds.size;
  return (
    <Tabs
      value={flow.mode}
      onValueChange={(value) => flow.setMode(value as "content" | "anima")}
      className="contents"
    >
      <TabsList className="mx-auto h-11 w-fit rounded-xl border bg-transparent p-1">
        <TabsTrigger
          value="content"
          disabled={flow.busy}
          className="data-[state=active]:bg-primary/15 min-w-28 rounded-lg"
        >
          {t("sharing.export.modes.content")}
        </TabsTrigger>
        <TabsTrigger
          value="anima"
          disabled={flow.busy}
          className="data-[state=active]:bg-primary/15 min-w-28 rounded-lg"
        >
          {t("sharing.export.modes.anima")}
        </TabsTrigger>
      </TabsList>
      {flow.inventoryLoading ? (
        <p role="status" className="text-muted-foreground py-4">
          {t("sharing.export.loadingLibrary")}
        </p>
      ) : null}
      {flow.inventoryError ? (
        <div role="alert" className="flex flex-wrap items-center gap-3">
          <p className="text-destructive">{flow.inventoryError}</p>
          <Button variant="outline" onClick={flow.refreshInventory}>
            {t("sharing.export.retryLoading")}
          </Button>
        </div>
      ) : null}
      <TabsContent value="anima" className="space-y-5">
        <SharingPrivacyNote />
        <label className="grid gap-2 font-medium">
          {t("sharing.export.chooseAnima")}
          <select
            className="bg-background h-14 min-w-0 rounded-xl border px-4 text-base"
            value={flow.animaId ?? ""}
            onChange={(event) => flow.selectAnima(event.target.value)}
            disabled={flow.busy || flow.inventoryLoading}
          >
            <option value="" disabled>
              {t("sharing.export.selectAnima")}
            </option>
            {flow.animas.map((anima) => (
              <option key={anima.id} value={anima.id}>
                {anima.display_name}
              </option>
            ))}
          </select>
        </label>
        {!flow.inventoryLoading &&
        !flow.inventoryError &&
        !flow.animas.length ? (
          <p className="text-muted-foreground py-6 text-center">
            {t("sharing.export.noAnimas")}
          </p>
        ) : null}
        {summary?.anima ? (
          <>
            <SharingAnimaDetails
              anima={summary.anima}
              items={packageItems}
              showPrivacyNote={false}
            />
            <SharingRequiredItems items={packageItems} />
          </>
        ) : null}
      </TabsContent>
      <TabsContent value="content" className="space-y-4">
        <div className="grid min-h-60 gap-6 md:grid-cols-[1.5fr_1fr]">
          <section
            className="min-w-0 space-y-3 md:border-r md:pr-6"
            aria-label={t("sharing.export.contentSelection")}
          >
            <label className="relative block">
              <Search
                aria-hidden="true"
                className="text-muted-foreground absolute top-3 left-3 size-4"
              />
              <Input
                aria-label={t("sharing.export.searchContent")}
                placeholder={t("sharing.export.searchContent")}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="h-10 pl-9"
              />
            </label>
            <div
              className="flex gap-1 overflow-x-auto border-b"
              aria-label={t("sharing.export.categories")}
            >
              {CATEGORIES.map((value) => (
                <button
                  type="button"
                  key={value}
                  aria-pressed={category === value}
                  onClick={() => setCategory(value)}
                  className={`min-h-10 shrink-0 border-b-2 px-3 text-sm ${value === category ? "border-primary font-medium" : "text-muted-foreground border-transparent"}`}
                >
                  {categoryLabel(value)}
                </button>
              ))}
            </div>
            <div className="max-h-80 space-y-1 overflow-y-auto">
              {items.map((item) => (
                <label
                  key={item.item_id}
                  className={`flex items-center gap-3 rounded-lg p-3 ${isNonPortable(item) ? "cursor-not-allowed opacity-70" : flow.selectedIds.has(item.item_id) ? "bg-primary/10 cursor-pointer" : "hover:bg-muted/50 cursor-pointer"}`}
                >
                  <Checkbox
                    aria-label={item.name}
                    aria-describedby={
                      isNonPortable(item)
                        ? `non-portable-${item.item_id}`
                        : undefined
                    }
                    checked={flow.selectedIds.has(item.item_id)}
                    disabled={flow.busy || isNonPortable(item)}
                    onCheckedChange={() => flow.toggleItem(item.item_id)}
                  />
                  <SharingItemIcon kind={item.kind} />
                  <span className="min-w-0">
                    <span className="block font-medium break-words">
                      {item.name}
                    </span>
                    <span className="text-muted-foreground text-xs">
                      {sharingKindLabel(item.kind)}
                    </span>
                    {isNonPortable(item) ? (
                      <span
                        id={`non-portable-${item.item_id}`}
                        className="text-muted-foreground block text-xs"
                      >
                        {nonPortableReason()}
                      </span>
                    ) : null}
                  </span>
                </label>
              ))}
              {!flow.inventoryLoading &&
              !flow.inventoryError &&
              !items.length ? (
                <p className="text-muted-foreground p-6 text-center">
                  {t("sharing.export.noMatches")}
                </p>
              ) : null}
            </div>
          </section>
          <section
            className="min-w-0 space-y-4"
            aria-label={t("sharing.yourPackage")}
          >
            <h3 className="text-lg font-semibold">
              {t("sharing.yourPackage")}
            </h3>
            <p className="font-medium">
              {t("sharing.selectedItems", { count })}
            </p>
            {summary ? (
              <>
                {summary.required_count > 0 ? (
                  <p>
                    {t("sharing.export.plusRequired", {
                      count: summary.required_count,
                    })}
                  </p>
                ) : null}
                <div className="max-h-56 overflow-y-auto">
                  {summary.items
                    .filter((item) => !item.selected)
                    .map((item) => (
                      <SharingItemRow
                        key={item.item_id}
                        item={{ id: item.item_id, ...item }}
                      />
                    ))}
                </div>
                <p className="border-t pt-4 text-sm">
                  {t("sharing.export.estimatedSize")}{" "}
                  <span className="float-right font-medium">
                    {formatters.fileSize(summary.estimated_size_bytes)}
                  </span>
                </p>
              </>
            ) : (
              <p className="text-muted-foreground text-sm">
                {t("sharing.export.chooseItem")}
              </p>
            )}
          </section>
        </div>
      </TabsContent>
      {flow.summaryLoading ? (
        <p role="status" className="text-muted-foreground text-sm">
          {t("sharing.export.checkingRequired")}
        </p>
      ) : null}
      {flow.error && !flow.summaryLoading ? (
        <Button
          className="w-fit"
          variant="outline"
          onClick={flow.refreshSummary}
          disabled={flow.busy}
        >
          {t("sharing.export.refreshSelection")}
        </Button>
      ) : null}
      <footer className="bg-popover sticky bottom-0 z-10 flex flex-wrap items-center justify-end gap-3 border-t py-4">
        <div className="flex flex-wrap items-center gap-4">
          <span className="text-muted-foreground text-sm">
            {flow.mode === "anima"
              ? summary?.anima?.display_name
              : t("sharing.export.selectedCount", {
                  count: flow.selectedIds.size,
                })}
          </span>
          <Button
            disabled={
              flow.busy ||
              flow.summaryLoading ||
              !summary ||
              Boolean(flow.error)
            }
            onClick={flow.prepareExport}
          >
            {t("sharing.export.review")}
          </Button>
        </div>
      </footer>
    </Tabs>
  );
}
