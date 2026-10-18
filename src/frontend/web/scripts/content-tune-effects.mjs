import { TuneSaveError } from "./content-tune-save.mjs";

/**
 * Changing an Included Avatar Effect's own sound for `pnpm -s content:tune`:
 * the sound every Gesture and Reaction using the effect plays when it
 * applies it, unless an event mutes it or (for a merged effect) picks
 * another of its declared sounds. Pure functions over the parsed descriptor.
 */

/** The alias a newly declared default sound takes, as promoted effects use. */
const DEFAULT_SOUND_ALIAS = "on-apply";

/** An Avatar Effect descriptor's declared sounds by alias, and its default. */
export function effectSounds(descriptor) {
  const sounds = {};
  for (const edge of Array.isArray(descriptor?.dependencies)
    ? descriptor.dependencies
    : [])
    if (
      edge?.content_type === "sound_effect" &&
      typeof edge.alias === "string" &&
      typeof edge.ref === "string"
    )
      sounds[edge.alias] = edge.ref;
  const soundAlias = descriptor?.definition?.soundAlias;
  return {
    sounds,
    soundAlias:
      typeof soundAlias === "string" && Object.hasOwn(sounds, soundAlias)
        ? soundAlias
        : null,
  };
}

/**
 * The descriptor with its default sound set to `ref` (a pack sound ID), or
 * removed for `null`. The default edge keeps its alias, so events that pick
 * a sound by alias stay valid; a sound the effect already declares becomes
 * the default by alias; a silent effect gains an optional `on-apply` edge.
 * A merged effect (several sounds) can't drop its default sound, because
 * other uses may pick the rest. `packSounds` lists the offered sound IDs.
 */
export function planEffectSound(descriptor, ref, { packSounds }) {
  if (ref !== null && (typeof ref !== "string" || !packSounds.has(ref)))
    throw new TuneSaveError(
      `${String(ref)} is not a sound in the WOW Sound catalog or the pack.`,
    );
  const { sounds, soundAlias } = effectSounds(descriptor);
  const edges = Array.isArray(descriptor.dependencies)
    ? descriptor.dependencies
    : [];
  const definition = { ...descriptor.definition };
  let dependencies;
  if (ref === null) {
    if (Object.keys(sounds).length > 1)
      throw new TuneSaveError(
        `${descriptor.content_id} declares several sounds that its uses pick from; mute it in those events instead of removing its sound.`,
      );
    dependencies = edges.filter(
      (edge) => edge?.content_type !== "sound_effect",
    );
    delete definition.soundAlias;
  } else {
    const declared = Object.entries(sounds).find(([, value]) => value === ref);
    if (declared) {
      dependencies = edges;
      definition.soundAlias = declared[0];
    } else if (soundAlias) {
      dependencies = edges.map((edge) =>
        edge?.content_type === "sound_effect" && edge.alias === soundAlias
          ? { ...edge, ref, optional: true }
          : edge,
      );
    } else {
      let alias = DEFAULT_SOUND_ALIAS;
      for (let index = 2; Object.hasOwn(sounds, alias); index += 1)
        alias = `${DEFAULT_SOUND_ALIAS}-${index}`;
      dependencies = [
        ...edges,
        { ref, content_type: "sound_effect", alias, optional: true },
      ];
      definition.soundAlias = alias;
    }
  }
  // Silent effects still store an empty list, as every Included effect does.
  return { ...descriptor, definition, dependencies };
}
