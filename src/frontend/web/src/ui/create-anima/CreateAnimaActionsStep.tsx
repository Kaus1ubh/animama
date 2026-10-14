import { ChevronDown, ChevronRight, Play } from "lucide-react";
import { useEffect, useState } from "react";
import { Trans, useTranslation } from "react-i18next";

import type {
  ItemRevisionRef,
  PyGesture,
} from "@animama/runtime-contracts/sdk";
import { TRACKED_EMOTIONS, type TrackedEmotion } from "@/lib/emotion";
import { emotionLabel } from "@/lib/emotion/presentation";
import { cn } from "@/lib/utils";
import type { AnimaCreationSources } from "@/query/hooks/useAnimaCreation";
import {
  ActionLoadoutRow,
  ActionRowIdentity,
  ReactionIntensityBadge,
} from "@/ui/animas/ActionLoadoutRows";
import { Button } from "@/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/ui/components/dialog";
import { Input } from "@/ui/components/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/components/tabs";
import { itemReference } from "./createAnimaContent";
import {
  INTENSITIES,
  REACTION_CELL_COUNT,
  reactionCount,
  sameRef,
  setReaction,
  emptyReactions,
  type CreateAnimaDraft,
  type DraftEdit,
  type Intensity,
} from "./createAnimaDraft";
import { selectCreationGesture } from "./createAnimaActions";

type Preview = (
  kind: "gesture" | "reaction",
  source: ItemRevisionRef,
  label: string,
) => void;

export function CreateAnimaActionsStep({
  draft,
  sources,
  onEdit,
  onReset,
  onPreview,
  focusTarget,
}: {
  draft: CreateAnimaDraft;
  sources: AnimaCreationSources;
  onEdit: (patch: DraftEdit) => void;
  onReset: () => void;
  onPreview: Preview;
  focusTarget?: string;
}) {
  const { t } = useTranslation("create");
  const { t: emotionT } = useTranslation("emotion");
  const [tab, setTab] = useState(
    focusTarget?.startsWith("creation-reaction-") ? "reactions" : "gestures",
  );
  const [search, setSearch] = useState("");
  const [source, setSource] = useState("all");
  const [replace, setReplace] = useState<PyGesture | null>(null);
  const [confirm, setConfirm] = useState<
    "reset" | "gestures" | "reactions" | null
  >(null);
  const [cell, setCell] = useState<{
    emotion: TrackedEmotion;
    intensity: Intensity;
  } | null>(null);
  const [reactionSearch, setReactionSearch] = useState("");
  const [reactionSource, setReactionSource] = useState("all");
  const [reactionLimit, setReactionLimit] = useState(24);
  const [reactionChoice, setReactionChoice] = useState<ItemRevisionRef | null>(
    null,
  );
  const [expandedEmotions, setExpandedEmotions] = useState<Set<TrackedEmotion>>(
    () => new Set(["admiration"]),
  );
  useEffect(() => {
    if (!focusTarget) return;
    const focusedEmotion = TRACKED_EMOTIONS.find((emotion) =>
      focusTarget.startsWith(`creation-reaction-${emotion}-`),
    );
    setTab(focusedEmotion ? "reactions" : "gestures");
    if (focusedEmotion)
      setExpandedEmotions((current) => new Set(current).add(focusedEmotion));
    setSearch("");
    setSource("all");
  }, [focusTarget]);
  const gestures = sources.gestures.data ?? [];
  const reactions = sources.reactions.data ?? [];
  const keys = [
    ...new Set([
      ...gestures.map((gesture) => gesture.semantic_key),
      ...draft.gestures.map((gesture) => gesture.semantic_key),
    ]),
  ].sort();
  const visibleKeys = keys.filter((key) => {
    const matches = gestures.filter(
      (gesture) =>
        gesture.semantic_key === key &&
        (source === "all" || gesture.source === source),
    );
    return (
      matches.some((gesture) =>
        `${key} ${gesture.name}`.toLowerCase().includes(search.toLowerCase()),
      ) ||
      (!matches.length &&
        source === "all" &&
        key.toLowerCase().includes(search.toLowerCase()))
    );
  });
  const filteredReactions = reactions.filter(
    (reaction) =>
      (reactionSource === "all" || reaction.source === reactionSource) &&
      `${reaction.name} ${reaction.emotion ?? ""}`
        .toLowerCase()
        .includes(reactionSearch.toLowerCase()),
  );
  const applyGesture = (item: PyGesture | null, key: string) =>
    onEdit({ gestures: selectCreationGesture(draft.gestures, item, key) });
  const sourceLabel = (value: string) =>
    value === "local" ? t("sources.local") : t("sources.included");
  const assigned = reactionCount(draft);
  // Values naming one Reaction cell in its labels.
  const cellText = (emotion: TrackedEmotion, intensity: Intensity) => ({
    emotion: emotionLabel(emotion, emotionT),
    intensity,
  });
  return (
    <div id="creation-actions" tabIndex={-1} className="space-y-5">
      <div className="bg-muted/20 rounded-xl border p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-medium">{t("actionsStep.starterPack.title")}</h3>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setConfirm("reset")}
          >
            {t("actionsStep.starterPack.reset")}
          </Button>
        </div>
        <p className="text-muted-foreground mt-2 text-sm">
          {t("actionsStep.starterPack.description")}
        </p>
        <p className="mt-2 text-sm">
          <Trans
            t={t}
            ns="create"
            i18nKey="actionsStep.starterPack.summary"
            count={draft.gestures.length}
            values={{ reactions: assigned, total: REACTION_CELL_COUNT }}
            components={{ strong: <strong /> }}
          />
        </p>
        {draft.starter_pack ? (
          <p className="text-muted-foreground mt-1 text-xs">
            {t("actionsStep.starterPack.version", {
              version: draft.starter_pack.version,
              gestures:
                sources.options.data?.counts.recommended_gestures ?? "—",
              cells:
                sources.options.data?.counts.recommended_reaction_cells ?? "—",
            })}
          </p>
        ) : null}
      </div>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="gestures">
            {t("actionsStep.tabs.gestures", {
              selected: draft.gestures.length,
            })}
          </TabsTrigger>
          <TabsTrigger value="reactions">
            {t("actionsStep.tabs.reactions", {
              assigned,
              total: REACTION_CELL_COUNT,
            })}
          </TabsTrigger>
        </TabsList>
        <TabsContent
          value="gestures"
          className="space-y-4"
          id="creation-gestures"
          tabIndex={-1}
        >
          <div className="flex flex-wrap gap-2">
            <Input
              className="min-w-0 flex-1 basis-40"
              aria-label={t("actionsStep.gestures.search")}
              placeholder={t("actionsStep.gestures.searchPlaceholder")}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <select
              className="bg-background rounded-md border px-2 text-sm"
              aria-label={t("actionsStep.gestures.sourceFilter")}
              value={source}
              onChange={(event) => setSource(event.target.value)}
            >
              <option value="all">{t("sources.all")}</option>
              <option value="included">{t("sources.included")}</option>
              <option value="local">{t("sources.local")}</option>
            </select>
          </div>
          {sources.gestures.isLoading ? (
            <p role="status" className="text-sm">
              {t("actionsStep.gestures.loading")}
            </p>
          ) : sources.gestures.isError ? (
            <div role="alert" className="text-sm">
              {t("actionsStep.gestures.loadFailed")}{" "}
              <Button
                size="sm"
                variant="outline"
                onClick={() => void sources.gestures.refetch()}
              >
                {t("actionsStep.gestures.retry")}
              </Button>
            </div>
          ) : !visibleKeys.length ? (
            <p className="text-muted-foreground text-sm">
              {t("actionsStep.gestures.noMatches")}
            </p>
          ) : null}
          <div
            role="list"
            className="divide-y overflow-hidden rounded-xl border"
          >
            {visibleKeys.map((key) => {
              const selection = draft.gestures.find(
                (gesture) => gesture.semantic_key === key,
              );
              const options = gestures.filter(
                (gesture) =>
                  gesture.semantic_key === key &&
                  (source === "all" || gesture.source === source),
              );
              return (
                <section
                  id={`creation-gesture-${key}`}
                  tabIndex={-1}
                  key={key}
                  role="listitem"
                  aria-label={t("actionsStep.gestures.key", { key })}
                  className="min-w-0 divide-y"
                >
                  {options.map((item) => (
                    <ActionLoadoutRow
                      key={item.item_id}
                      selected={sameRef(selection?.source, item)}
                    >
                      <ActionRowIdentity
                        name={item.name}
                        description={
                          item.description || sourceLabel(item.source)
                        }
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className={cn(
                          "h-8 shrink-0 rounded-lg text-xs",
                          sameRef(selection?.source, item) &&
                            "border-primary/40 bg-primary/8 text-primary",
                        )}
                        aria-pressed={sameRef(selection?.source, item)}
                        onClick={() =>
                          sameRef(selection?.source, item)
                            ? applyGesture(null, key)
                            : selection
                              ? setReplace(item)
                              : applyGesture(item, key)
                        }
                      >
                        {sameRef(selection?.source, item)
                          ? t("actionsStep.gestures.selected")
                          : t("actionsStep.gestures.select")}
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="outline"
                        onClick={() =>
                          onPreview("gesture", itemReference(item), item.name)
                        }
                        aria-label={t("actionsStep.gestures.preview", {
                          name: item.name,
                        })}
                      >
                        <Play className="size-3.5" />
                      </Button>
                    </ActionLoadoutRow>
                  ))}
                  {selection &&
                  !options.some((item) => sameRef(selection.source, item)) ? (
                    <p className="text-muted-foreground border-l-primary border-l-2 px-4 py-3 text-xs break-words">
                      {t("actionsStep.gestures.keptSelection", {
                        id: selection.source.item_id,
                      })}
                    </p>
                  ) : null}
                </section>
              );
            })}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setConfirm("gestures")}
          >
            {t("actionsStep.gestures.clearAll")}
          </Button>
          {!draft.gestures.length ? (
            <p className="text-muted-foreground text-sm">
              {t("actionsStep.gestures.none")}
            </p>
          ) : null}
        </TabsContent>
        <TabsContent value="reactions" className="space-y-4">
          {sources.reactions.isError ? (
            <p role="alert" className="text-sm">
              {t("actionsStep.reactions.loadFailed")}{" "}
              <Button
                variant="outline"
                size="sm"
                onClick={() => void sources.reactions.refetch()}
              >
                {t("actionsStep.reactions.retry")}
              </Button>
            </p>
          ) : null}
          <div
            data-testid="creation-reaction-matrix"
            className="overflow-hidden rounded-xl border"
            aria-label={t("actionsStep.reactions.matrix")}
          >
            {TRACKED_EMOTIONS.map((emotion) => {
              const expanded = expandedEmotions.has(emotion);
              const panelId = `creation-reaction-${emotion}-levels`;
              return (
                <section
                  key={emotion}
                  data-reaction-emotion={emotion}
                  className={cn(
                    "min-w-0 border-b border-l-2 last:border-b-0",
                    expanded ? "border-l-primary" : "border-l-transparent",
                  )}
                >
                  <button
                    type="button"
                    aria-expanded={expanded}
                    aria-controls={panelId}
                    onClick={() =>
                      setExpandedEmotions((current) => {
                        const next = new Set(current);
                        if (expanded) next.delete(emotion);
                        else next.add(emotion);
                        return next;
                      })
                    }
                    className={cn(
                      "focus-visible:ring-ring flex w-full items-center justify-between gap-4 px-4 py-3.5 text-left text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-inset",
                      expanded
                        ? "bg-primary/5 hover:bg-primary/8"
                        : "hover:bg-muted/30",
                    )}
                  >
                    <span>{emotionLabel(emotion, emotionT)}</span>
                    {expanded ? (
                      <ChevronDown className="size-4 shrink-0" />
                    ) : (
                      <ChevronRight className="size-4 shrink-0" />
                    )}
                  </button>
                  {expanded ? (
                    <div
                      id={panelId}
                      role="region"
                      aria-label={t("actionsStep.reactions.levels", {
                        emotion: emotionLabel(emotion, emotionT),
                      })}
                      className="divide-y border-t"
                    >
                      {INTENSITIES.map((intensity) => {
                        const ref = draft.reactions[emotion][intensity];
                        const recommended =
                          sources.options.data?.recommended.reactions[emotion][
                            intensity
                          ] ?? null;
                        const item = reactions.find((candidate) =>
                          sameRef(ref, candidate),
                        );
                        return (
                          <div
                            key={intensity}
                            id={`creation-reaction-${emotion}-${intensity}`}
                            tabIndex={-1}
                            className={cn(
                              "flex min-w-0 items-center gap-3 px-4 py-3.5",
                              ref && "bg-primary/5",
                            )}
                          >
                            <ReactionIntensityBadge intensity={intensity} />
                            <button
                              type="button"
                              className="focus-visible:ring-ring min-w-0 flex-1 rounded-lg border px-3 py-2 text-left text-sm focus-visible:ring-2"
                              onClick={() => {
                                setCell({ emotion, intensity });
                                setReactionChoice(ref);
                                setReactionSearch("");
                                setReactionSource("all");
                                setReactionLimit(24);
                              }}
                              aria-label={t(
                                "actionsStep.reactions.change",
                                cellText(emotion, intensity),
                              )}
                            >
                              <span className="block truncate">
                                {ref
                                  ? (item?.name ??
                                    t("actionsStep.reactions.needsAttention"))
                                  : t("actionsStep.reactions.empty")}
                              </span>
                            </button>
                            <div className="flex shrink-0 gap-1">
                              {ref ? (
                                <>
                                  <Button
                                    size="icon-sm"
                                    variant="outline"
                                    onClick={() =>
                                      onPreview(
                                        "reaction",
                                        ref,
                                        t(
                                          "actionsStep.reactions.previewLabel",
                                          cellText(emotion, intensity),
                                        ),
                                      )
                                    }
                                    aria-label={t(
                                      "actionsStep.reactions.previewCell",
                                      cellText(emotion, intensity),
                                    )}
                                  >
                                    <Play className="size-3" />
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-7 px-2 text-xs"
                                    onClick={() =>
                                      onEdit({
                                        reactions: setReaction(
                                          draft,
                                          emotion,
                                          intensity,
                                          null,
                                        ),
                                      })
                                    }
                                    aria-label={t(
                                      "actionsStep.reactions.clearCell",
                                      cellText(emotion, intensity),
                                    )}
                                  >
                                    {t("actions.clear")}
                                  </Button>
                                </>
                              ) : null}
                              {!sameRef(ref, recommended) ? (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 px-2 text-xs"
                                  onClick={() =>
                                    onEdit({
                                      reactions: setReaction(
                                        draft,
                                        emotion,
                                        intensity,
                                        recommended,
                                      ),
                                    })
                                  }
                                  aria-label={t(
                                    "actionsStep.reactions.revertCell",
                                    cellText(emotion, intensity),
                                  )}
                                >
                                  {t("actionsStep.reactions.revert")}
                                </Button>
                              ) : null}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </section>
              );
            })}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setConfirm("reactions")}
          >
            {t("actionsStep.reactions.clearAll")}
          </Button>
          {!assigned ? (
            <p className="text-muted-foreground text-sm">
              {t("actionsStep.reactions.none", { total: REACTION_CELL_COUNT })}
            </p>
          ) : null}
        </TabsContent>
      </Tabs>
      {replace ? (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setReplace(null);
          }}
        >
          <DialogContent>
            <DialogTitle>
              {t("actionsStep.replace.title", { key: replace.semantic_key })}
            </DialogTitle>
            <DialogDescription>
              {t("actionsStep.replace.description", { name: replace.name })}
            </DialogDescription>
            <DialogFooter>
              <Button variant="outline" onClick={() => setReplace(null)}>
                {t("actionsStep.replace.keep")}
              </Button>
              <Button
                onClick={() => {
                  applyGesture(replace, replace.semantic_key);
                  setReplace(null);
                }}
              >
                {t("actionsStep.replace.confirm")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
      {confirm ? (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setConfirm(null);
          }}
        >
          <DialogContent>
            <DialogTitle>
              {confirm === "reset"
                ? t("actionsStep.confirm.resetTitle")
                : confirm === "gestures"
                  ? t("actionsStep.confirm.clearGesturesTitle")
                  : t("actionsStep.confirm.clearReactionsTitle")}
            </DialogTitle>
            <DialogDescription>
              {confirm === "reset"
                ? t("actionsStep.confirm.resetDescription", {
                    total: REACTION_CELL_COUNT,
                  })
                : t("actionsStep.confirm.clearDescription")}
            </DialogDescription>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirm(null)}>
                {t("actions.cancel")}
              </Button>
              <Button
                onClick={() => {
                  if (confirm === "reset") onReset();
                  else if (confirm === "gestures") onEdit({ gestures: [] });
                  else onEdit({ reactions: emptyReactions() });
                  setConfirm(null);
                }}
              >
                {confirm === "reset"
                  ? t("actionsStep.confirm.reset")
                  : t("actionsStep.confirm.clear")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
      {cell ? (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open) setCell(null);
          }}
        >
          <DialogContent className="max-h-[90dvh] overflow-y-auto">
            <DialogTitle>
              {t(
                "actionsStep.cell.title",
                cellText(cell.emotion, cell.intensity),
              )}
            </DialogTitle>
            <DialogDescription>
              {t("actionsStep.cell.description")}
            </DialogDescription>
            <div className="flex flex-wrap gap-2">
              <Input
                className="min-w-0 flex-1 basis-40"
                aria-label={t("actionsStep.cell.search")}
                placeholder={t("actionsStep.cell.searchPlaceholder")}
                value={reactionSearch}
                onChange={(event) => {
                  setReactionSearch(event.target.value);
                  setReactionLimit(24);
                }}
              />
              <select
                className="bg-background rounded-md border px-2 text-sm"
                aria-label={t("actionsStep.cell.sourceFilter")}
                value={reactionSource}
                onChange={(event) => setReactionSource(event.target.value)}
              >
                <option value="all">{t("sources.all")}</option>
                <option value="included">{t("sources.included")}</option>
                <option value="local">{t("sources.local")}</option>
              </select>
            </div>
            <div
              role="radiogroup"
              aria-label={t("actionsStep.cell.assignment")}
              className="max-h-72 space-y-2 overflow-y-auto"
            >
              <label className="flex items-center gap-2 rounded-lg border p-3 text-sm">
                <input
                  name="reaction-choice"
                  type="radio"
                  checked={!reactionChoice}
                  onChange={() => setReactionChoice(null)}
                  className="accent-primary"
                />
                {t("actionsStep.reactions.empty")}
              </label>
              {filteredReactions.slice(0, reactionLimit).map((item) => (
                <div
                  key={item.item_id}
                  className={cn(
                    "flex items-center gap-2 rounded-lg border p-3",
                    sameRef(reactionChoice, item) && "bg-primary/5",
                  )}
                >
                  <label className="flex min-w-0 flex-1 items-center gap-2 text-sm">
                    <input
                      name="reaction-choice"
                      type="radio"
                      className="accent-primary"
                      checked={sameRef(reactionChoice, item)}
                      onChange={() => setReactionChoice(itemReference(item))}
                    />
                    <span className="break-words">
                      {item.name}
                      <span className="text-muted-foreground block text-xs">
                        {sourceLabel(item.source)}
                      </span>
                    </span>
                  </label>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      onPreview("reaction", itemReference(item), item.name)
                    }
                    aria-label={t("actionsStep.cell.preview", {
                      name: item.name,
                    })}
                  >
                    <Play className="size-3.5" />
                  </Button>
                </div>
              ))}
              {!filteredReactions.length ? (
                <p className="text-muted-foreground text-sm">
                  {t("actionsStep.cell.noMatches")}
                </p>
              ) : null}
            </div>
            {filteredReactions.length > reactionLimit ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setReactionLimit((value) => value + 24)}
              >
                {t("actionsStep.cell.showMore")}
              </Button>
            ) : null}
            <DialogFooter>
              <Button variant="outline" onClick={() => setCell(null)}>
                {t("actions.cancel")}
              </Button>
              <Button
                onClick={() => {
                  onEdit({
                    reactions: setReaction(
                      draft,
                      cell.emotion,
                      cell.intensity,
                      reactionChoice,
                    ),
                  });
                  setCell(null);
                }}
              >
                {t("actionsStep.cell.apply")}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
