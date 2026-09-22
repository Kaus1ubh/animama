import type {
  PyTypedContentPreview,
  PyTypedDependency,
} from "@animama/runtime-contracts/api-types";
import type {
  PyActionPreview,
  PyContentPreviewFile,
  PyIdleStylePreview,
  PyMusicTrackPreview,
} from "@/lib/content/catalogTypes";
import { typedLogicalResourceFiles } from "@/lib/content/typedLogicalResources";

type PreviewItem = PyTypedContentPreview["item"];

function runtimeId(item: PreviewItem): string {
  return item.logical_key?.split(":").at(-1) ?? item.item_id;
}

function targetForDependency(
  preview: PyTypedContentPreview,
  dependency: PyTypedDependency | undefined,
): PreviewItem | null {
  if (!dependency) return null;
  const suffix = dependency.ref.split(":").at(-1);
  const candidates = [preview.item, ...(preview.supports ?? [])];
  return (
    candidates.find((item) => item.logical_key === dependency.ref) ??
    candidates.find((item) => item.logical_key?.split(":").at(-1) === suffix) ??
    null
  );
}

function previewFiles(preview: PyTypedContentPreview): PyContentPreviewFile[] {
  return preview.files.map((file) => ({ ...file }));
}

function filesForItem(
  preview: PyTypedContentPreview,
  item: PreviewItem,
): PyContentPreviewFile[] {
  const refs = new Set((item.files ?? []).map((file) => file.file_ref));
  return previewFiles(preview).filter(
    (file) =>
      refs.has(file.file_ref) &&
      file.role !== "descriptor" &&
      file.role !== "metadata",
  );
}

function source(item: PreviewItem) {
  return {
    type: "catalog" as const,
    catalog_item_id: item.item_id,
    logical_key: item.logical_key,
    source: item.source,
  };
}

function referenceMap(preview: PyTypedContentPreview, item: PreviewItem) {
  return Object.fromEntries(
    (item.dependencies ?? []).flatMap((dependency) => {
      const target = targetForDependency(preview, dependency);
      return dependency.alias && target
        ? [[dependency.alias, runtimeId(target)]]
        : [];
    }),
  );
}

function dependencyConfig(
  preview: PyTypedContentPreview,
  item: PreviewItem,
): Record<string, unknown> {
  for (const owner of [preview.item, ...(preview.supports ?? [])]) {
    const dependency = (owner.dependencies ?? []).find(
      (candidate) =>
        targetForDependency(preview, candidate)?.item_id === item.item_id,
    );
    if (dependency) return { ...(dependency.config ?? {}) };
  }
  return {};
}

function runtimeSlotDefaults(item: PreviewItem): Record<string, unknown> {
  if (
    item.kind !== "particle_effect" &&
    item.kind !== "avatar_effect" &&
    item.kind !== "scene_effect"
  ) {
    return {};
  }
  const slot = {
    particle_effect: "particle_vfx",
    avatar_effect: "avatar_vfx",
    scene_effect: "scene_vfx",
  }[item.kind];
  const runtimeDefaults = item.runtime_defaults ?? {};
  const slots: Record<string, unknown> =
    runtimeDefaults.slots && typeof runtimeDefaults.slots === "object"
      ? (runtimeDefaults.slots as Record<string, unknown>)
      : {};
  const defaults = slots[slot];
  return defaults && typeof defaults === "object" ? { ...defaults } : {};
}

function supportNode(preview: PyTypedContentPreview, item: PreviewItem) {
  const common = {
    runtime_id: runtimeId(item),
    content_type: item.kind,
    source: source(item),
    name: item.name,
    description: item.description,
    files: filesForItem(preview, item),
    logical_resource_files: typedLogicalResourceFiles(item),
    reference_map: referenceMap(preview, item),
  };
  switch (item.kind) {
    case "particle_effect":
      return {
        ...common,
        config: {
          ...runtimeSlotDefaults(item),
          ...dependencyConfig(preview, item),
        },
        definition: item.definition,
      };
    case "avatar_effect":
    case "scene_effect":
      return {
        ...common,
        config: {
          ...runtimeSlotDefaults(item),
          ...dependencyConfig(preview, item),
        },
        technical_source: item.technical_source,
        definition: item.definition,
      };
    case "sound_effect":
      return {
        ...common,
        config: { ...item.defaults, ...dependencyConfig(preview, item) },
      };
    default:
      return null;
  }
}

const COMPONENT_SUPPORT_KINDS = new Set([
  "particle_effect",
  "avatar_effect",
  "scene_effect",
  "sound_effect",
]);

/**
 * Supply the exact typed closure facts still consumed by component editors.
 * This is a view adapter only; product APIs remain strictly discriminated.
 */
export function typedComponentPreviewMetadata(
  preview: PyTypedContentPreview,
): Record<string, unknown> {
  const dependencies = (preview.item.dependencies ?? []).flatMap(
    (dependency) => {
      const target = targetForDependency(preview, dependency);
      if (!target || !COMPONENT_SUPPORT_KINDS.has(dependency.kind)) return [];
      return [
        {
          ref: dependency.ref,
          alias: dependency.alias,
          content_type: dependency.kind,
          source: source(target),
          config: dependency.config,
        },
      ];
    },
  );
  return {
    dependencies,
    reference_map: referenceMap(preview, preview.item),
    supports: (preview.supports ?? []).flatMap((support) => {
      const node = supportNode(preview, support);
      return node ? [node] : [];
    }),
  };
}

/** Bridge the new typed preview closure into the established preview player. */
export function typedActionPreview(
  preview: PyTypedContentPreview,
): PyActionPreview {
  const item = preview.item;
  if (item.kind !== "gesture" && item.kind !== "reaction") {
    throw new Error("The preview is not an Action.");
  }
  const implementationDependency = (item.dependencies ?? []).find(
    (dependency) =>
      dependency.ref === item.implementation.content_dependency_ref,
  );
  const implementationTarget = targetForDependency(
    preview,
    implementationDependency,
  );
  const root = {
    content_type: item.kind,
    source: source(item),
    name: item.name,
    description: item.description,
    semantic_key: item.kind === "gesture" ? item.semantic_key : undefined,
    placement_hint:
      item.kind === "reaction" && item.emotion && item.intensity
        ? { emotion: item.emotion, intensity: item.intensity }
        : undefined,
    implementation: item.implementation,
    config: item.config,
    dependencies: item.dependencies,
    reference_map: referenceMap(preview, item),
    logical_resource_files: typedLogicalResourceFiles(item),
    files: implementationTarget
      ? filesForItem(preview, implementationTarget)
      : filesForItem(preview, item),
  };
  const supports = (preview.supports ?? []).flatMap((support) => {
    const node = supportNode(preview, support);
    return node ? [node] : [];
  });
  return {
    preview_id: preview.preview_id,
    revision: preview.revision_sha256,
    revision_sha256: preview.revision_sha256,
    expires_at: preview.expires_at,
    files: previewFiles(preview),
    metadata: {},
    closure: {
      revision: preview.revision_sha256,
      diagnostics: [],
      root,
      supports,
    },
  } as PyActionPreview;
}

/** Select one exact typed Idle animation for the existing stage preview. */
export function typedIdleStylePreview(
  preview: PyTypedContentPreview,
  animationId?: string,
): PyIdleStylePreview {
  const item = preview.item;
  if (item.kind !== "idle_style") {
    throw new Error("The preview is not an Idle Style.");
  }
  const selectedId =
    animationId ?? item.default_pool[0] ?? item.animations[0]?.animation_id;
  const animations = item.animations.map((animation) => {
    const direct = (item.files ?? []).find(
      (file) => file.file_ref === animation.file_ref,
    );
    const dependency = (item.dependencies ?? []).find(
      (candidate) => candidate.ref === animation.dependency_ref,
    );
    const target = targetForDependency(preview, dependency);
    const file = direct
      ? preview.files.find(
          (candidate) => candidate.file_ref === direct.file_ref,
        )
      : target
        ? filesForItem(preview, target)[0]
        : undefined;
    return {
      animation_id: animation.animation_id,
      name: animation.name,
      description: animation.description,
      playback: animation.playback,
      file: file?.filename,
      ordinal: file?.ordinal,
    };
  });
  return {
    preview_id: preview.preview_id,
    revision: preview.revision_sha256,
    revision_sha256: preview.revision_sha256,
    expires_at: preview.expires_at,
    files: previewFiles(preview),
    metadata: {
      style: {
        animations,
        default_pool: item.default_pool,
        emotion_pools: item.emotion_pools,
        cross_fade_seconds: item.cross_fade_seconds,
      },
    },
    selected_animation_id: selectedId ?? null,
    selected_animation_name:
      animations.find((animation) => animation.animation_id === selectedId)
        ?.name ?? null,
  } as PyIdleStylePreview;
}

/** Preserve the existing audio-preview control while consuming typed fields. */
export function typedMusicTrackPreview(
  preview: PyTypedContentPreview,
): PyMusicTrackPreview {
  const item = preview.item;
  if (item.kind !== "music_track") {
    throw new Error("The preview is not a Music Track.");
  }
  return {
    preview_id: preview.preview_id,
    revision: preview.revision_sha256,
    revision_sha256: preview.revision_sha256,
    expires_at: preview.expires_at,
    files: previewFiles(preview),
    metadata: {},
    duration_seconds: item.duration_seconds,
    codec: item.codec,
    loop: item.loop,
    gain: item.gain,
  } as PyMusicTrackPreview;
}
