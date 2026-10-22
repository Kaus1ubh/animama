import type {
  PreviewEffect,
  PreviewMedia,
} from "@/lib/avatar/motion-authoring/preview/previewMedia";
import type { PreviewClip } from "@/lib/avatar/motion-authoring/preview/sources";
import program from "virtual:landing-program";

/**
 * Everything the page plays, resolved ahead of time (`landing-stage-content.mjs`):
 * from the stage server in development, and bundled into the page by the
 * production build, whose URLs point at its own content-hashed files.
 */
export type StageProgram = {
  /** Each of `STAGE_AVATARS` with its VRM's URL, in the same order. */
  avatars: { id: string; url: string }[];
  /** Each Avatar's portrait URL, by id. */
  portraits: Record<string, string>;
  /** Each clip and effect the stops name, by Library spec. */
  sources: Record<
    string,
    {
      clip: PreviewClip | null;
      effect: PreviewEffect | null;
      media: PreviewMedia | null;
    }
  >;
  /** Sources that failed to resolve (the build refuses any). */
  problems: string[];
  /** Entrance clip URLs by file name. */
  walk: Record<string, string>;
};

export const PROGRAM: StageProgram = program;
