import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { loadTuneItem } from "./content-tune-model.mjs";
import {
  STARTER_IDLE_POOL,
  TuneSaveError,
  packChanges,
  planTuneSave,
  starterIdleKeys,
} from "./content-tune-save.mjs";
import {
  PACK_SOUND_MANIFEST,
  listIncludedMetas,
  packSoundRefs,
} from "./included-dependencies.mjs";

/**
 * File I/O for `pnpm -s content:tune` saves: find the item, plan the save
 * (`content-tune-save.mjs`), validate the clip, keep each file's form and
 * write both files. Only `content/included/{gestures,reactions}` under
 * `contentRoot` is ever written.
 */

/** Where each kind lives under the content root. */
const ITEM_FOLDERS = { gesture: "gestures", reaction: "reactions" };
/** An Included folder name: lowercase words joined by hyphens. */
const STEM = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const jsonFile = (value) => `${JSON.stringify(value, null, 2)}\n`;

/**
 * The clip file's new text in the form the old one had: unchanged bytes for
 * an unchanged clip, one compact line for a compact file, else Prettier's
 * JSON style (as `effects promote` writes changed Action clips).
 */
export async function clipFileText(clip, originalText, formatJson) {
  if (JSON.stringify(clip) === JSON.stringify(JSON.parse(originalText)))
    return originalText;
  return originalText.trimEnd().includes("\n")
    ? formatJson(clip)
    : `${JSON.stringify(clip)}\n`;
}

/**
 * Replace several files together: each new text is written to a sibling
 * temporary file first, and only once all are written are they renamed into
 * place, so a failed write changes nothing. A rename failure names the files
 * already replaced, which `git restore` recovers.
 */
async function replaceFiles(changes) {
  const staged = changes.map(({ file, text }) => ({
    file,
    text,
    temporary: path.join(
      path.dirname(file),
      `.${path.basename(file)}.${randomUUID()}.tmp`,
    ),
  }));
  const replaced = [];
  try {
    for (const { temporary, text } of staged) await writeFile(temporary, text);
    for (const { file, temporary } of staged) {
      await rename(temporary, file);
      replaced.push(file);
    }
  } catch (error) {
    throw new TuneSaveError(
      `Saving failed (${error.message})${
        replaced.length
          ? `; already replaced: ${replaced.join(", ")}. Restore with git if needed.`
          : "; nothing was changed."
      }`,
    );
  } finally {
    await Promise.all(
      staged.map(({ temporary }) => rm(temporary, { force: true })),
    );
  }
}

/**
 * The tuning server's writer. `repoRoot` holds the tracked pack manifest
 * and starter idle seed; `contentRoot` the Included content it edits.
 * `validateClip(clip)` returns `{ ok, issues }` (the app's 2.0 validator),
 * `maxClipBytes` is the largest clip the app loads, `formatJson(value)`
 * formats a clip and `packSounds` lists every sound ID the page offers.
 */
export function createTuneWriter({
  repoRoot,
  contentRoot,
  includedTypes,
  packSounds,
  validateClip,
  maxClipBytes,
  formatJson,
}) {
  const readJson = async (relative) =>
    JSON.parse(await readFile(path.join(repoRoot, relative), "utf8"));

  async function context() {
    return {
      shipped: packSoundRefs(await readJson(PACK_SOUND_MANIFEST)),
      idleKeys: starterIdleKeys(await readJson(STARTER_IDLE_POOL)),
    };
  }

  /**
   * The Included item `kind`/`stem` names, as loaded from disk now. The
   * stem must be a plain folder name, so a request can't name another path.
   */
  async function find(kind, stem) {
    if (!Object.hasOwn(ITEM_FOLDERS, kind))
      throw new TuneSaveError("Unknown item kind.");
    if (typeof stem !== "string" || !STEM.test(stem))
      throw new TuneSaveError("Unknown item.");
    const metaPath = path.join(
      contentRoot,
      ITEM_FOLDERS[kind],
      stem,
      `${stem}.meta.json`,
    );
    const item = await loadTuneItem(kind, metaPath).catch((error) => {
      if (error.code === "ENOENT") return null;
      throw new TuneSaveError(error.message);
    });
    if (!item) throw new TuneSaveError(`No Included ${kind} "${stem}".`);
    return item;
  }

  /**
   * Save one edit. Returns the reloaded item, the pack sounds it uses that
   * the tracked manifest lacks, and whether a Gesture clip changed (its
   * sample baseline then needs updating).
   */
  async function save(edit) {
    // Plan from the very texts the revision was computed from.
    const current = await find(edit?.kind, edit?.stem);
    const { metaText, clipText } = current;
    const { shipped, idleKeys } = await context();
    const plan = planTuneSave(
      {
        kind: current.kind,
        contentId: current.contentId,
        revision: current.revision,
        meta: JSON.parse(metaText),
        clip: JSON.parse(clipText),
      },
      edit,
      { includedTypes, packSounds, shipped, idleKeys },
    );
    const result = validateClip(plan.clip);
    if (!result.ok)
      throw new TuneSaveError(
        `The clip is not a valid animaPoseClip/2.0: ${result.issues
          .slice(0, 3)
          .map((issue) => `${issue.path}: ${issue.message}`)
          .join("; ")}`,
      );
    const nextClip = await clipFileText(plan.clip, clipText, formatJson);
    const size = Buffer.byteLength(nextClip);
    if (size > maxClipBytes)
      throw new TuneSaveError(
        `The clip would be ${size} bytes, over the ${maxClipBytes} the app loads.`,
      );
    const nextMeta = jsonFile(plan.meta);
    const clipChanged = nextClip !== clipText;
    await replaceFiles([
      ...(clipChanged ? [{ file: current.clipPath, text: nextClip }] : []),
      ...(nextMeta !== metaText
        ? [{ file: current.metaPath, text: nextMeta }]
        : []),
    ]);
    return {
      item: await find(current.kind, current.stem),
      pendingSounds: plan.pendingSounds,
      rebaseline:
        current.kind === "gesture" && clipChanged ? current.stem : null,
    };
  }

  /**
   * The pack changes all Included content needs now. `contentRoot` must be
   * a `content/included` folder, as `listIncludedMetas` walks it.
   */
  async function pending() {
    const { shipped } = await context();
    const metas = listIncludedMetas(path.resolve(contentRoot, "../.."), {
      readFileSync,
      readdirSync,
    });
    return packChanges(
      metas.map(({ value }) => value),
      shipped,
    );
  }

  return { find, save, pending };
}
