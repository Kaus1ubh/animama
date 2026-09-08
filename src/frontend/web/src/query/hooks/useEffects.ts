"use client";

import { useInfiniteQuery, useQuery } from "@tanstack/react-query";

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
import { useRuntimeOwnerId } from "@/app/runtime/RuntimeOwnerContext";
import { queryKeys } from "@/query/keys";

export type ContentOrigin = "all" | "builtin" | "owned";
export type ActionComponentType =
  | "particle_effect"
  | "avatar_effect"
  | "scene_effect"
  | "sound_effect";

type EffectCatalogInput = {
  query?: string;
  origin?: ContentOrigin;
  sort?: "relevance" | "updated" | "name";
  enabled?: boolean;
  limit?: number;
};

type EffectListInput = EffectCatalogInput & {
  enabledFamilies?: Partial<
    Record<"particles" | "sounds" | "avatars" | "scenes", boolean>
  >;
};

async function effectRows(
  kind: ActionComponentType,
): Promise<PyCatalogViewItem[]> {
  const options = { responseValidator: undefined, throwOnError: true as const };
  switch (kind) {
    case "particle_effect":
      return (await listParticleEffects(options)).data.items.map(
        typedComponentCatalogViewItem,
      );
    case "avatar_effect":
      return (await listAvatarEffects(options)).data.items.map(
        typedComponentCatalogViewItem,
      );
    case "scene_effect":
      return (await listSceneEffects(options)).data.items.map(
        typedComponentCatalogViewItem,
      );
    case "sound_effect":
      return (await listSoundEffects(options)).data.items.map(
        typedComponentCatalogViewItem,
      );
  }
}

async function effectItem(
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
        (await getParticleEffect(options)).data,
      );
    case "avatar_effect":
      return typedComponentCatalogViewItem(
        (await getAvatarEffect(options)).data,
      );
    case "scene_effect":
      return typedComponentCatalogViewItem(
        (await getSceneEffect(options)).data,
      );
    case "sound_effect":
      return typedComponentCatalogViewItem(
        (await getSoundEffect(options)).data,
      );
  }
}

async function effectPage(
  kind: ActionComponentType,
  input: EffectCatalogInput,
): Promise<PyContentPage> {
  const origin = input.origin ?? "all";
  const needle = (input.query ?? "").trim().toLocaleLowerCase();
  const rows = (await effectRows(kind)).filter(
    (item) =>
      (origin === "all" ||
        (origin === "builtin"
          ? item.catalog_source === "included"
          : item.catalog_source === "local")) &&
      (!needle ||
        item.name.toLocaleLowerCase().includes(needle) ||
        (item.description ?? "").toLocaleLowerCase().includes(needle)),
  );
  rows.sort((left, right) => left.name.localeCompare(right.name));
  return { items: rows, next_cursor: null, query: {} };
}

function useEffectPage(
  kind: ActionComponentType,
  key: readonly unknown[],
  input: EffectCatalogInput,
) {
  const userId = useRuntimeOwnerId();
  return useInfiniteQuery<PyContentPage>({
    queryKey: [...key, input.limit ?? 50],
    enabled: Boolean(userId && input.enabled !== false),
    initialPageParam: null as string | null,
    queryFn: async () => effectPage(kind, input),
    getNextPageParam: () => undefined,
  });
}

export function useParticleEffects(input: EffectCatalogInput = {}) {
  const userId = useRuntimeOwnerId();
  const query = input.query ?? "";
  const origin = input.origin ?? "all";
  const sort = input.sort ?? (query ? "relevance" : "updated");
  return useEffectPage(
    "particle_effect",
    queryKeys.particleEffects.list(userId ?? "__anon__", query, origin, sort),
    input,
  );
}

export function useSoundEffects(input: EffectCatalogInput = {}) {
  const userId = useRuntimeOwnerId();
  const query = input.query ?? "";
  const origin = input.origin ?? "all";
  const sort = input.sort ?? (query ? "relevance" : "updated");
  return useEffectPage(
    "sound_effect",
    queryKeys.soundEffects.list(userId ?? "__anon__", query, origin, sort),
    input,
  );
}

function useEffectItem(
  kind: ActionComponentType,
  itemId: string | null,
  key: readonly unknown[],
) {
  const userId = useRuntimeOwnerId();
  return useQuery<PyCatalogViewItem>({
    queryKey: key,
    enabled: Boolean(userId && itemId),
    queryFn: async () => {
      return effectItem(kind, itemId!);
    },
  });
}

export function useParticleEffect(itemId: string | null) {
  const userId = useRuntimeOwnerId();
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
  const userId = useRuntimeOwnerId();
  return useEffectItem(
    "sound_effect",
    itemId,
    queryKeys.soundEffects.detail(userId ?? "__anon__", itemId ?? "__none__"),
  );
}

export function useAvatarEffect(itemId: string | null) {
  const userId = useRuntimeOwnerId();
  return useEffectItem(
    "avatar_effect",
    itemId,
    queryKeys.avatarEffects.detail(userId ?? "__anon__", itemId ?? "__none__"),
  );
}

export function useSceneEffect(itemId: string | null) {
  const userId = useRuntimeOwnerId();
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
  const userId = useRuntimeOwnerId();
  return useQuery<PyCatalogViewItem>({
    queryKey: [
      "action-component",
      userId ?? "__anon__",
      contentType ?? "__none__",
      itemId ?? "__none__",
    ],
    enabled: Boolean(userId && contentType && itemId),
    queryFn: async () => {
      return effectItem(contentType!, itemId!);
    },
  });
}

export function useAvatarEffectsPage(input: EffectListInput = {}) {
  const userId = useRuntimeOwnerId();
  return useEffectPage(
    "avatar_effect",
    [
      "avatar-effects",
      userId ?? "__anon__",
      "page",
      input.query ?? "",
      input.origin ?? "all",
      input.sort ?? "name",
    ],
    input,
  );
}

export function useSceneEffectsPage(input: EffectListInput = {}) {
  const userId = useRuntimeOwnerId();
  return useEffectPage(
    "scene_effect",
    [
      "scene-effects",
      userId ?? "__anon__",
      "page",
      input.query ?? "",
      input.origin ?? "all",
      input.sort ?? "name",
    ],
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
