import { VRMExpressionPresetName } from "@pixiv/three-vrm";

import {
  HAND_ADJUSTMENT_LIMITS,
  HAND_PRESETS,
  type HandPreset,
} from "@/ui/pose-creator/poseCreatorHandAuthoring";
import {
  ANIMA_POSE_CLIP_MUTABLE_LAYER_IDS,
  type AnimaPoseClipMutableLayerId,
} from "../poses/animaPoseClip/schema";
import { JOINT_DEFINITIONS, resolveJoint, type Side } from "./anatomy";

/**
 * Agent-facing motion description: independent keyed tracks per joint
 * component, hips offset, hand shape and expression. It is the editable source
 * of a generated Gesture; `bakeMotion` turns it into `animaPoseClip/1.0`.
 */
export const MOTION_DESCRIPTION_SCHEMA = "animamaMotion/1" as const;

/** Tangent at a key: `auto` keeps velocity through it; `flat` stops there. */
export type MotionTangent = "auto" | "flat";
/** Interpolation of the segment leaving a key. */
export type MotionInterpolation = "smooth" | "linear" | "step";

export type MotionKey = {
  t: number;
  /** A number, or `"base"` for the base pose's value of this channel. */
  v: number | "base";
  tangent?: MotionTangent;
  interp?: MotionInterpolation;
};

/**
 * A held hand shape. The hand eases between neighbouring keys and settles on
 * each one; add keys closer together for quicker changes.
 */
export type HandShapeKey = {
  t: number;
  preset: HandPreset;
  /** Relative finger curl after the preset, degrees (Hands tool Curl). */
  curl?: number;
  /** Relative base-segment spread after the preset, degrees. */
  spread?: number;
};

export type MotionContact = {
  /** Humanoid bone that should touch, for example `rightIndexDistal`. */
  bone: string;
  /** Humanoid bone it touches, for example `head`. */
  target: string;
  /** Offset from the target bone in its rest-aligned frame, metres (x left, y up, z forward). */
  offset?: [number, number, number];
  from: number;
  to: number;
  /** Allowed distance, metres. Defaults to 0.06. */
  tolerance?: number;
};

export type MutableProceduralLayerId = AnimaPoseClipMutableLayerId;

export const MUTABLE_PROCEDURAL_LAYER_IDS = ANIMA_POSE_CLIP_MUTABLE_LAYER_IDS;

/** Generated Gestures mute every live layer except breathing by default. */
export const DEFAULT_GENERATED_MUTED_LAYERS: readonly MutableProceduralLayerId[] =
  MUTABLE_PROCEDURAL_LAYER_IDS.filter((id) => id !== "breathing");

export type MotionDescription = {
  schema: typeof MOTION_DESCRIPTION_SCHEMA;
  /** Gesture display name; the clip id is its kebab-case form. */
  name: string;
  /** `oneShot` enters, performs and returns; `loop` repeats seamlessly while held. */
  kind: "oneShot" | "loop";
  duration: number;
  fadeIn?: number;
  fadeOut?: number;
  /** Solve the legs so both feet stay where they are at rest (default true). */
  plantFeet?: boolean;
  mutedProceduralLayers?: MutableProceduralLayerId[];
  /** Baked keyframes per second (default 30). */
  sampleRate?: number;
  joints?: Record<string, Record<string, MotionKey[]>>;
  /** Hips translation from rest, metres: x toward the Avatar's left, y up, z forward. */
  hipsPosition?: Partial<Record<"x" | "y" | "z", MotionKey[]>>;
  hands?: Partial<Record<Side, HandShapeKey[]>>;
  expressions?: Record<string, MotionKey[]>;
  contacts?: MotionContact[];
};

export type MotionDescriptionIssue = { path: string; message: string };

export type MotionDescriptionParseResult =
  | { ok: true; description: MotionDescription }
  | { ok: false; issues: MotionDescriptionIssue[] };

const EXPRESSION_NAMES = new Set<string>(
  Object.values(VRMExpressionPresetName),
);
const HAND_PRESET_IDS = new Set<string>(HAND_PRESETS.map(({ id }) => id));
const LEG_JOINT = /^(left|right)(UpperLeg|LowerLeg|Foot)$/;
const TIME_EPSILON = 1e-6;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validate a description and report every problem with its JSON path. The
 * result is either a fully valid description or a list of issues; nothing is
 * partially accepted.
 */
export function parseMotionDescription(
  value: unknown,
): MotionDescriptionParseResult {
  const issues: MotionDescriptionIssue[] = [];
  const fail = (path: string, message: string) =>
    issues.push({ path, message });

  if (!isRecord(value)) {
    return {
      ok: false,
      issues: [{ path: "$", message: "Expected a JSON object." }],
    };
  }
  if (value.schema !== MOTION_DESCRIPTION_SCHEMA)
    fail("schema", `Expected "${MOTION_DESCRIPTION_SCHEMA}".`);
  if (typeof value.name !== "string" || !/[A-Za-z0-9]/.test(value.name))
    fail("name", "Expected a display name containing letters or digits.");
  if (value.kind !== "oneShot" && value.kind !== "loop")
    fail("kind", 'Expected "oneShot" or "loop".');
  const duration = value.duration;
  const validDuration =
    typeof duration === "number" && Number.isFinite(duration) && duration > 0;
  if (!validDuration)
    fail("duration", "Expected a positive number of seconds.");
  const end = validDuration ? duration : Number.POSITIVE_INFINITY;

  for (const field of ["fadeIn", "fadeOut"] as const) {
    const fade = value[field];
    if (
      fade !== undefined &&
      !(typeof fade === "number" && Number.isFinite(fade) && fade >= 0)
    )
      fail(field, "Expected a non-negative number of seconds.");
  }
  if (value.plantFeet !== undefined && typeof value.plantFeet !== "boolean")
    fail("plantFeet", "Expected true or false.");
  if (
    value.sampleRate !== undefined &&
    !(
      typeof value.sampleRate === "number" &&
      value.sampleRate >= 10 &&
      value.sampleRate <= 60
    )
  )
    fail("sampleRate", "Expected a number from 10 to 60.");
  if (value.mutedProceduralLayers !== undefined) {
    if (!Array.isArray(value.mutedProceduralLayers))
      fail("mutedProceduralLayers", "Expected an array of layer ids.");
    else
      value.mutedProceduralLayers.forEach((id, index) => {
        if (!MUTABLE_PROCEDURAL_LAYER_IDS.includes(id as never))
          fail(
            `mutedProceduralLayers[${index}]`,
            `Unknown layer "${String(id)}". Use one of: ${MUTABLE_PROCEDURAL_LAYER_IDS.join(", ")}.`,
          );
      });
  }

  const loop = value.kind === "loop";
  const checkKeys = (
    path: string,
    keys: unknown,
    range?: readonly [number, number],
  ) => {
    if (!Array.isArray(keys) || keys.length === 0) {
      fail(path, "Expected a non-empty array of keys.");
      return;
    }
    let previous = -Infinity;
    keys.forEach((key, index) => {
      const keyPath = `${path}[${index}]`;
      if (!isRecord(key)) {
        fail(keyPath, "Expected a key object { t, v }.");
        return;
      }
      checkTime(keyPath, key.t, previous);
      if (typeof key.t === "number") previous = key.t;
      if (key.v === "base") {
        if (!range) fail(`${keyPath}.v`, '"base" is not available here.');
      } else if (typeof key.v !== "number" || !Number.isFinite(key.v)) {
        fail(`${keyPath}.v`, 'Expected a number or "base".');
      } else if (range && (key.v < range[0] || key.v > range[1])) {
        fail(
          `${keyPath}.v`,
          `${key.v} is outside the allowed range ${range[0]} to ${range[1]}.`,
        );
      }
      if (
        key.tangent !== undefined &&
        key.tangent !== "auto" &&
        key.tangent !== "flat"
      )
        fail(`${keyPath}.tangent`, 'Expected "auto" or "flat".');
      if (
        key.interp !== undefined &&
        !["smooth", "linear", "step"].includes(key.interp as string)
      )
        fail(`${keyPath}.interp`, 'Expected "smooth", "linear" or "step".');
    });
    if (loop) checkLoopEnds(path, keys);
  };
  const checkTime = (path: string, t: unknown, previous: number) => {
    if (typeof t !== "number" || !Number.isFinite(t)) {
      fail(`${path}.t`, "Expected a time in seconds.");
    } else if (t < 0 || t > end + TIME_EPSILON) {
      fail(`${path}.t`, `Time ${t} is outside 0 to the clip duration.`);
    } else if (t <= previous + TIME_EPSILON) {
      fail(`${path}.t`, "Key times must strictly increase.");
    }
  };
  const checkLoopEnds = (path: string, keys: unknown[]) => {
    const first = keys[0];
    const last = keys[keys.length - 1];
    if (
      isRecord(first) &&
      isRecord(last) &&
      keys.length > 1 &&
      first.t === 0 &&
      typeof last.t === "number" &&
      Math.abs(last.t - end) < TIME_EPSILON &&
      first.v !== last.v
    )
      fail(
        path,
        "A loop track with keys at 0 and the duration must use the same value at both.",
      );
  };

  const plantFeet = value.plantFeet !== false;
  if (value.joints !== undefined) {
    if (!isRecord(value.joints))
      fail("joints", "Expected an object of joints.");
    else
      for (const [jointId, components] of Object.entries(value.joints)) {
        const path = `joints.${jointId}`;
        const joint = resolveJoint(jointId);
        if (!joint) {
          fail(path, `Unknown joint "${jointId}".`);
          continue;
        }
        if (plantFeet && LEG_JOINT.test(jointId)) {
          fail(
            path,
            "Legs are solved automatically while plantFeet is true. Set plantFeet to false to key them.",
          );
          continue;
        }
        if (!isRecord(components)) {
          fail(path, "Expected an object of component tracks.");
          continue;
        }
        const definition = JOINT_DEFINITIONS[joint.type];
        for (const [name, keys] of Object.entries(components)) {
          const component = definition.components[
            name as keyof typeof definition.components
          ] as { hard: [number, number] } | undefined;
          if (!component) {
            fail(
              `${path}.${name}`,
              `Unknown component. ${jointId} accepts: ${Object.keys(definition.components).join(", ")}.`,
            );
            continue;
          }
          checkKeys(`${path}.${name}`, keys, component.hard);
        }
      }
  }

  if (value.hipsPosition !== undefined) {
    if (!isRecord(value.hipsPosition))
      fail("hipsPosition", "Expected { x?, y?, z? } tracks.");
    else
      for (const [axis, keys] of Object.entries(value.hipsPosition)) {
        if (!["x", "y", "z"].includes(axis))
          fail(`hipsPosition.${axis}`, "Expected x, y or z.");
        else checkKeys(`hipsPosition.${axis}`, keys, [-0.3, 0.3]);
      }
  }

  if (value.expressions !== undefined) {
    if (!isRecord(value.expressions))
      fail("expressions", "Expected an object of expression tracks.");
    else
      for (const [name, keys] of Object.entries(value.expressions)) {
        if (!EXPRESSION_NAMES.has(name))
          fail(
            `expressions.${name}`,
            `Unknown expression. Use a VRM preset: ${[...EXPRESSION_NAMES].join(", ")}.`,
          );
        else {
          checkKeys(`expressions.${name}`, keys, [0, 1]);
          if (Array.isArray(keys))
            keys.forEach((key, index) => {
              if (isRecord(key) && key.v === "base")
                fail(
                  `expressions.${name}[${index}].v`,
                  "Expressions have no base value; use a weight from 0 to 1.",
                );
            });
        }
      }
  }

  if (value.hands !== undefined) {
    if (!isRecord(value.hands)) fail("hands", "Expected { left?, right? }.");
    else
      for (const [side, keys] of Object.entries(value.hands)) {
        const path = `hands.${side}`;
        if (side !== "left" && side !== "right") {
          fail(path, 'Expected "left" or "right".');
          continue;
        }
        if (!Array.isArray(keys) || keys.length === 0) {
          fail(path, "Expected a non-empty array of hand-shape keys.");
          continue;
        }
        let previous = -Infinity;
        keys.forEach((key, index) => {
          const keyPath = `${path}[${index}]`;
          if (!isRecord(key)) {
            fail(keyPath, "Expected { t, preset }.");
            return;
          }
          checkTime(keyPath, key.t, previous);
          if (typeof key.t === "number") previous = key.t;
          if (!HAND_PRESET_IDS.has(key.preset as string))
            fail(
              `${keyPath}.preset`,
              `Unknown preset. Use one of: ${[...HAND_PRESET_IDS].join(", ")}.`,
            );
          for (const field of ["curl", "spread"] as const) {
            const amount = key[field];
            const limit = HAND_ADJUSTMENT_LIMITS[field];
            if (
              amount !== undefined &&
              !(typeof amount === "number" && Math.abs(amount) <= limit)
            )
              fail(
                `${keyPath}.${field}`,
                `Expected degrees from −${limit} to ${limit}.`,
              );
          }
        });
        const first = keys[0];
        const last = keys[keys.length - 1];
        if (
          loop &&
          keys.length > 1 &&
          isRecord(first) &&
          isRecord(last) &&
          first.t === 0 &&
          typeof last.t === "number" &&
          Math.abs(last.t - end) < TIME_EPSILON &&
          (first.preset !== last.preset ||
            (first.curl ?? 0) !== (last.curl ?? 0) ||
            (first.spread ?? 0) !== (last.spread ?? 0))
        )
          fail(
            path,
            "A loop hand track with keys at 0 and the duration must use the same shape at both.",
          );
      }
  }

  if (value.contacts !== undefined) {
    if (!Array.isArray(value.contacts))
      fail("contacts", "Expected an array of contacts.");
    else
      value.contacts.forEach((contact, index) => {
        const path = `contacts[${index}]`;
        if (!isRecord(contact)) {
          fail(path, "Expected { bone, target, from, to }.");
          return;
        }
        for (const field of ["bone", "target"] as const)
          if (typeof contact[field] !== "string")
            fail(`${path}.${field}`, "Expected a humanoid bone name.");
        if (
          typeof contact.from !== "number" ||
          typeof contact.to !== "number" ||
          contact.from < 0 ||
          contact.to > end + TIME_EPSILON ||
          contact.to < contact.from
        )
          fail(path, "Expected 0 ≤ from ≤ to ≤ duration.");
        if (
          contact.offset !== undefined &&
          !(
            Array.isArray(contact.offset) &&
            contact.offset.length === 3 &&
            contact.offset.every((n) => typeof n === "number")
          )
        )
          fail(`${path}.offset`, "Expected [x, y, z] metres.");
        if (
          contact.tolerance !== undefined &&
          !(typeof contact.tolerance === "number" && contact.tolerance > 0)
        )
          fail(`${path}.tolerance`, "Expected a positive distance in metres.");
      });
  }

  return issues.length > 0
    ? { ok: false, issues }
    : { ok: true, description: value as MotionDescription };
}

/** Format issues for a terminal: one `path: message` line each. */
export function formatMotionDescriptionIssues(
  issues: readonly MotionDescriptionIssue[],
): string {
  return issues.map(({ path, message }) => `${path}: ${message}`).join("\n");
}
