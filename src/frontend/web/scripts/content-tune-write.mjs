import { randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { planEffectSound } from "./content-tune-effects.mjs";
import {
  listTuneItems,
  loadTuneEffect,
  loadTuneItem,
} from "./content-tune-model.mjs";
import {
  STARTER_LOADOUT,
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
 * and starter loadout (its Idle seed); `contentRoot` the Included content it
 * edits, and `effectsRoot` (default `contentRoot`) the one whose Avatar
 * Effects' sounds it changes.
 * `validateClip(clip)` returns `{ ok, issues }` (the app's 2.0 validator),
 * `maxClipBytes` is the largest clip the app loads, `formatJson(value)`
 * formats a clip and `packSounds` lists every sound ID the page offers.
 */
export function createTuneWriter({
  repoRoot,
  contentRoot,
  effectsRoot = contentRoot,
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
      idleKeys: starterIdleKeys(await readJson(STARTER_LOADOUT)),
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

  /** Plan and check one edit without writing: its file changes and notes. */
  async function prepare(edit, { shipped, idleKeys }) {
    // Plan from the very texts the revision was computed from.
    const current = await find(edit?.kind, edit?.stem);
    const { metaText, clipText } = current;
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
    return {
      current,
      plan,
      clipChanged,
      changes: [
        ...(clipChanged ? [{ file: current.clipPath, text: nextClip }] : []),
        ...(nextMeta !== metaText
          ? [{ file: current.metaPath, text: nextMeta }]
          : []),
      ],
    };
  }

  /**
   * Save several edits together. Every edit is planned and checked first;
   * if any is refused (naming its item), nothing is written. Otherwise all
   * files are replaced together. Returns the reloaded items, the pack sounds
   * they use that the tracked manifest lacks, and the Gestures whose clips
   * changed (their sample baselines then need updating).
   */
  /** Plan and check one effect sound change without writing. */
  async function prepareEffect(change, { shipped }) {
    const contentId = change?.contentId;
    if (typeof contentId !== "string")
      throw new TuneSaveError("Unknown effect.");
    const effect = await loadTuneEffect(effectsRoot, contentId);
    if (!effect)
      throw new TuneSaveError(`No Included Avatar Effect ${contentId}.`);
    if (change.revision !== effect.revision)
      throw new TuneSaveError(
        `${contentId} changed on disk since it was loaded; reload it and redo the change.`,
      );
    if (change.sound !== null && typeof change.sound !== "string")
      throw new TuneSaveError("Name the effect's new sound, or null for none.");
    const { sound } = change;
    if (sound === null) {
      // Removing a sound a use picks by alias would break that use.
      const alias = effect.descriptor.definition?.soundAlias;
      const { gestures, reactions } = await listTuneItems(contentRoot);
      const users = [...gestures, ...reactions].filter((item) => {
        const aliases = new Set(
          item.dependencies
            .filter((dependency) => dependency.ref === contentId)
            .map((dependency) => dependency.alias),
        );
        return (item.clip.events ?? []).some(
          (event) =>
            event.kind === "avatar_vfx" &&
            aliases.has(event.effectId) &&
            event.override?.soundAlias === alias,
        );
      });
      if (users.length)
        throw new TuneSaveError(
          `${users.map((item) => item.stem).join(", ")} pick this sound for their use; change those events first.`,
        );
    }
    const next = planEffectSound(effect.descriptor, sound, { packSounds });
    const text = jsonFile(next);
    return {
      effect,
      changes: text === effect.text ? [] : [{ file: effect.path, text }],
      pendingSounds: sound && !shipped.has(sound) ? [sound] : [],
    };
  }

  /**
   * Save item edits and effect sound changes together. Every change is
   * planned and checked first; if any is refused (naming it), nothing is
   * written. Otherwise all files are replaced together. Returns the
   * reloaded items and effects, the pack sounds they use that the tracked
   * manifest lacks, and the Gestures whose clips changed (their sample
   * baselines then need updating).
   */
  async function saveAll(edits = [], effectChanges = []) {
    if (!Array.isArray(edits) || !Array.isArray(effectChanges))
      throw new TuneSaveError("Expected lists of edits and effect changes.");
    if (!edits.length && !effectChanges.length)
      throw new TuneSaveError("Nothing to save.");
    const stems = edits.map((edit) => `${edit?.kind}:${edit?.stem}`);
    const effectIds = effectChanges.map((change) => change?.contentId);
    if (
      new Set(stems).size !== stems.length ||
      new Set(effectIds).size !== effectIds.length
    )
      throw new TuneSaveError("An item appears twice in one save.");
    const rules = await context();
    const prepared = [];
    for (const edit of edits) {
      try {
        prepared.push(await prepare(edit, rules));
      } catch (error) {
        const label = typeof edit?.stem === "string" ? edit.stem : "an item";
        throw new TuneSaveError(
          `Nothing was saved. ${label}: ${error.message}`,
        );
      }
    }
    const effects = [];
    for (const change of effectChanges) {
      try {
        effects.push(await prepareEffect(change, rules));
      } catch (error) {
        const label =
          typeof change?.contentId === "string"
            ? change.contentId
            : "an effect";
        throw new TuneSaveError(
          `Nothing was saved. ${label}: ${error.message}`,
        );
      }
    }
    await replaceFiles([
      ...prepared.flatMap(({ changes }) => changes),
      ...effects.flatMap(({ changes }) => changes),
    ]);
    return {
      items: await Promise.all(
        prepared.map(({ current }) => find(current.kind, current.stem)),
      ),
      effects: await Promise.all(
        effects.map(({ effect }) =>
          loadTuneEffect(effectsRoot, effect.contentId),
        ),
      ),
      pendingSounds: [
        ...new Set([
          ...prepared.flatMap(({ plan }) => plan.pendingSounds),
          ...effects.flatMap(({ pendingSounds }) => pendingSounds),
        ]),
      ],
      rebaseline: prepared
        .filter(
          ({ current, clipChanged }) =>
            current.kind === "gesture" && clipChanged,
        )
        .map(({ current }) => current.stem),
    };
  }

  /** Save one edit: `saveAll` with a single item. */
  async function save(edit) {
    const { items, pendingSounds, rebaseline } = await saveAll([edit]);
    return {
      item: items[0],
      pendingSounds,
      rebaseline: rebaseline[0] ?? null,
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

  return { find, save, saveAll, pending };
}
