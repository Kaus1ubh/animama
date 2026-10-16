import type {
  TuneClip,
  TuneDependency,
  TuneEffect,
  TuneEvent,
  TuneItem,
  TuneSound,
} from "./model.ts";

/*
 * The tuning page's edits to one Gesture or Reaction, as pure functions over
 * a draft: its events, its expressions (Reactions) and the dependencies the
 * events name. Saving sends the draft; the server rebuilds the dependency
 * list from the events, so edges an edit leaves unused simply drop.
 */

export type TuneDraft = {
  events: TuneEvent[];
  expressions: NonNullable<TuneClip["expressions"]>;
  dependencies: TuneDependency[];
};

/** What an added or retargeted event plays: an effect or a sound. */
export type TuneTarget =
  | { type: "effect"; effect: TuneEffect }
  | { type: "sound"; sound: TuneSound };

/** Default seconds a newly added Particle Effect plays, as Reactions use. */
export const PARTICLE_DURATION_SEC = 2;

const EVENT_KINDS = {
  avatar: "avatar_vfx",
  particle: "particle_vfx",
  scene: "scene_vfx",
} as const;

export function draftOf(item: TuneItem): TuneDraft {
  return structuredClone({
    events: item.clip.events ?? [],
    expressions: item.clip.expressions ?? {},
    dependencies: item.dependencies,
  });
}

/** Whether the draft differs from the item as loaded. */
export function isDirty(item: TuneItem, draft: TuneDraft): boolean {
  return JSON.stringify(draftOf(item)) !== JSON.stringify(draft);
}

function targetRef(target: TuneTarget): {
  ref: string;
  contentType: string;
  base: string;
} {
  return target.type === "sound"
    ? {
        ref: target.sound.ref,
        contentType: "sound_effect",
        base: target.sound.key,
      }
    : {
        ref: target.effect.contentId,
        contentType: target.effect.contentType,
        base: target.effect.stem,
      };
}

/** A clip alias not yet declared: `base`, else `base-2`, `base-3`… */
export function uniqueAlias(
  dependencies: TuneDependency[],
  base: string,
): string {
  const taken = new Set(dependencies.map((dependency) => dependency.alias));
  if (!taken.has(base)) return base;
  let index = 2;
  while (taken.has(`${base}-${index}`)) index += 1;
  return `${base}-${index}`;
}

/** The alias naming `target` in the draft, declaring it first when needed. */
function declare(
  draft: TuneDraft,
  target: TuneTarget,
): { dependencies: TuneDependency[]; alias: string } {
  const { ref, contentType, base } = targetRef(target);
  const existing = draft.dependencies.find(
    (dependency) =>
      dependency.ref === ref && dependency.content_type === contentType,
  );
  if (existing)
    return { dependencies: draft.dependencies, alias: existing.alias };
  const alias = uniqueAlias(draft.dependencies, base);
  return {
    dependencies: [
      ...draft.dependencies,
      { ref, alias, content_type: contentType, config: {} },
    ],
    alias,
  };
}

/** The event fields that name `target` by `alias`, for its event kind. */
function eventFields(
  target: TuneTarget,
  alias: string,
): Pick<TuneEvent, "kind"> & Partial<TuneEvent> {
  if (target.type === "sound") return { kind: "sfx", cueId: alias };
  const kind = EVENT_KINDS[target.effect.kind];
  if (kind === "scene_vfx")
    return {
      kind,
      presetId: alias,
      sceneKind: target.effect.sceneKind ?? "background_layers",
    };
  return { kind, effectId: alias };
}

/** An event id not yet in the draft, from `base`. */
function uniqueEventId(events: TuneEvent[], base: string): string {
  const taken = new Set(events.map((event) => event.id));
  if (!taken.has(base)) return base;
  let index = 2;
  while (taken.has(`${base}-${index}`)) index += 1;
  return `${base}-${index}`;
}

/** Add an event at `time` that plays `target`. */
export function addEvent(
  draft: TuneDraft,
  target: TuneTarget,
  time: number,
): TuneDraft {
  const { dependencies, alias } = declare(draft, target);
  const fields = eventFields(target, alias);
  const event: TuneEvent = {
    id: uniqueEventId(draft.events, alias),
    time: roundTime(time),
    ...fields,
    ...(fields.kind === "particle_vfx"
      ? { duration: PARTICLE_DURATION_SEC }
      : {}),
  } as TuneEvent;
  return { ...draft, dependencies, events: [...draft.events, event] };
}

/**
 * Make an event play `target` instead, keeping its id and time. Within one
 * kind the event keeps its own settings (duration, fades, volume, a muted
 * sound, a Particle Effect's anchor and transform) and drops only its
 * `override`, which belongs to the old effect. A target of another kind
 * starts that kind's event afresh.
 */
export function replaceTarget(
  draft: TuneDraft,
  eventId: string,
  target: TuneTarget,
): TuneDraft {
  const { dependencies, alias } = declare(draft, target);
  const fields = eventFields(target, alias);
  return {
    ...draft,
    dependencies,
    events: draft.events.map((event) => {
      if (event.id !== eventId) return event;
      if (fields.kind === event.kind) {
        const kept: TuneEvent = { ...event, ...fields };
        delete kept.override;
        return kept;
      }
      return {
        id: event.id,
        time: event.time,
        ...fields,
        ...(fields.kind === "particle_vfx"
          ? { duration: PARTICLE_DURATION_SEC }
          : {}),
      } as TuneEvent;
    }),
  };
}

/** Change an event's own settings: time, duration, volume, muted or override. */
export function updateEvent(
  draft: TuneDraft,
  eventId: string,
  patch: Partial<
    Pick<
      TuneEvent,
      "time" | "duration" | "volume" | "playAccompanyingSound" | "override"
    >
  >,
): TuneDraft {
  return {
    ...draft,
    events: draft.events.map((event) => {
      if (event.id !== eventId) return event;
      const next: TuneEvent = { ...event, ...patch };
      if (patch.time !== undefined) next.time = roundTime(patch.time);
      // Unset values are left out, as the clip format stores defaults.
      for (const key of Object.keys(patch) as (keyof typeof patch)[])
        if (patch[key] === undefined || patch[key] === null) delete next[key];
      if (next.playAccompanyingSound === true)
        delete next.playAccompanyingSound;
      return next;
    }),
  };
}

export function removeEvent(draft: TuneDraft, eventId: string): TuneDraft {
  return {
    ...draft,
    events: draft.events.filter((event) => event.id !== eventId),
  };
}

/**
 * Set a Reaction expression's peak weight. The expression keeps its shape:
 * every key of `base` (the expression as loaded, or else as currently
 * drafted) scales so its largest becomes `value`. Scaling always starts
 * from that shape, so a peak taken to 0 and back restores the curve. A new
 * expression gets one key at `beat`.
 */
export function setExpressionPeak(
  draft: TuneDraft,
  name: string,
  value: number,
  beat: string,
  base?: { v: number; beat?: string; t?: number }[],
): TuneDraft {
  const weight = Math.min(1, Math.max(0, value));
  const peakOf = (frames: { v: number }[] | undefined) =>
    frames?.length ? Math.max(0, ...frames.map((frame) => frame.v)) : 0;
  const current = draft.expressions[name];
  const shape =
    peakOf(base) > 0 ? base! : peakOf(current) > 0 ? current! : null;
  const round = (v: number) => Math.round(v * 1000) / 1000;
  const next = shape
    ? shape.map((frame) => ({
        ...frame,
        v: round((frame.v / peakOf(shape)) * weight),
      }))
    : current?.length === 1
      ? [{ ...current[0], v: round(weight) }]
      : [{ v: round(weight), beat }];
  return { ...draft, expressions: { ...draft.expressions, [name]: next } };
}

export function removeExpression(draft: TuneDraft, name: string): TuneDraft {
  const expressions = { ...draft.expressions };
  delete expressions[name];
  return { ...draft, expressions };
}

/** The page's save request for an item and its draft. */
export function saveRequest(item: TuneItem, draft: TuneDraft) {
  return {
    kind: item.kind,
    stem: item.stem,
    revision: item.revision,
    events: draft.events,
    ...(item.kind === "reaction" ? { expressions: draft.expressions } : {}),
    dependencies: draft.dependencies,
  };
}

function roundTime(time: number): number {
  return Math.max(0, Math.round(time * 100) / 100);
}
