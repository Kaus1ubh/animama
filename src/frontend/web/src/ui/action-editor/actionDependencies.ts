import type {
  PyContentDependency,
  PyExactContentSource,
} from "@/lib/content/catalogTypes";
import { getSceneFocusLinePresetIds } from "@/lib/scene-vfx/catalog";
import type { SceneVFXKind } from "@/lib/scene-vfx/types";
import { referencedAliases, type ActionDocument } from "./actionDocument";

export type ActionComponentType = PyContentDependency["content_type"];

const BUILTIN_FOCUS_SCENE_IDS = new Set<string>(getSceneFocusLinePresetIds());

/**
 * The lane a built-in Scene Effect plays in: Included content IDs name it
 * (`builtin:scene-effect:focus:<id>`), and the bundled focus presets cover IDs
 * without that segment; everything else is a background.
 */
function sceneKindForSource(source: PyExactContentSource): SceneVFXKind {
  if (source.type !== "builtin") return "background_layers";
  const contentId = source.content_id ?? "";
  const presetId = contentId.split(":").at(-1) ?? contentId;
  if (BUILTIN_FOCUS_SCENE_IDS.has(presetId)) return "focus_lines";
  return contentId.includes(":focus:") ? "focus_lines" : "background_layers";
}

export function dependencyAlias(name: string, existing: Iterable<string>) {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "component";
  const used = new Set(existing);
  if (!used.has(base)) return base;
  let suffix = 2;
  while (used.has(`${base}_${suffix}`)) suffix += 1;
  return `${base}_${suffix}`;
}

/** Add one exact typed component as a local, portable dependency. */
export function addActionDependency(
  document: ActionDocument,
  input: {
    name: string;
    contentType: ActionComponentType;
    source: PyExactContentSource;
  },
): ActionDocument {
  const alias = dependencyAlias(
    input.name,
    document.dependencies.map((value) => value.alias),
  );
  return {
    ...document,
    dependencies: [
      ...document.dependencies,
      { alias, content_type: input.contentType, source: input.source },
    ],
  };
}

/** Pin an imported local alias to one exact typed component without adding an event. */
export function mapActionDependency(
  document: ActionDocument,
  input: {
    alias: string;
    contentType: ActionComponentType;
    source: PyExactContentSource;
  },
): ActionDocument {
  return {
    ...document,
    dependencies: [
      ...document.dependencies.filter((value) => value.alias !== input.alias),
      {
        alias: input.alias,
        content_type: input.contentType,
        source: input.source,
      },
    ],
  };
}

/** Add an exact dependency and its first timeline event as one undoable value. */
export function addActionComponentEvent(
  document: ActionDocument,
  input: {
    name: string;
    contentType: ActionComponentType;
    source: PyExactContentSource;
    time?: number;
  },
): ActionDocument {
  const next = addActionDependency(document, input);
  const dependency = next.dependencies.at(-1)!;
  const eventBase = {
    id: `${dependency.alias}-${crypto.randomUUID()}`,
    time: input.time ?? 0,
  };
  const event =
    input.contentType === "sound_effect"
      ? { ...eventBase, kind: "sfx", cueId: dependency.alias, volume: 1 }
      : input.contentType === "scene_effect"
        ? {
            ...eventBase,
            kind: "scene_vfx",
            sceneKind: sceneKindForSource(input.source),
            presetId: dependency.alias,
          }
        : {
            ...eventBase,
            kind:
              input.contentType === "particle_effect"
                ? "particle_vfx"
                : "avatar_vfx",
            effectId: dependency.alias,
          };
  const currentDuration =
    typeof next.sequence.duration === "number" &&
    Number.isFinite(next.sequence.duration)
      ? Math.max(0, next.sequence.duration)
      : 0;
  // Give an endpoint effect room to play before Action cleanup, without
  // assigning the event an independent lifetime.
  const duration =
    input.contentType !== "sound_effect" &&
    eventBase.time >= currentDuration - 1e-6
      ? eventBase.time + 1
      : currentDuration;
  return {
    ...next,
    sequence: {
      ...next.sequence,
      ...(duration !== currentDuration ? { duration } : {}),
      events: [
        ...(Array.isArray(next.sequence.events) ? next.sequence.events : []),
        event,
      ],
    },
  };
}

/** Remove declarations that are no longer referenced by any timeline event. */
export function pruneUnusedDependencies(
  document: ActionDocument,
): ActionDocument {
  if (document.implementation === "vrma") {
    return { ...document, dependencies: [] };
  }
  return pruneUnusedTimelineDependencies(document);
}

/** Keep timeline dependencies synchronized with the events that reference them. */
export function pruneUnusedTimelineDependencies<
  T extends Pick<ActionDocument, "sequence" | "dependencies">,
>(value: T): T {
  const referenced = new Set(referencedAliases(value.sequence));
  return {
    ...value,
    dependencies: value.dependencies.filter((dependency) =>
      referenced.has(dependency.alias),
    ),
  };
}

/** Remove a dependency and all events that reference its local alias. */
export function removeActionDependency(
  document: ActionDocument,
  alias: string,
): ActionDocument {
  const events = Array.isArray(document.sequence.events)
    ? document.sequence.events
    : [];
  return {
    ...document,
    dependencies: document.dependencies.filter(
      (value) => value.alias !== alias,
    ),
    sequence: {
      ...document.sequence,
      events: events.filter((raw) => {
        if (!raw || typeof raw !== "object") return true;
        const event = raw as Record<string, unknown>;
        return ![event.effectId, event.presetId, event.cueId].includes(alias);
      }),
    },
  };
}
