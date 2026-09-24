import { useState } from "react";
import { Search } from "lucide-react";
import type { LibrarySharingFlow } from "@/lib/content-sharing/types";
import { Button } from "@/ui/components/button";
import { Input } from "@/ui/components/input";
import { Checkbox } from "@/ui/components/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/components/tabs";
import {
  SharingAnimaDetails,
  SharingItemIcon,
  SharingItemRow,
  SharingRequiredItems,
} from "./SharingPackageDetails";
import { sharingKindLabel, sharingSize } from "./sharingPresentation";

const CATEGORIES = ["All", "Avatars", "Actions", "FX"] as const;

/** Filtering only changes visible rows; selected identities belong to the flow. */
export function ContentExportSelection({ flow }: { flow: LibrarySharingFlow }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>("All");
  const needle = query.trim().toLocaleLowerCase();
  const items = flow.items.filter(
    (item) =>
      (!needle ||
        `${item.name} ${item.description ?? ""}`
          .toLocaleLowerCase()
          .includes(needle)) &&
      (category === "All" ||
        (category === "Avatars"
          ? item.kind === "avatar"
          : category === "Actions"
            ? ["gesture", "reaction", "pose", "idle_style"].includes(item.kind)
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
          Content
        </TabsTrigger>
        <TabsTrigger
          value="anima"
          disabled={flow.busy}
          className="data-[state=active]:bg-primary/15 min-w-28 rounded-lg"
        >
          Anima
        </TabsTrigger>
      </TabsList>
      {flow.inventoryLoading ? (
        <p role="status" className="text-muted-foreground py-4">
          Loading your Library…
        </p>
      ) : null}
      {flow.inventoryError ? (
        <div role="alert" className="flex flex-wrap items-center gap-3">
          <p className="text-destructive">{flow.inventoryError}</p>
          <Button variant="outline" onClick={flow.refreshInventory}>
            Retry loading
          </Button>
        </div>
      ) : null}
      <TabsContent value="anima" className="space-y-5">
        <label className="grid gap-2 font-medium">
          Choose an Anima
          <select
            className="bg-background h-14 min-w-0 rounded-xl border px-4 text-base"
            value={flow.animaId ?? ""}
            onChange={(event) => flow.selectAnima(event.target.value)}
            disabled={flow.busy || flow.inventoryLoading}
          >
            <option value="" disabled>
              Select an Anima
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
            There are no Anima to export yet.
          </p>
        ) : null}
        {summary?.anima ? (
          <>
            <SharingAnimaDetails anima={summary.anima} items={packageItems} />
            <SharingRequiredItems items={packageItems} />
          </>
        ) : null}
      </TabsContent>
      <TabsContent value="content" className="space-y-4">
        <p className="text-muted-foreground">
          Select the items you want to share.
        </p>
        <div className="grid min-h-60 gap-6 md:grid-cols-[1.5fr_1fr]">
          <section
            className="min-w-0 space-y-3 md:border-r md:pr-6"
            aria-label="Content selection"
          >
            <label className="relative block">
              <Search
                aria-hidden="true"
                className="text-muted-foreground absolute top-3 left-3 size-4"
              />
              <Input
                aria-label="Search content"
                placeholder="Search content"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="h-10 pl-9"
              />
            </label>
            <div
              className="flex gap-1 overflow-x-auto border-b"
              aria-label="Content categories"
            >
              {CATEGORIES.map((value) => (
                <button
                  type="button"
                  key={value}
                  aria-pressed={category === value}
                  onClick={() => setCategory(value)}
                  className={`min-h-10 shrink-0 border-b-2 px-3 text-sm ${value === category ? "border-primary font-medium" : "text-muted-foreground border-transparent"}`}
                >
                  {value}
                </button>
              ))}
            </div>
            <div className="max-h-80 space-y-1 overflow-y-auto">
              {items.map((item) => (
                <label
                  key={item.item_id}
                  className={`flex cursor-pointer items-center gap-3 rounded-lg p-3 ${flow.selectedIds.has(item.item_id) ? "bg-primary/10" : "hover:bg-muted/50"}`}
                >
                  <Checkbox
                    aria-label={item.name}
                    checked={flow.selectedIds.has(item.item_id)}
                    disabled={flow.busy}
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
                  </span>
                </label>
              ))}
              {!flow.inventoryLoading &&
              !flow.inventoryError &&
              !items.length ? (
                <p className="text-muted-foreground p-6 text-center">
                  No matching content.
                </p>
              ) : null}
            </div>
          </section>
          <section className="min-w-0 space-y-4" aria-label="Your package">
            <h3 className="text-lg font-semibold">Your package</h3>
            <p className="font-medium">
              {count} selected {count === 1 ? "item" : "items"}
            </p>
            {summary ? (
              <>
                <p>+ {summary.required_count} required items</p>
                <p className="text-muted-foreground text-sm">
                  Required content is included automatically so everything works
                  when imported.
                </p>
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
                  Estimated size{" "}
                  <span className="float-right font-medium">
                    {sharingSize(summary.estimated_size_bytes)}
                  </span>
                </p>
              </>
            ) : (
              <p className="text-muted-foreground text-sm">
                Choose at least one item to see its required content.
              </p>
            )}
          </section>
        </div>
      </TabsContent>
      {flow.summaryLoading ? (
        <p role="status" className="text-muted-foreground text-sm">
          Checking required content…
        </p>
      ) : null}
      {flow.error && !flow.summaryLoading ? (
        <Button
          className="w-fit"
          variant="outline"
          onClick={flow.refreshSummary}
          disabled={flow.busy}
        >
          Refresh selection
        </Button>
      ) : null}
      <footer className="bg-popover sticky bottom-0 z-10 flex flex-wrap items-center justify-between gap-3 border-t py-4">
        <Button variant="outline" onClick={flow.back} disabled={flow.busy}>
          Back
        </Button>
        <div className="flex flex-wrap items-center gap-4">
          <span className="text-muted-foreground text-sm">
            {flow.mode === "anima"
              ? summary?.anima?.display_name
              : `${flow.selectedIds.size} selected`}
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
            Review export
          </Button>
        </div>
      </footer>
    </Tabs>
  );
}
