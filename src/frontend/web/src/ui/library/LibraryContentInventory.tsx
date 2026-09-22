"use client";

import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  ChevronDown,
  ChevronRight,
  Loader2,
  Pause,
  Pencil,
  Play,
  Plus,
  Search,
  Sparkles,
  WandSparkles,
} from "lucide-react";

import type {
  PyAvatarCatalogItem,
  PyContentPreview,
  PyCatalogViewItem,
} from "@/lib/content/catalogTypes";
import {
  previewCatalogItem,
  previewTypedCatalogItem,
} from "@/lib/content/catalogApi";
import { typedActionPreview } from "@/lib/content/typedPreviewAdapters";
import { avatarPreviewTarget } from "@/lib/content/avatarPreviewTarget";
import { componentPreviewTarget } from "@/lib/content/componentPreviewTarget";
import {
  contentInventoryGroups,
  type LibraryInventoryGroup,
} from "@/lib/content/libraryContentInventory";
import {
  effectLibraryCard,
  avatarLibraryDescription,
  filterAndSortLibraryGestures,
  libraryProductActionPolicy,
  libraryRowPresentation,
  actionLibraryCard,
  poseLibraryCard,
  type LibraryProductCard,
} from "@/lib/content/libraryPresentation";
import type { ContentLibrarySearch } from "@/lib/content/librarySearch";
import { actionPreviewTarget } from "@/lib/content-preview/actionPreviewTarget";
import { posePreviewTarget } from "@/lib/content-preview/posePreviewTarget";
import { usePoses } from "@/query/hooks/usePoses";
import { useAvatarCatalog } from "@/query/hooks/useAvatarCatalog";
import { useEffects } from "@/query/hooks/useEffects";
import { useGestures, useReactions } from "@/query/hooks/useActions";
import { useContentPreviewDock } from "@/ui/content-preview/ContentPreviewDockProvider";
import { Button } from "@/ui/components/button";
import { Input } from "@/ui/components/input";
import { useContentPreviewAudio } from "@/ui/content-preview/useContentPreviewAudio";
import {
  ActionManageDialog,
  type ManageActionTarget,
} from "@/ui/action-manage/ActionManageDialog";
import { LibraryFilterMenu } from "./LibraryFilterMenu";
import { LibraryProductRow } from "./LibraryProductRow";

type SearchUpdate = (update: Partial<ContentLibrarySearch>) => void;

function ProductGroup({
  id,
  title,
  children,
  footer,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(true);
  const contentId = `library-${id}-content`;
  const headingId = `library-${id}-heading`;
  return (
    <section className="space-y-3" aria-labelledby={headingId}>
      <h2
        id={headingId}
        className="bg-background/95 sticky top-28 z-20 backdrop-blur-sm"
      >
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={contentId}
          onClick={() => setExpanded((current) => !current)}
          className="hover:bg-muted/30 focus-visible:ring-ring flex w-full items-center justify-start gap-2 rounded-lg px-3 py-2 text-left outline-none focus-visible:ring-2"
        >
          <span className="truncate text-lg font-semibold">{title}</span>
          {expanded ? (
            <ChevronDown className="size-4 shrink-0" />
          ) : (
            <ChevronRight className="size-4 shrink-0" />
          )}
        </button>
      </h2>
      {expanded ? (
        <div id={contentId} className="space-y-3">
          <div className="overflow-hidden rounded-xl border">{children}</div>
          {footer}
        </div>
      ) : null}
    </section>
  );
}

function InventoryState({
  pending,
  error,
  empty,
  onRetry,
}: {
  pending: boolean;
  error: unknown;
  empty: boolean;
  onRetry?: () => void;
}) {
  if (pending)
    return (
      <p className="text-muted-foreground col-span-full rounded-xl border p-4 text-sm">
        Loading…
      </p>
    );
  if (error)
    return (
      <div role="alert" className="flex items-center justify-between gap-3 p-4">
        <p className="text-destructive text-sm">
          This group could not be loaded.
        </p>
        {onRetry ? (
          <Button size="sm" variant="outline" onClick={onRetry}>
            Retry
          </Button>
        ) : null}
      </div>
    );
  if (empty)
    return (
      <p className="text-muted-foreground col-span-full rounded-xl border border-dashed p-4 text-sm">
        No matching items.
      </p>
    );
  return null;
}

function ProductRow({
  card,
  onPreview,
  onManage,
}: {
  card: LibraryProductCard;
  onPreview: () => void;
  onManage?: () => void;
}) {
  const itemId = card.itemId;
  const componentType =
    card.family === "particle"
      ? "particle_effect"
      : card.family === "avatar-effect"
        ? "avatar_effect"
        : card.family === "scene"
          ? "scene_effect"
          : "sound_effect";
  const editPath =
    card.family === "pose"
      ? `/a/poses/${itemId}/edit`
      : card.origin === "Mine" && itemId
        ? card.family === "gesture"
          ? `/a/gestures/${itemId}/edit`
          : card.family === "reaction"
            ? `/a/reactions/${itemId}/edit`
            : card.family === "particle"
              ? `/a/particle-effects/${itemId}/edit`
              : card.family === "avatar-effect"
                ? `/a/avatar-effects/${itemId}/edit`
                : card.family === "scene"
                  ? `/a/scene-effects/${itemId}/edit`
                  : card.family === "sound"
                    ? `/a/sound-effects/${itemId}/edit`
                    : null
        : null;
  const policy = libraryProductActionPolicy(card);
  return (
    <LibraryProductRow
      row={libraryRowPresentation(card)}
      actions={
        <>
          {policy.preview ? (
            <Button size="sm" variant="outline" onClick={onPreview}>
              <Play /> Preview
            </Button>
          ) : null}
          {policy.manage && onManage ? (
            <Button size="sm" onClick={onManage}>
              <Plus />
              Add / Manage
            </Button>
          ) : null}
          {(policy.edit || policy.customize) && editPath ? (
            <Button size="sm" variant="outline" asChild>
              <Link to={editPath}>
                <Pencil /> {policy.customize ? "Customize" : "Edit"}
              </Link>
            </Button>
          ) : null}
          {policy.useInGesture ? (
            <Button size="sm" asChild>
              <Link
                to="/a/gestures/new"
                search={{ component: card.itemId, componentType }}
              >
                <WandSparkles /> Use in Gesture
              </Link>
            </Button>
          ) : null}
          {policy.useInReaction ? (
            <Button size="sm" asChild>
              <Link
                to="/a/reactions/new"
                search={{ component: card.itemId, componentType }}
              >
                <WandSparkles /> Use in Reaction
              </Link>
            </Button>
          ) : null}
        </>
      }
    />
  );
}

function LoadMore({
  query,
}: {
  query: {
    hasNextPage?: boolean;
    isFetchingNextPage: boolean;
    fetchNextPage: () => Promise<unknown>;
  };
}) {
  return query.hasNextPage ? (
    <Button
      variant="outline"
      size="sm"
      disabled={query.isFetchingNextPage}
      onClick={() => void query.fetchNextPage()}
    >
      {query.isFetchingNextPage ? <Loader2 className="animate-spin" /> : null}
      Load more
    </Button>
  ) : null;
}

/** Typed product inventory; every group retains its own cursor and request. */
export function LibraryContentInventory({
  search,
  onSearchChange,
}: {
  search: ContentLibrarySearch;
  onSearchChange: SearchUpdate;
}) {
  const groups = contentInventoryGroups(search);
  const includes = (group: LibraryInventoryGroup) => groups.includes(group);
  const origin = search.showStarters ? "all" : "owned";
  const gestures = useGestures({
    query: search.query,
    origin,
    sort: search.sort,
    implementationKind:
      search.section !== "actions" || search.gestureMotion === "all"
        ? undefined
        : search.gestureMotion,
    enabled: includes("gestures"),
  });
  const poses = usePoses({
    query: search.query,
    origin,
    enabled: includes("poses"),
  });
  const reactions = useReactions({
    query: search.query,
    origin,
    sort: search.sort,
    enabled: includes("reactions"),
  });
  const {
    particles,
    sounds,
    avatars: avatarEffects,
    scenes,
  } = useEffects({
    query: search.query,
    origin,
    sort: search.sort,
    enabledFamilies: {
      particles: includes("particle"),
      sounds: includes("sound"),
      avatars: includes("avatar-effects"),
      scenes: includes("scene"),
    },
  });
  const avatars = useAvatarCatalog({
    query: search.query,
    origin,
    sort: search.sort,
    enabled: includes("avatars"),
  });
  const [manage, setManage] = useState<ManageActionTarget | null>(null);
  const [effectPreview, setEffectPreview] = useState<PyContentPreview | null>(
    null,
  );
  const [effectPreviewName, setEffectPreviewName] = useState<string | null>(
    null,
  );
  const effectAudio = useContentPreviewAudio(effectPreview);
  const { openPreview } = useContentPreviewDock();
  const gestureRows = useMemo(() => {
    const cards = (
      gestures.data?.pages.flatMap((page) => page.items) ?? []
    ).map((item) => actionLibraryCard("gesture", item));
    return filterAndSortLibraryGestures(cards, {
      gestureUpdatesOnly: search.gestureUpdatesOnly,
      gestureStatus: search.gestureStatus,
      gestureSort: search.gestureSort,
    });
  }, [
    gestures.data,
    search.gestureSort,
    search.gestureStatus,
    search.gestureUpdatesOnly,
  ]);
  const reactionRows = useMemo(
    () =>
      (reactions.data?.pages.flatMap((page) => page.items) ?? []).map((item) =>
        actionLibraryCard("reaction", item),
      ),
    [reactions.data],
  );
  const effectRows = (
    family: "particle" | "avatar-effect" | "scene" | "sound",
    values: PyCatalogViewItem[],
  ) => values.map((item) => effectLibraryCard(family, item));

  const previewPose = (card: LibraryProductCard) => {
    const item = poses.data?.items.find(
      (candidate) => candidate.item_id === card.itemId,
    );
    if (!item) return;
    setEffectPreview(null);
    openPreview(posePreviewTarget(item));
  };
  const previewAction = async (card: LibraryProductCard) => {
    if (!card.source) return;
    setEffectPreview(null);
    if (card.source.type !== "catalog") return;
    const preview = typedActionPreview(
      await previewTypedCatalogItem(
        card.family as "gesture" | "reaction",
        card.source.catalog_item_id,
      ),
    );
    openPreview(actionPreviewTarget(preview, card.name));
  };
  const previewEffect = async (card: LibraryProductCard) => {
    if (!card.source) return;
    setEffectPreview(null);
    if (card.source.type !== "catalog") return;
    const kind = (
      {
        particle: "particle_effect",
        sound: "sound_effect",
        "avatar-effect": "avatar_effect",
        scene: "scene_effect",
      } as const
    )[card.family as "particle" | "sound" | "avatar-effect" | "scene"];
    const preview = await previewCatalogItem(
      card.source.catalog_item_id,
      undefined,
      kind,
    );
    if (card.family === "particle") {
      openPreview(
        componentPreviewTarget(preview, "particle_effect", card.name),
      );
    } else if (card.family === "sound") {
      setEffectPreviewName(card.name);
      setEffectPreview(preview);
    } else if (card.family === "avatar-effect" || card.family === "scene") {
      openPreview(
        componentPreviewTarget(
          preview,
          card.family === "avatar-effect" ? "avatar_effect" : "scene_effect",
          card.name,
        ),
      );
    }
  };
  const previewAvatar = async (avatar: PyAvatarCatalogItem) => {
    if (!avatar.catalog_item_id) return;
    setEffectPreview(null);
    const preview = await previewCatalogItem(
      avatar.catalog_item_id,
      undefined,
      "avatar",
    );
    openPreview(avatarPreviewTarget(preview, avatar.name));
  };
  const manageCard = (card: LibraryProductCard) =>
    card.source &&
    setManage({
      kind: card.family as "gesture" | "reaction",
      itemId: card.itemId,
      name: card.name,
      description: card.description,
      source: card.source,
      emotion: card.emotion,
      intensity: card.intensity,
      includedCount: card.includedCount,
    });
  const renderCards = (cards: LibraryProductCard[]) =>
    cards.map((card) => (
      <ProductRow
        key={card.key}
        card={card}
        onPreview={() =>
          void (card.family === "pose"
            ? previewPose(card)
            : card.family === "gesture" || card.family === "reaction"
              ? previewAction(card)
              : previewEffect(card))
        }
        onManage={
          card.family === "gesture" || card.family === "reaction"
            ? () => manageCard(card)
            : undefined
        }
      />
    ));

  const typedGroups: Array<{
    id: LibraryInventoryGroup;
    title: string;
    cards: LibraryProductCard[];
    query?: typeof gestures | typeof poses;
  }> = [
    { id: "gestures", title: "Gestures", cards: gestureRows, query: gestures },
    {
      id: "reactions",
      title: "Reactions",
      cards: reactionRows,
      query: reactions as typeof gestures,
    },
    {
      id: "poses",
      title: "Poses",
      cards: (poses.data?.items ?? []).map(poseLibraryCard),
      query: poses,
    },
    {
      id: "particle",
      title: "Particle Effects",
      cards: effectRows(
        "particle",
        particles.data?.pages.flatMap((page) => page.items) ?? [],
      ),
      query: particles as typeof gestures,
    },
    {
      id: "avatar-effects",
      title: "Avatar Effects",
      cards: effectRows(
        "avatar-effect",
        avatarEffects.data?.pages.flatMap((page) => page.items) ?? [],
      ),
      query: avatarEffects as typeof gestures,
    },
    {
      id: "scene",
      title: "Scene Effects",
      cards: effectRows(
        "scene",
        scenes.data?.pages.flatMap((page) => page.items) ?? [],
      ),
      query: scenes as typeof gestures,
    },
    {
      id: "sound",
      title: "Sound Effects",
      cards: effectRows(
        "sound",
        sounds.data?.pages.flatMap((page) => page.items) ?? [],
      ),
      query: sounds as typeof gestures,
    },
  ];
  return (
    <div className="space-y-3">
      <div className="bg-background/95 sticky top-11 z-30 grid grid-cols-[minmax(0,1fr)_auto] gap-3 py-3 backdrop-blur-sm">
        <label className="relative">
          <Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            className="h-11 pl-9"
            value={search.query ?? ""}
            placeholder="Search the Library"
            onChange={(event) =>
              onSearchChange({ query: event.target.value || undefined })
            }
          />
        </label>
        <LibraryFilterMenu search={search} onSearchChange={onSearchChange} />
      </div>
      {groups.includes("avatars") ? (
        <div>
          <ProductGroup
            id="avatars"
            title="Avatars"
            footer={<LoadMore query={avatars} />}
          >
            <InventoryState
              pending={avatars.isPending}
              error={avatars.error}
              empty={
                avatars.data !== undefined &&
                !avatars.data.pages.some((page) => page.items.length)
              }
              onRetry={() => void avatars.refetch()}
            />
            {(avatars.data?.pages.flatMap((page) => page.items) ?? []).map(
              (avatar) => (
                <LibraryProductRow
                  key={avatar.avatar_id}
                  portraitUrl={avatar.preview_url}
                  row={{
                    family: "avatar",
                    name: avatar.name,
                    description: avatarLibraryDescription(avatar.description),
                    metadata: [],
                    origin: avatar.origin === "local" ? "Mine" : "Built-in",
                  }}
                  actions={
                    <>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!avatar.catalog_item_id}
                        onClick={() => void previewAvatar(avatar)}
                      >
                        <Play /> Preview
                      </Button>
                      {avatar.catalog_item_id ? (
                        <Button size="sm" asChild>
                          <Link
                            to="/a/animas/new"
                            search={{ avatar: avatar.catalog_item_id }}
                          >
                            <Plus /> Create Anima
                          </Link>
                        </Button>
                      ) : (
                        <Button size="sm" disabled>
                          <Plus /> Draft
                        </Button>
                      )}
                    </>
                  }
                />
              ),
            )}
          </ProductGroup>
        </div>
      ) : null}
      {typedGroups
        .filter((group) => groups.includes(group.id))
        .map((group) => (
          <div key={group.id}>
            <ProductGroup
              id={group.id}
              title={group.title}
              footer={
                group.query && "fetchNextPage" in group.query ? (
                  <LoadMore query={group.query} />
                ) : undefined
              }
            >
              <InventoryState
                pending={Boolean(group.query?.isPending)}
                error={group.query?.error}
                empty={Boolean(group.query?.data) && group.cards.length === 0}
                onRetry={() => void group.query?.refetch()}
              />
              {renderCards(group.cards)}
            </ProductGroup>
          </div>
        ))}
      {effectPreview ? (
        <section
          className="bg-muted flex flex-wrap items-center justify-between gap-3 rounded-xl p-4"
          aria-live="polite"
        >
          <div>
            <h2 className="font-medium">
              Sound preview{effectPreviewName ? ` · ${effectPreviewName}` : ""}
            </h2>
            <p className="text-muted-foreground text-sm">
              {effectAudio.status === "loading"
                ? "Preparing exact audio…"
                : effectAudio.status === "playing"
                  ? "Playing"
                  : effectAudio.status === "blocked"
                    ? "Your browser blocked automatic playback."
                    : "Ready to play"}
            </p>
          </div>
          {effectAudio.status === "playing" ? (
            <Button size="sm" variant="outline" onClick={effectAudio.stop}>
              <Pause /> Stop
            </Button>
          ) : effectAudio.url ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => void effectAudio.play()}
            >
              <Play /> Play
            </Button>
          ) : null}
          {effectAudio.error ? (
            <p className="text-destructive basis-full text-sm">
              {effectAudio.error}
            </p>
          ) : null}
        </section>
      ) : null}
      {!groups.length ? (
        <div className="rounded-xl border border-dashed p-8 text-center">
          <Sparkles className="mx-auto size-5" />
          <p className="mt-2 font-medium">
            Chat Uploads are managed separately below.
          </p>
        </div>
      ) : null}
      <ActionManageDialog
        open={Boolean(manage)}
        onOpenChange={(open) => {
          if (!open) setManage(null);
        }}
        target={manage}
        onPreview={() => {
          if (manage)
            void previewAction({
              key: "manage",
              itemId: manage.itemId,
              family: manage.kind,
              name: manage.name,
              description: manage.description,
              origin: "Mine",
              sourceLabel: "Local",
              updateAvailable: false,
              equippedCount: 0,
              includedCount: manage.includedCount ?? 0,
              source: manage.source ?? null,
              emotion: manage.emotion,
              intensity: manage.intensity,
            });
        }}
      />
    </div>
  );
}
