import { createColorOverLifeBehavior } from "./colors";
import { readFiniteNumber, valueRangeToGenerator } from "./numbers";
import { cloneJsonObject, readJsonObject } from "./json";
import type {
  JsonArray,
  JsonObject,
  ParticleVFXEditorFrameOverLifeDraft,
} from "./types";

export function setBehaviorEnabled(
  ps: JsonObject,
  type: "ForceOverLife" | "SizeOverLife" | "ColorOverLife",
  enabled: boolean,
): void {
  const behaviors = Array.isArray(ps.behaviors)
    ? (ps.behaviors as JsonArray)
    : [];
  const index = behaviors.findIndex(
    (behavior) => readJsonObject(behavior)?.type === type,
  );
  if (!enabled) {
    if (index >= 0) behaviors.splice(index, 1);
    ps.behaviors = behaviors;
    return;
  }
  if (index >= 0) return;
  behaviors.push(createDefaultBehavior(type));
  ps.behaviors = behaviors;
}

export function createDefaultBehavior(
  type: "ForceOverLife" | "SizeOverLife" | "ColorOverLife",
): JsonObject {
  if (type === "ForceOverLife") return createForceOverLifeBehavior();
  if (type === "SizeOverLife") return createSizeOverLifeBehavior();
  return createColorOverLifeBehavior();
}

export function createForceOverLifeBehavior(): JsonObject {
  return {
    type: "ForceOverLife",
    x: valueRangeToGenerator({ min: 0, max: 0 }),
    y: valueRangeToGenerator({ min: 0.12, max: 0.12 }),
    z: valueRangeToGenerator({ min: 0, max: 0 }),
  };
}

export function createSizeOverLifeBehavior(): JsonObject {
  return {
    type: "SizeOverLife",
    size: {
      type: "PiecewiseBezier",
      functions: [
        {
          function: {
            p0: 0.35,
            p1: 1,
            p2: 0.85,
            p3: 0,
          },
          start: 0,
        },
      ],
    },
  };
}

export function createFrameOverLifeBehavior(args: {
  startFrame: number;
  endFrame: number;
}): JsonObject {
  return {
    type: "FrameOverLife",
    frame: frameRangeToPiecewiseBezier(args.startFrame, args.endFrame),
  };
}

export function readFrameOverLifeDraft(
  ps: JsonObject,
): ParticleVFXEditorFrameOverLifeDraft {
  const behavior = findBehavior(ps, "FrameOverLife");
  if (!behavior) return { mode: "off", startFrame: 0, endFrame: 0 };

  const frame = readJsonObject(behavior.frame);
  const functions = Array.isArray(frame?.functions) ? frame.functions : [];
  const firstFunction = readJsonObject(functions[0]);
  const curve = readJsonObject(firstFunction?.function);
  const start = readFiniteNumber(firstFunction?.start);
  const p0 = readFiniteNumber(curve?.p0);
  const p1 = readFiniteNumber(curve?.p1);
  const p2 = readFiniteNumber(curve?.p2);
  const p3 = readFiniteNumber(curve?.p3);
  const fallback = {
    startFrame: Math.max(0, Math.round(p0 ?? 0)),
    endFrame: Math.max(0, Math.round(p3 ?? p0 ?? 0)),
  };

  if (
    frame?.type !== "PiecewiseBezier" ||
    functions.length !== 1 ||
    start !== 0 ||
    p0 === null ||
    p1 === null ||
    p2 === null ||
    p3 === null ||
    !isLinearBezier(p0, p1, p2, p3)
  ) {
    return {
      mode: "unsupported",
      raw: cloneJsonObject(behavior),
      label: "Unsupported FrameOverLife",
      ...fallback,
    };
  }

  return {
    mode: "linear",
    startFrame: Math.max(0, Math.round(p0)),
    endFrame: Math.max(0, Math.round(p3)),
  };
}

export function setFrameOverLifeDraft(
  ps: JsonObject,
  draft: ParticleVFXEditorFrameOverLifeDraft,
): void {
  if (draft.mode === "off") {
    removeBehavior(ps, "FrameOverLife");
    return;
  }
  const behaviors = Array.isArray(ps.behaviors)
    ? (ps.behaviors as JsonArray)
    : [];
  const index = behaviors.findIndex(
    (behavior) => readJsonObject(behavior)?.type === "FrameOverLife",
  );
  const nextBehavior =
    draft.mode === "unsupported"
      ? cloneJsonObject(draft.raw)
      : createFrameOverLifeBehavior(draft);
  if (index >= 0) {
    behaviors[index] = nextBehavior;
  } else {
    behaviors.push(nextBehavior);
  }
  ps.behaviors = behaviors;
}

export function cloneFrameOverLifeDraft(
  draft: ParticleVFXEditorFrameOverLifeDraft,
): ParticleVFXEditorFrameOverLifeDraft {
  if (draft.mode !== "unsupported") return { ...draft };
  return {
    ...draft,
    raw: cloneJsonObject(draft.raw),
  };
}

export function findForceOverLifeBehavior(ps: JsonObject): JsonObject | null {
  return findBehavior(ps, "ForceOverLife");
}

export function findBehavior(ps: JsonObject, type: string): JsonObject | null {
  const behaviors = Array.isArray(ps.behaviors) ? ps.behaviors : [];
  for (const behavior of behaviors) {
    const object = readJsonObject(behavior);
    if (object?.type === type) return object;
  }
  return null;
}

function removeBehavior(ps: JsonObject, type: string): void {
  const behaviors = Array.isArray(ps.behaviors)
    ? (ps.behaviors as JsonArray)
    : [];
  const index = behaviors.findIndex(
    (behavior) => readJsonObject(behavior)?.type === type,
  );
  if (index >= 0) behaviors.splice(index, 1);
  ps.behaviors = behaviors;
}

function frameRangeToPiecewiseBezier(
  startFrame: number,
  endFrame: number,
): JsonObject {
  const p0 = Math.max(0, Math.round(startFrame));
  const p3 = Math.max(0, Math.round(endFrame));
  const delta = p3 - p0;
  return {
    type: "PiecewiseBezier",
    functions: [
      {
        function: {
          p0,
          p1: p0 + delta / 3,
          p2: p0 + (delta * 2) / 3,
          p3,
        },
        start: 0,
      },
    ],
  };
}

function isLinearBezier(p0: number, p1: number, p2: number, p3: number) {
  const delta = p3 - p0;
  return (
    Math.abs(p1 - (p0 + delta / 3)) < 0.001 &&
    Math.abs(p2 - (p0 + (delta * 2) / 3)) < 0.001
  );
}
