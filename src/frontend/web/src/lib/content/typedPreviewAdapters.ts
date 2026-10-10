import { getI18n } from "react-i18next";
import type {
  PyTypedContentPreview,
  PyTypedDependency,
} from "@animama/runtime-contracts/api-types";
import type {
  PyActionPreview,
  PyContentPreviewFile,
  PyIdleStylePreview,
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
  if (dependency.item_id)
    return (
      candidates.find((item) => item.item_id === dependency.item_id) ?? null
    );
  return (
    candidates.find((item) => item.logical_key === dependency.ref) ??
    candidates.find((item) => item.logical_key?.split(":").at(-1) === suffix) ??
    null
  );
}

function exactDependencyTarget(
  preview: PyTypedContentPreview,
  dependency: PyTypedDependency | undefined,
): PreviewItem | undefined {
  if (!dependency) return undefined;
  return [preview.item, ...(preview.supports ?? [])].find((item) =>
    dependency.item_id
      ? item.item_id === dependency.item_id
      : item.logical_key === dependency.ref,
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
    const t = getI18n().getFixedT(null, "library");
    throw new Error(t("content.preview.notAction"));
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

function idleGesturePreview(
  preview: PyTypedContentPreview,
  selectedRef: string,
): PyIdleStylePreview {
  return {
    ...typedActionPreview(preview),
    idle_playback: preview.idle_playback?.[selectedRef] ?? {
      eligible: false,
      reason: "idle_playback_unavailable",
    },
    selected_gesture_ref: selectedRef,
    selected_gesture_name: preview.item.name,
  };
}

/** Preview a Style member or draft candidate with its exact finite Gesture facts. */
export function typedIdleStylePreview(
  preview: PyTypedContentPreview,
  gestureRef?: string,
): PyIdleStylePreview {
  const t = getI18n().getFixedT(null, "library");
  const style = preview.item;
  if (style.kind === "gesture") {
    const selectedRef = style.logical_key;
    if (!selectedRef || (gestureRef && gestureRef !== selectedRef))
      throw new Error(t("content.preview.idleGestureUnavailable"));
    return idleGesturePreview(preview, selectedRef);
  }
  if (style.kind !== "idle_style")
    throw new Error(t("content.preview.notIdleStyle"));
  const selectedRef = gestureRef ?? style.default_pool[0];
  if (!selectedRef) throw new Error(t("content.preview.noIdleGesture"));
  const selectedDependency = (style.dependencies ?? []).find(
    (dependency) =>
      dependency.kind === "gesture" && dependency.ref === selectedRef,
  );
  const gesture = exactDependencyTarget(preview, selectedDependency);
  if (!gesture || gesture.kind !== "gesture")
    throw new Error(t("content.preview.idleGestureUnavailable"));
  const supports: PreviewItem[] = [];
  const seen = new Set([gesture.item_id]);
  const pending = [...(gesture.dependencies ?? [])];
  while (pending.length) {
    const dependency = pending.shift()!;
    const support = exactDependencyTarget(preview, dependency);
    if (!support)
      throw new Error(t("content.preview.idleDependencyUnavailable"));
    if (seen.has(support.item_id)) continue;
    seen.add(support.item_id);
    supports.push(support);
    pending.push(...(support.dependencies ?? []));
  }
  return idleGesturePreview(
    { ...preview, item: gesture, supports },
    selectedRef,
  );
}
