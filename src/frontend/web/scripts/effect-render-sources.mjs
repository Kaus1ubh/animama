import { readdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Source resolution for `effect-render.mjs`: Avatar Effect descriptors and
 * Gesture clips named by path or by `library:[included/|local/]<key>`.
 * Everything here runs in Node; only resolved descriptors, clip JSON and image
 * locations reach the browser page.
 */
const webRoot = fileURLToPath(new URL("..", import.meta.url));
export const REPO_ROOT = path.resolve(webRoot, "../../..");
export const INCLUDED_CONTENT_ROOT = path.join(REPO_ROOT, "content/included");
export const INCLUDED_EFFECT_ROOT = path.join(
  INCLUDED_CONTENT_ROOT,
  "vfx/avatar",
);

/** Same limit as runtime loading of a private Avatar Effect image. */
export const MAX_EFFECT_IMAGE_BYTES = 16 * 1024 * 1024;

const LIBRARY_PREFIX = "library:";

/** Typed folders, as the content store registers them. */
const KINDS = {
  effect: {
    folder: "vfx/avatar",
    suffix: ".json",
    contentType: "avatar_effect",
  },
  gesture: {
    folder: "gestures",
    suffix: ".meta.json",
    contentType: "gesture",
  },
};

export class EffectSourceError extends Error {
  constructor(message) {
    super(message);
    this.name = "EffectSourceError";
  }
}

async function readJson(file) {
  let text;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    throw new EffectSourceError(
      `Cannot read ${file} (${error.code ?? error}).`,
    );
  }
  try {
    return JSON.parse(text);
  } catch {
    // Parser messages quote file content; report only the path.
    throw new EffectSourceError(`${file} is not valid JSON.`);
  }
}

async function isFile(file) {
  return (await stat(file).catch(() => null))?.isFile() ?? false;
}

/** True when `file` is `root` or lies beneath it. */
export function isInside(file, root) {
  const relative = path.relative(root, file);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

/**
 * Resolve `relative` against `folder` and return the file's real path. Both
 * the folder and the file are resolved through symlinks first, so a link
 * inside the folder cannot reach a file elsewhere.
 */
async function containedFile(folder, relative, label) {
  const realFolder = await realpath(folder);
  const lexical = path.resolve(realFolder, relative);
  const real = await realpath(lexical).catch(() => null);
  if (!isInside(lexical, realFolder) || (real && !isInside(real, realFolder)))
    throw new EffectSourceError(`${label} "${relative}" leaves ${folder}.`);
  if (!real || real === realFolder || !(await isFile(real)))
    throw new EffectSourceError(
      `${label} "${relative}" does not exist in ${folder}.`,
    );
  return real;
}

/**
 * List one kind's descriptors under a content root: `<stem>/<stem><suffix>`
 * folders and top-level `<stem><suffix>` files whose `content_type` matches.
 */
export async function scanLibrary(contentRoot, kind) {
  const { folder, suffix, contentType } = KINDS[kind];
  const root = path.join(contentRoot, folder);
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const items = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const descriptorPath = entry.isDirectory()
      ? path.join(root, entry.name, `${entry.name}${suffix}`)
      : entry.name.endsWith(suffix)
        ? path.join(root, entry.name)
        : null;
    if (!descriptorPath || !(await isFile(descriptorPath))) continue;
    // Rejects a descriptor symlinked from outside the library root.
    await containedFile(
      root,
      path.relative(root, descriptorPath),
      "Descriptor",
    );
    const descriptor = await readJson(descriptorPath);
    if (descriptor?.content_type !== contentType) continue;
    items.push({
      stem: path.basename(descriptorPath, suffix),
      descriptorPath,
      descriptor,
    });
  }
  return items;
}

/**
 * Split `library:[included/|local/]<key>`. Returns null for a plain path.
 */
export function parseLibrarySpec(spec) {
  if (!spec.startsWith(LIBRARY_PREFIX)) return null;
  const rest = spec.slice(LIBRARY_PREFIX.length);
  const match = /^(included|local)\/(.+)$/.exec(rest);
  const scope = match ? match[1] : null;
  const key = (match ? match[2] : rest).trim();
  if (!key) throw new EffectSourceError(`"${spec}" names no item.`);
  return { scope, key };
}

/** A key matches an item's stem, content id or (case-insensitively) name. */
function matchesKey(item, key) {
  return (
    item.stem === key ||
    item.descriptor.content_id === key ||
    (typeof item.descriptor.name === "string" &&
      item.descriptor.name.toLowerCase() === key.toLowerCase())
  );
}

async function resolveLibraryItem(spec, kind, { localContent }) {
  const { scope, key } = parseLibrarySpec(spec);
  if (scope === "local" && !localContent) {
    throw new EffectSourceError(
      `"${spec}" needs --local-content <dir> (a content root such as content/local).`,
    );
  }
  const roots = [
    ...(scope !== "local"
      ? [{ scope: "included", root: INCLUDED_CONTENT_ROOT }]
      : []),
    ...(scope !== "included" && localContent
      ? [{ scope: "local", root: localContent }]
      : []),
  ];
  const matches = [];
  for (const { scope: rootScope, root } of roots) {
    for (const item of await scanLibrary(root, kind)) {
      if (matchesKey(item, key)) matches.push({ ...item, scope: rootScope });
    }
  }
  if (matches.length === 0) {
    throw new EffectSourceError(`No ${kind} matches "${spec}".`);
  }
  if (matches.length > 1) {
    const found = matches
      .map((item) => `${item.scope}/${item.stem}`)
      .join(", ");
    throw new EffectSourceError(
      `"${spec}" is ambiguous (${found}); name a stem, content id or scope.`,
    );
  }
  return matches[0];
}

/** Resolve a folder to its `<basename><suffix>` descriptor, or the only one. */
async function descriptorInFolder(folder, suffix) {
  const named = path.join(folder, `${path.basename(folder)}${suffix}`);
  if (await isFile(named)) return named;
  const candidates = (await readdir(folder)).filter((name) =>
    name.endsWith(suffix),
  );
  if (candidates.length !== 1) {
    throw new EffectSourceError(
      `${folder} must contain ${path.basename(named)} or exactly one *${suffix} descriptor.`,
    );
  }
  return path.join(folder, candidates[0]);
}

async function resolvePath(spec, cwd) {
  const target = path.resolve(cwd, spec);
  const info = await stat(target).catch(() => null);
  if (!info) throw new EffectSourceError(`${target} does not exist.`);
  return { target, isDirectory: info.isDirectory() };
}

/**
 * Resolve one effect source (a folder, a descriptor `.json` or a `library:`
 * name) to its descriptor and image. The image must lie inside the
 * descriptor's folder and fit the runtime size limit.
 */
export async function resolveEffectSource(
  spec,
  { cwd = process.cwd(), localContent = null } = {},
) {
  let descriptorPath;
  let descriptor;
  if (parseLibrarySpec(spec)) {
    ({ descriptorPath, descriptor } = await resolveLibraryItem(spec, "effect", {
      localContent,
    }));
  } else {
    const { target, isDirectory } = await resolvePath(spec, cwd);
    descriptorPath = isDirectory
      ? await descriptorInFolder(target, KINDS.effect.suffix)
      : target;
    descriptor = await readJson(descriptorPath);
  }
  return loadEffectDescriptor(descriptorPath, descriptor);
}

async function containedImage(descriptorPath, logicalName) {
  const imagePath = await containedFile(
    path.dirname(descriptorPath),
    logicalName,
    "Effect image",
  );
  if ((await stat(imagePath)).size > MAX_EFFECT_IMAGE_BYTES) {
    throw new EffectSourceError(
      `${descriptorPath}: image "${logicalName}" exceeds 16 MiB.`,
    );
  }
  return imagePath;
}

async function loadEffectDescriptor(descriptorPath, descriptor) {
  const definition = descriptor?.definition;
  if (descriptor?.content_type !== "avatar_effect") {
    throw new EffectSourceError(
      `${descriptorPath} is not an Avatar Effect descriptor (content_type "avatar_effect").`,
    );
  }
  if (definition?.schema === "animama/avatar-effect/1") {
    throw new EffectSourceError(
      `${descriptorPath} uses animama/avatar-effect/1; convert it with \`uv run python scripts/content/convert_avatar_effects.py --write <folder>\`.`,
    );
  }
  const art =
    definition && typeof definition === "object" ? definition.art : null;
  if (!art || typeof art !== "object" || typeof art.image !== "string") {
    throw new EffectSourceError(
      `${descriptorPath} has no animama/avatar-effect/2 definition with an image.`,
    );
  }
  const imagePath = await containedImage(descriptorPath, art.image);
  const otherImagePath =
    typeof art.otherEyeImage === "string"
      ? await containedImage(descriptorPath, art.otherEyeImage)
      : null;
  const stem = path.basename(descriptorPath, KINDS.effect.suffix);
  return {
    stem,
    descriptorPath,
    contentId: descriptor.content_id ?? stem,
    name: typeof descriptor.name === "string" ? descriptor.name : stem,
    description:
      typeof descriptor.description === "string" ? descriptor.description : "",
    definition,
    imagePath,
    otherImagePath,
  };
}

/** Every Included Avatar Effect, sorted by stem. */
export async function listIncludedEffects() {
  const items = await scanLibrary(INCLUDED_CONTENT_ROOT, "effect");
  return Promise.all(
    items.map((item) =>
      loadEffectDescriptor(item.descriptorPath, item.descriptor),
    ),
  );
}

/**
 * Resolve a Gesture clip: a clip `.json`, a Gesture folder or `.meta.json`,
 * or `library:[included/|local/]<key>`. Only Anima Pose Clip Gestures can be
 * sampled; VRMA Gestures are rejected.
 */
export async function resolveClipSource(
  spec,
  { cwd = process.cwd(), localContent = null } = {},
) {
  let metaPath = null;
  let meta = null;
  if (parseLibrarySpec(spec)) {
    ({ descriptorPath: metaPath, descriptor: meta } = await resolveLibraryItem(
      spec,
      "gesture",
      { localContent },
    ));
  } else {
    const { target, isDirectory } = await resolvePath(spec, cwd);
    if (isDirectory) {
      metaPath = await descriptorInFolder(target, KINDS.gesture.suffix);
    } else if (target.endsWith(KINDS.gesture.suffix)) {
      metaPath = target;
    } else {
      return { clipPath: target, clip: await readJson(target) };
    }
    meta = await readJson(metaPath);
  }
  const implementation = meta?.implementation;
  if (implementation?.kind !== "anima_clip") {
    throw new EffectSourceError(
      `${metaPath} is not an Anima Pose Clip Gesture.`,
    );
  }
  const file = meta.files?.find(
    (entry) => entry?.role === implementation.file_role,
  );
  if (typeof file?.path !== "string") {
    throw new EffectSourceError(
      `${metaPath} lists no "${implementation.file_role}" file.`,
    );
  }
  const clipPath = await containedFile(
    path.dirname(metaPath),
    file.path,
    "Gesture clip",
  );
  return { clipPath, clip: await readJson(clipPath) };
}
