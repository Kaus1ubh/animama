import {
  applyDraft,
  applyEffectSound,
  type AppliedEdits,
  type AppliedEffectSounds,
} from "./applied.ts";
import { addEvent, draftOf, updateEvent } from "./draft.ts";
import type { TuneEffect, TuneItem, TuneSound } from "./model.ts";

/*
 * Proposed edits for the owner to review (`content:tune --proposals <file>`):
 * sound events to add to Gestures and Reactions, and new own sounds for
 * Avatar Effects, each with a note saying why. The page applies each
 * proposal once as a draft, so the owner reviews it like any applied edit
 * (keep it with Save all, drop it with Discard applied); a proposal already
 * merged is never applied again, so a discarded one stays discarded.
 */

export type ProposedSound = {
  /** Seconds into the clip. */
  time: number;
  /** A sound ID from the catalog, `builtin:sound-effect:<key>`. */
  sound: string;
  volume?: number;
};

export type TuneProposals = {
  items?: Record<string, { note: string; add: ProposedSound[] }>;
  effects?: Record<string, { note: string; sound: string | null }>;
  /** Set by the server when the file can't be read. */
  error?: string;
};

/**
 * A proposal's identity: its target and the change it makes (not its note),
 * so a changed proposal merges again, on top of whatever the file holds then.
 */
export function proposalId(contentId: string, change: unknown): string {
  return `${contentId}:${JSON.stringify(change)}`;
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/** Whether a file entry has an item proposal's shape. */
function isItemProposal(
  value: unknown,
): value is { note?: string; add: ProposedSound[] } {
  const proposal = value as { note?: unknown; add?: unknown } | null;
  return Boolean(
    proposal &&
    typeof proposal === "object" &&
    (proposal.note === undefined || typeof proposal.note === "string") &&
    Array.isArray(proposal.add) &&
    proposal.add.every((entry: Partial<ProposedSound> | null) =>
      Boolean(
        entry &&
        isFiniteNumber(entry.time) &&
        entry.time >= 0 &&
        typeof entry.sound === "string" &&
        (entry.volume === undefined || isFiniteNumber(entry.volume)),
      ),
    ),
  );
}

/** Whether a file entry has an effect proposal's shape. */
function isEffectProposal(
  value: unknown,
): value is { note?: string; sound: string | null } {
  const proposal = value as { note?: unknown; sound?: unknown } | null;
  return Boolean(
    proposal &&
    typeof proposal === "object" &&
    (proposal.note === undefined || typeof proposal.note === "string") &&
    (proposal.sound === null || typeof proposal.sound === "string"),
  );
}

export type ProposalMerge = {
  applied: AppliedEdits;
  effectSounds: AppliedEffectSounds;
  /** Proposal IDs merged so far, this time included. */
  seen: string[];
  /** Why each proposal was made, by content ID. */
  notes: Record<string, string>;
  /** Proposals that couldn't be applied, in words. */
  problems: string[];
};

/**
 * Apply the proposals not seen before as drafts. A proposal for an item or
 * effect that already has an applied edit is left for later, so the
 * owner's own work is never replaced.
 */
export function mergeProposals(
  proposals: TuneProposals | null,
  current: {
    items: TuneItem[];
    effects: TuneEffect[];
    sounds: TuneSound[];
    applied: AppliedEdits;
    effectSounds: AppliedEffectSounds;
    seen: string[];
  },
): ProposalMerge {
  const result: ProposalMerge = {
    applied: current.applied,
    effectSounds: current.effectSounds,
    seen: [...current.seen],
    notes: {},
    problems: proposals?.error ? [proposals.error] : [],
  };
  if (!proposals) return result;
  const seen = new Set(current.seen);
  const items = new Map(current.items.map((item) => [item.contentId, item]));
  const effects = new Map(
    current.effects.map((effect) => [effect.contentId, effect]),
  );
  const sounds = new Map(current.sounds.map((sound) => [sound.ref, sound]));
  for (const [contentId, proposal] of Object.entries(proposals.items ?? {})) {
    if (!isItemProposal(proposal)) {
      result.problems.push(`${contentId}: malformed proposal.`);
      continue;
    }
    if (proposal.note) result.notes[contentId] = proposal.note;
    const id = proposalId(contentId, proposal.add);
    const item = items.get(contentId);
    if (seen.has(id) || result.applied[contentId]) continue;
    if (!item) {
      result.problems.push(`${contentId}: no such Gesture or Reaction.`);
      continue;
    }
    let draft = draftOf(item);
    const missing = proposal.add.filter((entry) => !sounds.has(entry.sound));
    if (missing.length) {
      result.problems.push(
        `${item.stem}: ${missing.map((entry) => entry.sound).join(", ")} not in the catalog.`,
      );
      continue;
    }
    for (const entry of proposal.add) {
      draft = addEvent(
        draft,
        { type: "sound", sound: sounds.get(entry.sound)! },
        entry.time,
      );
      if (entry.volume !== undefined && entry.volume !== 1)
        draft = updateEvent(draft, draft.events.at(-1)!.id, {
          volume: entry.volume,
        });
    }
    result.applied = applyDraft(result.applied, item, draft);
    seen.add(id);
    result.seen.push(id);
  }
  for (const [contentId, proposal] of Object.entries(proposals.effects ?? {})) {
    if (!isEffectProposal(proposal)) {
      result.problems.push(`${contentId}: malformed proposal.`);
      continue;
    }
    if (proposal.note) result.notes[contentId] = proposal.note;
    const id = proposalId(contentId, proposal.sound);
    const effect = effects.get(contentId);
    if (seen.has(id) || result.effectSounds[contentId]) continue;
    if (!effect) {
      result.problems.push(`${contentId}: no such Avatar Effect.`);
      continue;
    }
    if (proposal.sound !== null && !sounds.has(proposal.sound)) {
      result.problems.push(
        `${effect.stem}: ${proposal.sound} not in the catalog.`,
      );
      continue;
    }
    result.effectSounds = applyEffectSound(
      result.effectSounds,
      effect,
      proposal.sound,
    );
    seen.add(id);
    result.seen.push(id);
  }
  return result;
}
