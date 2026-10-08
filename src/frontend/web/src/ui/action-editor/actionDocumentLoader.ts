import type {
  PyContentDependency,
  PyCatalogViewItem,
  PyGesture,
  PyActionPreview,
  PyReaction,
} from "@/lib/content/catalogTypes";
import {
  MAX_ANIMA_POSE_CLIP_BYTES,
  parseAnimaPoseClip,
} from "@/lib/avatar/poses/animaPoseClip";
import { BUILT_IN_AVATAR_MOTION_CATALOG } from "@/lib/avatar/motion/AvatarMotionCatalog";
import { fetchContentPreviewFile } from "@/lib/content/contentPreview";
import { actionClosure } from "@/lib/content-preview/ActionPreviewSession";
import { readBoundedJsonResponse } from "@/lib/runtime-content/runtimeContentDelivery";
import { gestureSemanticKey, normalizeActionDocument } from "./actionDocument";
import type { ActionDocument, ActionIntent } from "./actionDocument";

type ActionItem = PyGesture | PyReaction;

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function selectedIntensity(value: unknown): 1 | 2 | 3 {
  const intensity = Number(value);
  return intensity === 2 || intensity === 3 ? intensity : 1;
}

function dependenciesFromPreview(
  preview: PyActionPreview,
): PyContentDependency[] {
  const closure = actionClosure(preview);
  const supports = new Map(
    closure.supports.map((support) => [String(support.runtime_id), support]),
  );
  const resolved = Object.entries(object(closure.root.reference_map)).flatMap(
    ([alias, runtimeId]) => {
      const support = supports.get(String(runtimeId));
      const source = support?.source;
      const contentType = support?.content_type;
      return source &&
        typeof source === "object" &&
        [
          "particle_effect",
          "avatar_effect",
          "scene_effect",
          "sound_effect",
        ].includes(String(contentType))
        ? [
            {
              alias,
              content_type: contentType as PyContentDependency["content_type"],
              source: source as PyContentDependency["source"],
            },
          ]
        : [];
    },
  );
  if (resolved.length) return resolved;
  const authored = Array.isArray(closure.root.dependencies)
    ? closure.root.dependencies
    : [];
  return authored.flatMap((raw) => {
    const value = object(raw);
    const source = object(value.source);
    const contentType = value.content_type;
    const declaredRef = value.ref;
    const exactSource =
      source.type === "catalog" || source.type === "builtin"
        ? source
        : typeof declaredRef === "string" && declaredRef.startsWith("builtin:")
          ? {
              type: "builtin",
              content_id: declaredRef,
              // Included descriptors predate explicit source objects. Their
              // catalog contract is currently version 1, so reconstruct the
              // same exact source that the component catalog exposes.
              version:
                typeof value.version === "number" && value.version > 0
                  ? value.version
                  : 1,
            }
          : null;
    return typeof value.alias === "string" &&
      [
        "particle_effect",
        "avatar_effect",
        "scene_effect",
        "sound_effect",
      ].includes(String(contentType)) &&
      exactSource
      ? [
          {
            alias: value.alias,
            content_type: contentType as PyContentDependency["content_type"],
            source: exactSource as PyContentDependency["source"],
            config: object(value.config),
          },
        ]
      : [];
  });
}

async function ownedSequence(
  preview: PyActionPreview,
  root: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const sequenceFile = (Array.isArray(root.files) ? root.files : []).find(
    (raw) => object(raw).role === "sequence",
  );
  const fileRef = object(sequenceFile).file_ref;
  if (typeof fileRef !== "string" || !fileRef) {
    throw new Error("This Action has no readable sequence.");
  }
  const response = await fetchContentPreviewFile(preview, {
    file_ref: fileRef,
  });
  if (!response.ok) {
    throw new Error("This Action could not be downloaded.");
  }
  return (await readBoundedJsonResponse(
    response,
    MAX_ANIMA_POSE_CLIP_BYTES,
  )) as Record<string, unknown>;
}

function builtinSequence(
  intent: ActionIntent,
  root: Record<string, unknown>,
): Record<string, unknown> {
  const technical = object(object(root.implementation).technical_source);
  const key =
    technical.type === "runtime_catalog"
      ? technical.key
      : technical.type === "content_dependency"
        ? technical.ref
        : null;
  if (typeof key !== "string") {
    throw new Error("Only Starter Anima Pose Clips can be customized.");
  }
  const clip =
    intent === "gesture"
      ? BUILT_IN_AVATAR_MOTION_CATALOG.getPoseClip(key)
      : BUILT_IN_AVATAR_MOTION_CATALOG.getReactionClip(key);
  if (!clip) throw new Error("This Starter Anima Pose Clip is unavailable.");
  return structuredClone(clip) as unknown as Record<string, unknown>;
}

/** Return whether one catalog row is an editable built-in Anima Pose Clip. */
export function isCustomizableStarterAction(
  item: PyCatalogViewItem,
  intent: ActionIntent,
): item is PyGesture | PyReaction {
  if (item.origin !== "builtin") return false;
  const contentId = item.logical_key;
  if (typeof contentId !== "string") return false;
  const prefix = `builtin:${intent}:`;
  if (!contentId.startsWith(prefix)) return false;
  const runtimeId = contentId.slice(prefix.length);
  return Boolean(
    intent === "gesture"
      ? BUILT_IN_AVATAR_MOTION_CATALOG.getPoseClip(runtimeId)
      : BUILT_IN_AVATAR_MOTION_CATALOG.getReactionClip(runtimeId),
  );
}

/** Create a collision-resistant model selector for a private Starter fork. */
export function starterGestureSemanticKey(
  original: string,
  suffix: string,
): string {
  const normalizedSuffix = gestureSemanticKey(suffix).slice(0, 8);
  const tail = `_custom_${normalizedSuffix}`;
  const base = gestureSemanticKey(original).slice(0, 64 - tail.length);
  return `${base}${tail}`;
}

/**
 * Reconstruct editor state from an exact ready preview. Built-ins are returned
 * as unsaved private templates; owned items retain their logical identity.
 * Throws for a sequence that is not a valid `animaPoseClip/2.0` clip
 * (`UnsupportedAnimaPoseClipFormatError` for the retired 1.0 format).
 */
export async function actionDocumentFromPreview(args: {
  intent: ActionIntent;
  item: ActionItem;
  preview: PyActionPreview;
  base: ActionDocument;
  customizeStarter?: boolean;
  semanticSuffix?: string;
}): Promise<ActionDocument> {
  const { intent, item, preview, base } = args;
  const closure = actionClosure(preview);
  const root = closure.root;
  const implementation = object(root.implementation);
  const isBuiltin = root.catalog_source === "included";
  // Included and Local Actions both own registered sequences after conversion.
  const hasOwnedSequence =
    Array.isArray(root.files) &&
    root.files.some((file) => object(file).role === "sequence");
  const implementationKind =
    implementation.kind === "vrma" ? "vrma" : "anima_clip";
  const sequence =
    implementationKind === "anima_clip"
      ? hasOwnedSequence || !isBuiltin
        ? await ownedSequence(preview, root)
        : builtinSequence(intent, root)
      : base.sequence;
  // Only `animaPoseClip/2.0` clips open: a retired 1.0 or invalid clip throws
  // its reason instead of opening as an empty timeline.
  if (implementationKind === "anima_clip") parseAnimaPoseClip(sequence);
  const placement = object(root.placement_hint);
  const customName = args.customizeStarter ? `${item.name} Custom` : item.name;
  const semanticKey =
    intent === "gesture"
      ? args.customizeStarter
        ? starterGestureSemanticKey(
            String(root.semantic_key ?? item.name),
            args.semanticSuffix ?? crypto.randomUUID(),
          )
        : String(
            root.semantic_key ??
              ("semantic_key" in item ? item.semantic_key : ""),
          )
      : "";
  return normalizeActionDocument({
    ...base,
    name: customName,
    description: item.description ?? "",
    aiDescription: String(
      root.ai_description ?? root.description ?? item.description ?? "",
    ),
    semanticKey,
    implementation: implementationKind,
    suggestedEmotion: String(placement.emotion ?? ""),
    suggestedIntensity: selectedIntensity(placement.intensity),
    notes: args.customizeStarter
      ? `Customized from Starter ${item.name}.`
      : String(object(item.metadata).notes ?? ""),
    sequence:
      args.customizeStarter && implementationKind === "anima_clip"
        ? { ...sequence, name: customName }
        : sequence,
    dependencies: dependenciesFromPreview(preview),
  });
}
