import path from "node:path";

/**
 * The Included content a Reaction or Gesture may depend on, shared by
 * `pnpm -s effects promote` and `pnpm -s animation promote`. It imports
 * nothing beyond `node:path`, so either tool loads it without the render
 * stack.
 */

/** The alias field and dependency type of each event that plays content. */
const EVENT_DEPENDENCIES = {
  avatar_vfx: ["effectId", "avatar_effect"],
  particle_vfx: ["effectId", "particle_effect"],
  scene_vfx: ["presetId", "scene_effect"],
  sfx: ["cueId", "sound_effect"],
};

/**
 * Every Included descriptor under `<root>/content/included` (a JSON file
 * with a `content_id` or `dependencies`, not a review sidecar) as
 * `{ path, value }`, `path` relative to `root`. `fs` supplies
 * `readFileSync` and `readdirSync` (with `withFileTypes`).
 */
export function listIncludedMetas(root, { readFileSync, readdirSync }) {
  const metas = [];
  const walk = (relative) => {
    for (const entry of readdirSync(path.join(root, relative), {
      withFileTypes: true,
    })) {
      const child = `${relative}/${entry.name}`;
      if (entry.isDirectory()) walk(child);
      else if (
        entry.name.endsWith(".json") &&
        !entry.name.endsWith(".review.json")
      ) {
        try {
          const value = JSON.parse(
            readFileSync(path.join(root, child), "utf8"),
          );
          if (
            typeof value?.content_id === "string" ||
            Array.isArray(value?.dependencies)
          )
            metas.push({ path: child, value });
        } catch {
          // Not a descriptor.
        }
      }
    }
  };
  walk("content/included");
  return metas;
}

/** The tracked manifest of the private comedy sound pack, from the repo root. */
export const PACK_SOUND_MANIFEST =
  "src/backend/animama/resources/wow-comedy-sfx-manifest.json";

/**
 * The content IDs (`builtin:sound-effect:<key>`) of the sounds in the private
 * comedy pack, from its parsed tracked manifest.
 */
export function packSoundRefs(manifest) {
  return new Set(
    (Array.isArray(manifest?.files) ? manifest.files : [])
      .map((file) => file?.path)
      .filter((file) => typeof file === "string" && file.endsWith(".ogg"))
      .map(
        (file) => `builtin:sound-effect:${path.posix.basename(file, ".ogg")}`,
      ),
  );
}

/** The content type of each Included content ID, from Included descriptors. */
export function includedContentTypes(metas) {
  return new Map(
    metas
      .filter(({ value }) => typeof value.content_id === "string")
      .map(({ value }) => [value.content_id, value.content_type]),
  );
}

/**
 * Check a Reaction's or Gesture's dependencies against its clip's events and
 * return them as an Included meta stores them. Each dependency needs an
 * `alias`, a `ref` and a `content_type` (`config`, when given, is an
 * object); aliases are unique; each `ref`, re-pointed through
 * `promotedRefs` (a Local effect's ID → its Included ID in this run), must
 * be Included content of that type (`includedTypes`, after the run) or a
 * sound in the private comedy pack (`packSounds`, from `packSoundRefs`),
 * which is written as an optional edge so builds without the pack play the
 * item silently (ADR 0022); and every event that plays content must name a
 * declared alias of its type.
 * `missing` tells the reader how to fix a ref that is not Included. Throws
 * an `Error` naming the problem; callers add the item.
 */
export function includedActionDependencies(
  dependencies,
  events,
  {
    includedTypes,
    promotedRefs = new Map(),
    packSounds = new Set(),
    missing = "promote it in the same run",
  },
) {
  const result = [];
  const declared = new Map();
  for (const dependency of Array.isArray(dependencies) ? dependencies : []) {
    const { alias, ref, content_type: contentType, config } = dependency ?? {};
    if (
      typeof alias !== "string" ||
      typeof ref !== "string" ||
      typeof contentType !== "string"
    )
      throw new Error(
        'each dependency needs "alias", "ref" and "content_type".',
      );
    if (
      config !== undefined &&
      (config === null || typeof config !== "object" || Array.isArray(config))
    )
      throw new Error(
        `dependency "${alias}" has a "config" that is not an object.`,
      );
    if (declared.has(alias))
      throw new Error(`dependency alias "${alias}" repeats.`);
    const included = promotedRefs.get(ref) ?? ref;
    // A pack sound stays optional even where a loose copy sits in the tree.
    const packSound = packSounds.has(included);
    if (!packSound && !includedTypes.has(included))
      throw new Error(
        `dependency "${alias}" (${ref}) is not Included content after this promotion; ${missing}.`,
      );
    const actualType = packSound ? "sound_effect" : includedTypes.get(included);
    if (actualType !== contentType)
      throw new Error(
        `dependency "${alias}" is declared as a ${contentType}, but ${included} is a ${actualType}.`,
      );
    declared.set(alias, contentType);
    result.push({
      ref: included,
      alias,
      content_type: contentType,
      config: config ?? {},
      ...(packSound ? { optional: true } : {}),
    });
  }
  for (const event of Array.isArray(events) ? events : []) {
    const [field, contentType] = EVENT_DEPENDENCIES[event?.kind] ?? [];
    if (field && declared.get(event[field]) !== contentType)
      throw new Error(
        `event "${event.id}" plays "${event[field]}", which no dependency declares as a ${contentType.replace("_", " ")}.`,
      );
  }
  return result;
}
