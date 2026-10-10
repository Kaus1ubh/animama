import { createHash } from "node:crypto";
import { readFile, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";

import {
  INCLUDED_CONTENT_ROOT,
  MAX_EFFECT_IMAGE_BYTES,
  containedFile,
  effectSourceFiles,
  effectSourceVersion,
  isInside,
  resolveEffectDescriptor,
  resolveEffectRef,
  resolveEffectSource,
  resolveParticleRef,
  scanLibrary,
} from "./effect-render-sources.mjs";
import { pageEffect } from "./effect-render.mjs";

/**
 * Avatar Effects for the headed preview (`animation-preview.mjs`): effect
 * sources, the Avatar and Particle Effects a Gesture or Reaction depends on,
 * and the files the page may load. Resolution, including the realpath
 * containment checks, is `effect-render-sources.mjs`, shared with
 * `effects:render`.
 */

/** `library:avatar-effect/[included/|local/]<stem|content_id|name>`. */
export const EFFECT_LIBRARY_PREFIX = "library:avatar-effect/";
/** URL prefix of files served to the page. */
export const MEDIA_ROUTE = "/__preview/media/";
/** Longest `--duration`, in seconds. */
export const MAX_PREVIEW_DURATION_SEC = 600;
/** Folders the page may load from; the oldest are forgotten beyond this. */
export const MAX_MEDIA_FOLDERS = 64;
/** Largest particle manifest or texture served (the runtime package limit). */
const MAX_PARTICLE_FILE_BYTES = 64 * 1024 * 1024;

const CONTENT_TYPES = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".json": "application/json",
};

/**
 * Files offered to the page, each under `MEDIA_ROUTE<folder token>/<path in
 * folder>`. Only files registered through `url` are served, and each is
 * checked again on request (still inside its folder and within its size
 * limit), so a link or file swapped in later is refused. Relative URLs inside
 * a served file (a particle manifest's textures) resolve within the same
 * folder. Only the `maxFolders` most recently used folders stay registered,
 * so picking many sources does not grow the registry without bound.
 */
export class PreviewMediaFiles {
  #folders = new Map();
  #maxFolders;

  constructor({ maxFolders = MAX_MEDIA_FOLDERS } = {}) {
    this.#maxFolders = maxFolders;
  }

  /**
   * Register `file` (a real path inside the real `folder`), served while it
   * is at most `maxBytes`, and return its URL.
   */
  url(folder, file, version = null, maxBytes = MAX_EFFECT_IMAGE_BYTES) {
    const token = createHash("sha256")
      .update(folder)
      .digest("hex")
      .slice(0, 16);
    const relative = path.relative(folder, file).split(path.sep).join("/");
    if (!isInside(file, folder) || relative === "")
      throw new Error(`${file} is not inside ${folder}.`);
    const entry = this.#folders.get(token) ?? { folder, files: new Map() };
    // Most recently used last; the first entry is the one forgotten.
    this.#folders.delete(token);
    this.#folders.set(token, entry);
    while (this.#folders.size > this.#maxFolders)
      this.#folders.delete(this.#folders.keys().next().value);
    entry.files.set(relative, maxBytes);
    const encoded = relative.split("/").map(encodeURIComponent).join("/");
    return `${MEDIA_ROUTE}${token}/${encoded}${version ? `?v=${version}` : ""}`;
  }

  /**
   * The registered file a request path names (after `MEDIA_ROUTE`, without
   * the query), or null.
   */
  async lookup(route) {
    const [token, ...segments] = route.split("/");
    const entry = this.#folders.get(token);
    if (!entry) return null;
    let relative;
    try {
      relative = segments.map(decodeURIComponent).join("/");
    } catch {
      return null;
    }
    const maxBytes = entry.files.get(relative);
    if (maxBytes === undefined) return null;
    try {
      const file = await containedFile(entry.folder, relative, "Preview file");
      return (await stat(file)).size <= maxBytes ? file : null;
    } catch {
      return null;
    }
  }

  /** The response content type for a served file. */
  static contentType(file) {
    return (
      CONTENT_TYPES[path.extname(file).toLowerCase()] ??
      "application/octet-stream"
    );
  }
}

function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The `resolveEffectSource` spec for a preview source naming an Avatar Effect
 * (a folder, a descriptor `.json` or `library:avatar-effect/…`), or null when
 * it names something else (a clip, a project or a Gesture or Reaction).
 */
export async function effectSpecFor(spec, cwd) {
  if (spec.startsWith(EFFECT_LIBRARY_PREFIX))
    return `library:${spec.slice(EFFECT_LIBRARY_PREFIX.length)}`;
  if (spec.startsWith("library:")) return null;
  const target = path.resolve(cwd, spec);
  const info = await stat(target).catch(() => null);
  if (!info) return null;
  if (info.isDirectory()) return target;
  if (!target.endsWith(".json")) return null;
  try {
    const value = JSON.parse(await readFile(target, "utf8"));
    return value?.content_type === "avatar_effect" ? target : null;
  } catch {
    // Not JSON: the clip resolver reports it.
    return null;
  }
}

/** The page's view of an effect, with its images served by `files`. */
async function servedEffect(effect, files, version) {
  const folder = await realpath(path.dirname(effect.descriptorPath));
  return pageEffect(effect, async (file) => files.url(folder, file, version));
}

/**
 * The `PreviewMediaAdapter` the preview session uses (see
 * `src/lib/avatar/motion-authoring/preview/sources.ts`). `duration` is the
 * `--duration` given to every effect source, or null to loop.
 */
export function createPreviewMediaAdapter({ files, duration = null }) {
  /** The descriptor a spec names; its images are read by `load`. */
  async function resolve(spec, roots) {
    const effectSpec = await effectSpecFor(spec, roots.cwd);
    if (!effectSpec) return null;
    const { descriptorPath, descriptor } = await resolveEffectDescriptor(
      effectSpec,
      { cwd: roots.cwd, localContent: roots.local ?? null },
    );
    return { effectSpec, descriptorPath, descriptor };
  }

  return {
    async resolve(spec, roots) {
      const resolved = await resolve(spec, roots);
      if (!resolved) return null;
      const { effectSpec, descriptorPath, descriptor } = resolved;
      const folder = path.dirname(descriptorPath);
      const stem = path.basename(descriptorPath, ".json");
      const name =
        typeof descriptor?.name === "string" ? descriptor.name : stem;
      const origin = isInside(descriptorPath, INCLUDED_CONTENT_ROOT)
        ? "Included"
        : "Local";
      return {
        spec,
        type: "effect",
        path: descriptorPath,
        name: stem,
        ...(effectSpec.startsWith("library:")
          ? { kind: "library", label: `${origin} · ${name}` }
          : {
              kind: "file",
              label: path.basename(folder),
              // Beside the effect's folder, never inside the content item.
              notesDir: path.dirname(folder),
            }),
      };
    },

    async load(source, roots) {
      // Resolve again: the descriptor may now name other images.
      const resolved = await resolve(source.spec, roots);
      if (!resolved) throw new Error(`${source.spec} is no longer an effect.`);
      const effect = await resolveEffectSource(resolved.descriptorPath);
      const version = await effectSourceVersion(effect);
      return {
        version,
        text: await readFile(effect.descriptorPath, "utf8"),
        files: effectSourceFiles(effect),
        effect: { ...(await servedEffect(effect, files, version)), duration },
      };
    },

    async media(dependencies, roots) {
      const media = { avatarEffects: [], particleEffects: [], notices: [] };
      const notice = (text) => {
        if (!media.notices.includes(text)) media.notices.push(text);
      };
      const options = { localContent: roots.local ?? null, onSkip: notice };
      for (const dependency of Array.isArray(dependencies)
        ? dependencies
        : []) {
        if (
          !isRecord(dependency) ||
          typeof dependency.alias !== "string" ||
          typeof dependency.ref !== "string"
        )
          continue;
        const { alias, ref, content_type: contentType } = dependency;
        try {
          if (contentType === "avatar_effect") {
            const effect = await resolveEffectRef(ref, options);
            const version = await effectSourceVersion(effect);
            media.avatarEffects.push({
              alias,
              effect: await servedEffect(effect, files, version),
            });
          } else if (contentType === "particle_effect") {
            const particle = await resolveParticleRef(ref, options);
            for (const texture of particle.texturePaths)
              files.url(
                particle.folder,
                texture,
                null,
                MAX_PARTICLE_FILE_BYTES,
              );
            media.particleEffects.push({
              alias,
              name: particle.name,
              description: particle.description,
              manifestUrl: files.url(
                particle.folder,
                particle.manifestPath,
                null,
                MAX_PARTICLE_FILE_BYTES,
              ),
              // As the runtime projection merges them for a dependency.
              config: {
                ...particle.defaults,
                ...(isRecord(dependency.config) ? dependency.config : {}),
              },
            });
          }
        } catch (error) {
          notice(`${alias} (${ref}) does not play: ${error.message}`);
        }
      }
      return media;
    },

    /**
     * Picker choices for effects: the Library's Avatar Effects, the effect
     * sources named on the command line, and the other effect folders beside
     * each named folder, so one preview can review a batch of drafts.
     */
    async choices(roots, specs = []) {
      const choices = [];
      const seen = new Set();
      const add = (descriptorPath) => {
        if (seen.has(descriptorPath)) return;
        seen.add(descriptorPath);
        choices.push({
          spec: descriptorPath,
          label: path.basename(path.dirname(descriptorPath)),
          group: "Effect sources",
          path: descriptorPath,
        });
      };
      const siblingParents = [];
      for (const spec of specs) {
        const resolved = await resolve(spec, roots).catch(() => null);
        if (!resolved || resolved.effectSpec.startsWith("library:")) continue;
        add(resolved.descriptorPath);
        const parent = path.dirname(path.dirname(resolved.descriptorPath));
        if (!siblingParents.includes(parent)) siblingParents.push(parent);
      }
      for (const parent of siblingParents) {
        const entries = await readdir(parent, { withFileTypes: true }).catch(
          () => [],
        );
        const folders = entries
          .filter((entry) => entry.isDirectory())
          .map((entry) => entry.name)
          .sort();
        for (const name of folders) {
          // Only folders that hold an effect descriptor; work folders and
          // other files are skipped.
          const resolved = await resolve(path.join(parent, name), roots).catch(
            () => null,
          );
          if (!resolved) continue;
          const descriptor = await readFile(resolved.descriptorPath, "utf8")
            .then(JSON.parse)
            .catch(() => null);
          if (descriptor?.content_type === "avatar_effect")
            add(resolved.descriptorPath);
        }
      }
      for (const [origin, root] of [
        ["included", INCLUDED_CONTENT_ROOT],
        ["local", roots.local],
      ]) {
        if (!root) continue;
        const items = await scanLibrary(root, "effect").catch(() => []);
        choices.push(
          ...items
            .map((item) => ({
              spec: `${EFFECT_LIBRARY_PREFIX}${origin}/${item.stem}`,
              label:
                typeof item.descriptor.name === "string"
                  ? item.descriptor.name
                  : item.stem,
              group: `${origin === "included" ? "Included" : "Local"} Avatar Effects`,
              path: item.descriptorPath,
            }))
            .sort((a, b) => a.label.localeCompare(b.label)),
        );
      }
      return choices;
    },
  };
}

/**
 * The version of a reviewed file for `animation resolve`: an Avatar Effect
 * descriptor's covers its images too, as the preview's does; null for other
 * files, which hash their text.
 */
export async function effectVersionForFile(file) {
  if ((await effectSpecFor(file, path.dirname(file))) === null) return null;
  return effectSourceVersion(await resolveEffectSource(file));
}
