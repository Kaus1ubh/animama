import type { JsonArray, JsonObject } from "./types";

export function ensureJsonObjectProperty(
  object: JsonObject,
  key: string,
): JsonObject {
  const current = readJsonObject(object[key]);
  if (current) return current;
  const next: JsonObject = {};
  object[key] = next;
  return next;
}

export function ensureJsonArrayProperty(
  object: JsonObject,
  key: string,
): JsonArray {
  const current = Array.isArray(object[key]) ? (object[key] as JsonArray) : [];
  object[key] = current;
  return current;
}

export function ensureJsonObject(value: unknown): JsonObject {
  return readJsonObject(value) ?? {};
}

export function readJsonObject(value: unknown): JsonObject | null {
  return isJsonObject(value) ? value : null;
}

export function isJsonObject(value: unknown): value is JsonObject {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function cloneJsonObject(value: JsonObject): JsonObject {
  return JSON.parse(JSON.stringify(value)) as JsonObject;
}

export function readJsonArrayObjects(value: unknown): JsonObject[] {
  return Array.isArray(value)
    ? value.flatMap((item) => {
        const object = readJsonObject(item);
        return object ? [object] : [];
      })
    : [];
}

export function identityMatrix(): number[] {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

export function makeGroupUuid(effectId: string): string {
  return `animama-${makeSafeId(effectId)}-group`;
}

export function makeEmitterUuid(effectId: string, index: number): string {
  return `animama-${makeSafeId(effectId)}-emitter-${index}`;
}

export function makeSafeId(value: string): string {
  const safe = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return safe || "particle-vfx";
}
