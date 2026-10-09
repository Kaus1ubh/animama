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
import {
  fitHandShape,
  fitHandShapeOffsets,
  isOffsetExpressible,
  normalizeHandShape,
} from "../anatomy/handOffsets";
import {
  handBoneOf,
  handBones,
  handShapeRotations,
  resolveHandBones,
  type HandShape,
} from "../anatomy/handPresets";
import {
  easedProgress,
  findSegment,
  prepareAnimaPoseClipV2,
} from "./prepareV2";
import type {
  AnimaPoseClipPoseResolver,
  AnimaPoseClipSample,
  QuaternionTuple,
} from "./clipVocabulary";
import {
  ANIMA_POSE_CLIP_DECIMALS,
  roundAnimaPoseClipNumber,
} from "./clipVocabulary";
import {
  ANIMA_POSE_CLIP_V2_LIMITS,
  ANIMA_POSE_CLIP_V2_MIN_SPACING_TICKS,
  fromAnimaPoseClipTicks,
  toAnimaPoseClipTicks,
  type AnimaPoseClipBeat,
  type AnimaPoseClipEase,
  type AnimaPoseClipHandKey,
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
  /**
   * Hand shapes the Hands tool chose for the beat (a preset with Curl,
   * Spread and offsets). Each becomes the beat's hand key on that side, and
   * the pose's finger rotations on that side are read as offsets on it.
   */
  hands?: Partial<Record<Side, HandShape>>;
  /**
   * The pose is the beat as the editing Avatar plays it, solved contacts
   * included (a Pose-tab edit of the shown pose). Bones it names that
   * playback moves away from their authored rotation (an arm a solved
   * contact places) take the edit as the same local change of the authored
   * rotation (`authored · shown⁻¹ · next`), so the solve, which fits only
   * that Avatar, is never written into the clip; playback solves again from
   * the result. Otherwise the pose is taken by value, as a Library Pose is.
   */
  relativeToPlayback?: boolean;
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
 * Solved contact windows stretch the same way across beats (unsolved contacts
 * keep their offsets and move with their beat). A beat with detail cannot
 * pass a neighbour, and a beat without detail can pass only beats without
 * detail, and only when no solved window ends between its neighbours. When
 * the request would break ordering, the beat stops at the nearest time that
 * keeps it.
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
    // A solved window ending between the beat's old neighbours would fold
    // over it once the beat passes one of them.
    const lower = toAnimaPoseClipTicks(old[from - 1]?.time ?? 0);
    const upper = toAnimaPoseClipTicks(old[from + 1]?.time ?? clip.duration);
    if (solvedContactEnds(clip).some((end) => end > lower && end < upper))
      return null;
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
  return fitContactsToClip(retimeSolvedContacts(retimed, old));
}

/** Absolute ends of every solved contact window, in ticks. */
function solvedContactEnds(clip: AnimaPoseClipV2): number[] {
  const times = beatTimes(clip);
  return (clip.contacts ?? []).flatMap((contact) => {
    const beat = times.get(contact.beat);
    if (!contact.solve || beat === undefined) return [];
    const at = toAnimaPoseClipTicks(beat);
    return [
      at + toAnimaPoseClipTicks(contact.from),
      at + toAnimaPoseClipTicks(contact.to),
    ];
  });
}

/**
 * Map solved contact windows through a retime, as facing detail is mapped but
 * across beats: each window end moves piecewise linearly between the beats
 * around it, from their old times (`oldBeats`) to their new ones in `clip`,
 * with 0 and the duration fixed, and is stored again relative to its beat's
 * new time. An end on a beat stays on it. Unsolved contacts are unchanged.
 * Expects the beats in the same order before and after (or no solved end
 * between the moved beat's old neighbours).
 */
function retimeSolvedContacts(
  clip: AnimaPoseClipV2,
  oldBeats: readonly AnimaPoseClipBeat[],
): AnimaPoseClipV2 {
  if (!clip.contacts?.some((contact) => contact.solve)) return clip;
  const ticks = toAnimaPoseClipTicks;
  const newTimes = beatTimes(clip);
  const end = ticks(clip.duration);
  // [old, new] tick pairs in old time order.
  const knots: [number, number][] = oldBeats.map((beat) => [
    ticks(beat.time),
    ticks(newTimes.get(beat.id)!),
  ]);
  if (knots[0][0] > 0) knots.unshift([0, 0]);
  if (knots[knots.length - 1][0] < end) knots.push([end, end]);
  const retime = (time: number) => {
    let index = 0;
    while (index < knots.length - 2 && time > knots[index + 1][0]) index += 1;
    const [oldFrom, newFrom] = knots[index];
    const [oldTo, newTo] = knots[Math.min(index + 1, knots.length - 1)];
    return oldTo === oldFrom
      ? newFrom
      : newFrom + ((newTo - newFrom) * (time - oldFrom)) / (oldTo - oldFrom);
  };
  const oldTimes = new Map(oldBeats.map((beat) => [beat.id, beat.time]));
  const contacts = clip.contacts.map((contact) => {
    if (!contact.solve) return contact;
    const was = ticks(oldTimes.get(contact.beat)!);
    const now = newTimes.get(contact.beat)!;
    const offset = (seconds: number) =>
      roundTime(fromAnimaPoseClipTicks(retime(was + ticks(seconds))) - now);
    const from = offset(contact.from);
    const to = offset(contact.to);
    return from === contact.from && to === contact.to
      ? contact
      : { ...contact, from, to };
  });
  return { ...clip, contacts };
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

/** A bone's sampled rotation (rest when the sample leaves it out). */
function rotationOf(
  sample: AnimaPoseClipSample,
  bone: VRMHumanBoneName,
): Quaternion {
  return new Quaternion(...(sample.humanoid?.[bone]?.rotation ?? [0, 0, 0, 1]));
}

/**
 * The full sampled pose at a beat, as the creator Avatar plays it (solved
 * contacts included). It is what the creator shows, not what the clip
 * authors: edits of it go back through `setBeatPose` with
 * `relativeToPlayback`.
 */
export function beatKeyPose(
  clip: AnimaPoseClipV2,
  beatId: string,
  context: BeatEditContext,
): AnimaPoseClipSample {
  const beat = clip.beats.find(({ id }) => id === beatId);
  return prepareAnimaPoseClipV2(clip, context).sample(beat?.time ?? 0);
}

/**
 * The clip prepared to play its authored motion: contacts are not solved.
 * Every value read to write keys comes from it, so one Avatar's solve never
 * becomes part of the clip (ADR 0020).
 */
function prepareAuthored(clip: AnimaPoseClipV2, context: BeatEditContext) {
  return prepareAnimaPoseClipV2(clip, { ...context, solveContacts: false });
}

/** Whether playing the clip on the context's Avatar solves any contact. */
function solvesContacts(
  clip: AnimaPoseClipV2,
  context: BeatEditContext,
): boolean {
  return Boolean(
    context.vrm && clip.contacts?.some((contact) => contact.solve),
  );
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
        q: quaternionKey(
          evaluate.rotation(track.keys as AnimaPoseClipRotationKey[], time),
        ),
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
 * bones get a rotation track keyed at every beat. Hands driven by hand keys
 * stay hand keys (`setBeatHand`): a Hands-tool shape or finger edits become
 * the beat's hand key and its offsets. Legs solved by `plantFeet` are not
 * edited.
 *
 * Keys are written from the authored motion, never from solved contacts: a
 * pose given `relativeToPlayback` changes a solved arm's authored rotation by
 * the edit's local change, and untracked bones are keyed at other beats with
 * their authored rotations.
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
  // What the tracks play at the beat, and what the editing Avatar shows there
  // (the same unless a solved contact moves an arm).
  const authored = prepareAuthored(clip, context).sample(time);
  const before = solvesContacts(clip, context)
    ? prepareAnimaPoseClipV2(clip, context).sample(time)
    : authored;
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
  // Bones edited as shown; those `complete` fills in are taken by value.
  const shownBones = new Set(
    input.relativeToPlayback ? Object.keys(input.humanoid ?? {}) : [],
  );

  let changed: [VRMHumanBoneName, Quaternion][] = [];
  for (const [bone, transform] of Object.entries(pose.humanoid ?? {})) {
    if (!isVRMHumanBoneName(bone) || !transform?.rotation) continue;
    if (clip.plantFeet && LEG_BONE.test(bone)) continue;
    const next = new Quaternion(...transform.rotation).normalize();
    // A value is judged against the tracks; an edit of the shown pose against
    // what was shown and, where that differs from the tracks (a solved arm),
    // applied to them as the same local change.
    const current = rotationOf(authored, bone);
    const shown = shownBones.has(bone) ? rotationOf(before, bone) : current;
    if (
      !keyed.has(bone) &&
      angularDistanceDegrees(shown, next) <= CHANGE_DEGREES
    )
      continue;
    changed.push([
      bone,
      angularDistanceDegrees(shown, current) > CHANGE_DEGREES
        ? current.multiply(shown.clone().invert().multiply(next))
        : next,
    ]);
  }

  // Hands first: bones they take over leave the generic edits below.
  let working = clip;
  const edits = new Map(changed);
  for (const side of ["left", "right"] as const) {
    const hand = setBeatHand(
      working,
      beat,
      side,
      input.hands?.[side],
      edits,
      before,
      context,
    );
    working = hand.clip;
    changed = changed.filter(([bone]) => !hand.handled.has(bone));
  }

  const evaluate = trackEvaluator(working, context);
  const samples = new Map<string, AnimaPoseClipSample>();
  // The authored pose at another beat, for keying a newly tracked bone there.
  const sampleAt = (other: AnimaPoseClipBeat) => {
    let sample = samples.get(other.id);
    if (!sample) {
      sample = prepareAuthored(working, context).sample(other.time);
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
    const old = rotationOf(authored, bone);
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
              q: quaternionKey(
                key.dt ? new Quaternion(...key.q).multiply(delta) : next,
              ),
            },
      );
      rotations[bone] = owned.some((key) => !key.dt)
        ? updated
        : (sortKeys(beatTimes(working), [
            ...updated,
            { beat: beatId, q: quaternionKey(next) },
          ]) as AnimaPoseClipRotationKey[]);
    } else {
      rotations[bone] = working.beats.map((other) => ({
        beat: other.id,
        q: quaternionKey(
          other.id === beatId ? next : rotationOf(sampleAt(other), bone),
        ),
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
      rotations[bone] = [
        { beat: first.id, q: quaternionKey(new Quaternion(...q)) },
      ];
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
 * How far (degrees) offsets may fall short. A finger edit that changes joint
 * components offsets do not carry by no more than this stays offsets on the
 * hand key, and larger ones (a finger twist, say) fall back to tracks; a key
 * anchoring a beat must play its hand within it. Far below a visible change
 * of a finger.
 */
const HAND_OFFSET_TOLERANCE_DEGREES = 0.5;

type HandEdit = {
  clip: AnimaPoseClipV2;
  /** Bones the hand edit has written; the generic pose edit skips them. */
  handled: ReadonlySet<VRMHumanBoneName>;
};

/** Bones a joint or rotation track drives; tracks override hand shapes. */
function trackedBones(clip: AnimaPoseClipV2): Set<string> {
  const tracked = new Set<string>(Object.keys(clip.rotations ?? {}));
  for (const jointId of Object.keys(clip.joints ?? {}))
    for (const bone of resolveJoint(jointId)?.bones ?? []) tracked.add(bone);
  return tracked;
}

/** The finger bones a hand shape plays on this Avatar (all without one). */
function handShapeBones(vrm: VRM | null, side: Side): VRMHumanBoneName[] {
  return (
    vrm ? resolveHandBones({ vrm }, side).available : handBones(side)
  ).map(({ boneName }) => boneName as VRMHumanBoneName);
}

/** A hand key's shape, without its beat, offset and ease. */
function handKeyShape(key: AnimaPoseClipHandKey, offsets = true): HandShape {
  return normalizeHandShape({
    preset: key.preset,
    curl: key.curl,
    spread: key.spread,
    ...(offsets ? { fingers: key.fingers } : {}),
  });
}

/** A hand key holding a shape, owned by a beat. */
function handKey(
  shape: HandShape,
  owner: { beat: string; ease?: AnimaPoseClipEase },
): AnimaPoseClipHandKey {
  return {
    ...shape,
    beat: owner.beat,
    ...(owner.ease ? { ease: owner.ease } : {}),
  };
}

/**
 * Where a beat's hand key starts from: the key it owns at its own time, or
 * else the preset, Curl and Spread of the key nearest in time (across a
 * loop's seam). Null when the side has no hand keys.
 */
function beatHandKeyStart(
  clip: AnimaPoseClipV2,
  beat: AnimaPoseClipBeat,
  side: Side,
): { own: AnimaPoseClipHandKey | undefined; shape: HandShape } | null {
  const keys = clip.hands?.[side];
  if (!keys?.length) return null;
  const own = keys.find((key) => key.beat === beat.id && !key.dt);
  if (own) return { own, shape: handKeyShape(own) };
  const times = beatTimes(clip);
  let nearest = keys[0];
  let distance = Number.POSITIVE_INFINITY;
  for (const key of keys) {
    const gap = Math.abs(keyTime(times, key) - beat.time);
    const span = clip.loop ? Math.min(gap, clip.duration - gap) : gap;
    if (span < distance) {
      nearest = key;
      distance = span;
    }
  }
  return { own: undefined, shape: handKeyShape(nearest, false) };
}

/**
 * Fit `shape`'s offsets to the hand as shown: every given bone when `all`
 * (a key taken from a neighbour must hold the whole hand), otherwise only
 * bones the shape does not already play, so a key's existing offsets stay
 * exactly as they were. Every target is fitted as closely as offsets allow.
 *
 * Bones that may miss (`canMiss`) are `missed` when offsets cannot carry
 * their edit: the change to their shown rotation, from what the shape plays
 * and from the hand before the edit (`before`), turns components offsets do
 * not carry (`isOffsetExpressible`), or their offsets would pass the limit.
 * Judging the edit rather than the fit keeps a hand between two keys, which
 * offsets only approximate, editable as offsets.
 */
function fitShownHand(
  vrm: VRM | null,
  side: Side,
  shape: HandShape,
  shown: ReadonlyMap<VRMHumanBoneName, Quaternion>,
  metacarpal: QuaternionTuple | undefined,
  all: boolean,
  judge: {
    canMiss?: (bone: VRMHumanBoneName) => boolean;
    before?: ReadonlyMap<VRMHumanBoneName, Quaternion>;
  } = {},
): { shape: HandShape; missed: Map<VRMHumanBoneName, Quaternion> } {
  const played = handShapeRotations(vrm, side, shape, metacarpal);
  const targets = new Map(
    [...shown].filter(([bone, rotation]) => {
      const current = played.get(bone);
      return (
        current &&
        (all || angularDistanceDegrees(current, rotation) > CHANGE_DEGREES)
      );
    }),
  );
  const fit = fitHandShapeOffsets(vrm, side, shape, targets, metacarpal);
  const missed = new Map<VRMHumanBoneName, Quaternion>();
  for (const [bone, rotation] of targets) {
    if (judge.canMiss && !judge.canMiss(bone)) continue;
    const origins = [played.get(bone), judge.before?.get(bone)].filter(
      (origin): origin is Quaternion => Boolean(origin),
    );
    if (
      fit.limited.has(bone) ||
      !origins.some((origin) =>
        isOffsetExpressible(
          bone,
          origin,
          rotation,
          HAND_OFFSET_TOLERANCE_DEGREES,
        ),
      )
    )
      missed.set(bone, rotation);
  }
  return { shape: fit.shape, missed };
}

/** The shape the Hands tool adjusts at a beat, and the bones it leaves alone. */
export type BeatHandShape = {
  shape: HandShape;
  /**
   * Shown bones the shape does not drive: bones with their own tracks, and
   * bones whose edits offsets cannot carry (a twisted finger, say). The Hands
   * tool turns these as bones, as in Pose editing, so their edits keep their
   * tracks or get fallback tracks on commit.
   */
  unshaped: Set<VRMHumanBoneName>;
};

/**
 * The hand shape the Hands tool adjusts at a beat: the shape it recorded
 * earlier in this edit (`recorded`), else, for a hand driven by hand keys,
 * the beat's own key (dt 0) or the nearest key's preset, Curl and Spread.
 * Offsets are fitted to `rotations` (the finger rotations shown, canonical
 * basis; the thumb metacarpal at `metacarpal`) where they differ from that
 * shape, so earlier finger edits are kept. `original` holds the rotations
 * the beat had when the edit began; edits are judged against them. Null when
 * nothing is recorded and the side has no hand keys.
 */
export function beatHandShape(
  clip: AnimaPoseClipV2,
  beatId: string,
  side: Side,
  rotations: ReadonlyMap<VRMHumanBoneName, Quaternion>,
  original: ReadonlyMap<VRMHumanBoneName, Quaternion>,
  metacarpal: QuaternionTuple | undefined,
  context: Pick<BeatEditContext, "vrm">,
  recorded?: HandShape | null,
): BeatHandShape | null {
  let start: { shape: HandShape; all: boolean } | null = null;
  if (recorded) start = { shape: recorded, all: false };
  else {
    const beat = clip.beats.find(({ id }) => id === beatId);
    const key = beat ? beatHandKeyStart(clip, beat, side) : null;
    if (key) start = { shape: key.shape, all: !key.own };
  }
  if (!start) return null;
  const tracked = trackedBones(clip);
  const fit = fitShownHand(
    context.vrm ?? null,
    side,
    start.shape,
    new Map([...rotations].filter(([bone]) => !tracked.has(bone))),
    metacarpal,
    start.all,
    { before: original },
  );
  return {
    shape: fit.shape,
    unshaped: new Set([
      ...[...rotations.keys()].filter((bone) => tracked.has(bone)),
      ...fit.missed.keys(),
    ]),
  };
}

/**
 * A pose edit of one hand, kept as hand keys where the hand has them.
 *
 * With a Hands-tool shape (`intent`), the beat's hand key (dt 0) becomes that
 * shape; a hand without keys first gets a key at every other beat holding
 * what it plays there now (`anchorHandTrack`), or stays a generic finger edit
 * when no preset expresses that. Without one, finger edits of a hand driven
 * by hand keys become offsets on the beat's key, read against its preset,
 * Curl and Spread as fitted on the editing Avatar; a beat without a key gets
 * one from the nearest key's preset, Curl and Spread, with offsets for the
 * whole hand as shown. Between two different keys the shown hand is a blend
 * that offsets only approximate, so fingers there can move by a few degrees
 * (tests hold them within 4.5° halfway between `fist` and `open-spread`).
 * Keys at other beats are untouched.
 *
 * Finger edits that offsets cannot carry (a change of finger twist, of splay
 * or abduction past the proximal segment, or offsets beyond ±90°) and thumb
 * metacarpal edits also get tracks (`addHandFallbackTracks`); the key still
 * holds the closest offsets, so key and track agree as far as offsets can.
 * Bones with their own tracks are left to the generic edit.
 */
function setBeatHand(
  clip: AnimaPoseClipV2,
  beat: AnimaPoseClipBeat,
  side: Side,
  intent: HandShape | undefined,
  edits: ReadonlyMap<VRMHumanBoneName, Quaternion>,
  before: AnimaPoseClipSample,
  context: BeatEditContext,
): HandEdit {
  const unchanged: HandEdit = { clip, handled: new Set() };
  const metacarpal: VRMHumanBoneName = `${side}ThumbMetacarpal`;
  // Without a shape, only edits of a hand with hand keys concern hand keys.
  if (
    !intent &&
    (!clip.hands?.[side]?.length ||
      ![...edits.keys()].some(
        (bone) => bone === metacarpal || handBoneOf(bone)?.side === side,
      ))
  )
    return unchanged;
  const vrm = context.vrm ?? null;
  const tracked = trackedBones(clip);
  const free = handShapeBones(vrm, side).filter((bone) => !tracked.has(bone));
  const metacarpalEdit = tracked.has(metacarpal)
    ? undefined
    : edits.get(metacarpal);
  if (
    free.length === 0 ||
    (!intent && !metacarpalEdit && !free.some((bone) => edits.has(bone)))
  )
    return unchanged;

  let working = clip;
  if (!working.hands?.[side]?.length) {
    if (!intent) return unchanged;
    const anchored = anchorHandTrack(working, beat.id, side, free, context);
    if (!anchored) return unchanged;
    working = anchored;
  }
  const start = beatHandKeyStart(working, beat, side);
  const own = start?.own;
  const shape = intent ? normalizeHandShape(intent) : start!.shape;
  const metacarpalRotation = (
    edits.get(metacarpal) ?? rotationOf(before, metacarpal)
  ).toArray() as QuaternionTuple;
  const shown = new Map(
    free.map((bone) => [bone, edits.get(bone) ?? rotationOf(before, bone)]),
  );
  // A key taken from a neighbour holds the whole hand as shown, as closely
  // as offsets allow (see above); only edits offsets cannot carry miss.
  const fit = fitShownHand(
    vrm,
    side,
    shape,
    shown,
    metacarpalRotation,
    !intent && !own,
    {
      canMiss: (bone) => edits.has(bone),
      before: new Map(free.map((bone) => [bone, rotationOf(before, bone)])),
    },
  );
  const fallback = fit.missed;
  if (metacarpalEdit) fallback.set(metacarpal, metacarpalEdit);

  const times = beatTimes(working);
  const beatTicks = toAnimaPoseClipTicks(beat.time);
  const key = handKey(fit.shape, { beat: beat.id, ease: own?.ease });
  // The new key replaces the beat's own key and any key too close to it.
  const others = (working.hands?.[side] ?? []).filter(
    (other) =>
      other !== own &&
      Math.abs(toAnimaPoseClipTicks(keyTime(times, other)) - beatTicks) >=
        ANIMA_POSE_CLIP_V2_MIN_SPACING_TICKS,
  );
  working = {
    ...working,
    hands: {
      ...working.hands,
      [side]: sortKeys(times, [...others, key]) as AnimaPoseClipHandKey[],
    },
  };
  if (fallback.size > 0)
    working = addHandFallbackTracks(
      working,
      clip,
      beat.id,
      side,
      fallback,
      context,
    );
  return {
    clip: working,
    handled: new Set([...free, ...(metacarpalEdit ? [metacarpal] : [])]),
  };
}

/**
 * Start a hand track on a side without one: every beat but `beatId` gets a
 * key holding the hand it plays now, as the simplest preset with offsets that
 * fits (`fitHandShape`), so a new key at `beatId` leaves the other beats as
 * they were. Null when some beat's hand fits no preset.
 */
function anchorHandTrack(
  clip: AnimaPoseClipV2,
  beatId: string,
  side: Side,
  bones: readonly VRMHumanBoneName[],
  context: BeatEditContext,
): AnimaPoseClipV2 | null {
  const vrm = context.vrm ?? null;
  const prepared = prepareAuthored(clip, context);
  const metacarpal: VRMHumanBoneName = `${side}ThumbMetacarpal`;
  // Untracked fingers hold the base pose, so beats mostly share one fit.
  const fits = new Map<string, HandShape | null>();
  const keys: AnimaPoseClipHandKey[] = [];
  for (const other of clip.beats) {
    if (other.id === beatId) continue;
    const sample = prepared.sample(other.time);
    const rotations = new Map(
      bones.map((bone) => [bone, rotationOf(sample, bone)]),
    );
    const metacarpalRotation = sample.humanoid?.[metacarpal]?.rotation;
    const cacheKey = JSON.stringify([
      metacarpalRotation ?? null,
      [...rotations.values()].map((rotation) => rotation.toArray()),
    ]);
    let shape = fits.get(cacheKey);
    if (shape === undefined) {
      shape = fitHandShape(
        vrm,
        side,
        rotations,
        metacarpalRotation,
        HAND_OFFSET_TOLERANCE_DEGREES,
      );
      fits.set(cacheKey, shape);
    }
    if (!shape) return null;
    keys.push(handKey(shape, { beat: other.id }));
  }
  return { ...clip, hands: { ...clip.hands, [side]: keys } };
}

/**
 * Give bones that hand-key offsets cannot carry tracks keyed at every hand
 * key of their side: the beat's own key (dt 0) takes the edited rotation and
 * every other key the rotation `original` plays there now, so the hand at
 * other keys is unchanged. Finger segments get joint tracks, which override
 * hand shapes for the whole clip; the thumb metacarpal gets a rotation
 * track, since thumbs are fitted around it at every key.
 */
function addHandFallbackTracks(
  clip: AnimaPoseClipV2,
  original: AnimaPoseClipV2,
  beatId: string,
  side: Side,
  bones: ReadonlyMap<VRMHumanBoneName, Quaternion>,
  context: BeatEditContext,
): AnimaPoseClipV2 {
  const keys = clip.hands?.[side] ?? [];
  const times = beatTimes(clip);
  const prepared = prepareAuthored(original, context);
  const samples = keys.map((key) =>
    key.beat === beatId && !key.dt
      ? null
      : prepared.sample(keyTime(times, key)),
  );
  const owned = (key: AnimaPoseClipHandKey): OwnedKey => ({
    beat: key.beat,
    ...(key.dt ? { dt: key.dt } : {}),
    ...(key.ease ? { ease: key.ease } : {}),
  });
  const joints = { ...clip.joints };
  const rotations = { ...clip.rotations };
  for (const [bone, edited] of bones) {
    const at = (index: number) => {
      const sample = samples[index];
      return sample ? rotationOf(sample, bone) : edited;
    };
    const joint = resolveJoint(bone);
    if (!joint) {
      rotations[bone] = keys.map((key, index) => ({
        ...owned(key),
        q: quaternionKey(at(index)),
      }));
      continue;
    }
    const components: Record<string, AnimaPoseClipScalarKey[]> = {};
    let near: Record<string, number> | undefined;
    keys.forEach((key, index) => {
      const values = decomposeJointRotation(joint, at(index), near);
      near = values;
      for (const [name, value] of Object.entries(values))
        (components[name] ??= []).push({ ...owned(key), v: round(value) });
    });
    joints[joint.id] = components;
  }
  return {
    ...clip,
    ...(Object.keys(joints).length > 0 ? { joints } : {}),
    ...(Object.keys(rotations).length > 0 ? { rotations } : {}),
  };
}

function axisIndex(axis: string): 0 | 1 | 2 {
  return axis === "x" ? 0 : axis === "y" ? 1 : 2;
}

/** A rotation key at the precision Save writes, so drafts match saved clips. */
function quaternionKey(rotation: Quaternion): QuaternionTuple {
  return rotation
    .toArray()
    .map((value) =>
      roundAnimaPoseClipNumber(value, ANIMA_POSE_CLIP_DECIMALS.transform),
    ) as QuaternionTuple;
}

function round(value: number, decimals = 4): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}
