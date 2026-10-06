import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import type { AnimaPoseClip } from "../../poses/animaPoseClip";
import type { MotionDescription, MotionDescriptionIssue } from "../description";
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
import {
  PreviewSourceError,
  previewClipFromText,
  resolvePreviewSource,
  sourceVersion,
  type PreviewClip,
  type PreviewRoots,
  type PreviewSource,
} from "./sources";

export type PreviewSessionOptions = {
  /** The reviewed source, then an optional source to compare with it. */
  sources: [string] | [string, string];
  roots: PreviewRoots;
  /** Explicit review-notes file (`--notes`). */
  notes?: string;
  bake: (description: MotionDescription) => AnimaPoseClip;
  now?: () => Date;
};

export type PreviewRow = {
  role: "main" | "compare";
  spec: string;
  label: string;
  path: string;
  /** Version of the playing clip; null until the source first loads. */
  version: string | null;
  /** The last valid clip (kept while the source is invalid). */
  clip: PreviewClip | null;
  error: { message: string; issues: MotionDescriptionIssue[] } | null;
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
      options.sources.map((spec) => resolvePreviewSource(spec, options.roots)),
    );
    const rows = sources.map(
      (source, index): PreviewRow => ({
        role: index === 0 ? "main" : "compare",
        spec: source.spec,
        label: source.label,
        path: source.path,
        version: null,
        clip: null,
        error: null,
      }),
    );
    const paths = reviewPathsFor(sources[0], {
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

  /** Files whose changes should trigger `reload`. */
  get watchPaths(): string[] {
    return [...this.sources.map(({ path }) => path), this.paths.sidecar];
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
        if (version === row.version && !row.error) continue;
        try {
          row.clip = previewClipFromText(text, { bake: this.options.bake });
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

  /** Replay a retained version of the reviewed source. */
  async versionClip(versionId: string): Promise<PreviewClip> {
    const text = await readRetainedVersion(this.paths, versionId);
    return previewClipFromText(text, { bake: this.options.bake });
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

function setRowError(
  row: PreviewRow,
  message: string,
  issues: MotionDescriptionIssue[] = [],
): boolean {
  const same =
    row.error?.message === message &&
    JSON.stringify(row.error.issues) === JSON.stringify(issues);
  row.error = { message, issues };
  return !same;
}
