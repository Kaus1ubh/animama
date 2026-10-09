import { createHash } from "node:crypto";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Source resolution for `effect-render.mjs` and the headed preview
 * (`animation-preview.mjs`): Avatar Effect descriptors and Gesture clips named
 * by path or by `library:[included/|local/]<key>`, and the Avatar and Particle
 * Effects a Gesture or Reaction depends on. Everything here runs in Node; only
 * resolved descriptors, clip JSON and file locations reach the browser page.
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
/** Same limits as runtime loading of a private Particle Effect. */
const MAX_PARTICLE_MANIFEST_BYTES = 5 * 1024 * 1024;
const MAX_PARTICLE_PACKAGE_BYTES = 64 * 1024 * 1024;
/** Folder levels searched below a kind's folder (Included particles nest one). */
const MAX_DESCRIPTOR_DEPTH = 4;

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
  particle: {
    folder: "vfx/particle",
    suffix: ".json",
    contentType: "particle_effect",
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
export async function containedFile(folder, relative, label) {
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

/**
 * A descriptor's content ID: Included descriptors carry `content_id`, Local
 * ones (as the app writes them) `id`.
 */
function descriptorContentId(descriptor) {
  return descriptor?.content_id ?? descriptor?.id;
}

/** A key matches an item's stem, content id or (case-insensitively) name. */
function matchesKey(item, key) {
  return (
    item.stem === key ||
    descriptorContentId(item.descriptor) === key ||
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
export async function resolveEffectSource(spec, options = {}) {
  const { descriptorPath, descriptor } = await resolveEffectDescriptor(
    spec,
    options,
  );
  return loadEffectDescriptor(descriptorPath, descriptor);
}

/**
 * Find the descriptor an effect source names, without reading its images,
 * so a source whose image is still missing can be watched until it appears.
 */
export async function resolveEffectDescriptor(
  spec,
  { cwd = process.cwd(), localContent = null } = {},
) {
  if (parseLibrarySpec(spec)) {
    const { descriptorPath, descriptor } = await resolveLibraryItem(
      spec,
      "effect",
      { localContent },
    );
    return { descriptorPath, descriptor };
  }
  const { target, isDirectory } = await resolvePath(spec, cwd);
  const descriptorPath = isDirectory
    ? await descriptorInFolder(target, KINDS.effect.suffix)
    : target;
  return { descriptorPath, descriptor: await readJson(descriptorPath) };
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
    contentId: descriptorContentId(descriptor) ?? stem,
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

/** The files an effect source plays: its descriptor, then its images. */
export function effectSourceFiles(effect) {
  return [
    effect.descriptorPath,
    effect.imagePath,
    ...(effect.otherImagePath ? [effect.otherImagePath] : []),
  ];
}

/**
 * Content hash of an effect source over its descriptor and image bytes, so
 * editing either gives a new version.
 */
export async function effectSourceVersion(effect) {
  const hash = createHash("sha256");
  for (const file of effectSourceFiles(effect)) {
    const bytes = await readFile(file);
    // Length-prefixed, so moving bytes between files changes the hash.
    hash.update(`${path.basename(file)}\0${bytes.length}\0`);
    hash.update(bytes);
  }
  return hash.digest("hex").slice(0, 12);
}

/**
 * Descriptors below a kind's folder at any depth, named `<stem>/<stem><suffix>`
 * as the content store scans them. A descriptor's own folder is not searched
 * further.
 */
async function descriptorsBelow(folder, suffix, depth = MAX_DESCRIPTOR_DEPTH) {
  const entries = await readdir(folder, { withFileTypes: true }).catch(
    () => [],
  );
  const found = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory()) continue;
    const child = path.join(folder, entry.name);
    const descriptorPath = path.join(child, `${entry.name}${suffix}`);
    if (await isFile(descriptorPath)) found.push(descriptorPath);
    else if (depth > 1)
      found.push(...(await descriptorsBelow(child, suffix, depth - 1)));
  }
  return found;
}

/**
 * Find a dependency's descriptor by its exact content id (a meta file's
 * `dependencies[].ref`) in Included content, then Local content. A
 * descriptor that is linked from outside its kind's folder or is unreadable
 * is skipped and reported through `onSkip`, so one bad item does not stop
 * every other dependency from resolving.
 */
async function findContentRef(ref, kind, { localContent, onSkip }) {
  const { folder, suffix, contentType } = KINDS[kind];
  for (const contentRoot of [INCLUDED_CONTENT_ROOT, localContent]) {
    if (!contentRoot) continue;
    const root = path.join(contentRoot, folder);
    for (const descriptorPath of await descriptorsBelow(root, suffix)) {
      let descriptor;
      try {
        // Rejects a descriptor symlinked from outside the kind's folder.
        await containedFile(
          root,
          path.relative(root, descriptorPath),
          "Descriptor",
        );
        descriptor = await readJson(descriptorPath);
      } catch (error) {
        if (!(error instanceof EffectSourceError)) throw error;
        onSkip?.(`Skipped ${descriptorPath}: ${error.message}`);
        continue;
      }
      if (
        descriptor?.content_type === contentType &&
        descriptorContentId(descriptor) === ref
      )
        return { descriptorPath, descriptor };
    }
  }
  throw new EffectSourceError(
    `No ${contentType.replace("_", " ")} "${ref}" in Included${localContent ? " or Local" : ""} content.`,
  );
}

/** Resolve an Avatar Effect dependency (`builtin:avatar-effect:…` or Local). */
export async function resolveEffectRef(
  ref,
  { localContent = null, onSkip } = {},
) {
  const { descriptorPath, descriptor } = await findContentRef(ref, "effect", {
    localContent,
    onSkip,
  });
  return loadEffectDescriptor(descriptorPath, descriptor);
}

/**
 * Resolve a Particle Effect dependency to its manifest, textures and stored
 * runtime defaults. Every file must lie inside the descriptor's folder; the
 * manifest's relative image URLs resolve against it.
 */
export async function resolveParticleRef(
  ref,
  { localContent = null, onSkip } = {},
) {
  const { descriptorPath, descriptor } = await findContentRef(ref, "particle", {
    localContent,
    onSkip,
  });
  const folder = await realpath(path.dirname(descriptorPath));
  const files = Array.isArray(descriptor.files) ? descriptor.files : [];
  const named = (role) =>
    files.filter(
      (file) => file?.role === role && typeof file.path === "string",
    );
  const [manifest] = named("manifest");
  if (!manifest)
    throw new EffectSourceError(`${descriptorPath} lists no manifest file.`);
  const manifestPath = await containedFile(
    folder,
    manifest.path,
    "Particle manifest",
  );
  const texturePaths = [];
  for (const texture of named("texture"))
    texturePaths.push(
      await containedFile(folder, texture.path, "Particle texture"),
    );
  const sizes = await Promise.all(
    [manifestPath, ...texturePaths].map(
      async (file) => (await stat(file)).size,
    ),
  );
  if (
    sizes[0] > MAX_PARTICLE_MANIFEST_BYTES ||
    sizes.reduce((total, size) => total + size, 0) > MAX_PARTICLE_PACKAGE_BYTES
  )
    throw new EffectSourceError(
      `${descriptorPath} exceeds the Particle Effect size limits.`,
    );
  const defaults = descriptor.runtime_defaults?.slots?.particle_vfx;
  return {
    descriptorPath,
    folder,
    contentId: ref,
    name:
      typeof descriptor.name === "string"
        ? descriptor.name
        : path.basename(folder),
    description:
      typeof descriptor.description === "string" ? descriptor.description : "",
    defaults: defaults && typeof defaults === "object" ? defaults : {},
    manifestPath,
    texturePaths,
  };
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
