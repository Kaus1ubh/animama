import { useProductApiClient } from "@animama/product-ui";
import type { Client } from "@animama/runtime-contracts/sdk";

import { useCallback } from "react";
import {
  type InfiniteData,
  useInfiniteQuery,
  useQuery,
} from "@tanstack/react-query";

import {
  getAvatarEffect,
  getParticleEffect,
  getSceneEffect,
  getSoundEffect,
  listAvatarEffects,
  listParticleEffects,
  listSceneEffects,
  listSoundEffects,
} from "@animama/runtime-contracts/sdk";
import type {
  PyCatalogViewItem,
  PyContentPage,
} from "@/lib/content/catalogTypes";
import { typedComponentCatalogViewItem } from "@/lib/content/catalogTypes";
import { isNonPortable } from "@/lib/content/portability";
import { matchesContentName } from "@/lib/content/librarySearch";
import { useRuntimeCacheKey } from "@/app/runtime/RuntimeOwnerContext";
import { queryKeys } from "@/query/keys";
import { compareDisplayText } from "@animama/product-ui/i18n";
import { selectPageItems } from "./selectPageItems";

export type ContentOrigin = "all" | "builtin" | "owned";
export type ActionComponentType =
  | "particle_effect"
  | "avatar_effect"
  | "scene_effect"
  | "sound_effect";

type EffectCatalogInput = {
  query?: string;
  origin?: ContentOrigin;
  /** Ignored: every family lists by name. */
  sort?: "relevance" | "updated" | "name";
  enabled?: boolean;
  /** Ignored: every family is one unpaginated page. */
  limit?: number;
};

type EffectListInput = EffectCatalogInput & {
  enabledFamilies?: Partial<
    Record<"particles" | "sounds" | "avatars" | "scenes", boolean>
  >;
};

async function effectRows(
  apiClient: Client,
  kind: ActionComponentType,
): Promise<PyCatalogViewItem[]> {
  const options = { responseValidator: undefined, throwOnError: true as const };
  switch (kind) {
    case "particle_effect":
      return (
        await listParticleEffects({ ...options, client: apiClient })
      ).data.items.map(typedComponentCatalogViewItem);
    case "avatar_effect":
      return (
        await listAvatarEffects({ ...options, client: apiClient })
      ).data.items.map(typedComponentCatalogViewItem);
    case "scene_effect":
      return (
        await listSceneEffects({ ...options, client: apiClient })
      ).data.items.map(typedComponentCatalogViewItem);
    case "sound_effect":
      return (
        await listSoundEffects({ ...options, client: apiClient })
      ).data.items.map(typedComponentCatalogViewItem);
  }
}

async function effectItem(
  apiClient: Client,
  kind: ActionComponentType,
  itemId: string,
): Promise<PyCatalogViewItem> {
  const options = {
    path: { item_id: itemId },
    responseValidator: undefined,
    throwOnError: true as const,
  };
  switch (kind) {
    case "particle_effect":
      return typedComponentCatalogViewItem(
        (await getParticleEffect({ ...options, client: apiClient })).data,
      );
    case "avatar_effect":
      return typedComponentCatalogViewItem(
        (await getAvatarEffect({ ...options, client: apiClient })).data,
      );
    case "scene_effect":
      return typedComponentCatalogViewItem(
        (await getSceneEffect({ ...options, client: apiClient })).data,
      );
    case "sound_effect":
      return typedComponentCatalogViewItem(
        (await getSoundEffect({ ...options, client: apiClient })).data,
      );
  }
}

/** Every listable row of one family, sorted by name. */
async function effectPage(
  apiClient: Client,
  kind: ActionComponentType,
): Promise<PyContentPage> {
  return {
    items: listedEffectRows(kind, await effectRows(apiClient, kind), {}),
    next_cursor: null,
    query: {},
  };
}

/** Whether one row is listed for this origin and search. */
function effectRowListed(
  kind: ActionComponentType,
  item: PyCatalogViewItem,
  origin: ContentOrigin,
  query: string,
): boolean {
  return (
    // Licensed sounds play only through their built-in effects: Library
    // and the creator pickers never list or preview them alone. A Local
    // file with the same bytes is non-portable too, and equally hidden.
    !(kind === "sound_effect" && isNonPortable(item)) &&
    (origin === "all" ||
      (origin === "builtin"
        ? item.catalog_source === "included"
        : item.catalog_source === "local")) &&
    matchesContentName(item.name, query)
  );
}

/** Filter and sort one family's rows for the Library and creator pickers. */
export function listedEffectRows(
  kind: ActionComponentType,
  rows: PyCatalogViewItem[],
  input: EffectCatalogInput,
): PyCatalogViewItem[] {
  const origin = input.origin ?? "all";
  return rows
    .filter((item) => effectRowListed(kind, item, origin, input.query ?? ""))
    .sort((left, right) => compareDisplayText(left.name, right.name));
}

/**
 * One family's rows for a caller. The whole family is cached under ``key`` and
 * the caller's origin and search filter it locally, so typing a search never
 * re-downloads the list. Every family is one unpaginated page.
 */
function useEffectPage(
  kind: ActionComponentType,
  key: readonly unknown[],
  input: EffectCatalogInput,
) {
  const apiClient = useProductApiClient();

  const userId = useRuntimeCacheKey();
  const origin = input.origin ?? "all";
  const query = input.query ?? "";
  const select = useCallback(
    (data: InfiniteData<PyContentPage>) =>
      selectPageItems<PyCatalogViewItem, PyContentPage>(data, (item) =>
        effectRowListed(kind, item, origin, query),
      ),
    [kind, origin, query],
  );
  return useInfiniteQuery<
    PyContentPage,
    Error,
    InfiniteData<PyContentPage>,
    readonly unknown[],
    string | null
  >({
    queryKey: key,
    enabled: Boolean(userId && input.enabled !== false),
    initialPageParam: null,
    queryFn: async () => effectPage(apiClient, kind),
    getNextPageParam: () => undefined,
    select,
  });
}

export function useParticleEffects(input: EffectCatalogInput = {}) {
  const userId = useRuntimeCacheKey();
  return useEffectPage(
    "particle_effect",
    queryKeys.particleEffects.list(userId ?? "__anon__", "", "all"),
    input,
  );
}

export function useSoundEffects(input: EffectCatalogInput = {}) {
  const userId = useRuntimeCacheKey();
  return useEffectPage(
    "sound_effect",
    queryKeys.soundEffects.list(userId ?? "__anon__", "", "all"),
    input,
  );
}

function useEffectItem(
  kind: ActionComponentType,
  itemId: string | null,
  key: readonly unknown[],
) {
  const apiClient = useProductApiClient();

  const userId = useRuntimeCacheKey();
  return useQuery<PyCatalogViewItem>({
    queryKey: key,
    enabled: Boolean(userId && itemId),
    queryFn: async () => {
      return effectItem(apiClient, kind, itemId!);
    },
  });
}

export function useParticleEffect(itemId: string | null) {
  const userId = useRuntimeCacheKey();
  return useEffectItem(
    "particle_effect",
    itemId,
    queryKeys.particleEffects.detail(
      userId ?? "__anon__",
      itemId ?? "__none__",
    ),
  );
}

export function useSoundEffect(itemId: string | null) {
  const userId = useRuntimeCacheKey();
  return useEffectItem(
    "sound_effect",
    itemId,
    queryKeys.soundEffects.detail(userId ?? "__anon__", itemId ?? "__none__"),
  );
}

export function useAvatarEffect(itemId: string | null) {
  const userId = useRuntimeCacheKey();
  return useEffectItem(
    "avatar_effect",
    itemId,
    queryKeys.avatarEffects.detail(userId ?? "__anon__", itemId ?? "__none__"),
  );
}

export function useSceneEffect(itemId: string | null) {
  const userId = useRuntimeCacheKey();
  return useEffectItem(
    "scene_effect",
    itemId,
    queryKeys.sceneEffects.detail(userId ?? "__anon__", itemId ?? "__none__"),
  );
}

export function useActionComponent(
  contentType: ActionComponentType | null,
  itemId: string | null,
) {
  const apiClient = useProductApiClient();

  const userId = useRuntimeCacheKey();
  return useQuery<PyCatalogViewItem>({
    queryKey: [
      "action-component",
      userId ?? "__anon__",
      contentType ?? "__none__",
      itemId ?? "__none__",
    ],
    enabled: Boolean(userId && contentType && itemId),
    queryFn: async () => {
      return effectItem(apiClient, contentType!, itemId!);
    },
  });
}

export function useAvatarEffectsPage(input: EffectListInput = {}) {
  const userId = useRuntimeCacheKey();
  return useEffectPage(
    "avatar_effect",
    ["avatar-effects", userId ?? "__anon__", "page"],
    input,
  );
}

export function useSceneEffectsPage(input: EffectListInput = {}) {
  const userId = useRuntimeCacheKey();
  return useEffectPage(
    "scene_effect",
    ["scene-effects", userId ?? "__anon__", "page"],
    input,
  );
}

export function useEffects(input: EffectListInput = {}) {
  return {
    particles: useParticleEffects({
      ...input,
      enabled: input.enabledFamilies?.particles ?? input.enabled,
    }),
    sounds: useSoundEffects({
      ...input,
      enabled: input.enabledFamilies?.sounds ?? input.enabled,
    }),
    avatars: useAvatarEffectsPage({
      ...input,
      enabled: input.enabledFamilies?.avatars ?? input.enabled,
    }),
    scenes: useSceneEffectsPage({
      ...input,
      enabled: input.enabledFamilies?.scenes ?? input.enabled,
    }),
  };
}
