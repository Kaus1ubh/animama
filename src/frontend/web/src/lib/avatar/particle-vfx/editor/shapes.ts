import { FULL_CIRCLE_RADIANS } from "./constants";
import { readJsonObject } from "./json";
import {
  generatorToValueRange,
  readFiniteNumber,
  roundEditorNumber,
  valueRangeToGenerator,
} from "./numbers";
import type { JsonObject, ParticleVFXEditorShapeDraft } from "./types";

export function readShapeDraft(value: unknown): ParticleVFXEditorShapeDraft {
  const shape = readJsonObject(value);
  const type =
    shape?.type === "point" ||
    shape?.type === "sphere" ||
    shape?.type === "cone" ||
    shape?.type === "rectangle"
      ? shape.type
      : "unsupported";
  return {
    type,
    radius: readFiniteNumber(shape?.radius) ?? 0.12,
    width: readFiniteNumber(shape?.width) ?? 1,
    height: readFiniteNumber(shape?.height) ?? 1,
    arc: readFiniteNumber(shape?.arc) ?? FULL_CIRCLE_RADIANS,
    thickness: readFiniteNumber(shape?.thickness) ?? 1,
    angle: readFiniteNumber(shape?.angle) ?? 0.35,
    mode: readEmitterMode(shape?.mode),
    spread: readFiniteNumber(shape?.spread) ?? 0,
    speed: generatorToValueRange(shape?.speed) ?? { min: 1, max: 1 },
  };
}

export function shapeToJson(shape: ParticleVFXEditorShapeDraft): JsonObject {
  if (shape.type === "point") return { type: "point" };
  if (shape.type === "cone") {
    return {
      type: "cone",
      radius: roundEditorNumber(Math.max(0, shape.radius)),
      arc: roundEditorNumber(Math.max(0, shape.arc)),
      thickness: roundEditorNumber(Math.max(0, shape.thickness)),
      angle: roundEditorNumber(Math.max(0, shape.angle)),
      mode: readEmitterMode(shape.mode),
      spread: roundEditorNumber(shape.spread),
      speed: valueRangeToGenerator(shape.speed),
    };
  }
  if (shape.type === "rectangle") {
    return {
      type: "rectangle",
      width: roundEditorNumber(Math.max(0, shape.width)),
      height: roundEditorNumber(Math.max(0, shape.height)),
      thickness: roundEditorNumber(Math.max(0, shape.thickness)),
      mode: readEmitterMode(shape.mode),
      spread: roundEditorNumber(shape.spread),
      speed: valueRangeToGenerator(shape.speed),
    };
  }
  return {
    type: "sphere",
    radius: roundEditorNumber(Math.max(0, shape.radius)),
    arc: roundEditorNumber(Math.max(0, shape.arc)),
    thickness: roundEditorNumber(Math.max(0, shape.thickness)),
    mode: readEmitterMode(shape.mode),
    spread: roundEditorNumber(shape.spread),
    speed: valueRangeToGenerator(shape.speed),
  };
}

function readEmitterMode(value: unknown): 0 | 1 | 2 | 3 {
  return value === 1 || value === 2 || value === 3 ? value : 0;
}
