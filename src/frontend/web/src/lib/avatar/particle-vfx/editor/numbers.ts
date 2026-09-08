import { readJsonObject } from "./json";
import type { JsonObject, ParticleVFXEditorValueRange } from "./types";

export function readFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function cloneValueRange(
  value: ParticleVFXEditorValueRange | null,
): ParticleVFXEditorValueRange | null {
  return value ? { ...value } : null;
}

export function roundEditorNumber(value: number): number {
  return Number.parseFloat(value.toFixed(4));
}

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
}

export function generatorToValueRange(
  value: unknown,
): ParticleVFXEditorValueRange | null {
  const object = readJsonObject(value);
  if (!object) return null;
  if (object.type === "ConstantValue") {
    const constant = readFiniteNumber(object.value);
    return constant === null ? null : { min: constant, max: constant };
  }
  if (object.type === "IntervalValue") {
    const a = readFiniteNumber(object.a);
    const b = readFiniteNumber(object.b);
    if (a === null || b === null) return null;
    return { min: Math.min(a, b), max: Math.max(a, b) };
  }
  return null;
}

export function valueRangeToGenerator(
  range: ParticleVFXEditorValueRange,
): JsonObject {
  const min = roundEditorNumber(range.min);
  const max = roundEditorNumber(range.max);
  if (min === max) {
    return { type: "ConstantValue", value: min };
  }
  return {
    type: "IntervalValue",
    a: Math.min(min, max),
    b: Math.max(min, max),
  };
}
