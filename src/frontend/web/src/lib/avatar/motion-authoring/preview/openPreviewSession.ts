import { readFile } from "node:fs/promises";
import path from "node:path";

import { bakeMotion } from "../bake";
import {
  INCLUDED_AVATAR_FILES,
  REFERENCE_AVATAR_ID,
  loadHeadlessVrm,
} from "../headlessVrm";
import { PreviewSession, type PreviewSessionOptions } from "./previewSession";

/**
 * Open a preview session for the CLI: descriptions are generated on the VRM 1
 * reference Avatar, exactly as `pnpm animation generate` does.
 */
export async function openPreviewSession(
  options: Omit<PreviewSessionOptions, "bake"> & { avatarDirectory: string },
): Promise<PreviewSession> {
  const file = await readFile(
    path.join(
      options.avatarDirectory,
      INCLUDED_AVATAR_FILES[REFERENCE_AVATAR_ID],
    ),
  );
  const reference = await loadHeadlessVrm(
    file.buffer.slice(
      file.byteOffset,
      file.byteOffset + file.byteLength,
    ) as ArrayBuffer,
  );
  return PreviewSession.open({
    ...options,
    bake: (description) => bakeMotion(description, reference).clip,
  });
}
