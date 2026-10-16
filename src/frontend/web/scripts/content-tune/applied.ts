import { draftOf, saveRequest, type TuneDraft } from "./draft.ts";
import { effectDefaultSound, type TuneEffect, type TuneItem } from "./model.ts";

/*
 * Applied edits: drafts the owner has applied but not yet saved. They live
 * in this browser's local storage for the page's origin, keyed by checkout
 * (`TuneState.checkout`), so a page reload keeps them, and so does
 * restarting `content:tune` on the same port (its default port is fixed for
 * this reason); another worktree on that port has its own. Save all writes
 * every one of them in a single all-or-nothing save.
 */

/** One applied edit: the draft and the file revision it was made from. */
export type AppliedEdit = {
  kind: TuneItem["kind"];
  stem: string;
  revision: string;
  draft: TuneDraft;
};

/** Applied edits by content ID. */
export type AppliedEdits = Record<string, AppliedEdit>;

/** The storage key of a checkout's applied edits. */
export function appliedStorageKey(checkout: string): string {
  return `content-tune:applied:v1:${checkout}`;
}

/** Whether a stored value has an applied edit's shape. */
function isAppliedEdit(value: unknown): value is AppliedEdit {
  const edit = value as Partial<AppliedEdit> | null;
  return Boolean(
    edit &&
    (edit.kind === "gesture" || edit.kind === "reaction") &&
    typeof edit.stem === "string" &&
    typeof edit.revision === "string" &&
    edit.draft &&
    Array.isArray(edit.draft.events) &&
    Array.isArray(edit.draft.dependencies) &&
    edit.draft.expressions &&
    typeof edit.draft.expressions === "object",
  );
}

/**
 * The applied edits kept in `storage`; none when unreadable. Entries of
 * another shape (an older page) are left out rather than break the page.
 */
export function readApplied(
  storage: Storage | undefined,
  key: string,
): AppliedEdits {
  try {
    const value = JSON.parse(storage?.getItem(key) ?? "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter(([, edit]) => isAppliedEdit(edit)),
    ) as AppliedEdits;
  } catch {
    return {};
  }
}

/** Keep the applied edits in `storage`; a failure only loses persistence. */
export function writeApplied(
  storage: Storage | undefined,
  key: string,
  applied: AppliedEdits,
): void {
  try {
    if (Object.keys(applied).length)
      storage?.setItem(key, JSON.stringify(applied));
    else storage?.removeItem(key);
  } catch {
    // Private windows and full storage keep the edits for this page only.
  }
}

/**
 * The applied edits after applying `draft` to `item`. A draft equal to the
 * item's file removes its entry, as there is nothing left to save. An entry
 * keeps the revision it was first made from, so Save all refuses it if the
 * file has changed since.
 */
export function applyDraft(
  applied: AppliedEdits,
  item: TuneItem,
  draft: TuneDraft,
  /** The file revision the edit started from (default: the item's). */
  revision: string = item.revision,
): AppliedEdits {
  const next = { ...applied };
  if (JSON.stringify(draft) === JSON.stringify(draftOf(item)))
    delete next[item.contentId];
  else
    next[item.contentId] = {
      kind: item.kind,
      stem: item.stem,
      revision: applied[item.contentId]?.revision ?? revision,
      draft,
    };
  return next;
}

export function discardApplied(
  applied: AppliedEdits,
  contentIds: string[],
): AppliedEdits {
  const next = { ...applied };
  for (const id of contentIds) delete next[id];
  return next;
}

/**
 * Applied edits whose item is gone or whose file changed since the edit was
 * applied: Save all would refuse them, so the page asks to discard them.
 */
export function staleApplied(
  applied: AppliedEdits,
  items: TuneItem[],
): string[] {
  const revisions = new Map(
    items.map((item) => [item.contentId, item.revision]),
  );
  return Object.entries(applied)
    .filter(([id, edit]) => revisions.get(id) !== edit.revision)
    .map(([id]) => id);
}

/** An applied change to an Avatar Effect's own sound (null: silent). */
export type AppliedEffectSound = { revision: string; sound: string | null };

/** Applied effect sound changes by effect content ID. */
export type AppliedEffectSounds = Record<string, AppliedEffectSound>;

/** The storage key of a checkout's applied effect sound changes. */
export function effectSoundsStorageKey(checkout: string): string {
  return `content-tune:effect-sounds:v1:${checkout}`;
}

/** The applied effect sound changes kept in `storage`; none when unreadable. */
export function readEffectSounds(
  storage: Storage | undefined,
  key: string,
): AppliedEffectSounds {
  try {
    const value = JSON.parse(storage?.getItem(key) ?? "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter(
        ([, change]) =>
          change &&
          typeof (change as AppliedEffectSound).revision === "string" &&
          ((change as AppliedEffectSound).sound === null ||
            typeof (change as AppliedEffectSound).sound === "string"),
      ),
    ) as AppliedEffectSounds;
  } catch {
    return {};
  }
}

/**
 * The effect sound changes after choosing `sound` for `effect`. Choosing the
 * sound the effect's file already plays removes the entry.
 */
export function applyEffectSound(
  applied: AppliedEffectSounds,
  effect: TuneEffect,
  sound: string | null,
): AppliedEffectSounds {
  const next = { ...applied };
  if (sound === effectDefaultSound(effect)) delete next[effect.contentId];
  else
    next[effect.contentId] = {
      revision: applied[effect.contentId]?.revision ?? effect.revision ?? "",
      sound,
    };
  return next;
}

/** Applied effect sound changes whose effect is gone or changed since. */
export function staleEffectSounds(
  applied: AppliedEffectSounds,
  effects: TuneEffect[],
): string[] {
  const revisions = new Map(
    effects.map((effect) => [effect.contentId, effect.revision]),
  );
  return Object.entries(applied)
    .filter(([id, change]) => revisions.get(id) !== change.revision)
    .map(([id]) => id);
}

/**
 * The Save all request: one save edit per applied item and one change per
 * applied effect sound.
 */
export function saveAllRequest(
  applied: AppliedEdits,
  items: TuneItem[],
  effectSounds: AppliedEffectSounds = {},
) {
  const byId = new Map(items.map((item) => [item.contentId, item]));
  return {
    edits: Object.entries(applied).flatMap(([id, edit]) => {
      const item = byId.get(id);
      return item
        ? [saveRequest({ ...item, revision: edit.revision }, edit.draft)]
        : [];
    }),
    effects: Object.entries(effectSounds).map(([contentId, change]) => ({
      contentId,
      revision: change.revision,
      sound: change.sound,
    })),
  };
}
