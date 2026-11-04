import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { REVIEW_REGIONS, type ReviewRegion } from "./reviewRegions";
import { isRecord } from "@/lib/records";

/**
 * Review notes for the motion preview tool: the owner pins notes to a time
 * (and optionally a beat and body region) of a Gesture under review, and the
 * agent resolves them by revising the source. Notes live in a sidecar JSON
 * file; each distinct source version is retained beside it so the preview can
 * compare the previous and current motion.
 */

export const REVIEW_SIDECAR_SCHEMA = "animamaReview/1" as const;

export { REVIEW_REGIONS, type ReviewRegion } from "./reviewRegions";

export type ReviewNote = {
  id: string;
  createdAt: string;
  /** Playback time in seconds the note refers to. */
  time: number;
  /** Beat id (2.0 clips) or keyframe label the note was pinned to. */
  beat?: string;
  region?: ReviewRegion;
  text: string;
  /** Source version the note was made against. */
  version: string;
  status: "open" | "resolved";
  /** What the agent changed, written when resolving. */
  resolution?: string;
  resolvedVersion?: string;
  resolvedAt?: string;
};

export type ReviewVersion = { id: string; savedAt: string };

export type ReviewSidecar = {
  schema: typeof REVIEW_SIDECAR_SCHEMA;
  /** The reviewed source as given to the preview tool. */
  source: string;
  notes: ReviewNote[];
  versions: ReviewVersion[];
};

export type ReviewNoteInput = {
  time: number;
  beat?: string;
  region?: ReviewRegion;
  text: string;
};

export type ReviewPaths = {
  /** The sidecar JSON file. */
  sidecar: string;
  /** Directory of retained source versions (`<version>.txt`). */
  versions: string;
};

export type ReviewedSource = {
  /** A file the agent edits, or a read-only Library item. */
  kind: "file" | "library";
  path: string;
  /** Base name for the sidecar, without extension. */
  name: string;
  /**
   * Folder for a file source's notes when not the file's own: an Avatar
   * Effect's notes sit beside its folder, never inside the content item.
   */
  notesDir?: string;
};

const VERSION_ID = /^[a-z0-9]{1,64}$/;

/**
 * Where a source's review notes live: beside a file source (or in its
 * `notesDir`), or in the working directory for a Library item (the tool never
 * writes into the Library), unless an explicit notes file is given.
 */
export function reviewPathsFor(
  source: ReviewedSource,
  options: { cwd: string; notes?: string },
): ReviewPaths {
  const sidecar = options.notes
    ? path.resolve(options.cwd, options.notes)
    : source.kind === "file"
      ? path.join(
          source.notesDir ?? path.dirname(source.path),
          `${source.name}.review.json`,
        )
      : path.join(options.cwd, `${source.name}.review.json`);
  return {
    sidecar,
    versions: sidecar.endsWith(".json")
      ? sidecar.slice(0, -".json".length)
      : `${sidecar}.versions`,
  };
}

export function createReviewSidecar(source: string): ReviewSidecar {
  return { schema: REVIEW_SIDECAR_SCHEMA, source, notes: [], versions: [] };
}

export function addReviewNote(
  sidecar: ReviewSidecar,
  input: ReviewNoteInput,
  options: { version: string; now?: () => Date; id?: () => string },
): ReviewSidecar {
  const text = typeof input.text === "string" ? input.text.trim() : "";
  if (!text) throw new Error("A review note needs text.");
  if (
    !(typeof input.time === "number" && Number.isFinite(input.time)) ||
    input.time < 0
  )
    throw new Error("A review note needs a time of 0 seconds or later.");
  if (input.region !== undefined && !REVIEW_REGIONS.includes(input.region))
    throw new Error(`Unknown region "${String(input.region)}".`);
  const note: ReviewNote = {
    id: options.id?.() ?? `n${randomUUID().slice(0, 8)}`,
    createdAt: (options.now?.() ?? new Date()).toISOString(),
    time: Number(input.time.toFixed(3)),
    ...(input.beat ? { beat: String(input.beat) } : {}),
    ...(input.region ? { region: input.region } : {}),
    text,
    version: options.version,
    status: "open",
  };
  return { ...sidecar, notes: [...sidecar.notes, note] };
}

/** Mark a note resolved by the given source version. */
export function resolveReviewNote(
  sidecar: ReviewSidecar,
  id: string,
  resolution: string,
  options: { version: string; now?: () => Date },
): ReviewSidecar {
  if (!sidecar.notes.some((note) => note.id === id))
    throw new Error(`No review note "${id}".`);
  return {
    ...sidecar,
    notes: sidecar.notes.map((note) =>
      note.id === id
        ? {
            ...note,
            status: "resolved",
            resolution: resolution.trim(),
            resolvedVersion: options.version,
            resolvedAt: (options.now?.() ?? new Date()).toISOString(),
          }
        : note,
    ),
  };
}

export function deleteReviewNote(
  sidecar: ReviewSidecar,
  id: string,
): ReviewSidecar {
  return { ...sidecar, notes: sidecar.notes.filter((note) => note.id !== id) };
}

/**
 * Read a sidecar, or start an empty one when the file does not exist. A
 * malformed sidecar throws (naming the file) and is never overwritten.
 */
export async function loadReviewSidecar(
  file: string,
  source: string,
): Promise<ReviewSidecar> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return createReviewSidecar(source);
    throw error;
  }
  const problem = (reason: string) =>
    new Error(
      `Review notes ${file} are not valid: ${reason}. Fix or move the file.`,
    );
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw problem((error as Error).message);
  }
  const reason = invalidSidecarReason(value);
  if (reason) throw problem(reason);
  return value as ReviewSidecar;
}

/** Write a sidecar atomically (temporary file, then rename). */
export async function saveReviewSidecar(
  file: string,
  sidecar: ReviewSidecar,
): Promise<void> {
  const reason = invalidSidecarReason(sidecar);
  if (reason)
    throw new Error(`Refusing to save invalid review notes: ${reason}.`);
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(sidecar, null, 2)}\n`);
  await rename(temporary, file);
}

/**
 * Keep a source version's text so the preview can replay it later. The
 * version id is a content hash, so an unchanged source is retained once.
 */
export async function retainReviewVersion(
  sidecar: ReviewSidecar,
  paths: ReviewPaths,
  versionId: string,
  text: string,
  now: () => Date = () => new Date(),
): Promise<ReviewSidecar> {
  if (sidecar.versions.some(({ id }) => id === versionId)) return sidecar;
  await mkdir(paths.versions, { recursive: true });
  await writeFile(versionFile(paths, versionId), text);
  return {
    ...sidecar,
    versions: [
      ...sidecar.versions,
      { id: versionId, savedAt: now().toISOString() },
    ],
  };
}

export async function readRetainedVersion(
  paths: ReviewPaths,
  versionId: string,
): Promise<string> {
  return readFile(versionFile(paths, versionId), "utf8");
}

function versionFile(paths: ReviewPaths, versionId: string): string {
  if (!VERSION_ID.test(versionId))
    throw new Error(`Invalid version id "${versionId}".`);
  return path.join(paths.versions, `${versionId}.txt`);
}

function invalidSidecarReason(value: unknown): string | null {
  if (!isRecord(value)) return "expected a JSON object";
  if (value.schema !== REVIEW_SIDECAR_SCHEMA)
    return `expected schema "${REVIEW_SIDECAR_SCHEMA}"`;
  if (typeof value.source !== "string") return "source must be a string";
  if (!Array.isArray(value.notes)) return "notes must be an array";
  if (!Array.isArray(value.versions)) return "versions must be an array";
  for (const [index, note] of value.notes.entries()) {
    if (
      !isRecord(note) ||
      typeof note.id !== "string" ||
      typeof note.text !== "string" ||
      typeof note.time !== "number" ||
      typeof note.version !== "string" ||
      (note.status !== "open" && note.status !== "resolved")
    )
      return `notes[${index}] needs id, time, text, version and status`;
  }
  for (const [index, version] of value.versions.entries())
    if (
      !isRecord(version) ||
      typeof version.id !== "string" ||
      !VERSION_ID.test(version.id)
    )
      return `versions[${index}] needs a valid id`;
  return null;
}
