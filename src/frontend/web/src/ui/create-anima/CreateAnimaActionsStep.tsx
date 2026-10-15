import { Play } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Trans, useTranslation } from "react-i18next";

import type {
  ItemRevisionRef,
  PyGesture,
  PyReaction,
} from "@animama/runtime-contracts/sdk";
import { TRACKED_EMOTIONS, type TrackedEmotion } from "@/lib/emotion";
import { emotionLabel } from "@/lib/emotion/presentation";
import { cn } from "@/lib/utils";
import type { AnimaCreationSources } from "@/query/hooks/useAnimaCreation";
import {
  ActionLoadoutRow,
  ActionRowIdentity,
  reactionCellLabel,
} from "@/ui/animas/ActionLoadoutRows";
import {
  LoadoutPoolEmotionRow,
  type LoadoutPoolMember,
} from "@/ui/animas/LoadoutPool";
import { ReactionPoolCellRow } from "@/ui/animas/ReactionLoadoutGrid";
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
  addReactionPoolMember,
  INTENSITIES,
  REACTION_CELL_COUNT,
  reactionCount,
  removeReactionPoolMember,
  sameRef,
  samePool,
  setReactionPool,
  emptyReactions,
  type CreateAnimaDraft,
  type DraftEdit,
} from "./createAnimaDraft";
import { selectCreationGesture } from "./createAnimaActions";

type Preview = (
  kind: "gesture" | "reaction",
  source: ItemRevisionRef,
  label: string,
) => void;

/** A Reaction the picker offers, grouped as Local (owned) or Included (builtin). */
type CreationReactionChoice = PyReaction & { origin: "owned" | "builtin" };

/** A pool member as its cell lists it, with the exact revision it pins. */
type CreationReactionMember = LoadoutPoolMember & {
  item_id: string;
  ref: ItemRevisionRef;
};

/**
 * Every emotion's four Reaction cells, each a pool edited with the Loadout's
 * cell (add, remove, preview, no repeats, four at most) plus Revert to the
 * cell's recommended pool. Each change edits the draft at once.
 */
function CreationReactionPools({
  draft,
  sources,
  expanded,
  onToggle,
  onEdit,
  onPreview,
}: {
  draft: CreateAnimaDraft;
  sources: AnimaCreationSources;
  expanded: ReadonlySet<TrackedEmotion>;
  onToggle: (emotion: TrackedEmotion) => void;
  onEdit: (patch: DraftEdit) => void;
  onPreview: Preview;
}) {
  const { t } = useTranslation("create");
  const { t: animasT } = useTranslation("animas");
  const { t: emotionT } = useTranslation("emotion");
  const catalog = sources.reactions.data;
  // Recommended pools come with the creation options; until they load, no
  // cell can tell whether it differs from its own.
  const recommendedPools = sources.options.data?.recommended.reactions;
  const choices = useMemo(
    () =>
      (catalog ?? []).map(
        (reaction): CreationReactionChoice => ({
          ...reaction,
          origin: reaction.source === "local" ? "owned" : "builtin",
        }),
      ),
    [catalog],
  );
  return (
    <>
      {TRACKED_EMOTIONS.map((emotion) => {
        const label = emotionLabel(emotion, emotionT);
        const count = INTENSITIES.reduce(
          (total, intensity) =>
            total + draft.reactions[emotion][intensity].length,
          0,
        );
        return (
          <LoadoutPoolEmotionRow
            key={emotion}
            label={label}
            summary={
              count
                ? animasT("reactions.reactionCount", { count })
                : animasT("reactions.noReaction")
            }
            panelId={`creation-reaction-${emotion}-levels`}
            regionLabel={t("actionsStep.reactions.levels", { emotion: label })}
            open={expanded.has(emotion)}
            onToggle={() => onToggle(emotion)}
          >
            {INTENSITIES.map((intensity) => {
              const pool = draft.reactions[emotion][intensity];
              const recommended =
                recommendedPools?.[emotion]?.[intensity] ?? [];
              // A member whose exact revision the catalog no longer offers needs
              // attention; while the catalog loads, members are taken as listed.
              const members = pool.map((ref): CreationReactionMember => {
                const item = catalog?.find(
                  (candidate) => candidate.item_id === ref.item_id,
                );
                return {
                  binding_id: ref.item_id,
                  item_id: ref.item_id,
                  ref,
                  name: item?.name ?? ref.item_id,
                  available: !catalog || sameRef(ref, item),
                };
              });
              return (
                <ReactionPoolCellRow
                  key={intensity}
                  id={`creation-reaction-${emotion}-${intensity}`}
                  emotion={emotion}
                  intensity={Number(intensity)}
                  members={members}
                  isStarter={(member) =>
                    recommended.some((ref) => sameRef(ref, member.ref))
                  }
                  choices={choices}
                  loading={sources.reactions.isLoading}
                  error={sources.reactions.isError}
                  disabled={false}
                  busy={false}
                  unavailableText={t("actionsStep.reactions.needsAttention")}
                  onAdd={(item) =>
                    onEdit({
                      reactions: addReactionPoolMember(
                        draft,
                        emotion,
                        intensity,
                        itemReference(item),
                      ),
                    })
                  }
                  onRemove={(member) =>
                    onEdit({
                      reactions: removeReactionPoolMember(
                        draft,
                        emotion,
                        intensity,
                        member.item_id,
                      ),
                    })
                  }
                  onPreview={(member) =>
                    onPreview("reaction", member.ref, member.name)
                  }
                  onPreviewChoice={(item) =>
                    onPreview("reaction", itemReference(item), item.name)
                  }
                  onRetry={() => void sources.reactions.refetch()}
                  controls={
                    !recommendedPools || samePool(pool, recommended) ? null : (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-8 px-2 text-xs"
                        aria-label={t("actionsStep.reactions.revertCell", {
                          cell: reactionCellLabel(emotion, intensity, animasT),
                        })}
                        onClick={() =>
                          onEdit({
                            reactions: setReactionPool(
                              draft,
                              emotion,
                              intensity,
                              recommended,
                            ),
                          })
                        }
                      >
                        {t("actionsStep.reactions.revert")}
                      </Button>
                    )
                  }
                />
              );
            })}
          </LoadoutPoolEmotionRow>
        );
      })}
    </>
  );
}

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
  const [tab, setTab] = useState(
    focusTarget?.startsWith("creation-reaction-") ? "reactions" : "gestures",
  );
  const [search, setSearch] = useState("");
  const [source, setSource] = useState("all");
  const [replace, setReplace] = useState<PyGesture | null>(null);
  const [confirm, setConfirm] = useState<
    "reset" | "gestures" | "reactions" | null
  >(null);
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
  const applyGesture = (item: PyGesture | null, key: string) =>
    onEdit({ gestures: selectCreationGesture(draft.gestures, item, key) });
  const sourceLabel = (value: string) =>
    value === "local" ? t("sources.local") : t("sources.included");
  const assigned = reactionCount(draft);
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
            <CreationReactionPools
              draft={draft}
              sources={sources}
              expanded={expandedEmotions}
              onToggle={(emotion) =>
                setExpandedEmotions((current) => {
                  const next = new Set(current);
                  if (next.has(emotion)) next.delete(emotion);
                  else next.add(emotion);
                  return next;
                })
              }
              onEdit={onEdit}
              onPreview={onPreview}
            />
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
    </div>
  );
}
