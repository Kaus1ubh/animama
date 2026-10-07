import { POSE_CREATOR_CLIP_VALIDATION_OPTIONS } from "@/stores/pose-creator-store";
import {
  isAnimaPoseClipV2,
  parseAnimaPoseClip,
  parseAnyAnimaPoseClip,
} from "@/lib/avatar/poses/animaPoseClip";
import {
  buildAnimaPoseClipFromPoseCreatorDraft,
  convertPoseCreatorClipToV2,
  createPoseCreatorClipDraftFromAnimaPoseClip,
  poseCreatorMotionClip,
  serializePoseCreatorClipLayerMutes,
  type PoseCreatorClipDraft,
} from "@/ui/pose-creator/poseCreatorClipAuthoring";
import { pruneUnusedDependencies } from "./actionDependencies";
import {
  normalizeActionDocument,
  sanitizeReactionSequence,
  type ActionDocument,
  type ActionIntent,
} from "./actionDocument";

/** Serialize the live timeline store without its transient selection/playhead state. */
export function actionSequenceFromTimelineDraft(
  draft: PoseCreatorClipDraft,
  intent: ActionIntent,
  options: { allowEmpty?: boolean } = {},
): Record<string, unknown> | null {
  let clip = buildAnimaPoseClipFromPoseCreatorDraft(
    draft,
    POSE_CREATOR_CLIP_VALIDATION_OPTIONS,
  );
  if (!clip && draft.motion) {
    // A 2.0 draft that does not validate yet (for example while empty).
    const sequence = poseCreatorMotionClip(
      draft,
      draft.motion,
      POSE_CREATOR_CLIP_VALIDATION_OPTIONS,
    ) as unknown as Record<string, unknown>;
    if (options.allowEmpty && !draft.keyframes.length && !draft.events.length)
      return intent === "reaction"
        ? sanitizeReactionSequence(sequence)
        : sequence;
    try {
      clip = parseAnyAnimaPoseClip(sequence);
    } catch {
      return null;
    }
  }
  if (!clip) {
    try {
      // Typed Reactions may legitimately be effect-only. The Pose
      // Creator export validator requires a pose/keyframe, so fall back to the
      // actual animaPoseClip schema after removing editor-only draft fields.
      const serializedDraft = {
        ...structuredClone(draft.extraFields),
        ...serializePoseCreatorClipLayerMutes(draft),
        schema: "animaPoseClip/1.0",
        id: draft.id.trim(),
        name: draft.name.trim() || "New Clip",
        duration: draft.duration,
        ...(draft.loop ? { loop: true } : {}),
        ...(draft.basePose &&
        draft.basePose !==
          POSE_CREATOR_CLIP_VALIDATION_OPTIONS.omittedBasePoseId
          ? { basePose: draft.basePose }
          : {}),
        defaultTransition: structuredClone(draft.defaultTransition),
        ...(draft.fadeIn ? { fadeIn: structuredClone(draft.fadeIn) } : {}),
        ...(draft.fadeOut ? { fadeOut: structuredClone(draft.fadeOut) } : {}),
        poses: structuredClone(draft.poses),
        poseKeyframes: draft.keyframes.map((keyframe) => ({
          time: keyframe.time,
          pose: keyframe.pose,
          ...(keyframe.transition
            ? { transition: structuredClone(keyframe.transition) }
            : {}),
        })),
        ...(draft.events.length
          ? { events: structuredClone(draft.events) }
          : {}),
      };
      // Empty authoring documents must enter history when the last marker is
      // removed. Persistence still requires a playable clip by default.
      if (
        options.allowEmpty &&
        !draft.keyframes.length &&
        !draft.events.length
      ) {
        const empty = { ...serializedDraft, poses: {}, events: [] };
        return intent === "reaction" ? sanitizeReactionSequence(empty) : empty;
      }
      clip = parseAnimaPoseClip(serializedDraft);
    } catch {
      return null;
    }
  }
  const sequence = clip as unknown as Record<string, unknown>;
  return intent === "reaction" ? sanitizeReactionSequence(sequence) : sequence;
}

/** Commit component insertion in the same form that timeline hydration emits. */
export function canonicalizeActionComponentInsertion(
  document: ActionDocument,
): ActionDocument {
  if (document.implementation !== "anima_clip") return document;
  try {
    const draft = createPoseCreatorClipDraftFromAnimaPoseClip(
      document.sequence,
      {
        ...POSE_CREATOR_CLIP_VALIDATION_OPTIONS,
        fallbackBasePose: "",
      },
    );
    const sequence = actionSequenceFromTimelineDraft(draft, document.intent);
    return sequence ? { ...document, sequence } : document;
  } catch {
    // Imported documents may still need repair. Retain their invalid fields so
    // validation can report them instead of rejecting or silently deleting edits.
    return document;
  }
}

/**
 * Capture the authoritative document sent to draft replacement and finalize.
 *
 * Timeline controls write synchronously to Zustand while React document/history
 * synchronization is intentionally effect-driven. Persistence must therefore
 * sample the store directly so a Save click in the same frame cannot upload an
 * older sequence. Unreferenced exact dependencies are removed at this boundary
 * so the saved catalog item always matches the serialized sequence.
 */
export function actionDocumentForPersistence(
  document: ActionDocument,
  draft: PoseCreatorClipDraft,
): ActionDocument {
  const canonicalDocument = { ...document, name: document.name.trim() };
  if (document.implementation === "vrma") {
    return pruneUnusedDependencies(normalizeActionDocument(canonicalDocument));
  }
  const sequence = actionSequenceFromTimelineDraft(draft, document.intent);
  if (!sequence) {
    throw new Error(
      "The timeline contains invalid keyframes or events. Repair the highlighted timeline issues before saving.",
    );
  }
  return pruneUnusedDependencies(
    normalizeActionDocument({
      ...canonicalDocument,
      sequence: savedActionSequence(sequence, document.intent),
    }),
  );
}

/**
 * The sequence as Save and export write it: always `animaPoseClip/2.0`. A 1.0
 * timeline (a new document or an opened 1.0 clip) converts with the same
 * motion; pose references resolve by value from the app catalog.
 */
export function savedActionSequence(
  sequence: Record<string, unknown>,
  intent: ActionIntent,
): Record<string, unknown> {
  if (isAnimaPoseClipV2(sequence)) return sequence;
  const converted = convertPoseCreatorClipToV2(
    parseAnimaPoseClip(sequence),
  ) as unknown as Record<string, unknown>;
  return intent === "reaction"
    ? sanitizeReactionSequence(converted)
    : converted;
}

/** Resolve a default name before sampling the live draft, preserving edits during lookup. */
export async function captureActionDocumentForSave(
  readDocument: () => ActionDocument,
  readDraft: () => PoseCreatorClipDraft,
  allocateReactionName: () => Promise<string>,
): Promise<ActionDocument> {
  const initial = readDocument();
  const fallbackName =
    initial.intent === "reaction" && !initial.name.trim()
      ? await allocateReactionName()
      : null;
  const current = readDocument();
  return actionDocumentForPersistence(
    fallbackName && !current.name.trim()
      ? { ...current, name: fallbackName }
      : current,
    readDraft(),
  );
}
