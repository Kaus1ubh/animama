import { cloneJsonObject, readJsonObject } from "./json";
import {
  readFiniteNumber,
  roundEditorNumber,
  valueRangeToGenerator,
} from "./numbers";
import { findBehavior } from "./behaviors";
import type {
  JsonArray,
  JsonObject,
  ParticleVFXEditorAdvancedBehaviorsDraft,
  ParticleVFXEditorLimitSpeedOverLifeDraft,
  ParticleVFXEditorNoiseDraft,
  ParticleVFXEditorOrbitOverLifeDraft,
  ParticleVFXEditorRotation3DOverLifeDraft,
  ParticleVFXEditorTurbulenceFieldDraft,
  ParticleVFXEditorValueBehaviorDraft,
  ParticleVFXEditorValueGeneratorDraft,
} from "./types";
import type { ParticleVFXTransformAxisTriple } from "../types";

type AdvancedBehaviorPatch = Partial<ParticleVFXEditorAdvancedBehaviorsDraft>;

export const PARTICLE_VFX_ADVANCED_BEHAVIOR_TYPES = [
  "SpeedOverLife",
  "RotationOverLife",
  "Rotation3DOverLife",
  "OrbitOverLife",
  "Noise",
  "TurbulenceField",
  "LimitSpeedOverLife",
  "WidthOverLength",
] as const;

export function createConstantValueGeneratorDraft(
  value: number,
): ParticleVFXEditorValueGeneratorDraft {
  return { mode: "constant", value: roundEditorNumber(value) };
}

export function createRangeValueGeneratorDraft(
  min: number,
  max: number,
): ParticleVFXEditorValueGeneratorDraft {
  return {
    mode: "range",
    min: roundEditorNumber(Math.min(min, max)),
    max: roundEditorNumber(Math.max(min, max)),
  };
}

export function createLinearValueGeneratorDraft(
  start: number,
  end: number,
): ParticleVFXEditorValueGeneratorDraft {
  return {
    mode: "linear",
    start: roundEditorNumber(start),
    end: roundEditorNumber(end),
  };
}

export function readValueGeneratorDraft(
  value: unknown,
  fallbackValue = 0,
): ParticleVFXEditorValueGeneratorDraft {
  const object = readJsonObject(value);
  if (!object) return createConstantValueGeneratorDraft(fallbackValue);

  if (object.type === "ConstantValue") {
    const constant = readFiniteNumber(object.value);
    if (constant !== null) return createConstantValueGeneratorDraft(constant);
  }

  if (object.type === "IntervalValue") {
    const a = readFiniteNumber(object.a);
    const b = readFiniteNumber(object.b);
    if (a !== null && b !== null) return createRangeValueGeneratorDraft(a, b);
  }

  if (object.type === "PiecewiseBezier") {
    const functions = Array.isArray(object.functions) ? object.functions : [];
    const firstFunction = readJsonObject(functions[0]);
    const curve = readJsonObject(firstFunction?.function);
    const start = readFiniteNumber(firstFunction?.start);
    const p0 = readFiniteNumber(curve?.p0);
    const p1 = readFiniteNumber(curve?.p1);
    const p2 = readFiniteNumber(curve?.p2);
    const p3 = readFiniteNumber(curve?.p3);
    if (
      functions.length === 1 &&
      start === 0 &&
      p0 !== null &&
      p1 !== null &&
      p2 !== null &&
      p3 !== null &&
      isLinearBezier(p0, p1, p2, p3)
    ) {
      return createLinearValueGeneratorDraft(p0, p3);
    }
  }

  return {
    mode: "unsupported",
    raw: cloneJsonObject(object),
    label: typeof object.type === "string" ? object.type : "Unsupported",
    fallbackValue: readGeneratorFallbackValue(object, fallbackValue),
  };
}

export function valueGeneratorDraftToJson(
  draft: ParticleVFXEditorValueGeneratorDraft,
): JsonObject {
  if (draft.mode === "unsupported") return cloneJsonObject(draft.raw);
  if (draft.mode === "constant") {
    return valueRangeToGenerator({ min: draft.value, max: draft.value });
  }
  if (draft.mode === "range") {
    return valueRangeToGenerator({ min: draft.min, max: draft.max });
  }
  return linearValueGeneratorToJson(draft.start, draft.end);
}

export function cloneValueGeneratorDraft(
  draft: ParticleVFXEditorValueGeneratorDraft,
): ParticleVFXEditorValueGeneratorDraft {
  if (draft.mode === "unsupported") {
    return { ...draft, raw: cloneJsonObject(draft.raw) };
  }
  return { ...draft };
}

export function readAdvancedBehaviorsDraft(
  ps: JsonObject,
): ParticleVFXEditorAdvancedBehaviorsDraft {
  return {
    speedOverLife: readValueBehavior(ps, "SpeedOverLife", "speed", 1),
    rotationOverLife: readValueBehavior(
      ps,
      "RotationOverLife",
      "angularVelocity",
      0,
    ),
    rotation3DOverLife: readRotation3DOverLifeDraft(ps),
    orbitOverLife: readOrbitOverLifeDraft(ps),
    noise: readNoiseDraft(ps),
    turbulenceField: readTurbulenceFieldDraft(ps),
    limitSpeedOverLife: readLimitSpeedOverLifeDraft(ps),
    widthOverLength: readValueBehavior(ps, "WidthOverLength", "width", 1),
  };
}

export function createDefaultAdvancedBehaviorsDraft(): ParticleVFXEditorAdvancedBehaviorsDraft {
  return {
    speedOverLife: offValueBehavior(1),
    rotationOverLife: offValueBehavior(0),
    rotation3DOverLife: { mode: "off" },
    orbitOverLife: {
      mode: "off",
      orbitSpeed: createConstantValueGeneratorDraft(1),
      axis: axis(0, 1, 0),
    },
    noise: {
      mode: "off",
      frequency: createConstantValueGeneratorDraft(1),
      power: createConstantValueGeneratorDraft(0.1),
      positionAmount: createConstantValueGeneratorDraft(1),
      rotationAmount: createConstantValueGeneratorDraft(0),
    },
    turbulenceField: {
      mode: "off",
      scale: axis(1, 1, 1),
      octaves: 1,
      velocityMultiplier: axis(0.1, 0.1, 0.1),
      timeScale: axis(0.5, 0.5, 0.5),
    },
    limitSpeedOverLife: {
      mode: "off",
      speed: createConstantValueGeneratorDraft(1),
      dampen: 0.5,
    },
    widthOverLength: offValueBehavior(1),
  };
}

export function cloneAdvancedBehaviorsDraft(
  draft: ParticleVFXEditorAdvancedBehaviorsDraft,
): ParticleVFXEditorAdvancedBehaviorsDraft {
  return {
    speedOverLife: cloneValueBehaviorDraft(draft.speedOverLife),
    rotationOverLife: cloneValueBehaviorDraft(draft.rotationOverLife),
    rotation3DOverLife: cloneRotation3DOverLifeDraft(draft.rotation3DOverLife),
    orbitOverLife: cloneOrbitOverLifeDraft(draft.orbitOverLife),
    noise: cloneNoiseDraft(draft.noise),
    turbulenceField: cloneTurbulenceFieldDraft(draft.turbulenceField),
    limitSpeedOverLife: cloneLimitSpeedOverLifeDraft(draft.limitSpeedOverLife),
    widthOverLength: cloneValueBehaviorDraft(draft.widthOverLength),
  };
}

export function setAdvancedBehaviorsDraft(
  ps: JsonObject,
  patch: AdvancedBehaviorPatch,
): void {
  if (patch.speedOverLife) {
    setValueBehavior(ps, "SpeedOverLife", "speed", patch.speedOverLife);
  }
  if (patch.rotationOverLife) {
    setValueBehavior(
      ps,
      "RotationOverLife",
      "angularVelocity",
      patch.rotationOverLife,
    );
  }
  if (patch.rotation3DOverLife) {
    setRotation3DOverLifeDraft(ps, patch.rotation3DOverLife);
  }
  if (patch.orbitOverLife) {
    setOrbitOverLifeDraft(ps, patch.orbitOverLife);
  }
  if (patch.noise) {
    setNoiseDraft(ps, patch.noise);
  }
  if (patch.turbulenceField) {
    setTurbulenceFieldDraft(ps, patch.turbulenceField);
  }
  if (patch.limitSpeedOverLife) {
    setLimitSpeedOverLifeDraft(ps, patch.limitSpeedOverLife);
  }
  if (patch.widthOverLength) {
    setValueBehavior(ps, "WidthOverLength", "width", patch.widthOverLength);
  }
}

export function getUnsupportedAdvancedBehaviorLabels(
  draft: ParticleVFXEditorAdvancedBehaviorsDraft,
): string[] {
  const labels: string[] = [];
  collectUnsupportedValueBehavior(labels, draft.speedOverLife);
  collectUnsupportedValueBehavior(labels, draft.rotationOverLife);
  collectUnsupportedRotation3D(labels, draft.rotation3DOverLife);
  collectUnsupportedOrbit(labels, draft.orbitOverLife);
  collectUnsupportedNoise(labels, draft.noise);
  collectUnsupportedTurbulence(labels, draft.turbulenceField);
  collectUnsupportedLimitSpeed(labels, draft.limitSpeedOverLife);
  collectUnsupportedValueBehavior(labels, draft.widthOverLength);
  return labels;
}

function readValueBehavior(
  ps: JsonObject,
  type: string,
  field: string,
  fallbackValue: number,
): ParticleVFXEditorValueBehaviorDraft {
  const behavior = findBehavior(ps, type);
  if (!behavior) return offValueBehavior(fallbackValue);
  const value = readValueGeneratorDraft(behavior[field], fallbackValue);
  if (value.mode === "unsupported") {
    return {
      mode: "unsupported",
      raw: cloneJsonObject(behavior),
      label: type,
      value,
    };
  }
  return {
    mode: "enabled",
    value,
  };
}

function setValueBehavior(
  ps: JsonObject,
  type: string,
  field: string,
  draft: ParticleVFXEditorValueBehaviorDraft,
): void {
  if (draft.mode === "off") {
    removeBehavior(ps, type);
    return;
  }
  if (draft.mode === "unsupported") {
    upsertBehavior(ps, cloneJsonObject(draft.raw));
    return;
  }
  upsertBehavior(ps, {
    type,
    [field]: valueGeneratorDraftToJson(draft.value),
  });
}

function readRotation3DOverLifeDraft(
  ps: JsonObject,
): ParticleVFXEditorRotation3DOverLifeDraft {
  const behavior = findBehavior(ps, "Rotation3DOverLife");
  if (!behavior) return { mode: "off" };

  const angularVelocity = readJsonObject(behavior.angularVelocity);
  if (!angularVelocity) return unsupportedRotation3D(behavior);

  if (angularVelocity.type === "AxisAngle") {
    const axisValue = readAxisObject(angularVelocity.axis, axis(0, 1, 0));
    return {
      mode: "axis-angle",
      axis: axisValue,
      angle: readValueGeneratorDraft(angularVelocity.angle, 0),
    };
  }
  if (angularVelocity.type === "Euler") {
    return {
      mode: "euler",
      angleX: readValueGeneratorDraft(angularVelocity.angleX, 0),
      angleY: readValueGeneratorDraft(angularVelocity.angleY, 0),
      angleZ: readValueGeneratorDraft(angularVelocity.angleZ, 0),
      eulerOrder:
        typeof angularVelocity.eulerOrder === "string"
          ? angularVelocity.eulerOrder
          : "XYZ",
    };
  }
  if (angularVelocity.type === "RandomQuat") {
    return { mode: "random" };
  }
  return unsupportedRotation3D(behavior);
}

function setRotation3DOverLifeDraft(
  ps: JsonObject,
  draft: ParticleVFXEditorRotation3DOverLifeDraft,
): void {
  if (draft.mode === "off") {
    removeBehavior(ps, "Rotation3DOverLife");
    return;
  }
  if (draft.mode === "unsupported") {
    upsertBehavior(ps, cloneJsonObject(draft.raw));
    return;
  }
  if (draft.mode === "random") {
    upsertBehavior(ps, {
      type: "Rotation3DOverLife",
      angularVelocity: { type: "RandomQuat" },
    });
    return;
  }
  if (draft.mode === "axis-angle") {
    upsertBehavior(ps, {
      type: "Rotation3DOverLife",
      angularVelocity: {
        type: "AxisAngle",
        axis: axisToObject(draft.axis),
        angle: valueGeneratorDraftToJson(draft.angle),
      },
    });
    return;
  }
  upsertBehavior(ps, {
    type: "Rotation3DOverLife",
    angularVelocity: {
      type: "Euler",
      angleX: valueGeneratorDraftToJson(draft.angleX),
      angleY: valueGeneratorDraftToJson(draft.angleY),
      angleZ: valueGeneratorDraftToJson(draft.angleZ),
      eulerOrder: draft.eulerOrder || "XYZ",
    },
  });
}

function readOrbitOverLifeDraft(
  ps: JsonObject,
): ParticleVFXEditorOrbitOverLifeDraft {
  const behavior = findBehavior(ps, "OrbitOverLife");
  if (!behavior) {
    return {
      mode: "off",
      orbitSpeed: createConstantValueGeneratorDraft(1),
      axis: axis(0, 1, 0),
    };
  }
  const orbitSpeed = readValueGeneratorDraft(behavior.orbitSpeed, 1);
  const axisValue = readAxisArray(behavior.axis, axis(0, 1, 0));
  if (orbitSpeed.mode === "unsupported") {
    return {
      mode: "unsupported",
      raw: cloneJsonObject(behavior),
      label: "OrbitOverLife",
      orbitSpeed,
      axis: axisValue,
    };
  }
  return { mode: "enabled", orbitSpeed, axis: axisValue };
}

function setOrbitOverLifeDraft(
  ps: JsonObject,
  draft: ParticleVFXEditorOrbitOverLifeDraft,
): void {
  if (draft.mode === "off") {
    removeBehavior(ps, "OrbitOverLife");
    return;
  }
  if (draft.mode === "unsupported") {
    upsertBehavior(ps, cloneJsonObject(draft.raw));
    return;
  }
  upsertBehavior(ps, {
    type: "OrbitOverLife",
    orbitSpeed: valueGeneratorDraftToJson(draft.orbitSpeed),
    axis: axisToArray(draft.axis),
  });
}

function readNoiseDraft(ps: JsonObject): ParticleVFXEditorNoiseDraft {
  const defaults = createDefaultAdvancedBehaviorsDraft().noise;
  const behavior = findBehavior(ps, "Noise");
  if (!behavior) return defaults;
  const draft = {
    frequency: readValueGeneratorDraft(behavior.frequency, 1),
    power: readValueGeneratorDraft(behavior.power, 0.1),
    positionAmount: readValueGeneratorDraft(behavior.positionAmount, 1),
    rotationAmount: readValueGeneratorDraft(behavior.rotationAmount, 0),
  };
  if (
    draft.frequency.mode === "unsupported" ||
    draft.power.mode === "unsupported" ||
    draft.positionAmount.mode === "unsupported" ||
    draft.rotationAmount.mode === "unsupported"
  ) {
    return {
      mode: "unsupported",
      raw: cloneJsonObject(behavior),
      label: "Noise",
      ...draft,
    };
  }
  return { mode: "enabled", ...draft };
}

function setNoiseDraft(
  ps: JsonObject,
  draft: ParticleVFXEditorNoiseDraft,
): void {
  if (draft.mode === "off") {
    removeBehavior(ps, "Noise");
    return;
  }
  if (draft.mode === "unsupported") {
    upsertBehavior(ps, cloneJsonObject(draft.raw));
    return;
  }
  upsertBehavior(ps, {
    type: "Noise",
    frequency: valueGeneratorDraftToJson(draft.frequency),
    power: valueGeneratorDraftToJson(draft.power),
    positionAmount: valueGeneratorDraftToJson(draft.positionAmount),
    rotationAmount: valueGeneratorDraftToJson(draft.rotationAmount),
  });
}

function readTurbulenceFieldDraft(
  ps: JsonObject,
): ParticleVFXEditorTurbulenceFieldDraft {
  const defaults = createDefaultAdvancedBehaviorsDraft().turbulenceField;
  const behavior = findBehavior(ps, "TurbulenceField");
  if (!behavior) return defaults;
  const octaves = readFiniteNumber(behavior.octaves);
  return {
    mode: "enabled",
    scale: readAxisArray(behavior.scale, axis(1, 1, 1)),
    octaves: Math.max(1, Math.round(octaves ?? 1)),
    velocityMultiplier: readAxisArray(
      behavior.velocityMultiplier,
      axis(0.1, 0.1, 0.1),
    ),
    timeScale: readAxisArray(behavior.timeScale, axis(0.5, 0.5, 0.5)),
  };
}

function setTurbulenceFieldDraft(
  ps: JsonObject,
  draft: ParticleVFXEditorTurbulenceFieldDraft,
): void {
  if (draft.mode === "off") {
    removeBehavior(ps, "TurbulenceField");
    return;
  }
  if (draft.mode === "unsupported") {
    upsertBehavior(ps, cloneJsonObject(draft.raw));
    return;
  }
  upsertBehavior(ps, {
    type: "TurbulenceField",
    scale: axisToArray(draft.scale),
    octaves: Math.max(1, Math.round(draft.octaves)),
    velocityMultiplier: axisToArray(draft.velocityMultiplier),
    timeScale: axisToArray(draft.timeScale),
  });
}

function readLimitSpeedOverLifeDraft(
  ps: JsonObject,
): ParticleVFXEditorLimitSpeedOverLifeDraft {
  const behavior = findBehavior(ps, "LimitSpeedOverLife");
  if (!behavior) {
    return {
      mode: "off",
      speed: createConstantValueGeneratorDraft(1),
      dampen: 0.5,
    };
  }
  const speed = readValueGeneratorDraft(behavior.speed, 1);
  const dampen = readFiniteNumber(behavior.dampen) ?? 0.5;
  if (speed.mode === "unsupported") {
    return {
      mode: "unsupported",
      raw: cloneJsonObject(behavior),
      label: "LimitSpeedOverLife",
      speed,
      dampen,
    };
  }
  return { mode: "enabled", speed, dampen };
}

function setLimitSpeedOverLifeDraft(
  ps: JsonObject,
  draft: ParticleVFXEditorLimitSpeedOverLifeDraft,
): void {
  if (draft.mode === "off") {
    removeBehavior(ps, "LimitSpeedOverLife");
    return;
  }
  if (draft.mode === "unsupported") {
    upsertBehavior(ps, cloneJsonObject(draft.raw));
    return;
  }
  upsertBehavior(ps, {
    type: "LimitSpeedOverLife",
    speed: valueGeneratorDraftToJson(draft.speed),
    dampen: roundEditorNumber(Math.max(0, draft.dampen)),
  });
}

function cloneValueBehaviorDraft(
  draft: ParticleVFXEditorValueBehaviorDraft,
): ParticleVFXEditorValueBehaviorDraft {
  if (draft.mode === "unsupported") {
    return {
      ...draft,
      raw: cloneJsonObject(draft.raw),
      value: cloneValueGeneratorDraft(draft.value),
    };
  }
  return { ...draft, value: cloneValueGeneratorDraft(draft.value) };
}

function cloneRotation3DOverLifeDraft(
  draft: ParticleVFXEditorRotation3DOverLifeDraft,
): ParticleVFXEditorRotation3DOverLifeDraft {
  if (draft.mode === "unsupported") {
    return { ...draft, raw: cloneJsonObject(draft.raw) };
  }
  if (draft.mode === "axis-angle") {
    return {
      ...draft,
      axis: { ...draft.axis },
      angle: cloneValueGeneratorDraft(draft.angle),
    };
  }
  if (draft.mode === "euler") {
    return {
      ...draft,
      angleX: cloneValueGeneratorDraft(draft.angleX),
      angleY: cloneValueGeneratorDraft(draft.angleY),
      angleZ: cloneValueGeneratorDraft(draft.angleZ),
    };
  }
  return { ...draft };
}

function cloneOrbitOverLifeDraft(
  draft: ParticleVFXEditorOrbitOverLifeDraft,
): ParticleVFXEditorOrbitOverLifeDraft {
  if (draft.mode === "unsupported") {
    return {
      ...draft,
      raw: cloneJsonObject(draft.raw),
      orbitSpeed: cloneValueGeneratorDraft(draft.orbitSpeed),
      axis: { ...draft.axis },
    };
  }
  return {
    ...draft,
    orbitSpeed: cloneValueGeneratorDraft(draft.orbitSpeed),
    axis: { ...draft.axis },
  };
}

function cloneNoiseDraft(
  draft: ParticleVFXEditorNoiseDraft,
): ParticleVFXEditorNoiseDraft {
  const cloneFields = {
    frequency: cloneValueGeneratorDraft(draft.frequency),
    power: cloneValueGeneratorDraft(draft.power),
    positionAmount: cloneValueGeneratorDraft(draft.positionAmount),
    rotationAmount: cloneValueGeneratorDraft(draft.rotationAmount),
  };
  if (draft.mode === "unsupported") {
    return {
      mode: "unsupported",
      raw: cloneJsonObject(draft.raw),
      label: draft.label,
      ...cloneFields,
    };
  }
  return { mode: draft.mode, ...cloneFields };
}

function cloneTurbulenceFieldDraft(
  draft: ParticleVFXEditorTurbulenceFieldDraft,
): ParticleVFXEditorTurbulenceFieldDraft {
  const cloneFields = {
    scale: { ...draft.scale },
    octaves: draft.octaves,
    velocityMultiplier: { ...draft.velocityMultiplier },
    timeScale: { ...draft.timeScale },
  };
  if (draft.mode === "unsupported") {
    return {
      mode: "unsupported",
      raw: cloneJsonObject(draft.raw),
      label: draft.label,
      ...cloneFields,
    };
  }
  return { mode: draft.mode, ...cloneFields };
}

function cloneLimitSpeedOverLifeDraft(
  draft: ParticleVFXEditorLimitSpeedOverLifeDraft,
): ParticleVFXEditorLimitSpeedOverLifeDraft {
  if (draft.mode === "unsupported") {
    return {
      ...draft,
      raw: cloneJsonObject(draft.raw),
      speed: cloneValueGeneratorDraft(draft.speed),
    };
  }
  return { ...draft, speed: cloneValueGeneratorDraft(draft.speed) };
}

function offValueBehavior(
  fallbackValue: number,
): ParticleVFXEditorValueBehaviorDraft {
  return {
    mode: "off",
    value: createConstantValueGeneratorDraft(fallbackValue),
  };
}

function unsupportedRotation3D(
  behavior: JsonObject,
): ParticleVFXEditorRotation3DOverLifeDraft {
  return {
    mode: "unsupported",
    raw: cloneJsonObject(behavior),
    label: "Rotation3DOverLife",
  };
}

function upsertBehavior(ps: JsonObject, behavior: JsonObject): void {
  const behaviors = Array.isArray(ps.behaviors)
    ? (ps.behaviors as JsonArray)
    : [];
  const type = typeof behavior.type === "string" ? behavior.type : null;
  const index = behaviors.findIndex(
    (item) => readJsonObject(item)?.type === type,
  );
  if (index >= 0) {
    behaviors[index] = behavior;
  } else {
    behaviors.push(behavior);
  }
  ps.behaviors = behaviors;
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

function linearValueGeneratorToJson(start: number, end: number): JsonObject {
  const p0 = roundEditorNumber(start);
  const p3 = roundEditorNumber(end);
  const delta = p3 - p0;
  return {
    type: "PiecewiseBezier",
    functions: [
      {
        function: {
          p0,
          p1: roundEditorNumber(p0 + delta / 3),
          p2: roundEditorNumber(p0 + (delta * 2) / 3),
          p3,
        },
        start: 0,
      },
    ],
  };
}

function readGeneratorFallbackValue(
  object: JsonObject,
  fallbackValue: number,
): number {
  const value = readFiniteNumber(object.value);
  if (value !== null) return value;
  const a = readFiniteNumber(object.a);
  if (a !== null) return a;
  const functions = Array.isArray(object.functions) ? object.functions : [];
  const firstFunction = readJsonObject(functions[0]);
  const curve = readJsonObject(firstFunction?.function);
  return readFiniteNumber(curve?.p0) ?? fallbackValue;
}

function isLinearBezier(p0: number, p1: number, p2: number, p3: number) {
  const delta = p3 - p0;
  return (
    Math.abs(p1 - (p0 + delta / 3)) < 0.001 &&
    Math.abs(p2 - (p0 + (delta * 2) / 3)) < 0.001
  );
}

function axis(x: number, y: number, z: number): ParticleVFXTransformAxisTriple {
  return { x, y, z };
}

function readAxisArray(
  value: unknown,
  fallback: ParticleVFXTransformAxisTriple,
): ParticleVFXTransformAxisTriple {
  if (!Array.isArray(value)) return { ...fallback };
  return {
    x: readFiniteNumber(value[0]) ?? fallback.x,
    y: readFiniteNumber(value[1]) ?? fallback.y,
    z: readFiniteNumber(value[2]) ?? fallback.z,
  };
}

function readAxisObject(
  value: unknown,
  fallback: ParticleVFXTransformAxisTriple,
): ParticleVFXTransformAxisTriple {
  const object = readJsonObject(value);
  if (!object) return { ...fallback };
  return {
    x: readFiniteNumber(object.x) ?? fallback.x,
    y: readFiniteNumber(object.y) ?? fallback.y,
    z: readFiniteNumber(object.z) ?? fallback.z,
  };
}

function axisToArray(
  value: ParticleVFXTransformAxisTriple,
): [number, number, number] {
  return [
    roundEditorNumber(value.x),
    roundEditorNumber(value.y),
    roundEditorNumber(value.z),
  ];
}

function axisToObject(value: ParticleVFXTransformAxisTriple): JsonObject {
  return {
    x: roundEditorNumber(value.x),
    y: roundEditorNumber(value.y),
    z: roundEditorNumber(value.z),
  };
}

function collectUnsupportedValueBehavior(
  labels: string[],
  draft: ParticleVFXEditorValueBehaviorDraft,
): void {
  if (draft.mode === "unsupported") labels.push(draft.label);
  if (draft.value.mode === "unsupported") labels.push(draft.value.label);
}

function collectUnsupportedRotation3D(
  labels: string[],
  draft: ParticleVFXEditorRotation3DOverLifeDraft,
): void {
  if (draft.mode === "unsupported") labels.push(draft.label);
  if (draft.mode === "axis-angle" && draft.angle.mode === "unsupported") {
    labels.push(draft.angle.label);
  }
  if (draft.mode === "euler") {
    for (const value of [draft.angleX, draft.angleY, draft.angleZ]) {
      if (value.mode === "unsupported") labels.push(value.label);
    }
  }
}

function collectUnsupportedOrbit(
  labels: string[],
  draft: ParticleVFXEditorOrbitOverLifeDraft,
): void {
  if (draft.mode === "unsupported") labels.push(draft.label);
  if (draft.orbitSpeed.mode === "unsupported") {
    labels.push(draft.orbitSpeed.label);
  }
}

function collectUnsupportedNoise(
  labels: string[],
  draft: ParticleVFXEditorNoiseDraft,
): void {
  if (draft.mode === "unsupported") labels.push(draft.label);
  for (const value of [
    draft.frequency,
    draft.power,
    draft.positionAmount,
    draft.rotationAmount,
  ]) {
    if (value.mode === "unsupported") labels.push(value.label);
  }
}

function collectUnsupportedTurbulence(
  labels: string[],
  draft: ParticleVFXEditorTurbulenceFieldDraft,
): void {
  if (draft.mode === "unsupported") labels.push(draft.label);
}

function collectUnsupportedLimitSpeed(
  labels: string[],
  draft: ParticleVFXEditorLimitSpeedOverLifeDraft,
): void {
  if (draft.mode === "unsupported") labels.push(draft.label);
  if (draft.speed.mode === "unsupported") labels.push(draft.speed.label);
}
