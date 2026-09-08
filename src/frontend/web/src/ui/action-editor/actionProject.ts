import type {
  PyContentDependency,
  PyExactContentSource,
} from "@/lib/content/catalogTypes";
import {
  parseAnimaPoseClip,
  type AnimaPoseClip,
} from "@/lib/avatar/poses/animaPoseClip";
import type { ActionComponentType } from "./actionDependencies";
import {
  actionNameSlug,
  normalizeActionDocument,
  type ActionDocument,
  type ActionIntent,
} from "./actionDocument";

export const ACTION_PROJECT_SCHEMA = "animamaActionProject/1.0" as const;

export type ActionProject = {
  schema: typeof ACTION_PROJECT_SCHEMA;
  intent: ActionIntent;
  name: string;
  description: string;
  aiDescription: string;
  semanticKey: string;
  suggestedEmotion: string;
  suggestedIntensity: 1 | 2 | 3;
  notes: string;
  sequence: AnimaPoseClip;
  dependencies: PyContentDependency[];
};

export type ActionImport =
  | { kind: "clip"; sequence: AnimaPoseClip }
  | { kind: "project"; project: ActionProject };

export type UnresolvedActionReference = {
  alias: string;
  contentType: ActionComponentType;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${field} is required.`);
  }
  return value;
}

function optionalString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function parseSource(value: unknown): PyExactContentSource {
  if (!isRecord(value)) throw new Error("Dependency source is invalid.");
  if (
    value.type === "catalog" &&
    typeof value.catalog_item_id === "string" &&
    value.catalog_item_id
  ) {
    return {
      type: "catalog",
      catalog_item_id: value.catalog_item_id,
      logical_key:
        typeof value.logical_key === "string" ? value.logical_key : null,
    };
  }
  if (
    value.type === "builtin" &&
    typeof value.content_id === "string" &&
    value.content_id &&
    typeof value.version === "number" &&
    Number.isInteger(value.version) &&
    value.version > 0
  ) {
    return {
      type: "builtin",
      content_id: value.content_id,
      version: value.version,
    };
  }
  throw new Error("Dependency source must select available catalog content.");
}

const COMPONENT_TYPES = new Set<ActionComponentType>([
  "particle_effect",
  "avatar_effect",
  "scene_effect",
  "sound_effect",
]);

function parseDependencies(value: unknown): PyContentDependency[] {
  if (!Array.isArray(value)) throw new Error("Dependencies must be an array.");
  const seen = new Set<string>();
  return value.map((raw) => {
    if (!isRecord(raw)) throw new Error("Dependency declaration is invalid.");
    const alias = requiredString(raw.alias, "Dependency alias");
    if (seen.has(alias))
      throw new Error(`Dependency alias “${alias}” repeats.`);
    seen.add(alias);
    if (!COMPONENT_TYPES.has(raw.content_type as ActionComponentType)) {
      throw new Error(`Dependency “${alias}” has an unsupported type.`);
    }
    return {
      alias,
      content_type: raw.content_type as ActionComponentType,
      source: parseSource(raw.source),
      ...(isRecord(raw.config) ? { config: structuredClone(raw.config) } : {}),
    };
  });
}

/** Serialize only portable authoring state, never React, Zustand, or save state. */
export function createActionProject(document: ActionDocument): ActionProject {
  if (document.implementation !== "anima_clip") {
    throw new Error("VRMA Gestures do not have Anima Pose Clip project JSON.");
  }
  const normalized = normalizeActionDocument({
    ...document,
    name: document.name.trim(),
  });
  return {
    schema: ACTION_PROJECT_SCHEMA,
    intent: normalized.intent,
    name: normalized.name,
    description: normalized.description,
    aiDescription: normalized.aiDescription,
    semanticKey: normalized.semanticKey,
    suggestedEmotion: normalized.suggestedEmotion,
    suggestedIntensity: normalized.suggestedIntensity,
    notes: normalized.notes,
    sequence: parseAnimaPoseClip(normalized.sequence),
    dependencies: structuredClone(normalized.dependencies),
  };
}

/** Accept either a direct animaPoseClip or Animama's exact-dependency envelope. */
export function parseActionImport(
  value: unknown,
  expectedIntent: ActionIntent,
): ActionImport {
  if (!isRecord(value)) throw new Error("JSON must contain an object.");
  if (value.schema !== ACTION_PROJECT_SCHEMA) {
    return { kind: "clip", sequence: parseAnimaPoseClip(value) };
  }
  if (value.intent !== expectedIntent) {
    throw new Error(
      `This project contains a ${String(value.intent)} and cannot open in the ${expectedIntent} editor.`,
    );
  }
  const intensity = Number(value.suggestedIntensity ?? 1);
  if (![1, 2, 3].includes(intensity)) {
    throw new Error("Suggested Reaction intensity must be 1, 2, or 3.");
  }
  return {
    kind: "project",
    project: {
      schema: ACTION_PROJECT_SCHEMA,
      intent: expectedIntent,
      name: requiredString(value.name, "Project name"),
      description: optionalString(value.description),
      aiDescription: optionalString(value.aiDescription),
      semanticKey: optionalString(value.semanticKey),
      suggestedEmotion: optionalString(value.suggestedEmotion) || "joy",
      suggestedIntensity: intensity as 1 | 2 | 3,
      notes: optionalString(value.notes),
      sequence: parseAnimaPoseClip(value.sequence),
      dependencies: parseDependencies(value.dependencies),
    },
  };
}

function referenceForEvent(value: unknown): UnresolvedActionReference | null {
  if (!isRecord(value)) return null;
  if (
    value.kind === "particle_vfx" &&
    typeof value.effectId === "string" &&
    value.effectId
  ) {
    return { alias: value.effectId, contentType: "particle_effect" };
  }
  if (
    value.kind === "avatar_vfx" &&
    typeof value.effectId === "string" &&
    value.effectId
  ) {
    return { alias: value.effectId, contentType: "avatar_effect" };
  }
  if (
    value.kind === "scene_vfx" &&
    typeof value.presetId === "string" &&
    value.presetId
  ) {
    return { alias: value.presetId, contentType: "scene_effect" };
  }
  if (value.kind === "sfx" && typeof value.cueId === "string" && value.cueId) {
    return { alias: value.cueId, contentType: "sound_effect" };
  }
  return null;
}

/** Return unresolved aliases with the component family implied by each event. */
export function unresolvedActionReferences(
  sequence: Record<string, unknown>,
  dependencies: readonly PyContentDependency[],
): UnresolvedActionReference[] {
  const declared = new Set(dependencies.map((value) => value.alias));
  const unresolved = new Map<string, UnresolvedActionReference>();
  const events = Array.isArray(sequence.events) ? sequence.events : [];
  for (const event of events) {
    const reference = referenceForEvent(event);
    if (!reference || declared.has(reference.alias)) continue;
    const existing = unresolved.get(reference.alias);
    if (existing && existing.contentType !== reference.contentType) {
      throw new Error(
        `Alias “${reference.alias}” is used by more than one component type.`,
      );
    }
    unresolved.set(reference.alias, reference);
  }
  return [...unresolved.values()].sort((left, right) =>
    left.alias.localeCompare(right.alias),
  );
}

export function actionJsonFilename(
  name: string,
  kind: "clip" | "project",
): string {
  const base = actionNameSlug(name);
  return `${base}${kind === "project" ? ".project" : ""}.json`;
}
