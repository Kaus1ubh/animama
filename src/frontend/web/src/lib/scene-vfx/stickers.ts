import rawManifest from "../../../../../../content/included/resources/scene-vfx/stickers/stickers.json";

/**
 * Animama's built-in Scene stickers: Included PNGs under
 * `content/included/resources/scene-vfx/stickers/`, listed in `stickers.json`.
 * The Scene creator's sticker picker offers them; choosing one copies its PNG
 * into the effect as its own image, so a saved effect and its Portable
 * package carry the bytes and need no app resource.
 *
 * The PNGs are bundled as build assets, so the picker works the same in
 * development, a built app and the packaged desktop app.
 */

export const SCENE_STICKER_MANIFEST_SCHEMA = "animama/scene-stickers/1";

export type SceneSticker = {
  id: string;
  label: string;
  /** The family the picker groups it under, for example "Affection". */
  family: string;
  /** Its PNG in the sticker folder. */
  file: string;
  /** Where the page loads it. */
  url: string;
};

export type SceneStickerFamily = {
  family: string;
  stickers: SceneSticker[];
};

const STICKER_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const STICKER_FILE = /^[a-z0-9][a-z0-9-]{0,63}\.png$/;

function invalid(message: string): Error {
  return new Error(`Sticker manifest: ${message}`);
}

function text(value: unknown, field: string, id: string): string {
  if (typeof value !== "string" || !value.trim())
    throw invalid(`sticker "${id}" needs a ${field}.`);
  return value.trim();
}

/**
 * Read the sticker manifest, pairing each item with the URL of its PNG.
 * Throws for an unknown schema, an invalid or duplicate id, a missing label
 * or family, or a file that is not a bundled PNG of the folder.
 */
export function parseSceneStickerManifest(
  value: unknown,
  urlsByFile: ReadonlyMap<string, string>,
): SceneSticker[] {
  const manifest =
    value && typeof value === "object"
      ? (value as Record<string, unknown>)
      : null;
  if (manifest?.schema !== SCENE_STICKER_MANIFEST_SCHEMA)
    throw invalid(`the schema must be "${SCENE_STICKER_MANIFEST_SCHEMA}".`);
  if (!Array.isArray(manifest.items)) throw invalid("items must be a list.");
  const seen = new Set<string>();
  return manifest.items.map((raw: unknown) => {
    const item =
      raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
    const id = typeof item.id === "string" ? item.id : "";
    if (!STICKER_ID.test(id))
      throw invalid(`sticker id "${id}" must be lowercase kebab-case.`);
    if (seen.has(id)) throw invalid(`sticker id "${id}" is listed twice.`);
    seen.add(id);
    const file = text(item.file, "file", id);
    const url = STICKER_FILE.test(file) ? urlsByFile.get(file) : undefined;
    if (!url)
      throw invalid(`sticker "${id}" names ${file}, not a PNG in the folder.`);
    return {
      id,
      label: text(item.label, "label", id),
      family: text(item.family, "family", id),
      file,
      url,
    };
  });
}

const STICKER_URLS = import.meta.glob<string>(
  "../../../../../../content/included/resources/scene-vfx/stickers/*.png",
  { eager: true, query: "?url", import: "default" },
);

/** The built-in stickers, in manifest order. */
export const SCENE_STICKERS: readonly SceneSticker[] =
  parseSceneStickerManifest(
    rawManifest,
    new Map(
      Object.entries(STICKER_URLS).map(([path, url]) => [
        path.split("/").at(-1)!,
        url,
      ]),
    ),
  );

/** Stickers grouped by family, families in the order they first appear. */
export function sceneStickerFamilies(
  stickers: readonly SceneSticker[] = SCENE_STICKERS,
): SceneStickerFamily[] {
  const byFamily = new Map<string, SceneSticker[]>();
  for (const sticker of stickers) {
    const family = byFamily.get(sticker.family) ?? [];
    family.push(sticker);
    byFamily.set(sticker.family, family);
  }
  return [...byFamily].map(([family, members]) => ({
    family,
    stickers: members,
  }));
}

/**
 * Fetch a sticker's PNG as a file named after it (`<id>.png`), ready to be
 * added as the effect's own image.
 */
export async function fetchSceneStickerFile(
  sticker: SceneSticker,
  fetchImpl: (url: string) => Promise<Response> = (url) => fetch(url),
): Promise<File> {
  const response = await fetchImpl(sticker.url);
  if (!response.ok)
    throw new Error(`The ${sticker.label} sticker could not be loaded.`);
  const blob = await response.blob();
  return new File([blob], `${sticker.id}.png`, { type: "image/png" });
}
