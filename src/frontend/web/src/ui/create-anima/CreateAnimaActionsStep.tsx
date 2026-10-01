import { ChevronDown, ChevronRight, Play } from "lucide-react";
import { useEffect, useState } from "react";

import type {
  ItemRevisionRef,
  PyGesture,
} from "@animama/runtime-contracts/sdk";
import { TRACKED_EMOTIONS, type TrackedEmotion } from "@/lib/emotion";
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
const emotionLabel = (emotion: string) =>
  emotion.charAt(0).toUpperCase() + emotion.slice(1).replace(/_/g, " ");

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
  return (
    <div id="creation-actions" tabIndex={-1} className="space-y-5">
      <div className="bg-muted/20 rounded-xl border p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-medium">Recommended Starter Pack</h3>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setConfirm("reset")}
          >
            Reset to recommended
          </Button>
        </div>
        <p className="text-muted-foreground mt-2 text-sm">
          A starting point, not a requirement. Select exactly what your Anima
          can do.
        </p>
        <p className="mt-2 text-sm">
          <strong>{draft.gestures.length}</strong> Gestures ·{" "}
          <strong>{reactionCount(draft)}</strong> / 72 Reaction cells assigned
        </p>
        {draft.starter_pack ? (
          <p className="text-muted-foreground mt-1 text-xs">
            Version {draft.starter_pack.version} ·{" "}
            {sources.options.data?.counts.recommended_gestures ?? "—"}{" "}
            recommended Gestures ·{" "}
            {sources.options.data?.counts.recommended_reaction_cells ?? "—"}{" "}
            recommended cells
          </p>
        ) : null}
      </div>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="gestures">
            Gestures ({draft.gestures.length})
          </TabsTrigger>
          <TabsTrigger value="reactions">
            Reactions ({reactionCount(draft)}/72)
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
              aria-label="Search Gestures"
              placeholder="Search Gestures…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <select
              className="bg-background rounded-md border px-2 text-sm"
              aria-label="Gesture source"
              value={source}
              onChange={(event) => setSource(event.target.value)}
            >
              <option value="all">All sources</option>
              <option value="included">Included</option>
              <option value="local">My Content</option>
            </select>
          </div>
          {sources.gestures.isLoading ? (
            <p role="status" className="text-sm">
              Loading Gestures…
            </p>
          ) : sources.gestures.isError ? (
            <div role="alert" className="text-sm">
              Could not load Gestures. Selections have not changed.{" "}
              <Button
                size="sm"
                variant="outline"
                onClick={() => void sources.gestures.refetch()}
              >
                Retry Gestures
              </Button>
            </div>
          ) : !visibleKeys.length ? (
            <p className="text-muted-foreground text-sm">
              No matching Gestures. Hidden selections are kept.
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
                  aria-label={`Gesture ${key}`}
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
                          item.description ||
                          (item.source === "local" ? "My Content" : "Included")
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
                          ? "Selected"
                          : "Select"}
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="outline"
                        onClick={() =>
                          onPreview("gesture", itemReference(item), item.name)
                        }
                        aria-label={`Preview Gesture ${item.name}`}
                      >
                        <Play className="size-3.5" />
                      </Button>
                    </ActionLoadoutRow>
                  ))}
                  {selection &&
                  !options.some((item) => sameRef(selection.source, item)) ? (
                    <p className="text-muted-foreground border-l-primary border-l-2 px-4 py-3 text-xs break-words">
                      Kept selection: {selection.source.item_id}. It is hidden
                      by your filter or needs attention.
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
            Clear all Gestures
          </Button>
          {!draft.gestures.length ? (
            <p className="text-muted-foreground text-sm">
              No Gestures selected. Your Anima can still be created.
            </p>
          ) : null}
        </TabsContent>
        <TabsContent value="reactions" className="space-y-4">
          {sources.reactions.isError ? (
            <p role="alert" className="text-sm">
              Could not load Reactions. Assignments are preserved.{" "}
              <Button
                variant="outline"
                size="sm"
                onClick={() => void sources.reactions.refetch()}
              >
                Retry Reactions
              </Button>
            </p>
          ) : null}
          <div
            data-testid="creation-reaction-matrix"
            className="overflow-hidden rounded-xl border"
            aria-label="Reaction matrix"
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
                    <span>{emotionLabel(emotion)}</span>
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
                      aria-label={`${emotionLabel(emotion)} Reaction levels`}
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
                              aria-label={`Change ${emotion} intensity ${intensity}`}
                            >
                              <span className="block truncate">
                                {ref
                                  ? (item?.name ?? "Selected · needs attention")
                                  : "Empty"}
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
                                        `${emotionLabel(emotion)} · ${intensity}`,
                                      )
                                    }
                                    aria-label={`Preview ${emotion} intensity ${intensity}`}
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
                                    aria-label={`Clear ${emotion} intensity ${intensity}`}
                                  >
                                    Clear
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
                                  aria-label={`Revert ${emotion} intensity ${intensity} to recommended`}
                                >
                                  Revert
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
            Clear all Reactions
          </Button>
          {!reactionCount(draft) ? (
            <p className="text-muted-foreground text-sm">
              All 72 cells are empty. Your Anima can still be created.
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
              Replace Gesture for “{replace.semantic_key}”?
            </DialogTitle>
            <DialogDescription>
              Only one Gesture can use this semantic key. The selected source
              will be replaced with {replace.name}; no content is deleted.
            </DialogDescription>
            <DialogFooter>
              <Button variant="outline" onClick={() => setReplace(null)}>
                Keep current
              </Button>
              <Button
                onClick={() => {
                  applyGesture(replace, replace.semantic_key);
                  setReplace(null);
                }}
              >
                Replace selection
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
                ? "Reset Actions to recommended?"
                : `Clear all ${confirm === "gestures" ? "Gestures" : "Reactions"}?`}
            </DialogTitle>
            <DialogDescription>
              {confirm === "reset"
                ? "This replaces both Gesture selections and all 72 Reaction cells with the current Starter Pack. Avatar and Identity stay unchanged."
                : "Only these selections will be cleared. Empty selections are valid, and your saved content is not deleted."}
            </DialogDescription>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirm(null)}>
                Cancel
              </Button>
              <Button
                onClick={() => {
                  if (confirm === "reset") onReset();
                  else if (confirm === "gestures") onEdit({ gestures: [] });
                  else onEdit({ reactions: emptyReactions() });
                  setConfirm(null);
                }}
              >
                {confirm === "reset" ? "Reset Actions" : "Clear selections"}
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
              {emotionLabel(cell.emotion)} · intensity {cell.intensity}
            </DialogTitle>
            <DialogDescription>
              Choose any Reaction, or leave this cell empty. Preview does not
              change its assignment.
            </DialogDescription>
            <div className="flex flex-wrap gap-2">
              <Input
                className="min-w-0 flex-1 basis-40"
                aria-label="Search Reactions"
                placeholder="Search Reactions…"
                value={reactionSearch}
                onChange={(event) => {
                  setReactionSearch(event.target.value);
                  setReactionLimit(24);
                }}
              />
              <select
                className="bg-background rounded-md border px-2 text-sm"
                aria-label="Reaction source"
                value={reactionSource}
                onChange={(event) => setReactionSource(event.target.value)}
              >
                <option value="all">All sources</option>
                <option value="included">Included</option>
                <option value="local">My Content</option>
              </select>
            </div>
            <div
              role="radiogroup"
              aria-label="Reaction assignment"
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
                Empty
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
                        {item.source === "local" ? "My Content" : "Included"}
                      </span>
                    </span>
                  </label>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      onPreview("reaction", itemReference(item), item.name)
                    }
                    aria-label={`Preview Reaction ${item.name}`}
                  >
                    <Play className="size-3.5" />
                  </Button>
                </div>
              ))}
              {!filteredReactions.length ? (
                <p className="text-muted-foreground text-sm">
                  No matching Reactions. Your cell has not changed.
                </p>
              ) : null}
            </div>
            {filteredReactions.length > reactionLimit ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setReactionLimit((value) => value + 24)}
              >
                Show more Reactions
              </Button>
            ) : null}
            <DialogFooter>
              <Button variant="outline" onClick={() => setCell(null)}>
                Cancel
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
                Apply to cell
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
