import type { VRM, VRMHumanBoneName, VRMPose } from "@pixiv/three-vrm";
import { Quaternion } from "three";

import { isVRMHumanBoneName } from "../animaPose";
import {
  JOINT_DEFINITIONS,
  angularDistanceDegrees,
  decomposeJointRotation,
  resolveJoint,
  type ResolvedJoint,
  type Side,
} from "../anatomy/anatomy";
import { ScalarTrack } from "../anatomy/curves";
import { handShapeRotations } from "../anatomy/handPresets";
import {
  easedProgress,
  findSegment,
  prepareAnimaPoseClipV2,
} from "./prepareV2";
import type {
  AnimaPoseClipPoseResolver,
  AnimaPoseClipSample,
  QuaternionTuple,
} from "./schema";
import {
  ANIMA_POSE_CLIP_V2_LIMITS,
  ANIMA_POSE_CLIP_V2_MIN_SPACING_TICKS,
  fromAnimaPoseClipTicks,
  toAnimaPoseClipTicks,
  type AnimaPoseClipBeat,
  type AnimaPoseClipEase,
  type AnimaPoseClipRotationKey,
  type AnimaPoseClipScalarKey,
  type AnimaPoseClipV2,
} from "./schemaV2";

/**
 * Beat editing for `animaPoseClip/2.0`, as the Gesture and Reaction creators
 * use it. People edit beats; the keys a beat owns (its generated detail)
 * follow it: retiming moves them, a pose edit re-targets them and deleting
 * the beat removes them. Every operation returns a new clip.
 */

/** What preparing a clip needs: the Avatar (hands, legs) and pose lookup. */
export type BeatEditContext = {
  vrm?: VRM | null;
  resolvePose: AnimaPoseClipPoseResolver;
};

/** The new key pose of a beat: canonical humanoid transforms and weights. */
export type BeatPose = {
  humanoid?: VRMPose;
  expressions?: Record<string, number>;
  /**
   * The pose is the whole key pose (a Pose-tab edit): bones it omits return
   * to the clip's base pose and expressions it omits to 0. Otherwise omitted
   * bones and expressions keep their motion.
   */
  complete?: boolean;
  /**
   * Key every bone and expression the pose names at the beat, even where it
   * already matches (a Library Pose copied by value). Otherwise unchanged
   * joints keep their keys and detail.
   */
  keyAll?: boolean;
};

export type BeatDetailSummary = {
  /** Joints, bones, hands or expressions the detail moves. */
  channels: number;
  /** Seconds the detail reaches before and after the beat. */
  before: number;
  after: number;
};

type OwnedKey = { beat: string; dt?: number; ease?: AnimaPoseClipEase };
type TrackKind = "joint" | "rotation" | "hips" | "hand" | "expression";
type Track = {
  kind: TrackKind;
  /** Joint id for joint tracks, otherwise the track name. */
  group: string;
  name: string;
  keys: OwnedKey[];
};

const LEG_BONE = /^(left|right)(UpperLeg|LowerLeg|Foot)$/;
const FINGER_BONE = /^(left|right)(Thumb|Index|Middle|Ring|Little)/;
/** Smaller pose changes are treated as unchanged. */
const CHANGE_DEGREES = 0.01;
const CHANGE_VALUE = 1e-4;

// ── Tracks ───────────────────────────────────────────────────────────────

function tracksOf(clip: AnimaPoseClipV2): Track[] {
  const tracks: Track[] = [];
  for (const [joint, components] of Object.entries(clip.joints ?? {}))
    for (const [name, keys] of Object.entries(components))
      tracks.push({ kind: "joint", group: joint, name, keys });
  for (const [name, keys] of Object.entries(clip.rotations ?? {}))
    tracks.push({ kind: "rotation", group: name, name, keys: keys! });
  for (const [name, keys] of Object.entries(clip.hipsPosition ?? {}))
    tracks.push({ kind: "hips", group: "hips", name, keys: keys! });
  for (const [name, keys] of Object.entries(clip.hands ?? {}))
    tracks.push({ kind: "hand", group: name, name, keys: keys! });
  for (const [name, keys] of Object.entries(clip.expressions ?? {}))
    tracks.push({ kind: "expression", group: name, name, keys });
  return tracks;
}

/** Rebuild every track; tracks (and groups) left without keys are dropped. */
function mapTracks(
  clip: AnimaPoseClipV2,
  map: (track: Track) => OwnedKey[],
): AnimaPoseClipV2 {
  const record = <K>(
    entries: Record<string, K[] | undefined> | undefined,
    kind: TrackKind,
    group?: string,
  ) => {
    if (!entries) return undefined;
    const result: Record<string, K[]> = {};
    for (const [name, keys] of Object.entries(entries)) {
      const next = map({
        kind,
        group: group ?? name,
        name,
        keys: keys as OwnedKey[],
      });
      if (next.length > 0) result[name] = next as K[];
    }
    return Object.keys(result).length > 0 ? result : undefined;
  };
  const next: AnimaPoseClipV2 = { ...clip };
  let joints: AnimaPoseClipV2["joints"];
  if (clip.joints) {
    joints = {};
    for (const [joint, components] of Object.entries(clip.joints)) {
      const mapped = record(components, "joint", joint);
      if (mapped) joints[joint] = mapped;
    }
    if (Object.keys(joints).length === 0) joints = undefined;
  }
  const assign = <F extends keyof AnimaPoseClipV2>(
    field: F,
    value: AnimaPoseClipV2[F] | undefined,
  ) => {
    if (value === undefined) delete next[field];
    else next[field] = value;
  };
  assign("joints", joints);
  assign("rotations", record(clip.rotations, "rotation"));
  assign("hipsPosition", record(clip.hipsPosition, "hips"));
  assign("hands", record(clip.hands, "hand"));
  assign("expressions", record(clip.expressions, "expression"));
  return next;
}

const roundTime = (seconds: number) =>
  fromAnimaPoseClipTicks(toAnimaPoseClipTicks(seconds));

function beatTimes(clip: AnimaPoseClipV2): Map<string, number> {
  return new Map(clip.beats.map((beat) => [beat.id, beat.time]));
}

function keyTime(times: Map<string, number>, key: OwnedKey): number {
  return (times.get(key.beat) ?? 0) + (key.dt ?? 0);
}

/** A copy of `value` without `field`. */
function without<T extends object, F extends keyof T>(
  value: T,
  field: F,
): Omit<T, F> {
  const copy = { ...value };
  delete copy[field];
  return copy;
}

function withDt<K extends OwnedKey>(key: K, dt: number): K {
  const rest = without(key, "dt");
  return (dt !== 0 ? { ...rest, dt } : rest) as K;
}

function sortKeys(times: Map<string, number>, keys: OwnedKey[]): OwnedKey[] {
  return [...keys].sort((a, b) => keyTime(times, a) - keyTime(times, b));
}

// ── Detail ───────────────────────────────────────────────────────────────

/** Whether a beat owns keys away from its own time (generated detail). */
export function beatHasDetail(clip: AnimaPoseClipV2, beatId: string): boolean {
  return tracksOf(clip).some(({ keys }) =>
    keys.some((key) => key.beat === beatId && (key.dt ?? 0) !== 0),
  );
}

/** How far a beat's detail reaches, or null when it has none. */
export function beatDetailSummary(
  clip: AnimaPoseClipV2,
  beatId: string,
): BeatDetailSummary | null {
  const channels = new Set<string>();
  let before = 0;
  let after = 0;
  for (const track of tracksOf(clip))
    for (const key of track.keys) {
      const dt = key.dt ?? 0;
      if (key.beat !== beatId || dt === 0) continue;
      channels.add(`${track.kind}:${track.group}`);
      before = Math.max(before, -dt);
      after = Math.max(after, dt);
    }
  return channels.size > 0
    ? {
        channels: channels.size,
        before: roundTime(before),
        after: roundTime(after),
      }
    : null;
}

// ── Ordering ─────────────────────────────────────────────────────────────

/**
 * Whether beats and keys keep the 2.0 ordering rules: beats in order and
 * spaced, each key between its beat's neighbours and after the track's
 * previous key, everything inside the clip.
 */
function isOrdered(clip: AnimaPoseClipV2): boolean {
  const spacing = ANIMA_POSE_CLIP_V2_MIN_SPACING_TICKS;
  const end = toAnimaPoseClipTicks(clip.duration);
  const ticks = clip.beats.map((beat) => toAnimaPoseClipTicks(beat.time));
  for (let index = 0; index < ticks.length; index += 1) {
    if (ticks[index] < 0 || ticks[index] > end) return false;
    if (index > 0 && ticks[index] < ticks[index - 1] + spacing) return false;
  }
  const position = new Map(clip.beats.map((beat, index) => [beat.id, index]));
  for (const { keys } of tracksOf(clip)) {
    let previous = Number.NEGATIVE_INFINITY;
    for (const key of keys) {
      const owner = position.get(key.beat);
      if (owner === undefined) return false;
      const time = ticks[owner] + toAnimaPoseClipTicks(key.dt ?? 0);
      const lower = owner > 0 ? ticks[owner - 1] + spacing : 0;
      const upper = owner < ticks.length - 1 ? ticks[owner + 1] - spacing : end;
      if (time < Math.max(0, lower) || time > Math.min(end, upper))
        return false;
      if (time < previous + spacing) return false;
      previous = time;
    }
  }
  return true;
}

// ── Retime ───────────────────────────────────────────────────────────────

/**
 * Move a beat. Its own keys move with it rigidly; the facing detail of the
 * beats around its old and new place stretches or compresses with their gap.
 * A beat with detail cannot pass a neighbour, and a beat without detail can
 * pass only beats without detail. When the request would break ordering, the
 * beat stops at the nearest time that keeps it.
 */
export function retimeBeat(
  clip: AnimaPoseClipV2,
  beatId: string,
  timeSec: number,
): AnimaPoseClipV2 {
  const beat = clip.beats.find(({ id }) => id === beatId);
  if (!beat) return clip;
  const target = roundTime(Math.min(Math.max(timeSec, 0), clip.duration));
  if (target === beat.time) return clip;
  const attempt = (time: number) => {
    const next = moveBeat(clip, beatId, time);
    return next && isOrdered(next) ? next : null;
  };
  const direct = attempt(target);
  if (direct) return direct;
  // The furthest valid time between the current and the requested one.
  let good = beat.time;
  let bad = target;
  for (let step = 0; step < 32; step += 1) {
    const middle = roundTime((good + bad) / 2);
    if (middle === good || middle === bad) break;
    if (attempt(middle)) good = middle;
    else bad = middle;
  }
  return good === beat.time ? clip : (attempt(good) ?? clip);
}

function moveBeat(
  clip: AnimaPoseClipV2,
  beatId: string,
  time: number,
): AnimaPoseClipV2 | null {
  const old = clip.beats;
  const from = old.findIndex(({ id }) => id === beatId);
  const moved = { ...old[from], time };
  const others = old.filter(({ id }) => id !== beatId);
  let to = others.findIndex((beat) => beat.time > time);
  if (to < 0) to = others.length;
  const beats = [...others.slice(0, to), moved, ...others.slice(to)];
  if (to !== from) {
    if (beatHasDetail(clip, beatId)) return null;
    const passed =
      from < to ? old.slice(from + 1, to + 1) : old.slice(to, from);
    if (passed.some(({ id }) => beatHasDetail(clip, id))) return null;
  }

  // Facing detail scales with the gap on its side.
  const scales = new Map<string, { forward: number; backward: number }>();
  const gap = (list: AnimaPoseClipBeat[], index: number, side: 1 | -1) => {
    const neighbour = list[index + side];
    const bound = neighbour ? neighbour.time : side > 0 ? clip.duration : 0;
    return Math.abs(bound - list[index].time);
  };
  beats.forEach((beat, index) => {
    if (beat.id === beatId) return;
    const before = old.findIndex(({ id }) => id === beat.id);
    const ratio = (side: 1 | -1) => {
      const was = gap(old, before, side);
      return was > 0 ? gap(beats, index, side) / was : 1;
    };
    scales.set(beat.id, { forward: ratio(1), backward: ratio(-1) });
  });
  const times = new Map(beats.map((beat) => [beat.id, beat.time]));
  const retimed = mapTracks({ ...clip, beats }, ({ keys }) =>
    sortKeys(
      times,
      keys.map((key) => {
        const dt = key.dt ?? 0;
        const scale = scales.get(key.beat);
        if (dt === 0 || !scale) return key;
        return withDt(
          key,
          roundTime(dt * (dt > 0 ? scale.forward : scale.backward)),
        );
      }),
    ),
  );
  return fitContactsToClip(retimed);
}

/**
 * Keep every contact window inside the clip after its beat or the duration
 * moved: the window is clamped to 0…duration, a single-instant contact stays
 * a single instant, and a window that collapses to nothing is dropped.
 */
export function fitContactsToClip(clip: AnimaPoseClipV2): AnimaPoseClipV2 {
  if (!clip.contacts?.length) return clip;
  const times = new Map(clip.beats.map((beat) => [beat.id, beat.time]));
  let changed = false;
  const contacts = clip.contacts.flatMap((contact) => {
    const time = times.get(contact.beat);
    if (time === undefined) return [contact];
    const start = Math.min(Math.max(time + contact.from, 0), clip.duration);
    const end = Math.min(Math.max(time + contact.to, 0), clip.duration);
    if (start === time + contact.from && end === time + contact.to)
      return [contact];
    changed = true;
    if (end - start <= 0 && contact.to > contact.from) return [];
    return [
      { ...contact, from: roundTime(start - time), to: roundTime(end - time) },
    ];
  });
  if (!changed) return clip;
  const rest = without(clip, "contacts") as AnimaPoseClipV2;
  return contacts.length > 0 ? { ...rest, contacts } : rest;
}

// ── Delete, ease, label ──────────────────────────────────────────────────

/** Remove a beat with all of its keys and contacts. */
export function deleteBeat(
  clip: AnimaPoseClipV2,
  beatId: string,
): AnimaPoseClipV2 {
  if (!clip.beats.some(({ id }) => id === beatId)) return clip;
  const next = mapTracks(
    { ...clip, beats: clip.beats.filter(({ id }) => id !== beatId) },
    ({ keys }) => keys.filter((key) => key.beat !== beatId),
  );
  const contacts = clip.contacts?.filter((contact) => contact.beat !== beatId);
  if (contacts && contacts.length > 0) next.contacts = contacts;
  else delete next.contacts;
  return next;
}

/**
 * Set how motion arrives at all of a beat's keys (undefined restores the
 * track defaults). Keys' own eases give way to it.
 */
export function setBeatEase(
  clip: AnimaPoseClipV2,
  beatId: string,
  ease: AnimaPoseClipEase | undefined,
): AnimaPoseClipV2 {
  return mapTracks(
    {
      ...clip,
      beats: clip.beats.map((beat) => {
        if (beat.id !== beatId) return beat;
        const rest = without(beat, "ease");
        return ease ? { ...rest, ease } : rest;
      }),
    },
    ({ keys }) =>
      keys.map((key) => {
        return key.beat !== beatId || key.ease === undefined
          ? key
          : without(key, "ease");
      }),
  );
}

export function setBeatLabel(
  clip: AnimaPoseClipV2,
  beatId: string,
  label: string,
): AnimaPoseClipV2 {
  const value = label.trim().slice(0, ANIMA_POSE_CLIP_V2_LIMITS.labelLength);
  if (!value) return clip;
  return {
    ...clip,
    beats: clip.beats.map((beat) =>
      beat.id === beatId ? { ...beat, label: value } : beat,
    ),
  };
}

// ── Sampling helpers ─────────────────────────────────────────────────────

/** The full sampled pose at a beat, as the creator Avatar plays it. */
export function beatKeyPose(
  clip: AnimaPoseClipV2,
  beatId: string,
  context: BeatEditContext,
): AnimaPoseClipSample {
  const beat = clip.beats.find(({ id }) => id === beatId);
  return prepareAnimaPoseClipV2(clip, context).sample(beat?.time ?? 0);
}

/** Evaluates individual tracks of a clip at a time. */
function trackEvaluator(clip: AnimaPoseClipV2, context: BeatEditContext) {
  const times = beatTimes(clip);
  const eases = new Map(clip.beats.map((beat) => [beat.id, beat.ease]));
  const loop = clip.loop ? clip.duration : null;
  const basePose: VRMPose = clip.basePose
    ? (context.resolvePose(clip.basePose)?.humanoid ?? {})
    : {};
  const baseHips = basePose.hips?.position ?? [0, 0, 0];
  const baseJoint = new Map<string, Record<string, number>>();
  const jointBase = (joint: ResolvedJoint) => {
    let values = baseJoint.get(joint.id);
    if (!values) {
      const rotation = basePose[joint.bones[0]]?.rotation;
      values = decomposeJointRotation(
        joint,
        rotation ? new Quaternion(...rotation) : new Quaternion(),
      );
      baseJoint.set(joint.id, values);
    }
    return values;
  };
  const arrival = (key: OwnedKey, fallback: AnimaPoseClipEase) =>
    key.ease ?? eases.get(key.beat) ?? fallback;
  const scalar = (keys: AnimaPoseClipScalarKey[], base: number, t: number) =>
    new ScalarTrack(
      keys.map((key) => ({
        t: keyTime(times, key),
        v: key.v === "base" ? base : key.v,
        tangent: key.tangent ?? "auto",
        ease: arrival(key, "smooth"),
      })),
      loop,
    ).evaluate(t);
  return {
    basePose,
    baseHips,
    jointBase,
    /** Every component of a joint at `t` (untracked ones hold the base). */
    joint(joint: ResolvedJoint, t: number): Record<string, number> {
      const base = jointBase(joint);
      const tracks = clip.joints?.[joint.id] ?? {};
      return Object.fromEntries(
        Object.keys(JOINT_DEFINITIONS[joint.type].components).map((name) => [
          name,
          tracks[name]
            ? scalar(tracks[name], base[name] ?? 0, t)
            : (base[name] ?? 0),
        ]),
      );
    },
    hips(axis: 0 | 1 | 2, t: number): number {
      const keys = clip.hipsPosition?.[(["x", "y", "z"] as const)[axis]];
      return keys ? scalar(keys, baseHips[axis], t) : baseHips[axis];
    },
    expression(name: string, t: number): number {
      const keys = clip.expressions?.[name];
      return keys ? scalar(keys, 0, t) : 0;
    },
    rotation(keys: AnimaPoseClipRotationKey[], t: number): Quaternion {
      const timed = keys.map((key) => ({
        t: keyTime(times, key),
        ease: arrival(key, "easeInOutSine"),
        q: new Quaternion(...key.q).normalize(),
      }));
      const segment = findSegment(timed, t, loop);
      const to = timed[segment.to];
      return timed[segment.from].q
        .clone()
        .slerp(to.q, easedProgress(segment.progress, to.ease));
    },
  };
}

// ── Insert ───────────────────────────────────────────────────────────────

/**
 * Add a beat without detail at a time, pinning the motion there: every
 * joint, rotation, hips and expression track gets a key with its current
 * value, so the pose plays as before until the beat is edited. Keys of the
 * neighbouring beats that lie past the new time move to it. Returns the
 * existing beat when one is already at that time.
 */
export function insertBeat(
  clip: AnimaPoseClipV2,
  request: { timeSec: number; label: string },
  context: BeatEditContext,
): { clip: AnimaPoseClipV2; beatId: string } {
  const time = roundTime(Math.min(Math.max(request.timeSec, 0), clip.duration));
  const spacing = fromAnimaPoseClipTicks(ANIMA_POSE_CLIP_V2_MIN_SPACING_TICKS);
  const existing = clip.beats.find(
    (beat) => Math.abs(beat.time - time) < spacing,
  );
  if (existing) return { clip, beatId: existing.id };

  const label =
    request.label.trim().slice(0, ANIMA_POSE_CLIP_V2_LIMITS.labelLength) ||
    "Beat";
  const id = uniqueBeatId(clip, label);
  const beats = [...clip.beats, { id, label, time }].sort(
    (a, b) => a.time - b.time,
  );
  const index = beats.findIndex((beat) => beat.id === id);
  const previous = beats[index - 1]?.id;
  const following = beats[index + 1]?.id;
  const oldTimes = beatTimes(clip);
  const evaluate = trackEvaluator(clip, context);
  const times = new Map(beats.map((beat) => [beat.id, beat.time]));

  const next = mapTracks({ ...clip, beats }, (track) => {
    // Re-own neighbour keys that the new beat now separates from them.
    const keys = track.keys.map((key) => {
      const at = keyTime(oldTimes, key);
      const crosses =
        (key.beat === previous && at >= time) ||
        (key.beat === following && at <= time);
      return crosses ? withDt({ ...key, beat: id }, roundTime(at - time)) : key;
    });
    if (track.kind === "hand" || keys.some((key) => key.beat === id && !key.dt))
      return keys;
    return sortKeys(times, [...keys, anchorKey(track, id, time, evaluate)]);
  });
  return { clip: next, beatId: id };
}

function anchorKey(
  track: Track,
  beatId: string,
  time: number,
  evaluate: ReturnType<typeof trackEvaluator>,
): OwnedKey {
  switch (track.kind) {
    case "rotation":
      return {
        beat: beatId,
        q: evaluate
          .rotation(track.keys as AnimaPoseClipRotationKey[], time)
          .toArray() as QuaternionTuple,
      } as AnimaPoseClipRotationKey;
    case "joint": {
      const joint = resolveJoint(track.group)!;
      return {
        beat: beatId,
        v: round(evaluate.joint(joint, time)[track.name]),
      } as AnimaPoseClipScalarKey;
    }
    case "hips":
      return {
        beat: beatId,
        v: round(evaluate.hips(axisIndex(track.name), time), 5),
      } as AnimaPoseClipScalarKey;
    default:
      return {
        beat: beatId,
        v: round(evaluate.expression(track.name, time)),
      } as AnimaPoseClipScalarKey;
  }
}

function uniqueBeatId(clip: AnimaPoseClipV2, label: string): string {
  const stem =
    label
      .normalize("NFKD")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48) || "beat";
  const taken = new Set(clip.beats.map(({ id }) => id));
  if (!taken.has(stem)) return stem;
  for (let suffix = 2; ; suffix += 1)
    if (!taken.has(`${stem}-${suffix}`)) return `${stem}-${suffix}`;
}

// ── Pose edits ───────────────────────────────────────────────────────────

/**
 * Apply a new key pose to a beat. Joints the pose leaves unchanged keep
 * their keys. For a changed joint with anatomical tracks, every key the beat
 * owns shifts by the change, so its detail is re-targeted; components the
 * beat does not key get a key at the beat. Bones with rotation tracks take
 * the new rotation at the beat (offset keys turn with it), and untracked
 * bones get a rotation track keyed at every beat. Editing a finger of a hand
 * driven by Hands-tool presets first turns that hand into finger keys.
 * Legs solved by `plantFeet` are not edited.
 */
export function setBeatPose(
  clip: AnimaPoseClipV2,
  beatId: string,
  input: BeatPose,
  context: BeatEditContext,
): AnimaPoseClipV2 {
  const beat = clip.beats.find(({ id }) => id === beatId);
  if (!beat) return clip;
  const time = beat.time;
  const before = prepareAnimaPoseClipV2(clip, context).sample(time);
  const rotationOf = (sample: AnimaPoseClipSample, bone: VRMHumanBoneName) =>
    new Quaternion(...(sample.humanoid?.[bone]?.rotation ?? [0, 0, 0, 1]));
  const pose = input.complete
    ? completeBeatPose(input, before, clip, context)
    : input;
  const keyed = new Set(
    input.keyAll
      ? [
          ...Object.keys(input.humanoid ?? {}),
          ...Object.keys(input.expressions ?? {}).map((name) => `@${name}`),
        ]
      : [],
  );

  const changed: [VRMHumanBoneName, Quaternion][] = [];
  for (const [bone, transform] of Object.entries(pose.humanoid ?? {})) {
    if (!isVRMHumanBoneName(bone) || !transform?.rotation) continue;
    if (clip.plantFeet && LEG_BONE.test(bone)) continue;
    const next = new Quaternion(...transform.rotation).normalize();
    if (
      keyed.has(bone) ||
      angularDistanceDegrees(rotationOf(before, bone), next) > CHANGE_DEGREES
    )
      changed.push([bone, next]);
  }

  let working = clip;
  for (const side of ["left", "right"] as const)
    if (
      working.hands?.[side] &&
      changed.some(([bone]) => bone.startsWith(side) && FINGER_BONE.test(bone))
    )
      working = flattenHandToFingerTracks(working, side, context);

  const evaluate = trackEvaluator(working, context);
  const samples = new Map<string, AnimaPoseClipSample>();
  const sampleAt = (other: AnimaPoseClipBeat) => {
    let sample = samples.get(other.id);
    if (!sample) {
      sample = prepareAnimaPoseClipV2(working, context).sample(other.time);
      samples.set(other.id, sample);
    }
    return sample;
  };
  const doneJoints = new Set<string>();
  for (const [bone, next] of changed) {
    const jointId = bone === "leftEye" || bone === "rightEye" ? "eyes" : bone;
    const joint = resolveJoint(jointId);
    if (joint && working.joints?.[jointId]) {
      if (doneJoints.has(jointId)) continue;
      doneJoints.add(jointId);
      const old = evaluate.joint(joint, time);
      const target = decomposeJointRotation(joint, next, old);
      const components = { ...working.joints[jointId] };
      const forced = joint.bones.some((name) => keyed.has(name));
      for (const name of Object.keys(old)) {
        const delta = target[name] - old[name];
        if (Math.abs(delta) < CHANGE_VALUE && !forced) continue;
        const base = evaluate.jointBase(joint)[name] ?? 0;
        components[name] = shiftScalar(
          components[name],
          beatId,
          delta,
          target[name],
          base,
          working.beats,
        );
      }
      working = {
        ...working,
        joints: { ...working.joints, [jointId]: components },
      };
      continue;
    }
    const keys = working.rotations?.[bone];
    const old = rotationOf(before, bone);
    const rotations = { ...working.rotations };
    if (keys) {
      // Offset keys turn by the same local change as the beat's pose.
      const delta = old.clone().invert().multiply(next);
      const owned = keys.filter((key) => key.beat === beatId);
      const updated = keys.map((key) =>
        key.beat !== beatId
          ? key
          : {
              ...key,
              q: (key.dt
                ? new Quaternion(...key.q).multiply(delta)
                : next
              ).toArray() as QuaternionTuple,
            },
      );
      rotations[bone] = owned.some((key) => !key.dt)
        ? updated
        : (sortKeys(beatTimes(working), [
            ...updated,
            { beat: beatId, q: next.toArray() as QuaternionTuple },
          ]) as AnimaPoseClipRotationKey[]);
    } else {
      rotations[bone] = working.beats.map((other) => ({
        beat: other.id,
        q: (other.id === beatId
          ? next
          : rotationOf(sampleAt(other), bone)
        ).toArray() as QuaternionTuple,
      }));
    }
    working = { ...working, rotations };
  }

  // Hips offset, per axis.
  const hips = pose.humanoid?.hips?.position;
  if (hips) {
    const hipsPosition = { ...working.hipsPosition };
    let touched = false;
    (["x", "y", "z"] as const).forEach((axis, index) => {
      const old = evaluate.hips(index as 0 | 1 | 2, time);
      const delta = hips[index] - old;
      if (Math.abs(delta) < CHANGE_VALUE) return;
      touched = true;
      hipsPosition[axis] = shiftScalar(
        hipsPosition[axis],
        beatId,
        delta,
        hips[index],
        evaluate.baseHips[index],
        working.beats,
        5,
      );
    });
    if (touched) working = { ...working, hipsPosition };
  }

  // Expressions: names the pose omits are 0 at the beat.
  if (pose.expressions) {
    const names = new Set([
      ...Object.keys(working.expressions ?? {}),
      ...Object.keys(pose.expressions),
    ]);
    const expressions = { ...working.expressions };
    let touched = false;
    for (const name of names) {
      const target = Math.min(Math.max(pose.expressions[name] ?? 0, 0), 1);
      const delta = target - evaluate.expression(name, time);
      if (Math.abs(delta) < CHANGE_VALUE && !keyed.has(`@${name}`)) continue;
      touched = true;
      expressions[name] = shiftScalar(
        expressions[name],
        beatId,
        delta,
        target,
        0,
        working.beats,
        4,
        [0, 1],
      );
    }
    if (touched) working = { ...working, expressions };
  }
  return working;
}

/**
 * A whole key pose with its omissions filled in: bones the beat currently
 * poses take the base pose (or rest), the hips offset returns to the base,
 * and expressions default to 0. Bones the Avatar lacks are left alone, since
 * the editor could not show them.
 */
function completeBeatPose(
  pose: BeatPose,
  current: AnimaPoseClipSample,
  clip: AnimaPoseClipV2,
  context: BeatEditContext,
): BeatPose {
  const basePose: VRMPose = clip.basePose
    ? (context.resolvePose(clip.basePose)?.humanoid ?? {})
    : {};
  const humanoid: VRMPose = { ...pose.humanoid };
  for (const [bone, transform] of Object.entries(current.humanoid ?? {})) {
    if (!isVRMHumanBoneName(bone) || !transform) continue;
    if (context.vrm && !context.vrm.humanoid.getNormalizedBoneNode(bone))
      continue;
    const given = humanoid[bone];
    const base = basePose[bone];
    humanoid[bone] = {
      ...given,
      ...(transform.rotation && !given?.rotation
        ? { rotation: base?.rotation ?? [0, 0, 0, 1] }
        : {}),
      ...(transform.position && !given?.position
        ? { position: base?.position ?? [0, 0, 0] }
        : {}),
    };
  }
  return { humanoid, expressions: pose.expressions ?? {} };
}

/**
 * A scalar track after a beat's value changes by `delta`: the beat's keys
 * shift by it (detail rides along); without a key there, one is added; an
 * untracked channel gets a track holding its base at every other beat.
 */
function shiftScalar(
  keys: AnimaPoseClipScalarKey[] | undefined,
  beatId: string,
  delta: number,
  target: number,
  base: number,
  beats: readonly AnimaPoseClipBeat[],
  decimals = 4,
  range?: [number, number],
): AnimaPoseClipScalarKey[] {
  const clamp = (value: number) =>
    round(
      range ? Math.min(Math.max(value, range[0]), range[1]) : value,
      decimals,
    );
  if (!keys)
    return beats.map((beat) => ({
      beat: beat.id,
      v: beat.id === beatId ? clamp(target) : base === 0 && range ? 0 : "base",
    }));
  const owned = keys.filter((key) => key.beat === beatId);
  const shifted = keys.map((key) =>
    key.beat !== beatId
      ? key
      : { ...key, v: clamp((key.v === "base" ? base : key.v) + delta) },
  );
  if (owned.some((key) => !key.dt)) return shifted;
  const times = new Map(beats.map((beat) => [beat.id, beat.time]));
  return sortKeys(times, [
    ...shifted,
    { beat: beatId, v: clamp(target) },
  ]) as AnimaPoseClipScalarKey[];
}

// ── Base pose ────────────────────────────────────────────────────────────

/**
 * Freeze the clip's base pose into its tracks and remove the reference, so
 * it plays the same without the pose catalog: `"base"` keys take their
 * values, untracked joint components get a constant track, and base bones
 * without tracks get a constant rotation (except fingers driven by
 * Hands-tool shapes, which replace them, and legs solved by `plantFeet`). Null when the base pose does
 * not resolve; unchanged when the clip has none.
 */
export function detachBasePose(
  clip: AnimaPoseClipV2,
  context: BeatEditContext,
): AnimaPoseClipV2 | null {
  if (!clip.basePose) return clip;
  const resolved = context.resolvePose(clip.basePose);
  if (!resolved) return null;
  const unbased = without(clip, "basePose") as AnimaPoseClipV2;
  const first = clip.beats[0];
  if (!first) return unbased;
  const basePose: VRMPose = resolved.humanoid ?? {};
  const constant = (v: number): AnimaPoseClipScalarKey[] => [
    { beat: first.id, v },
  ];
  const covered = new Set<string>();

  const joints = { ...clip.joints };
  for (const [jointId, components] of Object.entries(clip.joints ?? {})) {
    const joint = resolveJoint(jointId);
    if (!joint) continue;
    joint.bones.forEach((bone) => covered.add(bone));
    const rotation = basePose[joint.bones[0]]?.rotation;
    const base = decomposeJointRotation(
      joint,
      rotation ? new Quaternion(...rotation) : new Quaternion(),
    );
    const restValues = decomposeJointRotation(joint, new Quaternion());
    const next: Record<string, AnimaPoseClipScalarKey[]> = {};
    for (const name of Object.keys(JOINT_DEFINITIONS[joint.type].components)) {
      const keys = components?.[name];
      if (keys)
        next[name] = keys.map((key) =>
          key.v === "base" ? { ...key, v: base[name] ?? 0 } : key,
        );
      else if (Math.abs((base[name] ?? 0) - (restValues[name] ?? 0)) > 1e-9)
        next[name] = constant(base[name] ?? 0);
    }
    joints[jointId] = next;
  }

  const rotations = { ...clip.rotations };
  for (const bone of Object.keys(clip.rotations ?? {})) covered.add(bone);
  const shaped = (bone: string) =>
    FINGER_BONE.test(bone) &&
    !bone.endsWith("ThumbMetacarpal") &&
    Boolean(clip.hands?.[bone.startsWith("left") ? "left" : "right"]);
  for (const [bone, transform] of Object.entries(basePose)) {
    const q = transform?.rotation;
    // Rest rotations are kept too: the base pose set these bones explicitly.
    // Planted legs are solved during playback.
    if (
      isVRMHumanBoneName(bone) &&
      q &&
      !covered.has(bone) &&
      !shaped(bone) &&
      !(clip.plantFeet && LEG_BONE.test(bone))
    )
      rotations[bone] = [{ beat: first.id, q: [...q] as QuaternionTuple }];
  }

  const baseHips = basePose.hips?.position;
  const hipsPosition = { ...clip.hipsPosition };
  (["x", "y", "z"] as const).forEach((axis, index) => {
    const v = baseHips?.[index] ?? 0;
    const keys = clip.hipsPosition?.[axis];
    if (keys)
      hipsPosition[axis] = keys.map((key) =>
        key.v === "base" ? { ...key, v } : key,
      );
    // A base hips offset is written on every axis, as the base set it.
    else if (baseHips) hipsPosition[axis] = constant(v);
  });

  return {
    ...unbased,
    ...(Object.keys(joints).length > 0 ? { joints } : {}),
    ...(Object.keys(rotations).length > 0 ? { rotations } : {}),
    ...(Object.keys(hipsPosition).length > 0 ? { hipsPosition } : {}),
  };
}

// ── Hands ────────────────────────────────────────────────────────────────

/**
 * Replace a hand's Hands-tool preset keys with equivalent finger rotation
 * keys (fitted to the context Avatar), keeping each key's beat, offset and
 * ease. Fingers that already have tracks keep them.
 */
export function flattenHandToFingerTracks(
  clip: AnimaPoseClipV2,
  side: Side,
  context: BeatEditContext,
): AnimaPoseClipV2 {
  const keys = clip.hands?.[side];
  if (!keys) return clip;
  const times = beatTimes(clip);
  const evaluate = trackEvaluator(clip, context);
  const covered = new Set<string>(Object.keys(clip.rotations ?? {}));
  for (const jointId of Object.keys(clip.joints ?? {}))
    for (const bone of resolveJoint(jointId)?.bones ?? []) covered.add(bone);
  const metacarpal = `${side}ThumbMetacarpal` as VRMHumanBoneName;
  const rotations: Record<string, AnimaPoseClipRotationKey[]> = {};
  for (const key of keys) {
    const at = keyTime(times, key);
    const metacarpalTrack = clip.rotations?.[metacarpal];
    const shape = handShapeRotations(
      context.vrm ?? null,
      side,
      key,
      metacarpalTrack
        ? (evaluate.rotation(metacarpalTrack, at).toArray() as QuaternionTuple)
        : evaluate.basePose[metacarpal]?.rotation,
    );
    for (const [bone, rotation] of shape) {
      if (covered.has(bone)) continue;
      (rotations[bone] ??= []).push({
        beat: key.beat,
        ...(key.dt ? { dt: key.dt } : {}),
        ...(key.ease ? { ease: key.ease } : {}),
        q: rotation.toArray() as QuaternionTuple,
      });
    }
  }
  const hands = { ...clip.hands };
  delete hands[side];
  const next: AnimaPoseClipV2 = {
    ...clip,
    rotations: { ...clip.rotations, ...rotations },
  };
  if (Object.keys(hands).length > 0) next.hands = hands;
  else delete next.hands;
  return next;
}

function axisIndex(axis: string): 0 | 1 | 2 {
  return axis === "x" ? 0 : axis === "y" ? 1 : 2;
}

function round(value: number, decimals = 4): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
