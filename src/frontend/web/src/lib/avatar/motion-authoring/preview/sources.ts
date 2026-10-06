import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

import {
  ANIMA_POSE_CLIP_V2_SCHEMA,
  getAnimaPoseClipTimelineDuration,
  isAnimaPoseClipV2,
  sanitizeAnimaPoseClip,
  validateAnimaPoseClipV2,
  type AnimaPoseClip,
  type AnyAnimaPoseClip,
} from "../../poses/animaPoseClip";
import { getAnimaPoseClipFadeDuration } from "../../poses/animaPoseClip/playback";
import {
  MOTION_DESCRIPTION_SCHEMA,
  parseMotionDescription,
  type MotionDescription,
  type MotionDescriptionIssue,
} from "../description";

/**
 * Sources the motion preview tool can play: clip files, motion descriptions,
 * creator project envelopes and Library items (read from the Included and
 * Local content directories, never written).
 */

export type PreviewSource = {
  /** What the user passed, for example `laugh.clip.json` or `library:wave`. */
  spec: string;
  kind: "file" | "library";
  /** The file whose text is played and watched. */
  path: string;
  /** Short name for review sidecars. */
  name: string;
  /** Display label. */
  label: string;
};

export type PreviewMarker = { id: string; time: number; label: string };

export type PreviewClip = {
  format:
    | "animaPoseClip/1.0"
    | "animaPoseClip/2.0"
    | "animamaMotion/1"
    | "animamaActionProject/1.0";
  clip: AnyAnimaPoseClip;
  markers: PreviewMarker[];
  /** Timeline length in seconds, excluding the fade-out. */
  duration: number;
  /** Fade-out after a one-shot's timeline, in seconds. */
  fadeOut: number;
  loop: boolean;
};

export type PreviewRoots = {
  cwd: string;
  /** `content/included`. */
  included: string;
  /** The selected stack's Local content directory, when known. */
  local?: string | null;
};

/** A source that cannot be played, with any per-field problems. */
export class PreviewSourceError extends Error {
  readonly issues: MotionDescriptionIssue[];
  constructor(message: string, issues: MotionDescriptionIssue[] = []) {
    super(message);
    this.name = "PreviewSourceError";
    this.issues = issues;
  }
}

/** Keyframe markers would only clutter the scrubber of a dense bake. */
const MAX_KEYFRAME_MARKERS = 40;
const PROJECT_SCHEMA = "animamaActionProject/1.0";
const LIBRARY_KINDS = ["gestures", "reactions"] as const;

/** Content hash identifying one version of a source. */
export function sourceVersion(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 12);
}

/**
 * Turn source text into a playable clip. Descriptions are generated with the
 * injected baker (it needs the reference Avatar).
 */
export function previewClipFromText(
  text: string,
  deps: { bake: (description: MotionDescription) => AnimaPoseClip },
): PreviewClip {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new PreviewSourceError(`Not valid JSON: ${(error as Error).message}`);
  }
  const schema = isRecord(value) ? value.schema : undefined;
  if (schema === MOTION_DESCRIPTION_SCHEMA) {
    const parsed = parseMotionDescription(value);
    if (!parsed.ok)
      throw new PreviewSourceError(
        `Invalid motion description (${parsed.issues.length} issue(s)).`,
        parsed.issues,
      );
    return describeClip(
      MOTION_DESCRIPTION_SCHEMA,
      deps.bake(parsed.description),
    );
  }
  if (schema === PROJECT_SCHEMA && isRecord(value))
    return describeClip(PROJECT_SCHEMA, parseClip(value.sequence));
  if (schema === "animaPoseClip/1.0" || schema === ANIMA_POSE_CLIP_V2_SCHEMA)
    return describeClip(schema, parseClip(value));
  throw new PreviewSourceError(
    `Unsupported schema ${JSON.stringify(schema ?? null)}. Expected animaPoseClip/1.0, ${ANIMA_POSE_CLIP_V2_SCHEMA}, ${MOTION_DESCRIPTION_SCHEMA} or ${PROJECT_SCHEMA}.`,
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
  const files = Array.isArray(match.meta.files) ? match.meta.files : [];
  const sequence = files.find(
    (file): file is { path: string } =>
      isRecord(file) &&
      file.role === "sequence" &&
      typeof file.path === "string",
  );
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
        if (isRecord(meta)) items.push({ origin, folder, stem, meta });
      } catch {
        // Not an Action folder (or unreadable): skip it.
      }
    }
  }
  return items;
}

/** Lower-cased identifiers a query may use for an item. */
function libraryKeys({ stem, meta }: LibraryCandidate): string[] {
  return [stem, meta.semantic_key, meta.name, meta.content_id]
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.toLowerCase());
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
