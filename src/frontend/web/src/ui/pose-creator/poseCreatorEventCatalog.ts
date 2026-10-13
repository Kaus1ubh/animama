import type { AnimaPoseClipEvent } from "@/lib/avatar/poses/animaPoseClip/clipVocabulary";
import type { ParticleVFXCatalogEntry } from "@/lib/avatar/particle-vfx/types";
import type { AvatarVFXCatalogEntry } from "@/lib/avatar/vfx/types";
import type { RuntimeAudioDescriptor } from "@/lib/runtime-content/AnimaRuntimeMediaCatalog";
import type { SceneVFXEntry, SceneVFXKind } from "@/lib/scene-vfx/types";
import { compareDisplayText } from "@animama/product-ui/i18n";

export type PoseCreatorAvatarVFXOption = {
  id: string;
  label: string;
  detail: string;
  soundOnApply: string | null;
};

export type PoseCreatorParticleVFXOption = {
  id: string;
  label: string;
  detail: string;
  defaultAnchor: ParticleVFXCatalogEntry["defaultAnchor"];
  defaultDurationSec: number;
  assetPath: string;
  defaultTransform: ParticleVFXCatalogEntry["defaultTransform"];
};

export type PoseCreatorSceneVFXOption = {
  id: string;
  label: string;
  detail: string;
  sceneKind: SceneVFXKind;
  soundOnApply?: string | null;
};

export type PoseCreatorSFXOption = {
  id: string;
  label: string;
  detail: string;
};

export type PoseCreatorEventCatalog = {
  avatarVFX: PoseCreatorAvatarVFXOption[];
  particleVFX: PoseCreatorParticleVFXOption[];
  sceneBackground: PoseCreatorSceneVFXOption[];
  sceneFocus: PoseCreatorSceneVFXOption[];
  sfx: PoseCreatorSFXOption[];
  validationRefs: {
    avatarVFXIds: string[];
    sceneBackgroundLayerPresetIds: string[];
    sceneFocusLinePresetIds: string[];
    particleVFXIds: string[];
    sfxCueIds: string[];
  };
};

export type PoseCreatorEventCatalogSource = {
  listAvatarVFX(): readonly AvatarVFXCatalogEntry[];
  listParticleVFX(): readonly ParticleVFXCatalogEntry[];
  listSceneVFX(kind: SceneVFXKind): readonly SceneVFXEntry[];
  listAudio(kind: "sfx"): readonly RuntimeAudioDescriptor[];
};

const EMPTY_EVENT_CATALOG: PoseCreatorEventCatalog = {
  avatarVFX: [],
  particleVFX: [],
  sceneBackground: [],
  sceneFocus: [],
  sfx: [],
  validationRefs: {
    avatarVFXIds: [],
    sceneBackgroundLayerPresetIds: [],
    sceneFocusLinePresetIds: [],
    particleVFXIds: [],
    sfxCueIds: [],
  },
};

/** Project one mounted Anima catalog into exact runtime-ID editor choices. */
export function createPoseCreatorEventCatalog(
  source: PoseCreatorEventCatalogSource | null,
): PoseCreatorEventCatalog {
  if (!source) return EMPTY_EVENT_CATALOG;

  const sfx = sortOptions(
    source.listAudio("sfx").map((entry) => ({
      id: entry.runtimeId,
      label: entry.label,
      detail: `equipped SFX / volume ${entry.volume}`,
    })),
  );
  const sfxIds = new Set(sfx.map((entry) => entry.id));
  const avatarVFX = sortOptions(
    source.listAvatarVFX().map((entry) => ({
      id: entry.id,
      label: entry.label,
      detail: `${entry.kind} / ${entry.region} / available resource`,
      soundOnApply:
        entry.sound?.onApply && sfxIds.has(entry.sound.onApply)
          ? entry.sound.onApply
          : null,
    })),
  );
  const particleVFX = sortOptions(
    source.listParticleVFX().map((entry) => ({
      id: entry.id,
      label: entry.label,
      detail: `anchor ${entry.defaultAnchor} / ${entry.defaultDurationSec.toFixed(2)}s / available resource`,
      defaultAnchor: entry.defaultAnchor,
      defaultDurationSec: entry.defaultDurationSec,
      assetPath: entry.assetPath,
      defaultTransform: entry.defaultTransform,
    })),
  );
  const sceneBackground = sceneOptions(
    source.listSceneVFX("background_layers"),
    "background_layers",
    sfxIds,
  );
  const sceneFocus = sceneOptions(
    source.listSceneVFX("focus_lines"),
    "focus_lines",
    sfxIds,
  );

  return {
    avatarVFX,
    particleVFX,
    sceneBackground,
    sceneFocus,
    sfx,
    validationRefs: {
      avatarVFXIds: avatarVFX.map((entry) => entry.id),
      sceneBackgroundLayerPresetIds: sceneBackground.map((entry) => entry.id),
      sceneFocusLinePresetIds: sceneFocus.map((entry) => entry.id),
      particleVFXIds: particleVFX.map((entry) => entry.id),
      sfxCueIds: sfx.map((entry) => entry.id),
    },
  };
}

/** Keep an imported unavailable runtime ID visible until it is replaced. */
export function withUnavailableEventOption<
  T extends { id: string; label: string },
>(
  options: readonly T[],
  currentId: string,
): Array<T | { id: string; label: string; unavailable: true }> {
  if (!currentId || options.some((option) => option.id === currentId)) {
    return [...options];
  }
  return [
    { id: currentId, label: `${currentId} · unavailable`, unavailable: true },
    ...options,
  ];
}

function sceneOptions(
  entries: readonly SceneVFXEntry[],
  kind: SceneVFXKind,
  sfxIds: Set<string>,
): PoseCreatorSceneVFXOption[] {
  return sortOptions(
    entries.map((entry) => ({
      id: entry.id,
      label: entry.label,
      detail: `${kind === "background_layers" ? "background layers" : "focus lines"} / available resource`,
      sceneKind: kind,
      soundOnApply:
        entry.sound?.onApply && sfxIds.has(entry.sound.onApply)
          ? entry.sound.onApply
          : null,
    })),
  );
}

function sortOptions<T extends { id: string; label: string }>(
  values: T[],
): T[] {
  return values.sort(
    (left, right) =>
      compareDisplayText(left.label, right.label) ||
      left.id.localeCompare(right.id),
  );
}

/** Resolve only the sound attached to this exact effect, never an independent SFX event. */
export function accompanyingEventSound(
  event: AnimaPoseClipEvent,
  catalog: PoseCreatorEventCatalog,
): PoseCreatorSFXOption | null {
  const soundId =
    event.kind === "avatar_vfx"
      ? catalog.avatarVFX.find((option) => option.id === event.effectId)
          ?.soundOnApply
      : event.kind === "scene_vfx"
        ? (event.sceneKind === "background_layers"
            ? catalog.sceneBackground
            : catalog.sceneFocus
          ).find((option) => option.id === event.presetId)?.soundOnApply
        : null;
  return catalog.sfx.find((option) => option.id === soundId) ?? null;
}
