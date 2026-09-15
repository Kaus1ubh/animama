import { POSE_CREATOR_CLIP_VALIDATION_OPTIONS } from "@/stores/pose-creator-store";
import { parseAnimaPoseClip } from "@/lib/avatar/poses/animaPoseClip";
import {
  buildAnimaPoseClipFromPoseCreatorDraft,
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
): Record<string, unknown> | null {
  let clip = buildAnimaPoseClipFromPoseCreatorDraft(
    draft,
    POSE_CREATOR_CLIP_VALIDATION_OPTIONS,
  );
  if (!clip) {
    try {
      // Typed Reactions may legitimately be effect-only. The Pose
      // Creator export validator requires a pose/keyframe, so fall back to the
      // actual animaPoseClip schema after removing editor-only draft fields.
      clip = parseAnimaPoseClip({
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
      });
    } catch {
      return null;
    }
  }
  const sequence = clip as unknown as Record<string, unknown>;
  return intent === "reaction" ? sanitizeReactionSequence(sequence) : sequence;
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
    normalizeActionDocument({ ...canonicalDocument, sequence }),
  );
}
