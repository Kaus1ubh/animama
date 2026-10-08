import { useNavigate } from "@tanstack/react-router";
import { FolderOpenIcon } from "lucide-react";
import { useState } from "react";

import type { PyCatalogViewItem } from "@/lib/content/catalogTypes";
import {
  useAvatarEffectsPage,
  useParticleEffects,
  useSceneEffectsPage,
} from "@/query/hooks/useEffects";
import { Button } from "@/ui/components/button";
import { Input } from "@/ui/components/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/ui/components/popover";

export type CreatorEffectType =
  | "particle_effect"
  | "avatar_effect"
  | "scene_effect";

/** Return the local, editable content accepted by the selected FX editor. */
export function creatorLoadItems(
  items: PyCatalogViewItem[],
  contentType: CreatorEffectType,
) {
  return items.filter(
    (item) =>
      item.kind === contentType &&
      item.origin === "owned" &&
      item.editable &&
      item.state === "ready" &&
      item.source,
  );
}

const labels: Record<CreatorEffectType, string> = {
  particle_effect: "Particle FX",
  avatar_effect: "Avatar FX",
  scene_effect: "Scene FX",
};

/** Keep normal router navigation so each creator's unsaved-change blocker applies. */
export function creatorEffectEditTarget(
  contentType: CreatorEffectType,
  itemId: string,
) {
  switch (contentType) {
    case "particle_effect":
      return {
        to: "/particle-effects/$particleEffectId/edit" as const,
        params: { particleEffectId: itemId },
      };
    case "avatar_effect":
      return {
        to: "/avatar-effects/$avatarEffectId/edit" as const,
        params: { avatarEffectId: itemId },
      };
    case "scene_effect":
      return {
        to: "/scene-effects/$sceneEffectId/edit" as const,
        params: { sceneEffectId: itemId },
      };
  }
}

/** Search editable FX without taking the author out of the current workspace. */
export function CreatorLoadPicker({
  contentType,
  disabled,
}: {
  contentType: CreatorEffectType;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          className="dark:bg-background dark:hover:bg-accent col-start-2 row-start-1 size-11 rounded-xl p-0 shadow-sm lg:col-start-3 lg:h-12 lg:w-12 2xl:w-auto 2xl:min-w-[88px] 2xl:px-4"
          aria-label={`Load ${labels[contentType]}`}
          title="Load"
        >
          <FolderOpenIcon className="size-4" />
          <span className="hidden 2xl:inline">Load</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        avoidSidebar
        align="start"
        sideOffset={12}
        className="w-[420px] rounded-xl p-3"
      >
        <CreatorLoadContents
          contentType={contentType}
          onLoaded={() => setOpen(false)}
        />
      </PopoverContent>
    </Popover>
  );
}

function CreatorLoadContents({
  contentType,
  onLoaded,
}: {
  contentType: CreatorEffectType;
  onLoaded: () => void;
}) {
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loadingItemId, setLoadingItemId] = useState<string | null>(null);
  const navigate = useNavigate();
  const input = { query: search, origin: "owned" as const };
  const particles = useParticleEffects({
    ...input,
    enabled: contentType === "particle_effect",
  });
  const avatars = useAvatarEffectsPage({
    ...input,
    enabled: contentType === "avatar_effect",
  });
  const scenes = useSceneEffectsPage({
    ...input,
    enabled: contentType === "scene_effect",
  });
  const query =
    contentType === "particle_effect"
      ? particles
      : contentType === "avatar_effect"
        ? avatars
        : scenes;
  const items = creatorLoadItems(
    query.data?.pages.flatMap((page) => page.items) ?? [],
    contentType,
  );
  const load = async (itemId: string) => {
    setLoadingItemId(itemId);
    setError(null);
    try {
      await navigate(creatorEffectEditTarget(contentType, itemId));
      onLoaded();
    } catch {
      setError("This effect could not be opened. Try again.");
    } finally {
      setLoadingItemId(null);
    }
  };
  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-semibold">Load {labels[contentType]}</p>
        <p className="text-muted-foreground text-xs">
          Open your editable Local content.
        </p>
      </div>
      <Input
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Search effects"
        aria-label={`Search ${labels[contentType]}`}
      />
      <div className="max-h-80 space-y-1 overflow-y-auto">
        {query.isPending ? (
          <p className="text-muted-foreground p-3 text-xs" role="status">
            Loading…
          </p>
        ) : query.isError ? (
          <div className="space-y-2 p-2">
            <p className="text-destructive text-xs" role="alert">
              Effects could not be loaded.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void query.refetch()}
            >
              Try again
            </Button>
          </div>
        ) : items.length ? (
          items.map((item) => (
            <Button
              key={item.item_id}
              type="button"
              variant="ghost"
              className="h-auto min-h-11 w-full justify-start px-2 py-2 text-left"
              disabled={loadingItemId !== null}
              onClick={() => void load(item.item_id)}
            >
              <span className="min-w-0">
                <span className="block truncate text-sm">{item.name}</span>
                <span className="text-muted-foreground text-2xs block">
                  {loadingItemId === item.item_id
                    ? "Opening…"
                    : "Editable Local content"}
                </span>
              </span>
            </Button>
          ))
        ) : (
          <p className="text-muted-foreground rounded-lg border border-dashed p-3 text-center text-xs">
            {search ? "No matching effects." : "No editable effects yet."}
          </p>
        )}
      </div>
      {error ? (
        <p className="text-destructive text-xs" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
