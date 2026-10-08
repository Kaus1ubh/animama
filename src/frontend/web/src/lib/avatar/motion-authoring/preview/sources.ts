import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

import {
  ANIMA_POSE_CLIP_V2_SCHEMA,
  getAnimaPoseClipTimelineDuration,
  isAnimaPoseClipV2,
  sanitizeAnimaPoseClip,
  validateAnimaPoseClipV2,
  type AnimaPoseClipV2Issue,
  type AnyAnimaPoseClip,
} from "../../poses/animaPoseClip";
import { getAnimaPoseClipFadeDuration } from "../../poses/animaPoseClip/playback";
import type { PreviewEffect, PreviewMedia } from "./previewMedia";

/**
 * Sources the motion preview tool can play: clip files, creator project
 * envelopes and Library items (read from the Included and Local content
 * directories, never written), plus Avatar Effect sources through a
 * `PreviewMediaAdapter`.
 */

export type PreviewSource = {
  /** What the user passed, for example `laugh.clip.json` or `library:wave`. */
  spec: string;
  /** A file the agent edits (notes beside it) or a read-only Library item. */
  kind: "file" | "library";
  /** What the source plays; a clip unless stated. */
  type?: "clip" | "effect";
  /** The file whose text is played and watched (an effect's descriptor). */
  path: string;
  /** Short name for review sidecars. */
  name: string;
  /** Display label. */
  label: string;
  /** A Library item's meta file, whose dependencies its clip events use. */
  metaPath?: string;
  /** Folder for a file source's review notes, when not the file's own. */
  notesDir?: string;
};

/**
 * Avatar Effect sources and clip dependencies, which the CLI server resolves
 * with `scripts/effect-render-sources.mjs` and serves to the page.
 */
export type PreviewMediaAdapter = {
  /** The effect source `spec` names, or null when it names no Avatar Effect. */
  resolve(spec: string, roots: PreviewRoots): Promise<PreviewSource | null>;
  /**
   * Read an effect source. `version` covers the descriptor and image bytes,
   * `text` is the descriptor retained for review, and `files` are watched.
   */
  load(
    source: PreviewSource,
    roots: PreviewRoots,
  ): Promise<{
    version: string;
    text: string;
    files: string[];
    effect: PreviewEffect;
  }>;
  /** Resolve a clip's typed dependencies to the effects its events play. */
  media(dependencies: unknown, roots: PreviewRoots): Promise<PreviewMedia>;
};

export type PreviewMarker = { id: string; time: number; label: string };

export type PreviewClip = {
  format:
    | "animaPoseClip/1.0"
    | "animaPoseClip/2.0"
    | "animamaActionProject/1.0";
  clip: AnyAnimaPoseClip;
  markers: PreviewMarker[];
  /** Timeline length in seconds, excluding the fade-out. */
  duration: number;
  /** Fade-out after a one-shot's timeline, in seconds. */
  fadeOut: number;
  loop: boolean;
  /** A project envelope's typed dependencies, which its events name. */
  dependencies?: unknown[];
};

export type PreviewRoots = {
  cwd: string;
  /** `content/included`. */
  included: string;
  /** The selected stack's Local content directory, when known. */
  local?: string | null;
};

/** A problem with one field of a source, by its JSON path. */
export type PreviewIssue = AnimaPoseClipV2Issue;

/** A source that cannot be played, with any per-field problems. */
export class PreviewSourceError extends Error {
  readonly issues: PreviewIssue[];
  constructor(message: string, issues: PreviewIssue[] = []) {
    super(message);
    this.name = "PreviewSourceError";
    this.issues = issues;
  }
}

/** Keyframe markers would only clutter the scrubber of a dense bake. */
const MAX_KEYFRAME_MARKERS = 40;
const PROJECT_SCHEMA = "animamaActionProject/1.0";
/** The per-bone description format that 2.0 clips replaced. */
export const RETIRED_DESCRIPTION_SCHEMA = "animamaMotion/1";
export const RETIRED_DESCRIPTION_MESSAGE = `${RETIRED_DESCRIPTION_SCHEMA} descriptions are retired: write an ${ANIMA_POSE_CLIP_V2_SCHEMA} clip instead (see the animama-animation skill).`;
const LIBRARY_KINDS = ["gestures", "reactions"] as const;

/** Content hash identifying one version of a source. */
export function sourceVersion(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 12);
}

/** Turn source text into a playable clip. */
export function previewClipFromText(text: string): PreviewClip {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new PreviewSourceError(`Not valid JSON: ${(error as Error).message}`);
  }
  const schema = isRecord(value) ? value.schema : undefined;
  if (schema === RETIRED_DESCRIPTION_SCHEMA)
    throw new PreviewSourceError(RETIRED_DESCRIPTION_MESSAGE);
  if (schema === PROJECT_SCHEMA && isRecord(value))
    return {
      ...describeClip(PROJECT_SCHEMA, parseClip(value.sequence)),
      dependencies: Array.isArray(value.dependencies) ? value.dependencies : [],
    };
  if (schema === "animaPoseClip/1.0" || schema === ANIMA_POSE_CLIP_V2_SCHEMA)
    return describeClip(schema, parseClip(value));
  throw new PreviewSourceError(
    `Unsupported schema ${JSON.stringify(schema ?? null)}. Expected ${ANIMA_POSE_CLIP_V2_SCHEMA}, animaPoseClip/1.0 or ${PROJECT_SCHEMA}.`,
  );
}

function parseClip(value: unknown): AnyAnimaPoseClip {
  if (isAnimaPoseClipV2(value)) {
    const result = validateAnimaPoseClipV2(value);
    if (!result.ok)
      throw new PreviewSourceError(
        `Invalid ${ANIMA_POSE_CLIP_V2_SCHEMA} (${result.issues.length} issue(s)).`,
        result.issues,
      );
    return result.clip;
  }
  const clip = sanitizeAnimaPoseClip(value);
  if (!clip)
    throw new PreviewSourceError(
      "Invalid animaPoseClip/1.0: check the schema, id, name, poses and keyframe times.",
    );
  return clip;
}

function describeClip(
  format: PreviewClip["format"],
  clip: AnyAnimaPoseClip,
): PreviewClip {
  const common = {
    format,
    clip,
    duration: getAnimaPoseClipTimelineDuration(clip),
    fadeOut: getAnimaPoseClipFadeDuration(clip.fadeOut),
    loop: clip.loop === true,
  };
  // 2.0 beats are the markers: notes pin to their ids.
  if (isAnimaPoseClipV2(clip))
    return {
      ...common,
      markers: clip.beats.map(({ id, time, label }) => ({ id, time, label })),
    };
  const keyframes = clip.poseKeyframes;
  return {
    ...common,
    markers:
      keyframes.length <= MAX_KEYFRAME_MARKERS
        ? keyframes.map((keyframe, index) => ({
            id: `k${index}`,
            time: keyframe.time,
            label: keyframe.pose,
          }))
        : [],
  };
}

/**
 * Resolve a command-line source: a file path (relative to `cwd`) or
 * `library:[included/|local/]<folder, selector or name>`.
 */
export async function resolvePreviewSource(
  spec: string,
  roots: PreviewRoots,
): Promise<PreviewSource> {
  if (spec.startsWith("library:"))
    return resolveLibrarySource(spec, spec.slice("library:".length), roots);
  const file = path.resolve(roots.cwd, spec);
  if (!(await isFile(file)))
    throw new PreviewSourceError(`Cannot find ${spec} (looked for ${file}).`);
  return {
    spec,
    kind: "file",
    path: file,
    name: path.basename(file).replace(/\.json$/, ""),
    label: path.basename(file),
  };
}

type LibraryCandidate = {
  origin: "included" | "local";
  kind: (typeof LIBRARY_KINDS)[number];
  folder: string;
  stem: string;
  meta: Record<string, unknown>;
};

async function resolveLibrarySource(
  spec: string,
  query: string,
  roots: PreviewRoots,
): Promise<PreviewSource> {
  const scoped = /^(included|local)\/(.+)$/.exec(query);
  const origins = scoped
    ? [scoped[1] as "included" | "local"]
    : (["included", "local"] as const);
  const wanted = (scoped ? scoped[2] : query).trim().toLowerCase();
  if (origins.includes("local") && !roots.local && scoped)
    throw new PreviewSourceError(
      "No Local content directory: pass --local-content <dir> or source the stack's .animama-stack.env.",
    );

  const matches: LibraryCandidate[] = [];
  for (const origin of origins) {
    const root = origin === "included" ? roots.included : roots.local;
    if (!root) continue;
    for (const candidate of await listLibraryItems(origin, root))
      if (libraryKeys(candidate).includes(wanted)) matches.push(candidate);
  }
  if (matches.length === 0)
    throw new PreviewSourceError(
      `No Library item matches "${query}" in ${origins.join(" or ")} content.`,
    );
  if (matches.length > 1)
    throw new PreviewSourceError(
      `"${query}" matches several Library items: ${matches
        .map(({ origin, stem }) => `${origin}/${stem}`)
        .join(", ")}. Prefix it with included/ or local/.`,
    );

  const [match] = matches;
  const sequence = sequenceFile(match);
  if (!sequence)
    throw new PreviewSourceError(
      `${match.origin}/${match.stem} has no clip (sequence) file.`,
    );
  const file = path.resolve(match.folder, sequence.path);
  if (path.dirname(file) !== match.folder)
    throw new PreviewSourceError(
      `${match.origin}/${match.stem} names a clip outside its folder.`,
    );
  const name =
    typeof match.meta.name === "string" ? match.meta.name : match.stem;
  return {
    spec,
    kind: "library",
    path: file,
    name: match.stem,
    label: `${match.origin === "included" ? "Included" : "Local"} · ${name}`,
    metaPath: path.join(match.folder, `${match.stem}.meta.json`),
  };
}

async function listLibraryItems(
  origin: "included" | "local",
  root: string,
): Promise<LibraryCandidate[]> {
  const items: LibraryCandidate[] = [];
  for (const kind of LIBRARY_KINDS) {
    const kindDir = path.join(root, kind);
    let stems: string[];
    try {
      stems = await readdir(kindDir);
    } catch {
      continue;
    }
    for (const stem of stems) {
      const folder = path.join(kindDir, stem);
      try {
        const meta = JSON.parse(
          await readFile(path.join(folder, `${stem}.meta.json`), "utf8"),
        ) as unknown;
        if (isRecord(meta)) items.push({ origin, kind, folder, stem, meta });
      } catch {
        // Not an Action folder (or unreadable): skip it.
      }
    }
  }
  return items;
}

/** The item's clip file entry, if it has one. */
function sequenceFile({ meta }: LibraryCandidate) {
  const files = Array.isArray(meta.files) ? meta.files : [];
  return files.find(
    (file): file is { path: string } =>
      isRecord(file) &&
      file.role === "sequence" &&
      typeof file.path === "string",
  );
}

/**
 * Whether a file lies in Library content: under the Included or Local content
 * directory, in an Avatar Effect item folder (`…/vfx/avatar/<stem>/`) or in a
 * Gesture or Reaction item folder (beside its `<stem>.meta.json`).
 */
export async function isInLibraryContent(
  file: string,
  roots: PreviewRoots,
): Promise<boolean> {
  const inside = (root: string) => {
    const relative = path.relative(root, file);
    return !relative.startsWith("..") && !path.isAbsolute(relative);
  };
  if ([roots.included, roots.local].some((root) => root && inside(root)))
    return true;
  const folder = path.dirname(file);
  const kindFolder = path.dirname(folder);
  if (
    path.basename(kindFolder) === "avatar" &&
    path.basename(path.dirname(kindFolder)) === "vfx"
  )
    return true;
  return isFile(path.join(folder, `${path.basename(folder)}.meta.json`));
}

/** One entry of the preview page's source picker. */
export type PreviewChoice = {
  /** A source spec `resolvePreviewSource` accepts. */
  spec: string;
  label: string;
  /** Picker group, such as a folder or "Local Gestures". */
  group: string;
  /** The clip file it plays, which identifies the selected choice. */
  path: string;
};

/**
 * Everything the preview page offers to play: the clip and project files in
 * `dirs`, grouped by folder name (review sidecars excluded), then the
 * Included and Local Gestures and Reactions that have a clip file. Unreadable
 * folders are skipped; a choice that cannot be played reports why when it is
 * selected.
 */
export async function listPreviewChoices(
  roots: PreviewRoots,
  dirs: string[],
): Promise<PreviewChoice[]> {
  const choices: PreviewChoice[] = [];
  for (const dir of new Set(dirs.map((value) => path.resolve(value)))) {
    let names: string[];
    try {
      names = (await readdir(dir, { withFileTypes: true }))
        .filter(
          (entry) =>
            entry.isFile() &&
            entry.name.endsWith(".json") &&
            !entry.name.endsWith(".review.json"),
        )
        .map(({ name }) => name)
        .sort();
    } catch {
      continue;
    }
    const group = `${path.basename(dir)}/`;
    for (const name of names)
      if (await isClipFile(path.join(dir, name)))
        choices.push({
          spec: path.join(dir, name),
          label: name,
          group,
          path: path.join(dir, name),
        });
  }
  for (const origin of ["included", "local"] as const) {
    const root = origin === "included" ? roots.included : roots.local;
    if (!root) continue;
    const items = (await listLibraryItems(origin, root)).filter((item) =>
      sequenceFile(item),
    );
    for (const kind of LIBRARY_KINDS) {
      const group = `${origin === "included" ? "Included" : "Local"} ${kind === "gestures" ? "Gestures" : "Reactions"}`;
      choices.push(
        ...items
          .filter((item) => item.kind === kind)
          .map((item) => ({
            spec: `library:${origin}/${item.stem}`,
            label:
              typeof item.meta.name === "string" ? item.meta.name : item.stem,
            group,
            path: path.resolve(item.folder, sequenceFile(item)!.path),
          }))
          .sort((a, b) => a.label.localeCompare(b.label)),
      );
    }
  }
  return choices;
}

/** Lower-cased identifiers a query may use for an item. */
function libraryKeys({ stem, meta }: LibraryCandidate): string[] {
  return [stem, meta.semantic_key, meta.name, meta.content_id]
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.toLowerCase());
}

const PLAYABLE_SCHEMAS = new Set<unknown>([
  "animaPoseClip/1.0",
  ANIMA_POSE_CLIP_V2_SCHEMA,
  PROJECT_SCHEMA,
]);

/** Whether a JSON file names a schema the preview plays (cheap pre-filter). */
async function isClipFile(file: string): Promise<boolean> {
  try {
    const value = JSON.parse(await readFile(file, "utf8")) as unknown;
    return isRecord(value) && PLAYABLE_SCHEMAS.has(value.schema);
  } catch {
    return false;
  }
}

async function isFile(file: string): Promise<boolean> {
  try {
    return (await stat(file)).isFile();
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
