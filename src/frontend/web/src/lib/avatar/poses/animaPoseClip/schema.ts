import type { VRMPose } from "@pixiv/three-vrm";
import type { AvatarInteractionPhase } from "@/lib/types/voice-types";

import {
  ANIMA_POSE_SCHEMA,
  cloneVRMPose,
  sanitizeAnimaPose,
  type AnimaPose,
} from "../animaPose";
import type { AvatarAnimationState } from "../../types";
import type { ProceduralAnimationLayerId } from "../../proc-animation/types";
import {
  PARTICLE_VFX_ANCHORS,
  type ParticleVFXAnchor,
  type ParticleVFXTransformAxisTriple,
  type ParticleVFXTransformInput,
} from "../../particle-vfx/types";

export const ANIMA_POSE_CLIP_SCHEMA = "animaPoseClip/1.0" as const;

/**
 * Live procedural layers a clip may mute while it plays. `talkingHands` is
 * excluded: Gestures already suppress it.
 */
export type AnimaPoseClipMutableLayerId = Exclude<
  ProceduralAnimationLayerId,
  "talkingHands"
>;

export const ANIMA_POSE_CLIP_MUTABLE_LAYER_IDS: readonly AnimaPoseClipMutableLayerId[] =
  [
    "breathing",
    "sway",
    "bounce",
    "headNod",
    "headSideTilt",
    "cursorLookAt",
    "emotionPosture",
  ];

export type AnimaPoseClipRole = "motion" | "reaction";
export type AnimaPoseClipPlaybackScope = "activeRun";

export type AnimaPoseClipEasing =
  | "linear"
  | "easeInSine"
  | "easeOutSine"
  | "easeInOutSine"
  | "easeInCubic"
  | "easeOutCubic"
  | "easeInOutCubic"
  | "back"
  | "elastic"
  | "bounce";

export type AnimaPoseClipRotationInterpolation = "slerp" | "nlerp" | "step";

export type AnimaPoseClipScalarInterpolation = "linear" | "step";

export type AnimaPoseClipInterpolation = {
  humanoidRotation?: AnimaPoseClipRotationInterpolation;
  humanoidPosition?: AnimaPoseClipScalarInterpolation;
  expression?: AnimaPoseClipScalarInterpolation;
};

export type AnimaPoseClipTransition = {
  easing?: AnimaPoseClipEasing;
  interpolation?: AnimaPoseClipInterpolation;
};

export type AnimaPoseClipFade = AnimaPoseClipTransition & {
  duration: number;
};

export type AnimaPoseClipPlaybackLifetime =
  | {
      kind: "whileInteractionPhase";
      phases: AvatarInteractionPhase[];
      scope?: AnimaPoseClipPlaybackScope;
    }
  | {
      kind: "whileAvatarState";
      states: AvatarAnimationState[];
      scope?: AnimaPoseClipPlaybackScope;
    };

export type AnimaPoseClipPlayback = {
  lifetime: AnimaPoseClipPlaybackLifetime;
};

export type AnimaPoseSnapshot = {
  humanoid?: VRMPose;
  expressions?: Record<string, number>;
};

export type AnimaPoseRef = {
  ref: string;
};

export type AnimaPoseClipPose = AnimaPoseSnapshot | AnimaPoseRef;

export type AnimaPoseClipKeyframe = {
  time: number;
  pose: string;
  transition?: AnimaPoseClipTransition;
};

export type AnimaPoseClipSceneVFXKind = "background_layers" | "focus_lines";

export type AnimaPoseClipVFXIntensityEnvelope = {
  from?: number;
  to?: number;
  fadeIn?: number;
  fadeOut?: number;
  easing?: AnimaPoseClipEasing;
};

export type AnimaPoseClipVFXEnvelope = {
  intensity?: AnimaPoseClipVFXIntensityEnvelope;
};

export type AnimaPoseClipVFXParameterKeyframe = {
  time: number;
  values: Record<string, number>;
  transition?: AnimaPoseClipTransition;
};

export type AnimaPoseClipAvatarVFXEvent = {
  id: string;
  time: number;
  kind: "avatar_vfx";
  /** Omitted in older clips: accompanying audio remains enabled. */
  playAccompanyingSound?: boolean;
  effectId: string;
  duration?: number;
  envelope?: AnimaPoseClipVFXEnvelope;
  parameterKeyframes?: AnimaPoseClipVFXParameterKeyframe[];
};

export type AnimaPoseClipSceneVFXEvent = {
  id: string;
  time: number;
  kind: "scene_vfx";
  /** Omitted in older clips: accompanying audio remains enabled. */
  playAccompanyingSound?: boolean;
  sceneKind: AnimaPoseClipSceneVFXKind;
  presetId: string;
  duration?: number;
  envelope?: AnimaPoseClipVFXEnvelope;
  parameterKeyframes?: AnimaPoseClipVFXParameterKeyframe[];
};

export type AnimaPoseClipParticleVFXEvent = {
  id: string;
  time: number;
  kind: "particle_vfx";
  effectId: string;
  anchor?: ParticleVFXAnchor;
  duration?: number;
  transform?: ParticleVFXTransformInput;
  followAnchor?: boolean;
  envelope?: AnimaPoseClipVFXEnvelope;
  parameterKeyframes?: AnimaPoseClipVFXParameterKeyframe[];
};

export type AnimaPoseClipSFXEvent = {
  id: string;
  time: number;
  kind: "sfx";
  cueId: string;
  volume?: number;
};

export type AnimaPoseClipVFXEvent =
  | AnimaPoseClipAvatarVFXEvent
  | AnimaPoseClipSceneVFXEvent
  | AnimaPoseClipParticleVFXEvent;

export type AnimaPoseClipEvent =
  | AnimaPoseClipAvatarVFXEvent
  | AnimaPoseClipSceneVFXEvent
  | AnimaPoseClipParticleVFXEvent
  | AnimaPoseClipSFXEvent;

export type AnimaPoseClip = {
  schema: typeof ANIMA_POSE_CLIP_SCHEMA;
  id: string;
  name: string;
  /**
   * Legacy authoring metadata retained for payload compatibility. Runtime
   * behavior is determined by the loadout slot that mounts the clip.
   */
  role?: AnimaPoseClipRole;
  duration?: number;
  loop?: boolean;
  playback?: AnimaPoseClipPlayback;
  basePose?: string;
  defaultTransition?: AnimaPoseClipTransition;
  fadeIn?: AnimaPoseClipFade;
  fadeOut?: AnimaPoseClipFade;
  poses: Record<string, AnimaPoseClipPose>;
  poseKeyframes: AnimaPoseClipKeyframe[];
  events?: AnimaPoseClipEvent[];
  /** Live procedural layers muted while this clip plays (absent: none). */
  mutedProceduralLayers?: AnimaPoseClipMutableLayerId[];
  // Parsing also preserves top-level fields this version does not know, so
  // newer or tool-specific metadata survives import, edit and save. They are
  // deliberately untyped; read them through `Record<string, unknown>`.
};

/** Top-level fields the parser validates; every other field is preserved. */
const KNOWN_CLIP_FIELDS = new Set([
  "schema",
  "id",
  "name",
  "role",
  "duration",
  "loop",
  "playback",
  "basePose",
  "defaultTransition",
  "fadeIn",
  "fadeOut",
  "poses",
  "poseKeyframes",
  "events",
  "mutedProceduralLayers",
]);

export type AnimaPoseClipSample = AnimaPoseSnapshot;

export type AnimaPoseClipPoseResolver = (
  poseId: string,
) => AnimaPose | AnimaPoseSnapshot | null | undefined;

export type AnimaPoseClipSampleDiagnostics = {
  missingPoseRefs: string[];
};

export type AnimaPoseClipSampleResult = {
  sample: AnimaPoseClipSample;
  diagnostics: AnimaPoseClipSampleDiagnostics;
};

export type ResolvedAnimaPoseClipTransition = {
  easing: AnimaPoseClipEasing;
  interpolation: {
    humanoidRotation: AnimaPoseClipRotationInterpolation;
    humanoidPosition: AnimaPoseClipScalarInterpolation;
    expression: AnimaPoseClipScalarInterpolation;
  };
};

export type QuaternionTuple = [number, number, number, number];
export type VectorTuple = [number, number, number];

export const DEFAULT_ANIMA_POSE_CLIP_TRANSITION: ResolvedAnimaPoseClipTransition =
  {
    easing: "easeInOutSine",
    interpolation: {
      humanoidRotation: "slerp",
      humanoidPosition: "linear",
      expression: "linear",
    },
  };

export const ANIMA_POSE_CLIP_EPSILON = 0.000001;

const KNOWN_EASINGS: ReadonlySet<string> = new Set<AnimaPoseClipEasing>([
  "linear",
  "easeInSine",
  "easeOutSine",
  "easeInOutSine",
  "easeInCubic",
  "easeOutCubic",
  "easeInOutCubic",
  "back",
  "elastic",
  "bounce",
]);

const KNOWN_ROTATION_INTERPOLATIONS: ReadonlySet<string> =
  new Set<AnimaPoseClipRotationInterpolation>(["slerp", "nlerp", "step"]);

const KNOWN_SCALAR_INTERPOLATIONS: ReadonlySet<string> =
  new Set<AnimaPoseClipScalarInterpolation>(["linear", "step"]);

const KNOWN_SCENE_VFX_KINDS: ReadonlySet<string> =
  new Set<AnimaPoseClipSceneVFXKind>(["background_layers", "focus_lines"]);

const KNOWN_CLIP_ROLES: ReadonlySet<string> = new Set<AnimaPoseClipRole>([
  "motion",
  "reaction",
]);

const KNOWN_PLAYBACK_SCOPES: ReadonlySet<string> =
  new Set<AnimaPoseClipPlaybackScope>(["activeRun"]);

const KNOWN_INTERACTION_PHASES: ReadonlySet<string> =
  new Set<AvatarInteractionPhase>([
    "idle",
    "user_typing",
    "listening",
    "user_speaking",
    "semantic_check",
    "submitting",
    "thinking",
    "responding_no_tts",
    "talking",
  ]);

const KNOWN_AVATAR_STATES: ReadonlySet<string> = new Set<AvatarAnimationState>([
  "idle",
  "listening",
  "thinking",
  "gesture",
  "talking",
]);

export function parseAnimaPoseClip(value: unknown): AnimaPoseClip {
  const clip = sanitizeAnimaPoseClip(value);
  if (!clip) {
    throw new Error("Invalid animaPoseClip/1.0 payload");
  }
  return clip;
}

/**
 * Validate a layer-mute list: null unless it is an array; known ids in
 * canonical order. Unknown ids (for example from a newer version) are ignored.
 */
export function sanitizeAnimaPoseClipLayerMutes(
  value: unknown,
): AnimaPoseClipMutableLayerId[] | null {
  if (!Array.isArray(value)) return null;
  const requested = new Set(value);
  return ANIMA_POSE_CLIP_MUTABLE_LAYER_IDS.filter((id) => requested.has(id));
}

export function sanitizeAnimaPoseClip(value: unknown): AnimaPoseClip | null {
  if (!isRecord(value)) return null;
  if (value.schema !== ANIMA_POSE_CLIP_SCHEMA) return null;

  const id = sanitizeRequiredString(value.id);
  const name = sanitizeRequiredString(value.name);
  if (!id || !name) return null;

  const role =
    value.role === undefined ? undefined : sanitizeClipRole(value.role);
  if (value.role !== undefined && !role) return null;

  const playback =
    value.playback === undefined ? undefined : sanitizePlayback(value.playback);
  if (value.playback !== undefined && !playback) return null;

  let duration: number | undefined;
  if (value.duration !== undefined) {
    const sanitizedDuration = sanitizePositiveNumber(value.duration);
    if (sanitizedDuration === null) return null;
    duration = sanitizedDuration;
  }

  if (value.loop !== undefined && typeof value.loop !== "boolean") {
    return null;
  }

  const basePose =
    value.basePose === undefined
      ? undefined
      : sanitizeRequiredString(value.basePose);
  if (value.basePose !== undefined && !basePose) return null;

  const defaultTransition =
    value.defaultTransition === undefined
      ? undefined
      : sanitizeTransition(value.defaultTransition);
  if (value.defaultTransition !== undefined && !defaultTransition) return null;

  const fadeIn =
    value.fadeIn === undefined ? undefined : sanitizeFade(value.fadeIn);
  if (value.fadeIn !== undefined && !fadeIn) return null;

  const fadeOut =
    value.fadeOut === undefined ? undefined : sanitizeFade(value.fadeOut);
  if (value.fadeOut !== undefined && !fadeOut) return null;

  const poses = sanitizeClipPoses(value.poses);
  if (!poses) return null;

  const poseKeyframes = sanitizeClipKeyframes(
    value.poseKeyframes,
    duration,
    new Set(Object.keys(poses)),
  );
  if (!poseKeyframes) return null;

  const events =
    value.events === undefined
      ? undefined
      : sanitizeClipEvents(value.events, duration);
  if (value.events !== undefined && !events) return null;
  if (poseKeyframes.length === 0 && (!events || events.length === 0)) {
    return null;
  }

  let mutedProceduralLayers: AnimaPoseClipMutableLayerId[] | undefined;
  if (value.mutedProceduralLayers !== undefined) {
    const sanitized = sanitizeAnimaPoseClipLayerMutes(
      value.mutedProceduralLayers,
    );
    if (!sanitized) return null;
    mutedProceduralLayers = sanitized;
  }

  // Finite clips may omit duration when their authored timeline has an end.
  // Effect duration is deliberately excluded: it cannot extend the clip clock.
  const timelineDuration =
    duration ?? getAuthoredTimelineDuration(poseKeyframes, events ?? undefined);
  if ((value.loop === true || !playback) && timelineDuration <= 0) {
    return null;
  }

  const unknownFields = Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !KNOWN_CLIP_FIELDS.has(key))
      .map(([key, field]) => [key, structuredClone(field)]),
  );

  return {
    ...unknownFields,
    schema: ANIMA_POSE_CLIP_SCHEMA,
    id,
    name,
    ...(role ? { role } : {}),
    ...(duration !== undefined ? { duration } : {}),
    ...(value.loop === true ? { loop: true } : {}),
    ...(playback ? { playback } : {}),
    ...(basePose ? { basePose } : {}),
    ...(defaultTransition ? { defaultTransition } : {}),
    ...(fadeIn ? { fadeIn } : {}),
    ...(fadeOut ? { fadeOut } : {}),
    poses,
    poseKeyframes,
    ...(events && events.length > 0 ? { events } : {}),
    ...(mutedProceduralLayers && mutedProceduralLayers.length > 0
      ? { mutedProceduralLayers }
      : {}),
  };
}

export function isAnimaPoseClipRef(value: unknown): value is AnimaPoseRef {
  if (!isRecord(value)) return false;
  return (
    Object.keys(value).length === 1 &&
    Boolean(sanitizeRequiredString(value.ref))
  );
}

export function isAnimaPoseSnapshot(
  value: unknown,
): value is AnimaPoseSnapshot {
  return sanitizePoseSnapshot(value, "snapshot", true) !== null;
}

export function sanitizePoseSnapshot(
  value: unknown,
  fallbackId: string,
  requireTargets: boolean,
): AnimaPoseSnapshot | null {
  if (!isRecord(value)) return null;
  if ("parent" in value) return null;

  const pose = sanitizeAnimaPose({
    schema: ANIMA_POSE_SCHEMA,
    id: fallbackId,
    name: fallbackId,
    ...value,
  });
  if (!pose) return null;

  const snapshot = extractPoseSnapshot(pose);
  if (requireTargets && !hasSampleTargets(snapshot)) return null;
  return snapshot;
}

function sanitizeClipPoses(
  value: unknown,
): Record<string, AnimaPoseClipPose> | null {
  if (!isRecord(value)) return null;

  const poses = Object.create(null) as Record<string, AnimaPoseClipPose>;
  const aliases = new Set<string>();
  for (const [rawAlias, rawPose] of Object.entries(value)) {
    const alias = sanitizeRequiredString(rawAlias);
    if (!alias || aliases.has(alias)) return null;

    const pose = sanitizeClipPose(rawPose, alias);
    if (!pose) return null;
    poses[alias] = pose;
    aliases.add(alias);
  }

  return poses;
}

function sanitizeClipPose(
  value: unknown,
  alias: string,
): AnimaPoseClipPose | null {
  if (isAnimaPoseClipRef(value)) {
    return {
      ref: value.ref.trim(),
    };
  }
  if (isRecord(value) && "ref" in value) return null;
  // A sparse expression timeline may need an empty landmark to mean "all
  // expressions are neutral here". Standalone poses still require a target,
  // but clip-local snapshots are allowed to be empty for that purpose.
  return sanitizePoseSnapshot(value, alias, false);
}

function sanitizeClipKeyframes(
  value: unknown,
  duration: number | undefined,
  aliases: Set<string>,
): AnimaPoseClipKeyframe[] | null {
  if (!Array.isArray(value)) return null;

  const keyframes: AnimaPoseClipKeyframe[] = [];
  let previousTime: number | null = null;

  for (const rawKeyframe of value) {
    if (!isRecord(rawKeyframe)) return null;
    const time = rawKeyframe.time;
    if (typeof time !== "number" || !Number.isFinite(time)) return null;
    if (time < 0) return null;
    if (duration !== undefined && time > duration) return null;
    if (previousTime !== null && time <= previousTime) return null;

    const pose = sanitizeRequiredString(rawKeyframe.pose);
    if (!pose || !aliases.has(pose)) return null;

    const transition =
      rawKeyframe.transition === undefined
        ? undefined
        : sanitizeTransition(rawKeyframe.transition);
    if (rawKeyframe.transition !== undefined && !transition) return null;

    keyframes.push({
      time,
      pose,
      ...(transition ? { transition } : {}),
    });
    previousTime = time;
  }

  return keyframes;
}

function sanitizeClipEvents(
  value: unknown,
  duration: number | undefined,
): AnimaPoseClipEvent[] | null {
  if (!Array.isArray(value)) return null;

  const ids = new Set<string>();
  const events: AnimaPoseClipEvent[] = [];
  for (const rawEvent of value) {
    const event = sanitizeClipEvent(rawEvent, duration);
    if (!event || ids.has(event.id)) return null;
    ids.add(event.id);
    events.push(event);
  }

  return events;
}

function sanitizeClipEvent(
  value: unknown,
  clipDuration: number | undefined,
): AnimaPoseClipEvent | null {
  if (!isRecord(value)) return null;

  const id = sanitizeRequiredString(value.id);
  if (!id) return null;

  const time = sanitizeFiniteNumber(value.time);
  if (time === null || time < 0) return null;
  if (clipDuration !== undefined && time > clipDuration) return null;

  switch (value.kind) {
    case "avatar_vfx":
      return sanitizeAvatarVFXEvent(value, id, time);
    case "scene_vfx":
      return sanitizeSceneVFXEvent(value, id, time);
    case "particle_vfx":
      return sanitizeParticleVFXEvent(value, id, time);
    case "sfx":
      return sanitizeSFXEvent(value, id, time);
    default:
      return null;
  }
}

function sanitizeAvatarVFXEvent(
  value: Record<string, unknown>,
  id: string,
  time: number,
): AnimaPoseClipAvatarVFXEvent | null {
  const effectId = sanitizeRequiredString(value.effectId);
  if (!effectId) return null;

  if (
    value.playAccompanyingSound !== undefined &&
    typeof value.playAccompanyingSound !== "boolean"
  )
    return null;

  const vfxFields = sanitizeVFXEventFields(value);
  if (!vfxFields) return null;

  return {
    id,
    time,
    kind: "avatar_vfx",
    effectId,
    ...vfxFields,
    ...(value.playAccompanyingSound !== undefined
      ? { playAccompanyingSound: value.playAccompanyingSound }
      : {}),
  };
}

function sanitizeSceneVFXEvent(
  value: Record<string, unknown>,
  id: string,
  time: number,
): AnimaPoseClipSceneVFXEvent | null {
  const sceneKind = sanitizeSceneVFXKind(value.sceneKind);
  const presetId = sanitizeRequiredString(value.presetId);
  if (!sceneKind || !presetId) return null;

  if (
    value.playAccompanyingSound !== undefined &&
    typeof value.playAccompanyingSound !== "boolean"
  )
    return null;

  const vfxFields = sanitizeVFXEventFields(value);
  if (!vfxFields) return null;

  return {
    id,
    time,
    kind: "scene_vfx",
    sceneKind,
    presetId,
    ...vfxFields,
    ...(value.playAccompanyingSound !== undefined
      ? { playAccompanyingSound: value.playAccompanyingSound }
      : {}),
  };
}

function sanitizeParticleVFXEvent(
  value: Record<string, unknown>,
  id: string,
  time: number,
): AnimaPoseClipParticleVFXEvent | null {
  const effectId = sanitizeRequiredString(value.effectId);
  if (!effectId) return null;

  const anchor =
    value.anchor === undefined
      ? undefined
      : sanitizeParticleVFXAnchor(value.anchor);
  if (value.anchor !== undefined && !anchor) return null;

  const transform =
    value.transform === undefined
      ? undefined
      : sanitizeParticleVFXTransform(value.transform);
  if (value.transform !== undefined && !transform) return null;

  let followAnchor: boolean | undefined;
  if (value.followAnchor !== undefined) {
    if (typeof value.followAnchor !== "boolean") return null;
    followAnchor = value.followAnchor;
  }

  const vfxFields = sanitizeVFXEventFields(value);
  if (!vfxFields) return null;

  return {
    id,
    time,
    kind: "particle_vfx",
    effectId,
    ...(anchor ? { anchor } : {}),
    ...vfxFields,
    ...(transform ? { transform } : {}),
    ...(followAnchor !== undefined ? { followAnchor } : {}),
  };
}

function sanitizeSFXEvent(
  value: Record<string, unknown>,
  id: string,
  time: number,
): AnimaPoseClipSFXEvent | null {
  if (
    value.duration !== undefined ||
    value.envelope !== undefined ||
    value.parameterKeyframes !== undefined
  ) {
    return null;
  }

  const cueId = sanitizeRequiredString(value.cueId);
  if (!cueId) return null;

  let volume: number | undefined;
  if (value.volume !== undefined) {
    const sanitizedVolume = sanitizeUnitNumber(value.volume);
    if (sanitizedVolume === null) return null;
    volume = sanitizedVolume;
  }

  return {
    id,
    time,
    kind: "sfx",
    cueId,
    ...(volume !== undefined ? { volume } : {}),
  };
}

function sanitizeVFXEventFields(
  value: Record<string, unknown>,
): Pick<
  AnimaPoseClipVFXEvent,
  "duration" | "envelope" | "parameterKeyframes"
> | null {
  let duration: number | undefined;
  if (value.duration !== undefined) {
    const sanitizedDuration = sanitizePositiveNumber(value.duration);
    if (sanitizedDuration === null) return null;
    duration = sanitizedDuration;
  }

  if (
    duration === undefined &&
    (value.envelope !== undefined || value.parameterKeyframes !== undefined)
  ) {
    return null;
  }

  const envelope =
    value.envelope === undefined
      ? undefined
      : sanitizeVFXEnvelope(value.envelope);
  if (value.envelope !== undefined && !envelope) return null;

  const parameterKeyframes =
    value.parameterKeyframes === undefined
      ? undefined
      : sanitizeVFXParameterKeyframes(value.parameterKeyframes, duration);
  if (value.parameterKeyframes !== undefined && !parameterKeyframes) {
    return null;
  }

  return {
    ...(duration !== undefined ? { duration } : {}),
    ...(envelope ? { envelope } : {}),
    ...(parameterKeyframes ? { parameterKeyframes } : {}),
  };
}

function sanitizeVFXEnvelope(value: unknown): AnimaPoseClipVFXEnvelope | null {
  if (!isRecord(value)) return null;

  const intensity =
    value.intensity === undefined
      ? undefined
      : sanitizeVFXIntensityEnvelope(value.intensity);
  if (value.intensity !== undefined && !intensity) return null;

  return {
    ...(intensity ? { intensity } : {}),
  };
}

function sanitizeVFXIntensityEnvelope(
  value: unknown,
): AnimaPoseClipVFXIntensityEnvelope | null {
  if (!isRecord(value)) return null;

  let from: number | undefined;
  if (value.from !== undefined) {
    const sanitizedFrom = sanitizeUnitNumber(value.from);
    if (sanitizedFrom === null) return null;
    from = sanitizedFrom;
  }

  let to: number | undefined;
  if (value.to !== undefined) {
    const sanitizedTo = sanitizeUnitNumber(value.to);
    if (sanitizedTo === null) return null;
    to = sanitizedTo;
  }

  let fadeIn: number | undefined;
  if (value.fadeIn !== undefined) {
    const sanitizedFadeIn = sanitizeNonNegativeNumber(value.fadeIn);
    if (sanitizedFadeIn === null) return null;
    fadeIn = sanitizedFadeIn;
  }

  let fadeOut: number | undefined;
  if (value.fadeOut !== undefined) {
    const sanitizedFadeOut = sanitizeNonNegativeNumber(value.fadeOut);
    if (sanitizedFadeOut === null) return null;
    fadeOut = sanitizedFadeOut;
  }

  const easing =
    value.easing === undefined ? undefined : sanitizeEasing(value.easing);
  if (value.easing !== undefined && !easing) return null;

  return {
    ...(from !== undefined ? { from } : {}),
    ...(to !== undefined ? { to } : {}),
    ...(fadeIn !== undefined ? { fadeIn } : {}),
    ...(fadeOut !== undefined ? { fadeOut } : {}),
    ...(easing ? { easing } : {}),
  };
}

function sanitizeVFXParameterKeyframes(
  value: unknown,
  duration: number | undefined,
): AnimaPoseClipVFXParameterKeyframe[] | null {
  if (!Array.isArray(value) || duration === undefined) {
    return null;
  }
  if (value.length === 0) return [];

  const keyframes: AnimaPoseClipVFXParameterKeyframe[] = [];
  let previousTime: number | null = null;
  let expectedKeys: string[] | null = null;

  for (const rawKeyframe of value) {
    if (!isRecord(rawKeyframe)) return null;

    const time = sanitizeFiniteNumber(rawKeyframe.time);
    if (time === null || time < 0 || time > duration) return null;
    if (previousTime === null && time !== 0) return null;
    if (previousTime !== null && time <= previousTime) return null;

    const values = sanitizeVFXParameterValues(rawKeyframe.values);
    if (!values) return null;

    const keys = Object.keys(values).sort();
    if (expectedKeys && !areStringArraysEqual(expectedKeys, keys)) return null;
    expectedKeys = expectedKeys ?? keys;

    const transition =
      rawKeyframe.transition === undefined
        ? undefined
        : sanitizeTransition(rawKeyframe.transition);
    if (rawKeyframe.transition !== undefined && !transition) return null;

    keyframes.push({
      time,
      values,
      ...(transition ? { transition } : {}),
    });
    previousTime = time;
  }

  return keyframes;
}

function sanitizeVFXParameterValues(
  value: unknown,
): Record<string, number> | null {
  if (!isRecord(value)) return null;

  const values = Object.create(null) as Record<string, number>;
  const keys = new Set<string>();
  for (const [rawKey, rawValue] of Object.entries(value)) {
    const key = sanitizeRequiredString(rawKey);
    const parameterValue = sanitizeFiniteNumber(rawValue);
    if (!key || keys.has(key) || parameterValue === null) return null;
    keys.add(key);
    values[key] = parameterValue;
  }

  return Object.keys(values).length > 0 ? values : null;
}

function sanitizeSceneVFXKind(
  value: unknown,
): AnimaPoseClipSceneVFXKind | null {
  return typeof value === "string" && KNOWN_SCENE_VFX_KINDS.has(value)
    ? (value as AnimaPoseClipSceneVFXKind)
    : null;
}

function sanitizeParticleVFXAnchor(value: unknown): ParticleVFXAnchor | null {
  return typeof value === "string" &&
    (PARTICLE_VFX_ANCHORS as readonly string[]).includes(value)
    ? (value as ParticleVFXAnchor)
    : null;
}

function sanitizeParticleVFXTransform(
  value: unknown,
): ParticleVFXTransformInput | null {
  if (!isRecord(value)) return null;

  const offset =
    value.offset === undefined
      ? undefined
      : sanitizeParticleVFXAxisTriple(value.offset, {
          requirePositive: false,
        });
  if (value.offset !== undefined && !offset) return null;

  const rotation =
    value.rotation === undefined
      ? undefined
      : sanitizeParticleVFXAxisTriple(value.rotation, {
          requirePositive: false,
        });
  if (value.rotation !== undefined && !rotation) return null;

  const scale =
    value.scale === undefined
      ? undefined
      : sanitizeParticleVFXAxisTriple(value.scale, {
          requirePositive: true,
        });
  if (value.scale !== undefined && !scale) return null;

  let depthOffset: number | undefined;
  if (value.depthOffset !== undefined) {
    const sanitizedDepthOffset = sanitizeFiniteNumber(value.depthOffset);
    if (sanitizedDepthOffset === null) return null;
    depthOffset = sanitizedDepthOffset;
  }

  return {
    ...(offset ? { offset } : {}),
    ...(depthOffset !== undefined ? { depthOffset } : {}),
    ...(rotation ? { rotation } : {}),
    ...(scale ? { scale } : {}),
  };
}

function sanitizeParticleVFXAxisTriple(
  value: unknown,
  options: { requirePositive: boolean },
): Partial<ParticleVFXTransformAxisTriple> | null {
  if (!isRecord(value)) return null;

  const triple: Partial<ParticleVFXTransformAxisTriple> = {};
  for (const axis of ["x", "y", "z"] as const) {
    if (value[axis] === undefined) continue;
    const number = sanitizeFiniteNumber(value[axis]);
    if (number === null) return null;
    if (options.requirePositive && number <= 0) return null;
    triple[axis] = number;
  }

  return triple;
}

function sanitizeClipRole(value: unknown): AnimaPoseClipRole | null {
  return typeof value === "string" && KNOWN_CLIP_ROLES.has(value)
    ? (value as AnimaPoseClipRole)
    : null;
}

function sanitizePlayback(value: unknown): AnimaPoseClipPlayback | null {
  if (!isRecord(value)) return null;
  const lifetime = sanitizePlaybackLifetime(value.lifetime);
  if (!lifetime) return null;
  return { lifetime };
}

function sanitizePlaybackLifetime(
  value: unknown,
): AnimaPoseClipPlaybackLifetime | null {
  if (!isRecord(value)) return null;

  const scope =
    value.scope === undefined ? undefined : sanitizePlaybackScope(value.scope);
  if (value.scope !== undefined && !scope) return null;

  if (value.kind === "whileInteractionPhase") {
    const phases = sanitizeStringArray<AvatarInteractionPhase>(
      value.phases,
      KNOWN_INTERACTION_PHASES,
    );
    if (!phases) return null;
    return {
      kind: "whileInteractionPhase",
      phases,
      ...(scope ? { scope } : {}),
    };
  }

  if (value.kind === "whileAvatarState") {
    const states = sanitizeStringArray<AvatarAnimationState>(
      value.states,
      KNOWN_AVATAR_STATES,
    );
    if (!states) return null;
    return {
      kind: "whileAvatarState",
      states,
      ...(scope ? { scope } : {}),
    };
  }

  return null;
}

function sanitizePlaybackScope(
  value: unknown,
): AnimaPoseClipPlaybackScope | null {
  return typeof value === "string" && KNOWN_PLAYBACK_SCOPES.has(value)
    ? (value as AnimaPoseClipPlaybackScope)
    : null;
}

function sanitizeStringArray<T extends string>(
  value: unknown,
  knownValues: ReadonlySet<string>,
): T[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;

  const values: T[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string" || !knownValues.has(entry)) return null;
    if (seen.has(entry)) return null;
    seen.add(entry);
    values.push(entry as T);
  }
  return values;
}

function sanitizeTransition(value: unknown): AnimaPoseClipTransition | null {
  if (!isRecord(value)) return null;

  const easing =
    value.easing === undefined ? undefined : sanitizeEasing(value.easing);
  if (value.easing !== undefined && !easing) return null;

  const interpolation =
    value.interpolation === undefined
      ? undefined
      : sanitizeInterpolation(value.interpolation);
  if (value.interpolation !== undefined && !interpolation) return null;

  return {
    ...(easing ? { easing } : {}),
    ...(interpolation ? { interpolation } : {}),
  };
}

function sanitizeFade(value: unknown): AnimaPoseClipFade | null {
  if (!isRecord(value)) return null;

  const duration = sanitizeNonNegativeNumber(value.duration);
  if (duration === null) return null;

  const transition = sanitizeTransition(value);
  if (!transition) return null;

  return {
    duration,
    ...transition,
  };
}

function sanitizeInterpolation(
  value: unknown,
): AnimaPoseClipInterpolation | null {
  if (!isRecord(value)) return null;

  const humanoidRotation =
    value.humanoidRotation === undefined
      ? undefined
      : sanitizeRotationInterpolation(value.humanoidRotation);
  if (value.humanoidRotation !== undefined && !humanoidRotation) return null;

  const humanoidPosition =
    value.humanoidPosition === undefined
      ? undefined
      : sanitizeScalarInterpolation(value.humanoidPosition);
  if (value.humanoidPosition !== undefined && !humanoidPosition) return null;

  const expression =
    value.expression === undefined
      ? undefined
      : sanitizeScalarInterpolation(value.expression);
  if (value.expression !== undefined && !expression) return null;

  return {
    ...(humanoidRotation ? { humanoidRotation } : {}),
    ...(humanoidPosition ? { humanoidPosition } : {}),
    ...(expression ? { expression } : {}),
  };
}

function sanitizeEasing(value: unknown): AnimaPoseClipEasing | null {
  return typeof value === "string" && KNOWN_EASINGS.has(value)
    ? (value as AnimaPoseClipEasing)
    : null;
}

function sanitizeRotationInterpolation(
  value: unknown,
): AnimaPoseClipRotationInterpolation | null {
  return typeof value === "string" && KNOWN_ROTATION_INTERPOLATIONS.has(value)
    ? (value as AnimaPoseClipRotationInterpolation)
    : null;
}

function sanitizeScalarInterpolation(
  value: unknown,
): AnimaPoseClipScalarInterpolation | null {
  return typeof value === "string" && KNOWN_SCALAR_INTERPOLATIONS.has(value)
    ? (value as AnimaPoseClipScalarInterpolation)
    : null;
}

function extractPoseSnapshot(pose: AnimaPose): AnimaPoseSnapshot {
  return {
    ...(pose.humanoid ? { humanoid: cloneVRMPose(pose.humanoid) } : {}),
    ...(pose.expressions ? { expressions: { ...pose.expressions } } : {}),
  };
}

function hasSampleTargets(sample: AnimaPoseClipSample): boolean {
  return (
    Object.keys(sample.humanoid ?? {}).length > 0 ||
    Object.keys(sample.expressions ?? {}).length > 0
  );
}

function sanitizeRequiredString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function sanitizeFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function sanitizePositiveNumber(value: unknown): number | null {
  const number = sanitizeFiniteNumber(value);
  return number !== null && number > 0 ? number : null;
}

function sanitizeNonNegativeNumber(value: unknown): number | null {
  const number = sanitizeFiniteNumber(value);
  return number !== null && number >= 0 ? number : null;
}

function sanitizeUnitNumber(value: unknown): number | null {
  const number = sanitizeFiniteNumber(value);
  return number !== null && number >= 0 && number <= 1 ? number : null;
}

function areStringArraysEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function getAuthoredTimelineDuration(
  keyframes: readonly AnimaPoseClipKeyframe[],
  events: readonly AnimaPoseClipEvent[] | undefined,
): number {
  let maxTime = 0;
  for (const keyframe of keyframes) {
    maxTime = Math.max(maxTime, keyframe.time);
  }
  for (const event of events ?? []) {
    maxTime = Math.max(maxTime, event.time);
  }
  return maxTime;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
