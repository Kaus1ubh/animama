import { getI18n } from "react-i18next";
import type {
  PyTypedContentPreview,
  PyTypedDependency,
} from "@animama/runtime-contracts/api-types";
import type {
  PyActionPreview,
  PyContentPreviewFile,
  PyIdlePreview,
} from "@/lib/content/catalogTypes";
import { typedLogicalResourceFiles } from "@/lib/content/typedLogicalResources";
import { WordedError } from "@/lib/errors/apiError";

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
  if (dependency.item_id)
    return (
      candidates.find((item) => item.item_id === dependency.item_id) ?? null
    );
  // A typed preview gives every member its ID; a null one is a removed
  // Included effect, never a similar item.
  if (dependency.item_id === null) return null;
  return (
    candidates.find((item) => item.logical_key === dependency.ref) ??
    // Only an item of the dependency's kind may match by name.
    candidates.find(
      (item) =>
        item.kind === dependency.kind &&
        item.logical_key?.split(":").at(-1) === suffix,
    ) ??
    null
  );
}

const REMOVABLE_EFFECT_KINDS = new Set([
  "avatar_effect",
  "particle_effect",
  "scene_effect",
]);

/**
 * Alias → ref of each Included effect the Action names that was removed (no
 * preview item carries it) and each optional sound this installation omitted.
 * The Action plays without them.
 */
function missingReferences(
  preview: PyTypedContentPreview,
  dependencies: readonly PyTypedDependency[] | undefined,
): Record<string, string> {
  return {
    ...(preview.optional_omitted ?? {}),
    ...Object.fromEntries(
      (dependencies ?? []).flatMap((dependency) =>
        !targetForDependency(preview, dependency) &&
        dependency.alias &&
        REMOVABLE_EFFECT_KINDS.has(dependency.kind) &&
        dependency.ref.startsWith("builtin:")
          ? [[dependency.alias, dependency.ref]]
          : [],
      ),
    ),
  };
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
    portability: item.portability,
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
          // Creators never copy a licensed (non-portable) target into a draft.
          portability: target.portability,
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
    const t = getI18n().getFixedT(null, "library");
    throw new WordedError(t("content.preview.notAction"));
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
    missing_references: missingReferences(preview, item.dependencies),
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

/** Preview one Gesture for idle use with its exact finite playback facts. */
export function typedIdleGesturePreview(
  preview: PyTypedContentPreview,
): PyIdlePreview {
  const t = getI18n().getFixedT(null, "library");
  const gesture = preview.item;
  const selectedRef = gesture.kind === "gesture" ? gesture.logical_key : null;
  if (!selectedRef)
    throw new WordedError(t("content.preview.idleGestureUnavailable"));
  return {
    ...typedActionPreview(preview),
    idle_playback: preview.idle_playback?.[selectedRef] ?? {
      eligible: false,
      reason: "idle_playback_unavailable",
    },
    selected_gesture_ref: selectedRef,
    selected_gesture_name: gesture.name,
  };
}
