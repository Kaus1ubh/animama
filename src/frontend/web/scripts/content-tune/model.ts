/*
 * The tuning page's view of the server's read model
 * (`../content-tune-model.mjs`) and the derived facts the page shows: what
 * each event plays, how a Reaction compares with the documented ladder and
 * which audio a sound cue plays.
 */

export const SOUND_REF_PREFIX = "builtin:sound-effect:";

export type TuneSound = {
  key: string;
  ref: string;
  name: string;
  description: string | null;
  duration: number | null;
  /** The vendor catalog folder, or "Pack" for a pack-only sound. */
  category: string;
  /** In the tracked pack manifest, so it ships with built-in content. */
  shipped: boolean;
  /** Its audio can be previewed. */
  available: boolean;
};

export type TuneEffect = {
  kind: "avatar" | "particle" | "scene";
  contentType: "avatar_effect" | "particle_effect" | "scene_effect";
  contentId: string;
  stem: string;
  name: string;
  /** A Scene Effect's layer kind, which its events name. */
  sceneKind?: "background_layers" | "focus_lines";
};

export type TuneDependency = {
  ref: string;
  alias: string;
  content_type: string;
  optional?: boolean;
  config?: Record<string, unknown>;
};

export type TuneEvent = {
  id: string;
  time: number;
  kind: string;
  effectId?: string;
  presetId?: string;
  cueId?: string;
  volume?: number;
  duration?: number;
  playAccompanyingSound?: boolean;
  override?: { soundAlias?: string } & Record<string, unknown>;
} & Record<string, unknown>;

export type TuneClip = {
  id: string;
  duration: number;
  events?: TuneEvent[];
  expressions?: Record<string, { v: number; beat?: string; t?: number }[]>;
} & Record<string, unknown>;

export type TuneItem = {
  kind: "gesture" | "reaction";
  stem: string;
  contentId: string;
  name: string;
  emotion: string | null;
  intensity: number | null;
  dependencies: TuneDependency[];
  clip: TuneClip;
  revision: string;
};

export type TuneState = {
  avatar: { id: string; url: string };
  gestures: TuneItem[];
  reactions: TuneItem[];
  effects: TuneEffect[];
  sounds: TuneSound[];
  /** The vendor catalog is listed, not just the pack. */
  catalog: boolean;
  /** Items that couldn't be loaded, each naming its file. */
  problems: string[];
  /** Identifies the checkout's content (keys the applied drafts). */
  checkout: string;
};

/** The clip alias an event plays, and the kind of content it names. */
export function eventTarget(
  event: TuneEvent,
): { alias: string; contentType: string } | null {
  if (event.kind === "sfx" && typeof event.cueId === "string")
    return { alias: event.cueId, contentType: "sound_effect" };
  if (event.kind === "scene_vfx" && typeof event.presetId === "string")
    return { alias: event.presetId, contentType: "scene_effect" };
  if (event.kind === "avatar_vfx" && typeof event.effectId === "string")
    return { alias: event.effectId, contentType: "avatar_effect" };
  if (event.kind === "particle_vfx" && typeof event.effectId === "string")
    return { alias: event.effectId, contentType: "particle_effect" };
  return null;
}

/** Display kinds of the events the page lists. */
export const EVENT_KIND_LABELS: Record<string, string> = {
  avatar_vfx: "Avatar Effect",
  particle_vfx: "Particle Effect",
  scene_vfx: "Scene Effect",
  sfx: "Sound",
};

/** Lookup tables over the state, built once per load. */
export class TuneIndex {
  readonly effects: Map<string, TuneEffect>;
  readonly sounds: Map<string, TuneSound>;

  constructor(state: Pick<TuneState, "effects" | "sounds">) {
    this.effects = new Map(
      state.effects.map((effect) => [effect.contentId, effect]),
    );
    this.sounds = new Map(state.sounds.map((sound) => [sound.ref, sound]));
  }

  /** The dependency an event's alias names in `item`, or null. */
  dependency(item: TuneItem, event: TuneEvent): TuneDependency | null {
    const target = eventTarget(event);
    if (!target) return null;
    return (
      item.dependencies.find(
        (dependency) =>
          dependency.alias === target.alias &&
          dependency.content_type === target.contentType,
      ) ?? null
    );
  }

  /** A readable name for what an event plays. */
  targetName(item: TuneItem, event: TuneEvent): string {
    const dependency = this.dependency(item, event);
    if (!dependency) return `${eventTarget(event)?.alias ?? "?"} (undeclared)`;
    if (dependency.content_type === "sound_effect")
      return this.sounds.get(dependency.ref)?.name ?? dependency.ref;
    return this.effects.get(dependency.ref)?.name ?? dependency.ref;
  }

  /**
   * The audio URL a played cue resolves to: a sound event's alias names a
   * sound dependency; an effect's own sound cue is the sound's content ID.
   */
  soundUrl(item: TuneItem, cueId: string): string | null {
    const dependency = item.dependencies.find(
      (entry) => entry.alias === cueId && entry.content_type === "sound_effect",
    );
    const sound = this.sounds.get(dependency?.ref ?? cueId);
    return sound?.available
      ? `/__tune/sound/${encodeURIComponent(sound.key)}`
      : null;
  }
}

/** How many events of each effect kind an item plays. */
export function eventCounts(item: TuneItem): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const event of item.clip.events ?? [])
    counts[event.kind] = (counts[event.kind] ?? 0) + 1;
  return counts;
}

/** An expression's peak weight in a Reaction: its largest keyframe value. */
export function peakExpressions(item: TuneItem): [string, number][] {
  return Object.entries(item.clip.expressions ?? {})
    .map(([name, frames]): [string, number] => [
      name,
      Math.max(0, ...frames.map((frame) => frame.v)),
    ])
    .sort((a, b) => b[1] - a[1]);
}

/**
 * Where a Reaction differs from the documented ladder (reaction-pools spec
 * R2): intensity 1 is an expression, with at most one subtle Avatar Effect;
 * 2 adds one or two Avatar Effects; 3 adds a Particle Effect; 4 adds a Scene
 * Effect. The ladder is guidance, so these are notes, not errors.
 */
export function ladderNotes(item: TuneItem): string[] {
  if (item.kind !== "reaction" || !item.intensity) return [];
  const counts = eventCounts(item);
  const avatar = counts.avatar_vfx ?? 0;
  const particle = counts.particle_vfx ?? 0;
  const scene = counts.scene_vfx ?? 0;
  const notes: string[] = [];
  if (item.intensity === 1 && (avatar > 1 || particle + scene > 0))
    notes.push("more than an expression and one subtle Avatar Effect");
  if (item.intensity === 2 && avatar > 2) notes.push("over two Avatar Effects");
  if (item.intensity >= 2 && avatar === 0) notes.push("no Avatar Effect");
  if (item.intensity >= 3 && particle === 0) notes.push("no Particle Effect");
  if (item.intensity === 4 && scene === 0) notes.push("no Scene Effect");
  return notes;
}

/** Sounds grouped by category, each group sorted by key. */
export function soundGroups(sounds: TuneSound[]): [string, TuneSound[]][] {
  const groups = new Map<string, TuneSound[]>();
  for (const sound of sounds) {
    const list = groups.get(sound.category) ?? [];
    list.push(sound);
    groups.set(sound.category, list);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
}
