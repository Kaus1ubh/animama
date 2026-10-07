import { type VRMPose, type VRMPoseTransform } from "@pixiv/three-vrm";
import type { AnimaPoseClipMutableLayerId } from "@/lib/avatar/poses/animaPoseClip/schema";

import {
  DEFAULT_ANIMA_POSE_CLIP_TRANSITION,
  ANIMA_POSE_CLIP_SCHEMA,
  cloneVRMPose,
  cloneVRMPoseTransform,
  getAnimaPoseClipTimelineDuration,
  cloneParticleVFXTransform,
  isAnimaPoseClipRef,
  isAnimaPoseClipVFXEvent,
  isVRMHumanBoneName,
  parseAnimaPoseClip,
  type AnimaPose,
  type AnimaPoseClip,
  type AnimaPoseClipAvatarVFXEvent,
  type AnimaPoseClipCatalogIdCollection,
  type AnimaPoseClipEasing,
  type AnimaPoseClipEvent,
  type AnimaPoseClipEventCatalogRefs,
  type AnimaPoseClipFade,
  type AnimaPoseClipKeyframe,
  type AnimaPoseClipParticleVFXEvent,
  type AnimaPoseClipPose,
  type AnimaPoseClipSceneVFXEvent,
  type AnimaPoseClipSceneVFXKind,
  type AnimaPoseClipSFXEvent,
  type AnimaPoseClipTransition,
  type AnimaPoseClipVFXEnvelope,
  type AnimaPoseClipVFXParameterKeyframe,
  type ParticleVFXAnchor,
  type ParticleVFXCatalogEntry,
  type ParticleVFXTransformAxisTriple,
  type ParticleVFXTransformInput,
} from "@/lib/avatar";

export type PoseCreatorAuthoringMode = "pose" | "clip";

export type PoseCreatorClipKeyframeDraft = AnimaPoseClipKeyframe & {
  id: string;
};

export type PoseCreatorClipEventDraft = AnimaPoseClipEvent;

export type PoseCreatorClipExportMode = "referenced" | "baked";

export type PoseCreatorClipKeyframeDraftPatch = Partial<
  Pick<PoseCreatorClipKeyframeDraft, "time" | "pose">
> & {
  transition?: AnimaPoseClipTransition | null;
};

export type PoseCreatorClipEventDraftPatch = {
  playAccompanyingSound?: boolean;
  time?: number;
  duration?: number | null;
  /** Avatar Effect fade in and out (seconds) for an event with a duration. */
  fadeIn?: number;
  fadeOut?: number;
  effectId?: string;
  sceneKind?: AnimaPoseClipSceneVFXKind;
  presetId?: string;
  anchor?: ParticleVFXAnchor | null;
  followAnchor?: boolean;
  transform?: ParticleVFXTransformInput | null;
  cueId?: string;
  volume?: number | null;
};

export type PoseCreatorClipValidationSeverity = "error" | "warning";

export type PoseCreatorClipValidationIssue = {
  severity: PoseCreatorClipValidationSeverity;
  code: string;
  message: string;
  target?: string;
};

export type PoseCreatorClipPreviewDiagnostics = {
  missingPoseRefs: string[];
  missingAvatarVFXIds: string[];
  missingSceneVFXPresetIds: string[];
  missingParticleVFXIds: string[];
  missingSFXCueIds: string[];
  eventAdapterWarnings: string[];
};

export type PoseCreatorClipDraft = {
  id: string;
  name: string;
  duration: number;
  loop: boolean;
  basePose: string;
  defaultTransition: AnimaPoseClipTransition;
  fadeIn?: AnimaPoseClipFade;
  fadeOut?: AnimaPoseClipFade;
  /** Live procedural layers the clip mutes while it plays. */
  mutedProceduralLayers: AnimaPoseClipMutableLayerId[];
  /**
   * Imported top-level clip fields the editor does not edit (for example
   * `playback`, `role` or newer metadata), written back unchanged on save.
   */
  extraFields: Record<string, unknown>;
  poses: Record<string, AnimaPoseClipPose>;
  keyframes: PoseCreatorClipKeyframeDraft[];
  events: PoseCreatorClipEventDraft[];
  currentTimeSec: number;
  selectedKeyframeId: string | null;
  selectedPoseAlias: string | null;
  selectedEventId: string | null;
  isDirty: boolean;
  validationIssues: PoseCreatorClipValidationIssue[];
};

export type PoseCreatorClipDraftPatch = Partial<
  Pick<PoseCreatorClipDraft, "id" | "name" | "duration" | "loop" | "basePose">
> & {
  defaultTransition?: AnimaPoseClipTransition;
  fadeIn?: AnimaPoseClipFade | null;
  fadeOut?: AnimaPoseClipFade | null;
  mutedProceduralLayers?: AnimaPoseClipMutableLayerId[];
  extraFields?: Record<string, unknown>;
};

export type PoseCreatorClipValidationOptions = {
  knownPoseIds?: readonly string[];
  omittedBasePoseId?: string;
  availableBoneNames?: readonly string[];
  eventCatalogRefs?: AnimaPoseClipEventCatalogRefs;
};

export type PoseCreatorClipImportOptions = PoseCreatorClipValidationOptions & {
  fallbackBasePose: string;
};

export type PoseCreatorClipExportOptions = PoseCreatorClipValidationOptions & {
  mode: PoseCreatorClipExportMode;
  resolvePose?: (poseId: string) => AnimaPose | null | undefined;
};

export const POSE_CREATOR_CLIP_EASING_OPTIONS = [
  { value: "linear", label: "Linear" },
  { value: "easeInSine", label: "Ease in sine" },
  { value: "easeOutSine", label: "Ease out sine" },
  { value: "easeInOutSine", label: "Ease in-out sine" },
  { value: "easeInCubic", label: "Ease in cubic" },
  { value: "easeOutCubic", label: "Ease out cubic" },
  { value: "easeInOutCubic", label: "Ease in-out cubic" },
  { value: "back", label: "Back" },
  { value: "elastic", label: "Elastic" },
  { value: "bounce", label: "Bounce" },
] as const satisfies ReadonlyArray<{
  value: AnimaPoseClipEasing;
  label: string;
}>;

const DEFAULT_CLIP_ID = "pose_creator_clip";
export const DEFAULT_POSE_CREATOR_CLIP_NAME = "New Clip";
const DEFAULT_CLIP_DURATION = 2;
const KEYFRAME_TIME_EPSILON = 0.0005;
const QUATERNION_ZERO_EPSILON = 0.000001;
const QUATERNION_NORMALIZED_EPSILON = 0.001;
const MIN_POSE_CREATOR_CLIP_EVENT_DURATION_SEC = 0.001;
export const DEFAULT_POSE_CREATOR_CLIP_SNAP_INTERVAL_SEC = 0.05;
export const POSE_CREATOR_CLIP_SNAP_INTERVAL_OPTIONS = [
  { value: 0.05, label: "0.05s" },
  { value: 0.1, label: "0.10s" },
  { value: 0.25, label: "0.25s" },
  { value: 0.5, label: "0.50s" },
] as const;
export const DEFAULT_POSE_CREATOR_CLIP_PLAYBACK_SPEED = 1;
export const POSE_CREATOR_CLIP_PLAYBACK_SPEED_OPTIONS = [
  { value: 0.25, label: "0.25x" },
  { value: 0.5, label: "0.5x" },
  { value: 1, label: "1x" },
  { value: 2, label: "2x" },
] as const;
export const POSE_CREATOR_CLIP_FRAME_STEP_SEC = 1 / 30;

export function createDefaultPoseCreatorClipDraft(
  basePose: string,
  options: PoseCreatorClipValidationOptions = {},
): PoseCreatorClipDraft {
  const draft: PoseCreatorClipDraft = {
    id: DEFAULT_CLIP_ID,
    name: "",
    duration: DEFAULT_CLIP_DURATION,
    loop: false,
    basePose,
    defaultTransition: cloneDefaultTransition(),
    mutedProceduralLayers: [],
    extraFields: {},
    poses: {},
    keyframes: [],
    events: [],
    currentTimeSec: 0,
    selectedKeyframeId: null,
    selectedPoseAlias: null,
    selectedEventId: null,
    isDirty: false,
    validationIssues: [],
  };

  return withPoseCreatorClipValidation(draft, options);
}

/** Pick the first available default name without colliding with clip names. */
export function createUniquePoseCreatorClipName(
  existingNames: Iterable<string>,
): string {
  const usedNames = new Set(
    Array.from(existingNames, (name) => name.trim().toLocaleLowerCase()),
  );
  const baseName = DEFAULT_POSE_CREATOR_CLIP_NAME;
  if (!usedNames.has(baseName.toLocaleLowerCase())) return baseName;

  let suffix = 1;
  while (usedNames.has(`${baseName} (${suffix})`.toLocaleLowerCase())) {
    suffix += 1;
  }
  return `${baseName} (${suffix})`;
}

/** Endpoint toggles follow actual base-reference landmarks, including loaded clips. */
export function isPoseCreatorBaseKeyframe(
  draft: PoseCreatorClipDraft,
  frame: PoseCreatorClipKeyframeDraft,
): boolean {
  const pose = draft.poses[frame.pose];
  return Boolean(
    pose && isAnimaPoseClipRef(pose) && pose.ref === draft.basePose,
  );
}

export function patchPoseCreatorClipDraft(
  draft: PoseCreatorClipDraft,
  patch: PoseCreatorClipDraftPatch,
  options: PoseCreatorClipValidationOptions = {},
): PoseCreatorClipDraft {
  // Clearing a duration field must not collapse both endpoint landmarks to zero.
  if (
    patch.duration !== undefined &&
    clampPoseCreatorClipDuration(patch.duration) <= 0
  ) {
    patch = { ...patch, duration: draft.duration };
  }
  return withPoseCreatorClipValidation(
    {
      ...draft,
      ...patch,
      // Endpoint landmarks track the clip bounds; other authored timing stays intact.
      keyframes: sortPoseCreatorClipKeyframes(
        draft.keyframes.map((frame) =>
          patch.duration !== undefined &&
          draft.duration > 0 &&
          Math.abs(frame.time - draft.duration) < 0.0005 &&
          isPoseCreatorBaseKeyframe(draft, frame)
            ? { ...frame, time: clampPoseCreatorClipDuration(patch.duration) }
            : frame,
        ),
      ),
      duration:
        patch.duration === undefined
          ? draft.duration
          : clampPoseCreatorClipDuration(patch.duration),
      defaultTransition: patch.defaultTransition
        ? clonePoseCreatorClipTransition(patch.defaultTransition)
        : draft.defaultTransition,
      fadeIn:
        patch.fadeIn === undefined
          ? clonePoseCreatorClipFade(draft.fadeIn)
          : normalizePoseCreatorClipFade(patch.fadeIn),
      fadeOut:
        patch.fadeOut === undefined
          ? clonePoseCreatorClipFade(draft.fadeOut)
          : normalizePoseCreatorClipFade(patch.fadeOut),
      currentTimeSec:
        patch.duration === undefined
          ? draft.currentTimeSec
          : clampPoseCreatorClipTime(draft.currentTimeSec, patch.duration),
      isDirty: true,
    },
    options,
  );
}

export function buildAnimaPoseClipFromPoseCreatorDraft(
  draft: PoseCreatorClipDraft,
  options: PoseCreatorClipValidationOptions = {},
): AnimaPoseClip | null {
  const validationIssues = validatePoseCreatorClipDraft(draft, options);
  if (hasPoseCreatorClipValidationErrors(validationIssues)) return null;

  try {
    return parseAnimaPoseClip({
      ...structuredClone(draft.extraFields),
      ...serializePoseCreatorClipLayerMutes(draft),
      schema: ANIMA_POSE_CLIP_SCHEMA,
      id: draft.id.trim(),
      name: draft.name.trim() || DEFAULT_POSE_CREATOR_CLIP_NAME,
      duration: draft.duration,
      ...(draft.loop ? { loop: true } : {}),
      ...(draft.basePose && draft.basePose !== options.omittedBasePoseId
        ? { basePose: draft.basePose }
        : {}),
      defaultTransition: clonePoseCreatorClipTransition(
        draft.defaultTransition,
      ),
      ...(draft.fadeIn && draft.fadeIn.duration > 0
        ? { fadeIn: clonePoseCreatorClipFade(draft.fadeIn) }
        : {}),
      ...(draft.fadeOut && draft.fadeOut.duration > 0
        ? { fadeOut: clonePoseCreatorClipFade(draft.fadeOut) }
        : {}),
      poses: draft.poses,
      poseKeyframes: sortPoseCreatorClipKeyframes(draft.keyframes).map(
        (keyframe) => ({
          time: keyframe.time,
          pose: keyframe.pose,
          ...(keyframe.transition
            ? {
                transition: clonePoseCreatorClipTransition(keyframe.transition),
              }
            : {}),
        }),
      ),
      ...(draft.events.length > 0
        ? {
            events: sortPoseCreatorClipEvents(draft.events).map(
              clonePoseCreatorClipEvent,
            ),
          }
        : {}),
    });
  } catch {
    return null;
  }
}

/** Top-level clip fields the editor owns; everything else is passed through. */
const POSE_CREATOR_OWNED_CLIP_FIELDS = new Set([
  "schema",
  "id",
  "name",
  "duration",
  "loop",
  "basePose",
  "defaultTransition",
  "fadeIn",
  "fadeOut",
  "poses",
  "poseKeyframes",
  "events",
  "mutedProceduralLayers",
]);

/** Imported fields the editor does not own, cloned for the draft. */
export function getPoseCreatorClipExtraFields(
  clip: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(clip)
      .filter(([key]) => !POSE_CREATOR_OWNED_CLIP_FIELDS.has(key))
      .map(([key, value]) => [key, structuredClone(value)]),
  );
}

/** The draft's layer mutes as clip fields (omitted when none are muted). */
export function serializePoseCreatorClipLayerMutes(
  draft: Pick<PoseCreatorClipDraft, "mutedProceduralLayers">,
): { mutedProceduralLayers?: AnimaPoseClipMutableLayerId[] } {
  return draft.mutedProceduralLayers.length > 0
    ? { mutedProceduralLayers: [...draft.mutedProceduralLayers] }
    : {};
}

export function createPoseCreatorClipDraftFromAnimaPoseClip(
  value: unknown,
  options: PoseCreatorClipImportOptions,
): PoseCreatorClipDraft {
  const clip = parseAnimaPoseClip(value);
  const keyframes: PoseCreatorClipKeyframeDraft[] = [];
  const usedKeyframeIds = new Set<string>();
  const events = sortPoseCreatorClipEvents(
    (clip.events ?? []).map(clonePoseCreatorClipEvent),
  );

  for (const keyframe of clip.poseKeyframes) {
    const id = generatePoseCreatorClipKeyframeId(usedKeyframeIds);
    usedKeyframeIds.add(id);
    keyframes.push({
      id,
      time: keyframe.time,
      pose: keyframe.pose,
      ...(keyframe.transition
        ? { transition: clonePoseCreatorClipTransition(keyframe.transition) }
        : {}),
    });
  }

  const firstKeyframe = keyframes[0] ?? null;
  const timelineDuration = getAnimaPoseClipTimelineDuration(clip);
  return withPoseCreatorClipValidation(
    {
      id: clip.id,
      name: clip.name,
      // Legacy reaction clips can be lifetime-driven and therefore have no
      // finite editor duration. Imported clips are generic, so give
      // those retained App documents a deterministic finite save timeline.
      duration: timelineDuration > 0 ? timelineDuration : clip.playback ? 1 : 0,
      loop: clip.loop === true,
      // Absence is an explicit standalone snapshot, never an implicit live default.
      basePose: clip.basePose ?? "",
      defaultTransition: clip.defaultTransition
        ? clonePoseCreatorClipTransition(clip.defaultTransition)
        : cloneDefaultTransition(),
      ...(clip.fadeIn ? { fadeIn: clonePoseCreatorClipFade(clip.fadeIn) } : {}),
      ...(clip.fadeOut
        ? { fadeOut: clonePoseCreatorClipFade(clip.fadeOut) }
        : {}),
      mutedProceduralLayers: [...(clip.mutedProceduralLayers ?? [])],
      extraFields: getPoseCreatorClipExtraFields(clip),
      poses: clonePoseCreatorClipPoses(clip.poses),
      keyframes,
      events,
      currentTimeSec: firstKeyframe?.time ?? 0,
      selectedKeyframeId: firstKeyframe?.id ?? null,
      selectedPoseAlias: firstKeyframe?.pose ?? null,
      selectedEventId: null,
      isDirty: true,
      validationIssues: [],
    },
    options,
  );
}

export function buildPoseCreatorClipForExport(
  draft: PoseCreatorClipDraft,
  options: PoseCreatorClipExportOptions,
): AnimaPoseClip | null {
  const validationIssues = validatePoseCreatorClipDraft(draft, options);
  if (hasPoseCreatorClipValidationErrors(validationIssues)) return null;

  const clip = buildAnimaPoseClipFromPoseCreatorDraft(draft, options);
  if (!clip) return null;

  if (options.mode === "referenced") return clip;
  return bakePoseCreatorClipReferences(clip, options);
}

export function formatPoseCreatorClipJsonForExport(
  draft: PoseCreatorClipDraft,
  options: PoseCreatorClipExportOptions,
): string | null {
  const clip = buildPoseCreatorClipForExport(draft, options);
  return clip ? JSON.stringify(parseAnimaPoseClip(clip), null, 2) : null;
}

export function bakePoseCreatorClipReferences(
  clip: AnimaPoseClip,
  options: Pick<PoseCreatorClipExportOptions, "resolvePose"> = {},
): AnimaPoseClip | null {
  const sanitizedClip = parseAnimaPoseClip(clip);
  const resolvePose = options.resolvePose ?? (() => null);
  const baseSnapshot = sanitizedClip.basePose
    ? resolvePoseSnapshot(sanitizedClip.basePose, resolvePose)
    : {};
  if (sanitizedClip.basePose && !baseSnapshot) return null;

  const poses: Record<string, AnimaPoseClipPose> = {};
  for (const [alias, pose] of Object.entries(sanitizedClip.poses)) {
    const snapshot = isAnimaPoseClipRef(pose)
      ? resolvePoseSnapshot(pose.ref, resolvePose)
      : cloneAnimaPoseClipSnapshot(pose);
    if (!snapshot) return null;

    const bakedPose = mergePoseCreatorClipSnapshots(
      baseSnapshot ?? {},
      snapshot,
    );
    poses[alias] = bakedPose;
  }

  return parseAnimaPoseClip({
    schema: ANIMA_POSE_CLIP_SCHEMA,
    id: sanitizedClip.id,
    name: sanitizedClip.name,
    duration: sanitizedClip.duration,
    ...(sanitizedClip.loop === true ? { loop: true } : {}),
    ...(sanitizedClip.defaultTransition
      ? {
          defaultTransition: clonePoseCreatorClipTransition(
            sanitizedClip.defaultTransition,
          ),
        }
      : {}),
    ...(sanitizedClip.fadeIn
      ? { fadeIn: clonePoseCreatorClipFade(sanitizedClip.fadeIn) }
      : {}),
    ...(sanitizedClip.fadeOut
      ? { fadeOut: clonePoseCreatorClipFade(sanitizedClip.fadeOut) }
      : {}),
    poses,
    poseKeyframes: sanitizedClip.poseKeyframes.map((keyframe) => ({
      time: keyframe.time,
      pose: keyframe.pose,
      ...(keyframe.transition
        ? { transition: clonePoseCreatorClipTransition(keyframe.transition) }
        : {}),
    })),
    ...(sanitizedClip.events && sanitizedClip.events.length > 0
      ? { events: sanitizedClip.events.map(clonePoseCreatorClipEvent) }
      : {}),
  });
}

export function validatePoseCreatorClipDraft(
  draft: PoseCreatorClipDraft,
  options: PoseCreatorClipValidationOptions = {},
): PoseCreatorClipValidationIssue[] {
  const issues: PoseCreatorClipValidationIssue[] = [];
  const localAliases = new Set(Object.keys(draft.poses));
  const usedAliases = new Set<string>();
  const knownPoseIds = new Set(options.knownPoseIds ?? []);
  const availableBoneNames = new Set(options.availableBoneNames ?? []);
  const eventIds = new Set<string>();

  if (!draft.id.trim()) {
    issues.push({
      severity: "error",
      code: "missing-id",
      message: "Clip id is required.",
      target: "id",
    });
  }

  if (!Number.isFinite(draft.duration) || draft.duration <= 0) {
    issues.push({
      severity: "error",
      code: "invalid-duration",
      message: "Clip duration must be greater than 0 seconds.",
      target: "duration",
    });
  }

  if (
    draft.basePose &&
    draft.basePose !== options.omittedBasePoseId &&
    knownPoseIds.size > 0 &&
    !knownPoseIds.has(draft.basePose)
  ) {
    issues.push({
      severity: "error",
      code: "missing-base-pose-ref",
      message: `Base pose "${draft.basePose}" is unavailable in the compatibility pose resolver.`,
      target: "basePose",
    });
  }

  // Event-only Actions need no synthetic pose; validate their events below.
  if (localAliases.size === 0 && draft.events.length === 0) {
    issues.push({
      severity: "error",
      code: "empty-poses",
      message: "Add at least one local pose before exporting a clip.",
      target: "poses",
    });
  }

  if (draft.keyframes.length === 0 && draft.events.length === 0) {
    issues.push({
      severity: "error",
      code: "empty-keyframes",
      message: "Add at least one keyframe before exporting a clip.",
      target: "keyframes",
    });
  } else {
    const sortedKeyframes = sortPoseCreatorClipKeyframes(draft.keyframes);
    const finalKeyframe = sortedKeyframes[sortedKeyframes.length - 1];
    if (
      finalKeyframe &&
      Number.isFinite(finalKeyframe.time) &&
      Number.isFinite(draft.duration) &&
      finalKeyframe.time > draft.duration
    ) {
      issues.push({
        severity: "error",
        code: "duration-shorter-than-final-keyframe",
        message: "Clip duration is shorter than the final keyframe time.",
        target: "duration",
      });
    }
  }

  for (const keyframe of draft.keyframes) {
    usedAliases.add(keyframe.pose);

    if (!Number.isFinite(keyframe.time)) {
      issues.push({
        severity: "error",
        code: "invalid-keyframe-time",
        message: `Keyframe "${keyframe.id}" has an invalid time.`,
        target: keyframe.id,
      });
    } else if (keyframe.time < 0 || keyframe.time > draft.duration) {
      issues.push({
        severity: "error",
        code: "keyframe-outside-duration",
        message: `Keyframe "${keyframe.id}" is outside the clip duration.`,
        target: keyframe.id,
      });
    }

    if (!localAliases.has(keyframe.pose)) {
      issues.push({
        severity: "error",
        code: "missing-local-pose",
        message: `Keyframe "${keyframe.id}" references missing local pose "${keyframe.pose}".`,
        target: keyframe.id,
      });
    }
  }

  const timeOwners = new Map<string, PoseCreatorClipKeyframeDraft>();
  for (const keyframe of draft.keyframes) {
    if (!Number.isFinite(keyframe.time)) continue;
    const timeKey = formatKeyframeTimeKey(keyframe.time);
    const existing = timeOwners.get(timeKey);
    if (!existing) {
      timeOwners.set(timeKey, keyframe);
      continue;
    }

    issues.push({
      severity: "error",
      code: "duplicate-keyframe-time",
      message: `Keyframes "${existing.id}" and "${keyframe.id}" share the same time.`,
      target: keyframe.id,
    });
  }

  for (const [alias, pose] of Object.entries(draft.poses)) {
    if (!usedAliases.has(alias)) {
      issues.push({
        severity: "warning",
        code: "unused-local-pose",
        message: `Local pose "${alias}" is not used by any keyframe.`,
        target: alias,
      });
    }

    if (
      isAnimaPoseClipRef(pose) &&
      knownPoseIds.size > 0 &&
      !knownPoseIds.has(pose.ref)
    ) {
      issues.push({
        severity: "error",
        code: "missing-external-pose-ref",
        message: `Local pose "${alias}" references unavailable legacy pose "${pose.ref}".`,
        target: alias,
      });
    }

    if (!isAnimaPoseClipRef(pose)) {
      validateInlineClipPose(alias, pose, availableBoneNames, issues);
    }
  }

  for (const event of draft.events) {
    const target = getPoseCreatorClipEventValidationTarget(event.id);

    if (!event.id.trim()) {
      issues.push({
        severity: "error",
        code: "missing-event-id",
        message: "Effect event id is required.",
        target,
      });
    } else if (eventIds.has(event.id)) {
      issues.push({
        severity: "error",
        code: "duplicate-event-id",
        message: `Effect event id "${event.id}" is used more than once.`,
        target,
      });
    }
    eventIds.add(event.id);

    if (!Number.isFinite(event.time)) {
      issues.push({
        severity: "error",
        code: "invalid-event-time",
        message: `Effect event "${event.id}" has an invalid time.`,
        target,
      });
    } else if (event.time < 0 || event.time > draft.duration) {
      issues.push({
        severity: "error",
        code: "event-outside-duration",
        message: `Effect event "${event.id}" is outside the clip duration.`,
        target,
      });
    }

    if (event.kind === "avatar_vfx") {
      validateAvatarVFXEventDraft(event, options.eventCatalogRefs, issues);
    } else if (event.kind === "scene_vfx") {
      validateSceneVFXEventDraft(event, options.eventCatalogRefs, issues);
    } else if (event.kind === "particle_vfx") {
      validateParticleVFXEventDraft(event, options.eventCatalogRefs, issues);
    } else {
      validateSFXEventDraft(event, options.eventCatalogRefs, issues);
    }

    if (isAnimaPoseClipVFXEvent(event) && event.duration !== undefined) {
      if (!Number.isFinite(event.duration) || event.duration <= 0) {
        issues.push({
          severity: "error",
          code: "invalid-event-duration",
          message: `VFX event "${event.id}" must have a positive duration.`,
          target,
        });
      } else if (
        Number.isFinite(event.time) &&
        Number.isFinite(draft.duration) &&
        event.time + event.duration > draft.duration
      ) {
        issues.push({
          severity: "warning",
          code: "event-duration-exceeds-clip",
          message: `VFX event "${event.id}" continues beyond the clip duration.`,
          target,
        });
      }
    }

    if (isAnimaPoseClipVFXEvent(event) && event.parameterKeyframes) {
      for (const parameterKeyframe of event.parameterKeyframes) {
        if (
          event.duration !== undefined &&
          parameterKeyframe.time > event.duration
        ) {
          issues.push({
            severity: "error",
            code: "event-parameter-keyframe-outside-duration",
            message: `VFX event "${event.id}" has parameter keyframes outside its duration.`,
            target,
          });
          break;
        }
      }
    }
  }

  return issues;
}

function validateAvatarVFXEventDraft(
  event: AnimaPoseClipAvatarVFXEvent,
  catalogRefs: AnimaPoseClipEventCatalogRefs | undefined,
  issues: PoseCreatorClipValidationIssue[],
): void {
  const target = getPoseCreatorClipEventValidationTarget(event.id);
  if (!event.effectId.trim()) {
    issues.push({
      severity: "error",
      code: "missing-avatar-vfx-id",
      message: `Avatar VFX event "${event.id}" needs an effect id.`,
      target,
    });
    return;
  }

  if (
    catalogRefs?.avatarVFXIds &&
    !hasCatalogId(catalogRefs.avatarVFXIds, event.effectId)
  ) {
    issues.push({
      severity: "warning",
      code: "unknown-avatar-vfx-id",
      message: `Avatar VFX effect "${event.effectId}" is not in the current catalog.`,
      target,
    });
  }
}

function validateSceneVFXEventDraft(
  event: AnimaPoseClipSceneVFXEvent,
  catalogRefs: AnimaPoseClipEventCatalogRefs | undefined,
  issues: PoseCreatorClipValidationIssue[],
): void {
  const target = getPoseCreatorClipEventValidationTarget(event.id);
  if (!event.presetId.trim()) {
    issues.push({
      severity: "error",
      code: "missing-scene-vfx-preset-id",
      message: `Scene VFX event "${event.id}" needs a preset id.`,
      target,
    });
    return;
  }

  const catalogIds =
    event.sceneKind === "background_layers"
      ? catalogRefs?.sceneBackgroundLayerPresetIds
      : catalogRefs?.sceneFocusLinePresetIds;
  if (catalogIds && !hasCatalogId(catalogIds, event.presetId)) {
    issues.push({
      severity: "warning",
      code: "unknown-scene-vfx-preset-id",
      message: `Scene VFX preset "${event.presetId}" is not in the current catalog.`,
      target,
    });
  }
}

function validateParticleVFXEventDraft(
  event: AnimaPoseClipParticleVFXEvent,
  catalogRefs: AnimaPoseClipEventCatalogRefs | undefined,
  issues: PoseCreatorClipValidationIssue[],
): void {
  const target = getPoseCreatorClipEventValidationTarget(event.id);
  if (!event.effectId.trim()) {
    issues.push({
      severity: "error",
      code: "missing-particle-vfx-id",
      message: `Particle VFX event "${event.id}" needs an effect id.`,
      target,
    });
    return;
  }

  if (
    catalogRefs?.particleVFXIds &&
    !hasCatalogId(catalogRefs.particleVFXIds, event.effectId)
  ) {
    issues.push({
      severity: "warning",
      code: "unknown-particle-vfx-id",
      message: `Particle VFX effect "${event.effectId}" is not in the current catalog.`,
      target,
    });
  }
}

function validateSFXEventDraft(
  event: AnimaPoseClipSFXEvent,
  catalogRefs: AnimaPoseClipEventCatalogRefs | undefined,
  issues: PoseCreatorClipValidationIssue[],
): void {
  const target = getPoseCreatorClipEventValidationTarget(event.id);
  if (!event.cueId.trim()) {
    issues.push({
      severity: "error",
      code: "missing-sfx-cue-id",
      message: `SFX event "${event.id}" needs a cue id.`,
      target,
    });
    return;
  }

  if (
    catalogRefs?.sfxCueIds &&
    !hasCatalogId(catalogRefs.sfxCueIds, event.cueId)
  ) {
    issues.push({
      severity: "warning",
      code: "unknown-sfx-cue-id",
      message: `SFX cue "${event.cueId}" is not in the current catalog.`,
      target,
    });
  }

  if (
    event.volume !== undefined &&
    (!Number.isFinite(event.volume) || event.volume < 0 || event.volume > 1)
  ) {
    issues.push({
      severity: "error",
      code: "invalid-sfx-volume",
      message: `SFX event "${event.id}" volume must be between 0 and 1.`,
      target,
    });
  }
}

function hasCatalogId(
  collection: AnimaPoseClipCatalogIdCollection,
  id: string,
): boolean {
  if (typeof (collection as ReadonlySet<string>).has === "function") {
    return (collection as ReadonlySet<string>).has(id);
  }
  return (collection as readonly string[]).includes(id);
}

export function hasPoseCreatorClipValidationErrors(
  issues: readonly PoseCreatorClipValidationIssue[],
): boolean {
  return issues.some((issue) => issue.severity === "error");
}

function validateInlineClipPose(
  alias: string,
  pose: Pick<AnimaPose, "humanoid" | "expressions">,
  availableBoneNames: ReadonlySet<string>,
  issues: PoseCreatorClipValidationIssue[],
): void {
  const humanoidEntries = Object.entries(pose.humanoid ?? {});
  const expressionEntries = Object.entries(pose.expressions ?? {});

  // Empty clip-local poses are valid neutral expression landmarks. They are
  // distinct from standalone reusable poses, which still require a target.

  for (const [boneName, transform] of humanoidEntries) {
    if (!isVRMHumanBoneName(boneName)) {
      issues.push({
        severity: "error",
        code: "invalid-pose-bone",
        message: `Local pose "${alias}" contains invalid humanoid bone "${boneName}".`,
        target: `${alias}:${boneName}`,
      });
      continue;
    }

    if (availableBoneNames.size > 0 && !availableBoneNames.has(boneName)) {
      issues.push({
        severity: "warning",
        code: "pose-bone-unavailable",
        message: `Local pose "${alias}" targets bone "${boneName}", which is unavailable on the current avatar.`,
        target: `${alias}:${boneName}`,
      });
    }

    if (!transform.position && !transform.rotation) {
      issues.push({
        severity: "error",
        code: "empty-bone-transform",
        message: `Local pose "${alias}" has no transform data for bone "${boneName}".`,
        target: `${alias}:${boneName}`,
      });
    }

    if (transform.position) {
      validateVectorTuple(alias, boneName, transform.position, issues);
    }
    if (transform.rotation) {
      validateQuaternionTuple(alias, boneName, transform.rotation, issues);
    }
  }

  for (const [expressionName, weight] of expressionEntries) {
    if (
      !expressionName.trim() ||
      typeof weight !== "number" ||
      !Number.isFinite(weight)
    ) {
      issues.push({
        severity: "error",
        code: "invalid-expression-weight",
        message: `Local pose "${alias}" contains an invalid expression weight.`,
        target: `${alias}:${expressionName}`,
      });
      continue;
    }

    if (weight < 0 || weight > 1) {
      issues.push({
        severity: "error",
        code: "expression-weight-out-of-range",
        message: `Local pose "${alias}" expression "${expressionName}" is outside the 0..1 range.`,
        target: `${alias}:${expressionName}`,
      });
    }
  }
}

function validateVectorTuple(
  alias: string,
  boneName: string,
  value: readonly unknown[],
  issues: PoseCreatorClipValidationIssue[],
): void {
  if (
    !Array.isArray(value) ||
    value.length !== 3 ||
    !value.every((entry) => typeof entry === "number" && Number.isFinite(entry))
  ) {
    issues.push({
      severity: "error",
      code: "invalid-position-data",
      message: `Local pose "${alias}" bone "${boneName}" has invalid position data.`,
      target: `${alias}:${boneName}`,
    });
  }
}

function validateQuaternionTuple(
  alias: string,
  boneName: string,
  value: readonly unknown[],
  issues: PoseCreatorClipValidationIssue[],
): void {
  if (
    !Array.isArray(value) ||
    value.length !== 4 ||
    !value.every((entry) => typeof entry === "number" && Number.isFinite(entry))
  ) {
    issues.push({
      severity: "error",
      code: "invalid-quaternion-data",
      message: `Local pose "${alias}" bone "${boneName}" has invalid quaternion data.`,
      target: `${alias}:${boneName}`,
    });
    return;
  }

  const length = Math.hypot(
    value[0] as number,
    value[1] as number,
    value[2] as number,
    value[3] as number,
  );
  if (length <= QUATERNION_ZERO_EPSILON) {
    issues.push({
      severity: "error",
      code: "invalid-quaternion-data",
      message: `Local pose "${alias}" bone "${boneName}" has a zero-length quaternion.`,
      target: `${alias}:${boneName}`,
    });
    return;
  }

  if (Math.abs(length - 1) > QUATERNION_NORMALIZED_EPSILON) {
    issues.push({
      severity: "warning",
      code: "non-normalized-quaternion",
      message: `Local pose "${alias}" bone "${boneName}" quaternion is not normalized.`,
      target: `${alias}:${boneName}`,
    });
  }
}

export function clampPoseCreatorClipDuration(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Number(value.toFixed(3)));
}

export function clampPoseCreatorClipTime(
  value: number,
  duration: number,
): number {
  if (!Number.isFinite(value)) return 0;
  const max = Number.isFinite(duration) ? Math.max(0, duration) : 0;
  return Math.min(max, Math.max(0, Number(value.toFixed(3))));
}

export function normalizePoseCreatorClipSnapInterval(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return DEFAULT_POSE_CREATOR_CLIP_SNAP_INTERVAL_SEC;
  }
  return Number(value.toFixed(3));
}

export function snapPoseCreatorClipTime(
  value: number,
  duration: number,
  interval: number,
): number {
  const normalizedInterval = normalizePoseCreatorClipSnapInterval(interval);
  const snapped = Math.round(value / normalizedInterval) * normalizedInterval;
  return clampPoseCreatorClipTime(snapped, duration);
}

export function normalizePoseCreatorClipPlaybackSpeed(value: number): number {
  const allowedSpeed = POSE_CREATOR_CLIP_PLAYBACK_SPEED_OPTIONS.find(
    (option) => option.value === value,
  );
  return allowedSpeed?.value ?? DEFAULT_POSE_CREATOR_CLIP_PLAYBACK_SPEED;
}

export function generatePoseCreatorClipPoseAlias(
  sourceId: string,
  existingAliases: Iterable<string>,
): string {
  const baseAlias = camelCaseAlias(sourceId) || "pose";
  const usedAliases = new Set(existingAliases);
  if (!usedAliases.has(baseAlias)) return baseAlias;

  let suffix = 2;
  while (usedAliases.has(`${baseAlias}_${suffix}`)) {
    suffix += 1;
  }
  return `${baseAlias}_${suffix}`;
}

export function generatePoseCreatorClipCapturedAlias(
  existingAliases: Iterable<string>,
): string {
  const usedAliases = new Set(existingAliases);
  let index = 1;
  while (usedAliases.has(formatCapturedAlias(index))) {
    index += 1;
  }
  return formatCapturedAlias(index);
}

export function generatePoseCreatorClipKeyframeId(
  existingIds: Iterable<string>,
): string {
  const usedIds = new Set(existingIds);
  let index = 1;
  while (usedIds.has(formatKeyframeId(index))) {
    index += 1;
  }
  return formatKeyframeId(index);
}

export function generatePoseCreatorClipEventId(
  existingIds: Iterable<string>,
): string {
  const usedIds = new Set(existingIds);
  let index = 1;
  while (usedIds.has(formatEventId(index))) {
    index += 1;
  }
  return formatEventId(index);
}

export function getPoseCreatorClipEventValidationTarget(
  eventId: string,
): string {
  return `event:${eventId}`;
}

export function clonePoseCreatorClipPose(
  pose: AnimaPoseClipPose,
): AnimaPoseClipPose {
  if (isAnimaPoseClipRef(pose)) {
    return { ref: pose.ref };
  }

  return {
    ...(pose.humanoid ? { humanoid: cloneVRMPose(pose.humanoid) } : {}),
    ...(pose.expressions ? { expressions: { ...pose.expressions } } : {}),
  };
}

export function clonePoseCreatorClipEvent(
  event: AnimaPoseClipEvent,
): AnimaPoseClipEvent {
  if (event.kind === "avatar_vfx") {
    return {
      id: event.id,
      time: event.time,
      kind: "avatar_vfx",
      effectId: event.effectId,
      ...clonePoseCreatorClipVFXEventFields(event),
      ...(event.playAccompanyingSound !== undefined
        ? { playAccompanyingSound: event.playAccompanyingSound }
        : {}),
    };
  }

  if (event.kind === "scene_vfx") {
    return {
      id: event.id,
      time: event.time,
      kind: "scene_vfx",
      sceneKind: event.sceneKind,
      presetId: event.presetId,
      ...clonePoseCreatorClipVFXEventFields(event),
      ...(event.playAccompanyingSound !== undefined
        ? { playAccompanyingSound: event.playAccompanyingSound }
        : {}),
    };
  }

  if (event.kind === "particle_vfx") {
    return {
      id: event.id,
      time: event.time,
      kind: "particle_vfx",
      effectId: event.effectId,
      ...(event.anchor ? { anchor: event.anchor } : {}),
      ...clonePoseCreatorClipVFXEventFields(event),
      ...(event.transform
        ? { transform: cloneParticleVFXTransformInput(event.transform) }
        : {}),
      ...(event.followAnchor !== undefined
        ? { followAnchor: event.followAnchor }
        : {}),
    };
  }

  return {
    id: event.id,
    time: event.time,
    kind: "sfx",
    cueId: event.cueId,
    ...(event.volume !== undefined ? { volume: event.volume } : {}),
  };
}

function clonePoseCreatorClipVFXEventFields(
  event:
    | AnimaPoseClipAvatarVFXEvent
    | AnimaPoseClipSceneVFXEvent
    | AnimaPoseClipParticleVFXEvent,
): Pick<
  | AnimaPoseClipAvatarVFXEvent
  | AnimaPoseClipSceneVFXEvent
  | AnimaPoseClipParticleVFXEvent,
  "duration" | "envelope" | "parameterKeyframes"
> {
  return {
    ...(event.duration !== undefined ? { duration: event.duration } : {}),
    ...(event.envelope
      ? { envelope: clonePoseCreatorClipVFXEnvelope(event.envelope) }
      : {}),
    ...(event.parameterKeyframes
      ? {
          parameterKeyframes: event.parameterKeyframes.map(
            clonePoseCreatorClipVFXParameterKeyframe,
          ),
        }
      : {}),
  };
}

function cloneParticleVFXTransformInput(
  transform: NonNullable<AnimaPoseClipParticleVFXEvent["transform"]>,
): AnimaPoseClipParticleVFXEvent["transform"] {
  return {
    ...(transform.offset ? { offset: { ...transform.offset } } : {}),
    ...(transform.depthOffset !== undefined
      ? { depthOffset: transform.depthOffset }
      : {}),
    ...(transform.rotation ? { rotation: { ...transform.rotation } } : {}),
    ...(transform.scale ? { scale: { ...transform.scale } } : {}),
  };
}

function clonePoseCreatorClipVFXEnvelope(
  envelope: AnimaPoseClipVFXEnvelope,
): AnimaPoseClipVFXEnvelope {
  return {
    ...(envelope.intensity
      ? {
          intensity: {
            ...(envelope.intensity.from !== undefined
              ? { from: envelope.intensity.from }
              : {}),
            ...(envelope.intensity.to !== undefined
              ? { to: envelope.intensity.to }
              : {}),
            ...(envelope.intensity.fadeIn !== undefined
              ? { fadeIn: envelope.intensity.fadeIn }
              : {}),
            ...(envelope.intensity.fadeOut !== undefined
              ? { fadeOut: envelope.intensity.fadeOut }
              : {}),
            ...(envelope.intensity.easing
              ? { easing: envelope.intensity.easing }
              : {}),
          },
        }
      : {}),
  };
}

function clonePoseCreatorClipVFXParameterKeyframe(
  keyframe: AnimaPoseClipVFXParameterKeyframe,
): AnimaPoseClipVFXParameterKeyframe {
  return {
    time: keyframe.time,
    values: { ...keyframe.values },
    ...(keyframe.transition
      ? { transition: clonePoseCreatorClipTransition(keyframe.transition) }
      : {}),
  };
}

function clonePoseCreatorClipPoses(
  poses: Record<string, AnimaPoseClipPose>,
): Record<string, AnimaPoseClipPose> {
  return Object.fromEntries(
    Object.entries(poses).map(([alias, pose]) => [
      alias,
      clonePoseCreatorClipPose(pose),
    ]),
  );
}

function resolvePoseSnapshot(
  poseId: string,
  resolvePose: (poseId: string) => AnimaPose | null | undefined,
): Pick<AnimaPose, "humanoid" | "expressions"> | null {
  const pose = resolvePose(poseId);
  if (!pose) return null;
  return {
    ...(pose.humanoid ? { humanoid: cloneVRMPose(pose.humanoid) } : {}),
    ...(pose.expressions ? { expressions: { ...pose.expressions } } : {}),
  };
}

function cloneAnimaPoseClipSnapshot(
  pose: Pick<AnimaPose, "humanoid" | "expressions">,
): Pick<AnimaPose, "humanoid" | "expressions"> {
  return {
    ...(pose.humanoid ? { humanoid: cloneVRMPose(pose.humanoid) } : {}),
    ...(pose.expressions ? { expressions: { ...pose.expressions } } : {}),
  };
}

function mergePoseCreatorClipSnapshots(
  baseSnapshot: Pick<AnimaPose, "humanoid" | "expressions">,
  overlaySnapshot: Pick<AnimaPose, "humanoid" | "expressions">,
): Pick<AnimaPose, "humanoid" | "expressions"> {
  const humanoid = mergePoseCreatorClipHumanoidSnapshots(
    baseSnapshot.humanoid,
    overlaySnapshot.humanoid,
  );
  const expressions = mergePoseCreatorClipExpressions(
    baseSnapshot.expressions,
    overlaySnapshot.expressions,
  );

  return {
    ...(humanoid ? { humanoid } : {}),
    ...(expressions ? { expressions } : {}),
  };
}

function mergePoseCreatorClipHumanoidSnapshots(
  basePose: VRMPose | undefined,
  overlayPose: VRMPose | undefined,
): VRMPose | undefined {
  if (!basePose && !overlayPose) return undefined;

  const pose = basePose ? cloneVRMPose(basePose) : {};
  for (const boneName of Object.keys(overlayPose ?? {}).filter(
    isVRMHumanBoneName,
  )) {
    const overlayTransform = overlayPose?.[boneName];
    if (!overlayTransform) continue;

    const baseTransform = pose[boneName];
    pose[boneName] = mergePoseCreatorClipTransforms(
      baseTransform,
      overlayTransform,
    );
  }

  return Object.keys(pose).length > 0 ? pose : undefined;
}

function mergePoseCreatorClipTransforms(
  baseTransform: VRMPoseTransform | undefined,
  overlayTransform: VRMPoseTransform,
): VRMPoseTransform {
  const merged: VRMPoseTransform = {
    ...(baseTransform ? cloneVRMPoseTransform(baseTransform) : {}),
    ...cloneVRMPoseTransform(overlayTransform),
  };
  return merged;
}

function mergePoseCreatorClipExpressions(
  baseExpressions: Record<string, number> | undefined,
  overlayExpressions: Record<string, number> | undefined,
): Record<string, number> | undefined {
  const expressions = {
    ...(baseExpressions ?? {}),
    ...(overlayExpressions ?? {}),
  };
  return Object.keys(expressions).length > 0 ? expressions : undefined;
}

export function createPoseCreatorClipRefPose(
  poseId: string,
): AnimaPoseClipPose {
  return { ref: poseId };
}

export function createPoseCreatorClipInlinePose(
  pose: AnimaPose,
): AnimaPoseClipPose {
  return {
    ...(pose.humanoid ? { humanoid: cloneVRMPose(pose.humanoid) } : {}),
    ...(pose.expressions ? { expressions: { ...pose.expressions } } : {}),
  };
}

export function clonePoseCreatorClipTransition(
  transition: AnimaPoseClipTransition,
): AnimaPoseClipTransition {
  return {
    ...(transition.easing ? { easing: transition.easing } : {}),
    ...(transition.interpolation
      ? { interpolation: { ...transition.interpolation } }
      : {}),
  };
}

export function clonePoseCreatorClipFade(
  fade: AnimaPoseClipFade | null | undefined,
): AnimaPoseClipFade | undefined {
  if (!fade) return undefined;
  return {
    duration: clampPoseCreatorClipFadeDuration(fade.duration),
    ...clonePoseCreatorClipTransition(fade),
  };
}

export function normalizePoseCreatorClipFade(
  fade: AnimaPoseClipFade | null | undefined,
): AnimaPoseClipFade | undefined {
  if (!fade) return undefined;
  return {
    duration: clampPoseCreatorClipFadeDuration(fade.duration),
    ...(normalizePoseCreatorClipTransition(fade) ?? {}),
  };
}

export function normalizePoseCreatorClipTransition(
  transition: AnimaPoseClipTransition | null | undefined,
): AnimaPoseClipTransition | undefined {
  if (!transition) return undefined;

  const interpolation = transition.interpolation
    ? {
        ...(transition.interpolation.humanoidRotation
          ? { humanoidRotation: transition.interpolation.humanoidRotation }
          : {}),
        ...(transition.interpolation.humanoidPosition
          ? { humanoidPosition: transition.interpolation.humanoidPosition }
          : {}),
        ...(transition.interpolation.expression
          ? { expression: transition.interpolation.expression }
          : {}),
      }
    : undefined;

  const normalized = {
    ...(transition.easing ? { easing: transition.easing } : {}),
    ...(interpolation && Object.keys(interpolation).length > 0
      ? { interpolation }
      : {}),
  };

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function clampPoseCreatorClipFadeDuration(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, value);
}

export function sortPoseCreatorClipKeyframes(
  keyframes: readonly PoseCreatorClipKeyframeDraft[],
): PoseCreatorClipKeyframeDraft[] {
  return [...keyframes].sort((left, right) => {
    const timeDelta = left.time - right.time;
    if (timeDelta !== 0) return timeDelta;
    return left.id.localeCompare(right.id);
  });
}

export function sortPoseCreatorClipEvents(
  events: readonly PoseCreatorClipEventDraft[],
): PoseCreatorClipEventDraft[] {
  return events
    .map((event, index) => ({ event, index }))
    .sort((left, right) => {
      const timeDelta = left.event.time - right.event.time;
      if (timeDelta !== 0) return timeDelta;
      return left.index - right.index;
    })
    .map(({ event }) => clonePoseCreatorClipEvent(event));
}

export function findPoseCreatorClipKeyframeAtTime(
  keyframes: readonly PoseCreatorClipKeyframeDraft[],
  time: number,
): PoseCreatorClipKeyframeDraft | null {
  return (
    keyframes.find(
      (keyframe) => Math.abs(keyframe.time - time) <= KEYFRAME_TIME_EPSILON,
    ) ?? null
  );
}

export function createPoseCreatorClipKeyframeDraft(
  draft: PoseCreatorClipDraft,
  poseAlias: string,
  time: number,
): PoseCreatorClipKeyframeDraft {
  return {
    id: generatePoseCreatorClipKeyframeId(
      draft.keyframes.map((keyframe) => keyframe.id),
    ),
    time: clampPoseCreatorClipTime(time, draft.duration),
    pose: poseAlias,
  };
}

export function createPoseCreatorClipAvatarVFXEventDraft(
  draft: PoseCreatorClipDraft,
  effectId: string,
  time: number,
): AnimaPoseClipAvatarVFXEvent {
  return {
    id: generatePoseCreatorClipEventId(draft.events.map((event) => event.id)),
    time: clampPoseCreatorClipTime(time, draft.duration),
    kind: "avatar_vfx",
    effectId,
  };
}

export function createPoseCreatorClipSceneVFXEventDraft(
  draft: PoseCreatorClipDraft,
  sceneKind: AnimaPoseClipSceneVFXKind,
  presetId: string,
  time: number,
): AnimaPoseClipSceneVFXEvent {
  return {
    id: generatePoseCreatorClipEventId(draft.events.map((event) => event.id)),
    time: clampPoseCreatorClipTime(time, draft.duration),
    kind: "scene_vfx",
    sceneKind,
    presetId,
  };
}

export function createPoseCreatorClipParticleVFXEventDraft(
  draft: PoseCreatorClipDraft,
  effectId: string,
  time: number,
  catalogEntry?: Pick<
    ParticleVFXCatalogEntry,
    "defaultAnchor" | "defaultDurationSec" | "defaultTransform"
  > | null,
): AnimaPoseClipParticleVFXEvent {
  return {
    id: generatePoseCreatorClipEventId(draft.events.map((event) => event.id)),
    time: clampPoseCreatorClipTime(time, draft.duration),
    kind: "particle_vfx",
    effectId,
    ...(catalogEntry
      ? {
          anchor: catalogEntry.defaultAnchor,
          transform: cloneParticleVFXTransform(catalogEntry.defaultTransform),
        }
      : {}),
    followAnchor: true,
  };
}

export function createPoseCreatorClipSFXEventDraft(
  draft: PoseCreatorClipDraft,
  cueId: string,
  time: number,
): AnimaPoseClipSFXEvent {
  return {
    id: generatePoseCreatorClipEventId(draft.events.map((event) => event.id)),
    time: clampPoseCreatorClipTime(time, draft.duration),
    kind: "sfx",
    cueId,
  };
}

export function patchPoseCreatorClipKeyframeDraft(
  keyframe: PoseCreatorClipKeyframeDraft,
  patch: PoseCreatorClipKeyframeDraftPatch,
  duration: number,
): PoseCreatorClipKeyframeDraft {
  const transition =
    patch.transition === undefined
      ? keyframe.transition
        ? clonePoseCreatorClipTransition(keyframe.transition)
        : undefined
      : normalizePoseCreatorClipTransition(patch.transition);

  const nextKeyframe: PoseCreatorClipKeyframeDraft = {
    ...keyframe,
    ...(patch.pose !== undefined ? { pose: patch.pose } : {}),
    ...(patch.time !== undefined
      ? { time: clampPoseCreatorClipTime(patch.time, duration) }
      : {}),
  };
  if (transition) {
    nextKeyframe.transition = transition;
  } else {
    delete nextKeyframe.transition;
  }
  return nextKeyframe;
}

export function patchPoseCreatorClipEventDraft(
  event: PoseCreatorClipEventDraft,
  patch: PoseCreatorClipEventDraftPatch,
  duration: number,
): PoseCreatorClipEventDraft {
  const time =
    patch.time === undefined
      ? event.time
      : clampPoseCreatorClipTime(patch.time, duration);

  if (event.kind === "avatar_vfx") {
    const nextEvent = clonePoseCreatorClipEvent(
      event,
    ) as AnimaPoseClipAvatarVFXEvent;
    nextEvent.time = time;
    if (patch.playAccompanyingSound !== undefined)
      nextEvent.playAccompanyingSound = patch.playAccompanyingSound;
    if (patch.effectId !== undefined) nextEvent.effectId = patch.effectId;
    applyPoseCreatorClipVFXDurationPatch(nextEvent, patch);
    applyPoseCreatorClipAvatarVFXFadePatch(nextEvent, patch);
    return nextEvent;
  }

  if (event.kind === "scene_vfx") {
    const nextEvent = clonePoseCreatorClipEvent(
      event,
    ) as AnimaPoseClipSceneVFXEvent;
    nextEvent.time = time;
    if (patch.playAccompanyingSound !== undefined)
      nextEvent.playAccompanyingSound = patch.playAccompanyingSound;
    if (patch.sceneKind !== undefined) nextEvent.sceneKind = patch.sceneKind;
    if (patch.presetId !== undefined) nextEvent.presetId = patch.presetId;
    applyPoseCreatorClipVFXDurationPatch(nextEvent, patch);
    return nextEvent;
  }

  if (event.kind === "particle_vfx") {
    const nextEvent = clonePoseCreatorClipEvent(
      event,
    ) as AnimaPoseClipParticleVFXEvent;
    nextEvent.time = time;
    if (patch.effectId !== undefined) nextEvent.effectId = patch.effectId;
    applyPoseCreatorClipParticleVFXPatch(nextEvent, patch);
    applyPoseCreatorClipVFXDurationPatch(nextEvent, patch);
    return nextEvent;
  }

  const nextEvent = clonePoseCreatorClipEvent(event) as AnimaPoseClipSFXEvent;
  nextEvent.time = time;
  if (patch.cueId !== undefined) nextEvent.cueId = patch.cueId;
  applyPoseCreatorClipSFXVolumePatch(nextEvent, patch);
  return nextEvent;
}

function applyPoseCreatorClipVFXDurationPatch(
  event:
    | AnimaPoseClipAvatarVFXEvent
    | AnimaPoseClipSceneVFXEvent
    | AnimaPoseClipParticleVFXEvent,
  patch: PoseCreatorClipEventDraftPatch,
): void {
  if (patch.duration === undefined) return;
  if (patch.duration === null) {
    delete event.duration;
    delete event.envelope;
    delete event.parameterKeyframes;
    return;
  }
  event.duration = normalizePoseCreatorClipEventDuration(patch.duration);
}

/**
 * Write Fade in and Fade out into `envelope.intensity`, and re-clamp existing
 * fades when the duration changes. Fades need a duration (ending with the
 * Action removes the envelope); the envelope is removed when both are zero.
 */
function applyPoseCreatorClipAvatarVFXFadePatch(
  event: AnimaPoseClipAvatarVFXEvent,
  patch: PoseCreatorClipEventDraftPatch,
): void {
  const fadePatched = patch.fadeIn !== undefined || patch.fadeOut !== undefined;
  const reclamp =
    typeof patch.duration === "number" &&
    event.envelope?.intensity !== undefined;
  if (!fadePatched && !reclamp) return;
  if (event.duration === undefined) return;
  const current = event.envelope?.intensity ?? {};
  const clamp = (value: number) =>
    Number.isFinite(value) ? Math.min(event.duration!, Math.max(0, value)) : 0;
  const fadeIn = clamp(patch.fadeIn ?? current.fadeIn ?? 0);
  const fadeOut = clamp(patch.fadeOut ?? current.fadeOut ?? 0);
  if (fadeIn === 0 && fadeOut === 0) {
    delete event.envelope;
    return;
  }
  event.envelope = { intensity: { ...current, fadeIn, fadeOut } };
}

function applyPoseCreatorClipParticleVFXPatch(
  event: AnimaPoseClipParticleVFXEvent,
  patch: PoseCreatorClipEventDraftPatch,
): void {
  if (patch.anchor !== undefined) {
    if (patch.anchor === null) {
      delete event.anchor;
    } else {
      event.anchor = patch.anchor;
    }
  }

  if (patch.followAnchor !== undefined) {
    event.followAnchor = patch.followAnchor;
  }

  if (patch.transform !== undefined) {
    if (patch.transform === null) {
      delete event.transform;
    } else {
      event.transform = mergeParticleVFXTransformInput(
        event.transform,
        patch.transform,
      );
    }
  }
}

function mergeParticleVFXTransformInput(
  base: ParticleVFXTransformInput | undefined,
  patch: ParticleVFXTransformInput,
): ParticleVFXTransformInput {
  return {
    ...(base?.offset || patch.offset
      ? { offset: mergeParticleVFXAxisTriple(base?.offset, patch.offset) }
      : {}),
    ...(patch.depthOffset !== undefined
      ? { depthOffset: patch.depthOffset }
      : base?.depthOffset !== undefined
        ? { depthOffset: base.depthOffset }
        : {}),
    ...(base?.rotation || patch.rotation
      ? { rotation: mergeParticleVFXAxisTriple(base?.rotation, patch.rotation) }
      : {}),
    ...(base?.scale || patch.scale
      ? { scale: mergeParticleVFXAxisTriple(base?.scale, patch.scale) }
      : {}),
  };
}

function mergeParticleVFXAxisTriple(
  base: Partial<ParticleVFXTransformAxisTriple> | undefined,
  patch: Partial<ParticleVFXTransformAxisTriple> | undefined,
): Partial<ParticleVFXTransformAxisTriple> {
  return {
    ...(base ?? {}),
    ...(patch ?? {}),
  };
}

function applyPoseCreatorClipSFXVolumePatch(
  event: AnimaPoseClipSFXEvent,
  patch: PoseCreatorClipEventDraftPatch,
): void {
  if (patch.volume === undefined) return;
  if (patch.volume === null) {
    delete event.volume;
    return;
  }
  event.volume = normalizePoseCreatorClipUnitValue(patch.volume);
}

function normalizePoseCreatorClipEventDuration(value: number): number {
  if (!Number.isFinite(value)) {
    return MIN_POSE_CREATOR_CLIP_EVENT_DURATION_SEC;
  }
  return Math.max(
    MIN_POSE_CREATOR_CLIP_EVENT_DURATION_SEC,
    Number(value.toFixed(3)),
  );
}

function normalizePoseCreatorClipUnitValue(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(1, Math.max(0, Number(value.toFixed(3))));
}

export function withPoseCreatorClipValidation(
  draft: PoseCreatorClipDraft,
  options: PoseCreatorClipValidationOptions = {},
): PoseCreatorClipDraft {
  return {
    ...draft,
    validationIssues: validatePoseCreatorClipDraft(draft, options),
  };
}

function cloneDefaultTransition(): AnimaPoseClipTransition {
  return {
    easing: DEFAULT_ANIMA_POSE_CLIP_TRANSITION.easing,
    interpolation: {
      ...DEFAULT_ANIMA_POSE_CLIP_TRANSITION.interpolation,
    },
  };
}

function camelCaseAlias(value: string): string {
  const words = value
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean);

  return words
    .map((word, index) => {
      const lower = word.toLowerCase();
      if (index === 0) return lower;
      return `${lower.charAt(0).toUpperCase()}${lower.slice(1)}`;
    })
    .join("");
}

function formatCapturedAlias(index: number): string {
  return `captured_${String(index).padStart(3, "0")}`;
}

function formatKeyframeId(index: number): string {
  return `kf_${String(index).padStart(3, "0")}`;
}

function formatEventId(index: number): string {
  return `evt_${String(index).padStart(3, "0")}`;
}

function formatKeyframeTimeKey(time: number): string {
  return Number(time.toFixed(3)).toFixed(3);
}
