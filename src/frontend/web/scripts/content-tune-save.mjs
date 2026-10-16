import { includedActionDependencies } from "./included-dependencies.mjs";

/**
 * Saving for `pnpm -s content:tune`: turn the page's edits of one Included
 * Gesture or Reaction into the clip and meta files it writes, after the
 * checks the Included-content tests would otherwise fail on later. Pure
 * functions over parsed values; the server reads and writes the files.
 */

export const STARTER_IDLE_POOL =
  "src/backend/animama/resources/starter-idle-pool.v1.json";
/** Audible events in one clip start at least this far apart (seconds). */
export const AUDIBLE_SPACING_SEC = 0.3;
/** The event field naming the dependency alias each kind plays. */
const EVENT_ALIAS_FIELDS = {
  avatar_vfx: "effectId",
  particle_vfx: "effectId",
  scene_vfx: "presetId",
  sfx: "cueId",
};

export class TuneSaveError extends Error {}

/** Every Gesture key the starter Idle pool seed names (its idle members). */
export function starterIdleKeys(seed) {
  const cells = Object.values(seed?.cells ?? {}).flatMap((levels) =>
    Object.values(levels).flat(),
  );
  return new Set([...(seed?.default ?? []), ...cells]);
}

/** Whether an event plays a sound: an `sfx` event or an unmuted Avatar Effect. */
function audible(event) {
  return (
    event?.kind === "sfx" ||
    (event?.kind === "avatar_vfx" && event.playAccompanyingSound !== false)
  );
}

/**
 * Problems the Included-content tests would report for a clip's events:
 * audible events closer than 0.3 s, and any sound on a starter idle Gesture
 * (idles play while the Anima is quiet).
 */
export function eventIssues(events, { idle = false } = {}) {
  const issues = [];
  const times = events
    .filter(audible)
    .map((event) => Number(event.time) || 0)
    .sort((a, b) => a - b);
  for (let index = 1; index < times.length; index += 1) {
    const [earlier, later] = [times[index - 1], times[index]];
    if (later - earlier < AUDIBLE_SPACING_SEC - 1e-9)
      issues.push(
        `sounds at ${earlier.toFixed(2)} s and ${later.toFixed(2)} s are under ${AUDIBLE_SPACING_SEC} s apart; mute one effect or move a sound.`,
      );
  }
  if (idle)
    for (const event of events) {
      if (event?.kind === "sfx")
        issues.push(
          `starter idle Gestures play no sound events ("${event.id}").`,
        );
      else if (
        event?.kind === "avatar_vfx" &&
        event.playAccompanyingSound !== false
      )
        issues.push(
          `starter idle Gestures mute their effects' sounds ("${event.id}").`,
        );
    }
  return issues;
}

/** The dependencies the events play, in their declared order: unused edges drop. */
function usedDependencies(dependencies, events) {
  const used = new Set(
    events
      .map((event) => event?.[EVENT_ALIAS_FIELDS[event?.kind]])
      .filter((alias) => typeof alias === "string"),
  );
  return dependencies.filter((dependency) => used.has(dependency?.alias));
}

/**
 * Plan one save. `current` is the item as loaded from disk now
 * (`{ kind, contentId, meta, clip, revision }`); `edit` is the page's request
 * (`{ revision, events, expressions?, dependencies }`). Returns
 * `{ clip, meta, pendingSounds }`: the new clip (identity, playback, tracks
 * and timing kept; only `events` and, for a Reaction, `expressions` change),
 * the new meta (only `dependencies` change) and the pack sound IDs it uses
 * that the tracked manifest lacks.
 *
 * `packSounds` lists every sound ID the page offers (the catalog and the
 * pack); `shipped` the IDs in the tracked manifest; `includedTypes` the
 * Included content types by ID; `idleKeys` the starter idle Gestures.
 */
export function planTuneSave(
  current,
  edit,
  { includedTypes, packSounds, shipped, idleKeys },
) {
  if (edit?.revision !== current.revision)
    throw new TuneSaveError(
      `${current.contentId} changed on disk since it was loaded; reload it and redo the edit.`,
    );
  if (!Array.isArray(edit.events))
    throw new TuneSaveError("events must be a list.");
  if (!Array.isArray(edit.dependencies))
    throw new TuneSaveError("dependencies must be a list.");
  const events = [...edit.events].sort((a, b) => a.time - b.time);
  let dependencies;
  try {
    dependencies = includedActionDependencies(
      usedDependencies(edit.dependencies, events),
      events,
      {
        includedTypes,
        packSounds,
        missing: "pick an Included effect or a catalog sound",
      },
    );
  } catch (error) {
    throw new TuneSaveError(error.message);
  }
  const issues = eventIssues(events, { idle: idleKeys.has(current.contentId) });
  if (issues.length) throw new TuneSaveError(issues.join("\n"));

  const clip = { ...current.clip, events };
  // A clip that stored no event list keeps storing none.
  if (!events.length && !Object.hasOwn(current.clip, "events"))
    delete clip.events;
  if (current.kind === "reaction" && edit.expressions !== undefined) {
    if (
      edit.expressions === null ||
      typeof edit.expressions !== "object" ||
      Array.isArray(edit.expressions)
    )
      throw new TuneSaveError("expressions must be an object.");
    clip.expressions = edit.expressions;
  }
  return {
    clip,
    meta: { ...current.meta, dependencies },
    pendingSounds: dependencies
      .filter(
        (dependency) =>
          dependency.content_type === "sound_effect" &&
          !shipped.has(dependency.ref),
      )
      .map((dependency) => dependency.ref),
  };
}

/**
 * The pack changes Included content needs: sounds it plays that the tracked
 * manifest lacks (`additions`) and shipped sounds nothing plays any more
 * (`removals`). The pack ships exactly the sounds built-in content uses.
 * `metas` are every Included descriptor's parsed value.
 */
export function packChanges(metas, shipped) {
  const used = new Set();
  for (const meta of metas)
    for (const dependency of Array.isArray(meta?.dependencies)
      ? meta.dependencies
      : [])
      if (
        dependency?.content_type === "sound_effect" &&
        typeof dependency.ref === "string" &&
        dependency.ref.startsWith("builtin:sound-effect:")
      )
        used.add(dependency.ref);
  return {
    additions: [...used].filter((ref) => !shipped.has(ref)).sort(),
    removals: [...shipped].filter((ref) => !used.has(ref)).sort(),
  };
}
