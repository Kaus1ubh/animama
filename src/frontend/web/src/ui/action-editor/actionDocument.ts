import type { PyContentDependency } from "@/lib/content/catalogTypes";

export type ActionIntent = "gesture" | "reaction";
export type ActionImplementation = "anima_clip" | "vrma";

export type ActionDocument = {
  schema: 1;
  intent: ActionIntent;
  name: string;
  description: string;
  aiDescription: string;
  semanticKey: string;
  implementation: ActionImplementation;
  suggestedEmotion: string;
  suggestedIntensity: 1 | 2 | 3;
  notes: string;
  sequence: Record<string, unknown>;
  dependencies: PyContentDependency[];
};

export type ActionAuthoringSnapshot = Pick<
  ActionDocument,
  "sequence" | "dependencies"
>;

const EXPRESSION_WEIGHT_EPSILON = 0.000001;
const ACTION_SLUG_MAX_LENGTH = 120;

/** Convert a display name into the stable ASCII slug used by Action files and clips. */
export function actionNameSlug(name: string, fallback = "action"): string {
  const value = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, ACTION_SLUG_MAX_LENGTH)
    .replace(/-+$/g, "");
  return value || fallback;
}

/** Derive the embedded Anima Pose Clip ID from its owning Action name. */
export function actionClipId(name: string, intent: ActionIntent): string {
  return actionNameSlug(name, `new-${intent}`);
}

/** Capture only undoable creator content, excluding metadata and save state. */
export function actionAuthoringSnapshot(
  document: ActionDocument,
): ActionAuthoringSnapshot {
  const normalized = normalizeActionDocument(document);
  return {
    sequence: structuredClone(normalized.sequence),
    dependencies: structuredClone(normalized.dependencies),
  };
}

export function applyActionAuthoringSnapshot(
  document: ActionDocument,
  snapshot: ActionAuthoringSnapshot,
): ActionDocument {
  return normalizeActionDocument({
    ...document,
    sequence: structuredClone(snapshot.sequence),
    dependencies: structuredClone(snapshot.dependencies),
  });
}

export function actionAuthoringSnapshotsEqual(
  left: ActionAuthoringSnapshot,
  right: ActionAuthoringSnapshot,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** Generate the stable, model-facing selector proposed for a new Gesture. */
export function gestureSemanticKey(name: string): string {
  const value = name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
  return value || "new_gesture";
}

function defaultSequence(intent: ActionIntent): Record<string, unknown> {
  const reaction = intent === "reaction";
  return {
    schema: "animaPoseClip/1.0",
    id: actionClipId("", intent),
    name: `New ${intent === "gesture" ? "Gesture" : "Reaction"}`,
    duration: 1.2,
    loop: false,
    defaultTransition: {
      easing: "easeInOutSine",
      interpolation: {
        ...(!reaction
          ? {
              humanoidRotation: "slerp",
              humanoidPosition: "linear",
            }
          : {}),
        expression: "linear",
      },
    },
    // A new action has no authored landmarks. Gesture Pose mode creates
    // the first real keyframe at the playhead when the creator starts editing.
    poses: {},
    poseKeyframes: [],
    events: [],
  };
}

/** Create a product-specific editor document without exposing a role selector. */
export function createActionDocument(intent: ActionIntent): ActionDocument {
  // New editors show the content type as a placeholder instead of persisting a
  // fake display name that the creator must remember to replace.
  const name = "";
  return {
    schema: 1,
    intent,
    name,
    description: "",
    aiDescription: "",
    semanticKey: intent === "gesture" ? gestureSemanticKey(name) : "",
    implementation: "anima_clip",
    suggestedEmotion: "joy",
    suggestedIntensity: 1,
    notes: "",
    sequence: defaultSequence(intent),
    dependencies: [],
  };
}

/**
 * Rename a document while keeping brand-new Gesture selectors name-coupled.
 * Customized Starter Gestures intentionally carry a distinct selector, so a
 * display-name edit must not replace that collision-safe identity.
 */
export function renameActionDocument(
  document: ActionDocument,
  name: string,
  syncNewGestureSelector: boolean,
): ActionDocument {
  const selectorFollowsName =
    document.intent === "gesture" &&
    document.semanticKey === gestureSemanticKey(document.name);
  return normalizeActionDocument({
    ...document,
    name,
    semanticKey:
      syncNewGestureSelector && selectorFollowsName
        ? gestureSemanticKey(name)
        : document.semanticKey,
  });
}

/**
 * Remove motion-only channels that the shared pose workspace can synthesize
 * while editing a Reaction. Reactions intentionally own expression, VFX, and
 * SFX timing only; their documents must never inherit the preview Avatar's
 * neutral humanoid pose or an external base-pose reference.
 */
export function sanitizeReactionSequence(
  sequence: Record<string, unknown>,
): Record<string, unknown> {
  const sanitized = structuredClone(sequence);
  delete sanitized.basePose;

  const poses = isRecord(sanitized.poses) ? sanitized.poses : {};
  const retainedPoses: Record<string, unknown> = {};
  for (const [alias, rawPose] of Object.entries(poses)) {
    if (!isRecord(rawPose) || typeof rawPose.ref === "string") continue;
    const hadHumanoid = isRecord(rawPose.humanoid);
    const pose = { ...rawPose };
    delete pose.humanoid;
    if (!isRecord(pose.expressions)) {
      // Preserve an explicitly empty, expression-neutral landmark, but do not
      // turn a stripped humanoid-only pose into a valid Reaction keyframe.
      if (!hadHumanoid && Object.keys(pose).length === 0) {
        retainedPoses[alias] = {};
      }
      continue;
    }

    const expressions = Object.fromEntries(
      Object.entries(pose.expressions).filter(
        ([, value]) =>
          typeof value === "number" &&
          Number.isFinite(value) &&
          Math.abs(value) > EXPRESSION_WEIGHT_EPSILON,
      ),
    );
    // Retain an empty pose as an explicit neutral landmark. The clip sampler
    // treats omitted expression channels as zero, so serialized documents do
    // not need noisy `{ happy: 0 }` entries to fade back to neutral.
    retainedPoses[alias] =
      Object.keys(expressions).length > 0 ? { ...pose, expressions } : {};
  }
  sanitized.poses = retainedPoses;

  if (Array.isArray(sanitized.poseKeyframes)) {
    sanitized.poseKeyframes = sanitized.poseKeyframes.filter(
      (rawKeyframe) =>
        isRecord(rawKeyframe) &&
        typeof rawKeyframe.pose === "string" &&
        rawKeyframe.pose in retainedPoses,
    );
  }

  const transition = isRecord(sanitized.defaultTransition)
    ? { ...sanitized.defaultTransition }
    : null;
  if (transition && isRecord(transition.interpolation)) {
    const interpolation = { ...transition.interpolation };
    delete interpolation.humanoidRotation;
    delete interpolation.humanoidPosition;
    transition.interpolation = interpolation;
    sanitized.defaultTransition = transition;
  }
  return sanitized;
}

/** Enforce the product capabilities whenever a document crosses editor state. */
export function normalizeActionDocument(
  document: ActionDocument,
): ActionDocument {
  // The blank new-document state needs a schema-valid timeline placeholder.
  // Once the required Action name exists, it is the sole clip-name authority.
  const clipName =
    document.name.trim() ||
    `New ${document.intent === "gesture" ? "Gesture" : "Reaction"}`;
  const sequence = {
    ...document.sequence,
    id: actionClipId(clipName, document.intent),
    name: clipName,
  };
  return document.intent === "reaction"
    ? { ...document, sequence: sanitizeReactionSequence(sequence) }
    : { ...document, sequence };
}

export type ActionDocumentIssue = {
  field: string;
  message: string;
};

/** Validate editor-only invariants before previewing or saving. */
export function validateActionDocument(
  document: ActionDocument,
): ActionDocumentIssue[] {
  const issues: ActionDocumentIssue[] = [];
  if (!document.name.trim())
    issues.push({ field: "name", message: "Name is required." });
  if (document.intent === "gesture" && !document.aiDescription.trim())
    issues.push({
      field: "aiDescription",
      message: "Describe when the AI should choose this Gesture.",
    });
  if (document.intent === "gesture" && !document.semanticKey.trim())
    issues.push({ field: "semanticKey", message: "Selector ID is required." });
  if (document.intent === "reaction" && document.implementation === "vrma")
    issues.push({
      field: "implementation",
      message: "Reactions use expression, effect, and sound timelines.",
    });
  const aliases = new Set(document.dependencies.map((value) => value.alias));
  for (const alias of referencedAliases(document.sequence)) {
    if (!aliases.has(alias)) {
      issues.push({
        field: "dependencies",
        message: `Map or remove the unknown event ID “${alias}”.`,
      });
    }
  }
  if (document.intent === "reaction" && hasHumanoidTracks(document.sequence)) {
    issues.push({
      field: "sequence",
      message: "Reactions cannot contain humanoid pose or bone tracks.",
    });
  }
  return issues;
}

export function referencedAliases(sequence: Record<string, unknown>): string[] {
  const events = Array.isArray(sequence.events) ? sequence.events : [];
  const aliases = events.flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const event = raw as Record<string, unknown>;
    const value = event.effectId ?? event.presetId ?? event.cueId;
    return typeof value === "string" && value ? [value] : [];
  });
  return [...new Set(aliases)].sort();
}

export function hasHumanoidTracks(sequence: Record<string, unknown>): boolean {
  const poses = sequence.poses;
  return Boolean(
    poses &&
    typeof poses === "object" &&
    Object.values(poses).some(
      (pose) =>
        pose &&
        typeof pose === "object" &&
        Object.keys((pose as Record<string, unknown>).humanoid ?? {}).length,
    ),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
