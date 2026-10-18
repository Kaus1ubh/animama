import { createHash } from "node:crypto";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";

import { loadSoundCatalog } from "./animation-reel.mjs";
import { effectSounds } from "./content-tune-effects.mjs";
import { scanLibrary } from "./effect-render-sources.mjs";
import { SOUND_REF_PREFIX, packSoundRefs } from "./included-dependencies.mjs";

/**
 * The read model behind `pnpm -s content:tune`: the Included Gestures and
 * Reactions it tunes, the effects and sounds it offers, and each item's
 * revision. Everything here runs in Node; the page only receives these
 * summaries, clips and served file URLs.
 */

/** Audio the vendor catalog may hold, in preference order for one key. */
const CATALOG_EXTENSIONS = [".ogg", ".mp3", ".wav", ".m4a", ".flac", ".opus"];
/** Folder levels searched below the vendor catalog root. */
const MAX_CATALOG_DEPTH = 4;
/** Where each tuned kind lives under the Included content root. */
const ITEM_FOLDERS = { gesture: "gestures", reaction: "reactions" };
/** The kinds of effect a clip event plays, by their library scan kind. */
const EFFECT_SCANS = [
  { scan: "effect", kind: "avatar", contentType: "avatar_effect" },
  { scan: "particle", kind: "particle", contentType: "particle_effect" },
  { scan: "scene", kind: "scene", contentType: "scene_effect" },
];

/**
 * A vendor file's pack key, as the pack names its copies:
 * `AC_Funny_Sweat_02.ogg` → `funny_sweat_02`. Null for other files.
 */
export function vendorSoundKey(fileName) {
  const extension = path.extname(fileName).toLowerCase();
  if (!CATALOG_EXTENSIONS.includes(extension)) return null;
  const stem = path.basename(fileName, path.extname(fileName));
  const key = stem
    .replace(/^AC_/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return key || null;
}

/** A readable name for a key: `funny_sweat_02` → `Funny Sweat 02`. */
export function soundDisplayName(key) {
  return key
    .split("_")
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
}

async function audioFiles(folder, depth) {
  const entries = await readdir(folder, { withFileTypes: true }).catch(
    () => [],
  );
  const found = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const file = path.join(folder, entry.name);
    if (entry.isFile() && vendorSoundKey(entry.name)) found.push(file);
    else if (entry.isDirectory() && depth > 1)
      found.push(...(await audioFiles(file, depth - 1)));
  }
  return found;
}

/**
 * The vendor catalog under `root`: one sound per key, its category the
 * first folder below `root` (or "Other"), preferring Ogg over other audio.
 */
export async function listVendorCatalog(root) {
  if (!root) return [];
  const real = await realpath(root).catch(() => null);
  if (!real || !(await stat(real)).isDirectory()) return [];
  const byKey = new Map();
  for (const file of await audioFiles(real, MAX_CATALOG_DEPTH)) {
    const key = vendorSoundKey(path.basename(file));
    const rank = CATALOG_EXTENSIONS.indexOf(path.extname(file).toLowerCase());
    const current = byKey.get(key);
    if (current && current.rank <= rank) continue;
    const [first, ...rest] = path.relative(real, file).split(path.sep);
    byKey.set(key, {
      key,
      file,
      rank,
      category: rest.length ? first : "Other",
    });
  }
  return [...byKey.values()].map(({ rank: _rank, ...sound }) => sound);
}

/**
 * Every sound the page offers, by key: the vendor catalog's sounds and the
 * pack's (its sidecars give names, descriptions and durations). `shipped`
 * marks keys in the tracked pack manifest; `file` is the audio to preview,
 * or null when neither root holds it.
 */
export async function listTuneSounds({ catalogDir, packRoots, manifest }) {
  const shipped = packSoundRefs(manifest);
  const pack = await loadSoundCatalog(packRoots);
  const sounds = new Map();
  for (const sound of await listVendorCatalog(catalogDir))
    sounds.set(sound.key, {
      key: sound.key,
      ref: `${SOUND_REF_PREFIX}${sound.key}`,
      name: soundDisplayName(sound.key),
      description: null,
      duration: null,
      category: sound.category,
      file: sound.file,
    });
  for (const [ref, sound] of pack) {
    if (!ref.startsWith(SOUND_REF_PREFIX)) continue;
    const key = ref.slice(SOUND_REF_PREFIX.length);
    const known = sounds.get(key);
    sounds.set(key, {
      key,
      ref,
      name: sound.name,
      description: sound.description ?? known?.description ?? null,
      duration: sound.duration,
      category: known?.category ?? "Pack",
      file: known?.file ?? sound.file,
    });
  }
  for (const ref of shipped) {
    const key = ref.slice(SOUND_REF_PREFIX.length);
    if (!sounds.has(key))
      sounds.set(key, {
        key,
        ref,
        name: soundDisplayName(key),
        description: null,
        duration: null,
        category: "Pack",
        file: null,
      });
  }
  return [...sounds.values()]
    .map((sound) => ({ ...sound, shipped: shipped.has(sound.ref) }))
    .sort(
      (a, b) =>
        a.category.localeCompare(b.category) || a.key.localeCompare(b.key),
    );
}

/** The sha256 of an item's meta and clip text: its revision as loaded. */
export function itemRevision(metaText, clipText) {
  return createHash("sha256")
    .update(metaText)
    .update("\0")
    .update(clipText)
    .digest("hex");
}

/** The clip file a Gesture or Reaction meta plays, or null. */
function clipFile(metaPath, meta) {
  const implementation = meta?.implementation;
  if (implementation?.kind !== "anima_clip") return null;
  const file = (Array.isArray(meta.files) ? meta.files : []).find(
    (entry) => entry?.role === implementation.file_role,
  );
  if (typeof file?.path !== "string") return null;
  const folder = path.dirname(metaPath);
  const resolved = path.resolve(folder, file.path);
  return path.relative(folder, resolved).startsWith("..") ? null : resolved;
}

/**
 * One Included Gesture or Reaction as the page edits it: identity, ladder
 * cell, dependencies, clip and revision. Null for a VRMA Gesture; an item
 * whose meta or clip can't be read or parsed throws, naming the file.
 */
export async function loadTuneItem(kind, metaPath) {
  const readJson = async (file) => {
    const text = await readFile(file, "utf8");
    try {
      return { text, value: JSON.parse(text) };
    } catch (error) {
      throw new Error(`${file}: ${error.message}`);
    }
  };
  const { text: metaText, value: meta } = await readJson(metaPath);
  if (meta?.content_type !== kind) return null;
  const clipPath = clipFile(metaPath, meta);
  if (!clipPath) return null;
  const { text: clipText, value: clip } = await readJson(clipPath);
  return {
    kind,
    stem: path.basename(metaPath, ".meta.json"),
    contentId: meta.content_id,
    name: meta.name ?? path.basename(metaPath, ".meta.json"),
    emotion: meta.placement_hint?.emotion ?? null,
    intensity: meta.placement_hint?.intensity ?? null,
    dependencies: Array.isArray(meta.dependencies) ? meta.dependencies : [],
    clip,
    metaPath,
    clipPath,
    // The exact texts the revision covers, so a save plans from them.
    metaText,
    clipText,
    revision: itemRevision(metaText, clipText),
  };
}

/**
 * Every Included Gesture and Reaction the page can tune, by kind. An item
 * that can't be loaded is left out and named in `problems`, so one broken
 * file doesn't hide the rest.
 */
export async function listTuneItems(contentRoot) {
  const result = { gestures: [], reactions: [], problems: [] };
  for (const [kind, list] of [
    ["gesture", result.gestures],
    ["reaction", result.reactions],
  ])
    for (const metaPath of await itemMetas(contentRoot, kind)) {
      try {
        const item = await loadTuneItem(kind, metaPath);
        if (item) list.push(item);
      } catch (error) {
        result.problems.push(error.message);
      }
    }
  return result;
}

/**
 * The `<stem>/<stem>.meta.json` files of one kind's Included folder, each a
 * real file inside it (as `scanLibrary` admits them, but without parsing,
 * so one malformed file can't stop the listing).
 */
async function itemMetas(contentRoot, kind) {
  const folder = path.join(contentRoot, ITEM_FOLDERS[kind]);
  const realFolder = await realpath(folder).catch(() => null);
  if (!realFolder) return [];
  const entries = await readdir(realFolder, { withFileTypes: true });
  const metas = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    const file = path.join(realFolder, entry.name, `${entry.name}.meta.json`);
    const real = await realpath(file).catch(() => null);
    if (real && !path.relative(realFolder, real).startsWith(".."))
      metas.push(real);
  }
  return metas;
}

/**
 * Every Included Avatar, Particle and Scene Effect a clip event can play. An
 * Avatar Effect also lists its declared sounds, its default sound and its
 * file revision, so the page can change the sound it plays.
 */
export async function listTuneEffects(contentRoot) {
  const effects = [];
  for (const { scan, kind, contentType } of EFFECT_SCANS)
    for (const { stem, descriptor, descriptorPath } of await scanLibrary(
      contentRoot,
      scan,
    ))
      if (typeof descriptor.content_id === "string")
        effects.push({
          kind,
          contentType,
          contentId: descriptor.content_id,
          stem,
          name: descriptor.name ?? stem,
          // A Scene event names the layer kind it starts.
          ...(kind === "scene"
            ? { sceneKind: descriptor.definition?.kind ?? "background_layers" }
            : {}),
          ...(kind === "avatar"
            ? {
                ...effectSounds(descriptor),
                revision: itemRevision(
                  await readFile(descriptorPath, "utf8"),
                  "",
                ),
              }
            : {}),
        });
  return effects;
}

/**
 * The Included Avatar Effect `contentId` names under `contentRoot`, as the
 * writer edits it: its descriptor path, text, parsed value and revision.
 */
export async function loadTuneEffect(contentRoot, contentId) {
  const entry = (await scanLibrary(contentRoot, "effect")).find(
    ({ descriptor }) => descriptor.content_id === contentId,
  );
  if (!entry) return null;
  const text = await readFile(entry.descriptorPath, "utf8");
  return {
    contentId,
    stem: entry.stem,
    path: entry.descriptorPath,
    text,
    descriptor: JSON.parse(text),
    revision: itemRevision(text, ""),
  };
}

/** An item as the page lists it: no local file paths or raw texts. */
export function publicItem({
  metaPath: _meta,
  clipPath: _clip,
  metaText: _metaText,
  clipText: _clipText,
  ...item
}) {
  return item;
}
