import { POSE_CREATOR_CLIP_VALIDATION_OPTIONS } from "@/stores/pose-creator-store";
import { parseAnimaPoseClip } from "@/lib/avatar/poses/animaPoseClip";
import {
  buildAnimaPoseClipFromPoseCreatorDraft,
  createPoseCreatorClipDraftFromAnimaPoseClip,
  poseCreatorMotionClip,
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
  if (!clip) {
    // A draft that does not pass the creator checks yet (for example while
    // empty) may still be a valid clip.
    const sequence = poseCreatorMotionClip(
      draft,
      draft.motion,
      POSE_CREATOR_CLIP_VALIDATION_OPTIONS,
    ) as unknown as Record<string, unknown>;
    // Empty authoring documents must enter history when the last marker is
    // removed. Persistence still requires a playable clip by default.
    if (options.allowEmpty && !draft.keyframes.length && !draft.events.length)
      return intent === "reaction"
        ? sanitizeReactionSequence(sequence)
        : sequence;
    try {
      clip = parseAnimaPoseClip(sequence);
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
      sequence,
    }),
  );
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
