import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import {
  addReviewNote,
  deleteReviewNote,
  loadReviewSidecar,
  readRetainedVersion,
  retainReviewVersion,
  reviewPathsFor,
  saveReviewSidecar,
  type ReviewNoteInput,
  type ReviewPaths,
  type ReviewSidecar,
} from "./reviewNotes";
import { AvatarEffectDefinitionError } from "../../vfx/definition";
import { effectSourceEntry } from "../../vfx/effectSource";
import {
  EMPTY_PREVIEW_MEDIA,
  clipUsesMedia,
  previewSceneEntry,
  type PreviewEffect,
  type PreviewMedia,
} from "./previewMedia";
import {
  PreviewSourceError,
  isInLibraryContent,
  previewClipFromText,
  resolvePreviewSource,
  sourceVersion,
  type PreviewClip,
  type PreviewIssue,
  type PreviewMediaAdapter,
  type PreviewRoots,
  type PreviewSource,
} from "./sources";

export type PreviewSessionOptions = {
  /** The reviewed source, then an optional source to compare with it. */
  sources: [string] | [string, string];
  roots: PreviewRoots;
  /** Explicit review-notes file (`--notes`). */
  notes?: string;
  /** Avatar Effect sources and clip dependencies; without it, clips only. */
  media?: PreviewMediaAdapter;
  now?: () => Date;
};

export type PreviewRow = {
  role: "main" | "compare";
  spec: string;
  /** A clip (Gesture, Reaction or project) or an effect source of any kind. */
  type: "clip" | "effect";
  label: string;
  path: string;
  /** Version of the playing source; null until it first loads. */
  version: string | null;
  /** The last valid clip (kept while the source is invalid). */
  clip: PreviewClip | null;
  /** The last valid effect source (kept while it is invalid). */
  effect: PreviewEffect | null;
  /** Effects the clip's events play; null when it has no such events. */
  media: PreviewMedia | null;
  error: { message: string; issues: PreviewIssue[] } | null;
};

export type PreviewState = {
  /** Increases whenever anything a page shows changes. */
  generation: number;
  rows: PreviewRow[];
  review: {
    path: string;
    sidecar: ReviewSidecar | null;
    error: string | null;
  };
};

/**
 * One preview tool run: the reviewed source (and an optional comparison), the
 * versions retained as the source changes, and the review notes. The CLI
 * server owns HTTP and file watching; this owns what they read and write.
 */
export class PreviewSession {
  private generation = 0;
  private reviewError: string | null = null;
  private sidecar: ReviewSidecar | null = null;
  /** Serialises reloads and note edits so no write is based on stale notes. */
  private queue: Promise<unknown> = Promise.resolve();

  private readonly options: PreviewSessionOptions;
  private readonly sources: PreviewSource[];
  private readonly rows: PreviewRow[];
  private readonly paths: ReviewPaths;
  /** Each effect source's descriptor and images, as last loaded. */
  private readonly effectFiles = new Map<number, string[]>();

  private constructor(
    options: PreviewSessionOptions,
    sources: PreviewSource[],
    rows: PreviewRow[],
    paths: ReviewPaths,
  ) {
    this.options = options;
    this.sources = sources;
    this.rows = rows;
    this.paths = paths;
  }

  static async open(options: PreviewSessionOptions): Promise<PreviewSession> {
    const sources = await Promise.all(
      options.sources.map(
        async (spec) =>
          (await options.media?.resolve(spec, options.roots)) ??
          resolvePreviewSource(spec, options.roots),
      ),
    );
    const rows = sources.map(
      (source, index): PreviewRow => ({
        role: index === 0 ? "main" : "compare",
        spec: source.spec,
        type: source.type ?? "clip",
        label: source.label,
        path: source.path,
        version: null,
        clip: null,
        effect: null,
        media: null,
        error: null,
      }),
    );
    // Notes never go inside Library content, even for a file given by path:
    // the content scanner would take them for files of the item.
    const reviewed = (await isInLibraryContent(sources[0].path, options.roots))
      ? { ...sources[0], kind: "library" as const }
      : sources[0];
    const paths = reviewPathsFor(reviewed, {
      cwd: options.roots.cwd,
      notes: options.notes,
    });
    // The notes folder must exist so its sidecar can be watched for the
    // agent's resolutions before the first note is written.
    await mkdir(path.dirname(paths.sidecar), { recursive: true });
    const session = new PreviewSession(options, sources, rows, paths);
    await session.reload();
    return session;
  }

  /**
   * Continue numbering after a session this one replaces (the page picked
   * other sources), so pages never take its state for older state.
   */
  continueAfter(generation: number) {
    this.generation = Math.max(this.generation, generation + 1);
  }

  /**
   * Files whose changes should trigger `reload`, including each effect
   * source's images (which can change when its descriptor does).
   */
  get watchPaths(): string[] {
    return [
      ...new Set([
        ...this.sources.map(({ path }) => path),
        ...[...this.effectFiles.values()].flat(),
        this.paths.sidecar,
      ]),
    ];
  }

  /**
   * Folders whose every change should trigger `reload`: each effect source's
   * folder, so an image the descriptor names but that is missing (or newly
   * renamed) is picked up when it appears. The version hash makes a change
   * that alters nothing a no-op.
   */
  get watchDirs(): string[] {
    return [
      ...new Set(
        this.sources
          .filter(({ type }) => type === "effect")
          .map(({ path: file }) => path.dirname(file)),
      ),
    ];
  }

  get reviewPaths(): ReviewPaths {
    return this.paths;
  }

  /**
   * Re-read every source and the notes. A changed reviewed source is retained
   * as a new version. Returns whether anything changed.
   */
  reload(): Promise<boolean> {
    return this.serialize(async () => {
      // Notes first, so a changed reviewed source is retained in them.
      let changed = await this.reloadNotes();
      for (const [index, source] of this.sources.entries()) {
        const row = this.rows[index];
        if (row.type === "effect") {
          changed = (await this.reloadEffect(index)) || changed;
          continue;
        }
        let text: string;
        try {
          text = await readFile(source.path, "utf8");
        } catch (error) {
          changed =
            setRowError(
              row,
              `Cannot read ${source.path}: ${(error as Error).message}`,
            ) || changed;
          continue;
        }
        const version = sourceVersion(text);
        if (version === row.version && !row.error) {
          // Retain it now if an earlier attempt failed (for example while
          // the notes file was broken).
          if (
            row.role === "main" &&
            this.sidecar &&
            !this.sidecar.versions.some(({ id }) => id === version)
          )
            await this.retain(version, text);
          continue;
        }
        try {
          const clip = previewClipFromText(text);
          row.media = await this.mediaFor(source, clip);
          row.clip = clip;
        } catch (error) {
          changed =
            setRowError(
              row,
              (error as Error).message,
              error instanceof PreviewSourceError ? error.issues : [],
            ) || changed;
          continue;
        }
        row.version = version;
        row.error = null;
        changed = true;
        if (row.role === "main") await this.retain(version, text);
      }
      if (changed) this.generation += 1;
      return changed;
    });
  }

  /** Re-read an effect source; same contract as a clip row in `reload`. */
  private async reloadEffect(index: number): Promise<boolean> {
    const source = this.sources[index];
    const row = this.rows[index];
    let loaded: Awaited<ReturnType<PreviewMediaAdapter["load"]>>;
    try {
      loaded = await this.options.media!.load(source, this.options.roots);
      this.effectFiles.set(index, loaded.files);
      validatePreviewEffect(loaded.effect);
    } catch (error) {
      return setRowError(
        row,
        (error as Error).message,
        error instanceof PreviewSourceError ? error.issues : [],
      );
    }
    if (loaded.version === row.version && !row.error) {
      if (
        row.role === "main" &&
        this.sidecar &&
        !this.sidecar.versions.some(({ id }) => id === loaded.version)
      )
        await this.retain(loaded.version, loaded.text);
      return false;
    }
    row.effect = loaded.effect;
    row.version = loaded.version;
    row.error = null;
    if (row.role === "main") await this.retain(loaded.version, loaded.text);
    return true;
  }

  /**
   * The effects a clip's events play: resolved from a project envelope's
   * dependencies or a Library item's meta file. Null when no event needs
   * them; a dependency that cannot be read becomes a notice, not an error.
   */
  private async mediaFor(
    source: PreviewSource,
    clip: PreviewClip,
  ): Promise<PreviewMedia | null> {
    const adapter = this.options.media;
    if (!adapter || !clipUsesMedia(clip.clip)) return null;
    if (clip.dependencies)
      return adapter.media(clip.dependencies, this.options.roots);
    if (!source.metaPath) return null;
    try {
      const meta = JSON.parse(await readFile(source.metaPath, "utf8")) as {
        dependencies?: unknown;
      };
      return await adapter.media(meta?.dependencies, this.options.roots);
    } catch (error) {
      return {
        ...EMPTY_PREVIEW_MEDIA,
        notices: [
          `Cannot read the dependencies in ${source.metaPath}: ${(error as Error).message}`,
        ],
      };
    }
  }

  state(): PreviewState {
    return {
      generation: this.generation,
      rows: this.rows.map((row) => ({ ...row })),
      review: {
        path: this.paths.sidecar,
        sidecar: this.sidecar,
        error: this.reviewError,
      },
    };
  }

  /** Add a note against the reviewed source's current version. */
  addNote(input: ReviewNoteInput): Promise<PreviewState> {
    return this.serialize(async () => {
      const version = this.rows[0].version;
      if (!version) throw new Error("The reviewed source has not loaded yet.");
      await this.updateSidecar((sidecar) =>
        addReviewNote(sidecar, input, { version, now: this.options.now }),
      );
      return this.state();
    });
  }

  deleteNote(id: string): Promise<PreviewState> {
    return this.serialize(async () => {
      await this.updateSidecar((sidecar) => deleteReviewNote(sidecar, id));
      return this.state();
    });
  }

  /** Replay a retained version of the reviewed clip. */
  async versionClip(versionId: string): Promise<PreviewClip> {
    // An effect's retained descriptor lacks its images, so it cannot replay.
    if (this.rows[0].type === "effect")
      throw new Error("Earlier effect versions cannot be replayed.");
    const text = await readRetainedVersion(this.paths, versionId);
    return previewClipFromText(text);
  }

  private serialize<T>(task: () => Promise<T>): Promise<T> {
    const next = this.queue.then(task, task);
    this.queue = next.catch(() => undefined);
    return next;
  }

  /** Retain a source version; a storage failure is a notes problem. */
  private async retain(version: string, text: string) {
    try {
      await this.updateSidecar((sidecar) =>
        retainReviewVersion(
          sidecar,
          this.paths,
          version,
          text,
          this.options.now,
        ),
      );
    } catch (error) {
      this.reviewError = (error as Error).message;
    }
  }

  /**
   * Change the notes as they are on disk now (another process, such as
   * `animation resolve`, may have written them since the last reload).
   */
  private async updateSidecar(
    change: (sidecar: ReviewSidecar) => ReviewSidecar | Promise<ReviewSidecar>,
  ) {
    const current = await loadReviewSidecar(
      this.paths.sidecar,
      this.sourceRef(),
    );
    const next = await change(current);
    if (next !== current) await saveReviewSidecar(this.paths.sidecar, next);
    if (JSON.stringify(next) !== JSON.stringify(this.sidecar))
      this.generation += 1;
    this.sidecar = next;
    this.reviewError = null;
  }

  private async reloadNotes(): Promise<boolean> {
    const before = JSON.stringify([this.sidecar, this.reviewError]);
    try {
      this.sidecar = await loadReviewSidecar(
        this.paths.sidecar,
        this.sourceRef(),
      );
      this.reviewError = null;
    } catch (error) {
      // Keep showing the last good notes; never overwrite a malformed file.
      this.reviewError = (error as Error).message;
    }
    return JSON.stringify([this.sidecar, this.reviewError]) !== before;
  }

  /** The reviewed file, relative to the sidecar (as `animation resolve` reads it). */
  private sourceRef(): string {
    return path.relative(
      path.dirname(this.paths.sidecar),
      this.sources[0].path,
    );
  }
}

/**
 * Parse an effect source as runtime loading would, so a definition problem is
 * reported by field like a clip's, before the page tries to apply it. (A
 * Particle Effect's manifest is parsed by the page's particle loader, whose
 * errors the page shows.)
 */
function validatePreviewEffect(effect: PreviewEffect): void {
  try {
    if (effect.kind === "avatar_effect") effectSourceEntry(effect);
    else if (effect.kind === "scene_effect") previewSceneEntry(effect);
  } catch (error) {
    const kind =
      effect.kind === "avatar_effect" ? "Avatar Effect" : "Scene Effect";
    const field =
      error instanceof AvatarEffectDefinitionError
        ? (error.field ?? "definition")
        : "definition";
    throw new PreviewSourceError(`The ${kind} cannot be played.`, [
      {
        path: field,
        message: error instanceof Error ? error.message : String(error),
      },
    ]);
  }
}

function setRowError(
  row: PreviewRow,
  message: string,
  issues: PreviewIssue[] = [],
): boolean {
  const same =
    row.error?.message === message &&
    JSON.stringify(row.error.issues) === JSON.stringify(issues);
  row.error = { message, issues };
  return !same;
}
