import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

import { REACTION_INTENSITIES } from "@/lib/avatar/reactionPools";
import type { EffectSource } from "@/lib/avatar/vfx/effectSource";
import { TRACKED_EMOTIONS } from "@/lib/emotion";
import { Button } from "@/ui/components/button";
import { Input } from "@/ui/components/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/ui/components/tabs";

import type { PageClipMedia } from "../effect-render/session";
import {
  TuneIndex,
  eventCounts,
  ladderNotes,
  peakExpressions,
  soundGroups,
  effectDefaultSound,
  type TuneEvent,
  type TuneItem,
  type TuneSound,
  type TuneEffect,
  type TuneState,
} from "./model";
import {
  appliedStorageKey,
  applyDraft,
  applyEffectSound,
  discardApplied,
  effectSoundsStorageKey,
  readEffectSounds,
  staleEffectSounds,
  type AppliedEffectSounds,
  readApplied,
  saveAllRequest,
  staleApplied,
  writeApplied,
  type AppliedEdits,
} from "./applied";
import { useAudition } from "./audition";
import { draftOf, updateEvent, type TuneDraft } from "./draft";
import {
  EventsEditor,
  ExpressionsEditor,
  SoundPicker,
  type Audition,
} from "./editor";
import { PlacementSection } from "./placement";
import { PreviewPlayer, type PlayerState } from "./player";

/*
 * The owner's content-tuning page (served by `scripts/content-tune.mjs`):
 * Included Gestures, the Reaction ladder and the WOW Sound catalog, with a
 * live preview of the selected item on an Included Avatar and editing of
 * its events and (Reactions) peak expressions, saved to Included content.
 */

/** Save all's answer: the reloaded items and what the owner must do next. */
type SaveResult = {
  items: TuneItem[];
  effects: TuneEffect[];
  pendingSounds: string[];
  rebaseline: string[];
};

/** The item as its draft would play it. */
function withDraft(item: TuneItem, draft: TuneDraft): TuneItem {
  return {
    ...item,
    dependencies: draft.dependencies,
    clip: {
      ...item.clip,
      events: draft.events,
      expressions: draft.expressions,
    },
  };
}

/** The beat a new expression key sits on: the strongest key's, else the first. */
function peakBeat(item: TuneItem): string {
  let best: { v: number; beat?: string } | null = null;
  for (const frames of Object.values(item.clip.expressions ?? {}))
    for (const frame of frames) if (!best || frame.v > best.v) best = frame;
  const beats = (item.clip.beats as { id: string }[] | undefined) ?? [];
  return best?.beat ?? beats[0]?.id ?? "peak";
}

const INTENSITY_LABELS: Record<number, string> = {
  1: "Mild",
  2: "Moderate",
  3: "Strong",
  4: "Intense",
};
const STAGE_SIZE = { width: 560, height: 420 };

async function api<T>(route: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/__tune/${route}`, {
    ...init,
    headers: init?.body
      ? { "content-type": "application/json", ...init.headers }
      : init?.headers,
  });
  const body = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? response.statusText);
  return body;
}

function SoundRow({
  sound,
  playing,
  onToggle,
}: {
  sound: TuneSound;
  playing: boolean;
  onToggle: () => void;
}) {
  return (
    <li className="flex items-center gap-2 py-1">
      <Button
        size="icon-sm"
        variant="outline"
        disabled={!sound.available}
        aria-label={playing ? `Stop ${sound.name}` : `Play ${sound.name}`}
        onClick={onToggle}
      >
        {playing ? "■" : "▶"}
      </Button>
      <span className="min-w-0 flex-1 truncate" title={sound.key}>
        {sound.name}
      </span>
      {sound.duration !== null && (
        <span className="text-muted-foreground text-xs tabular-nums">
          {sound.duration.toFixed(1)} s
        </span>
      )}
      {sound.shipped && (
        <span className="bg-muted rounded px-1.5 py-0.5 text-xs">In pack</span>
      )}
    </li>
  );
}

function SoundCatalog({
  sounds,
  catalog,
  audition,
}: {
  sounds: TuneSound[];
  catalog: boolean;
  audition: Audition;
}) {
  const [query, setQuery] = useState("");
  const { playing, toggle } = audition;
  const shown = sounds.filter((sound) =>
    `${sound.name} ${sound.key} ${sound.category}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  return (
    <div className="flex min-h-0 flex-col gap-2">
      <Input
        placeholder="Search sounds"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {!sounds.some((sound) => sound.available) && (
        <p className="text-destructive text-xs">
          No sound files found, so nothing can be heard. Pass --sounds with the
          comedy pack (such as the primary checkout&apos;s
          build-inputs/wow-comedy-sfx) or --catalog with the vendor folder.
        </p>
      )}
      {!catalog && (
        <p className="text-muted-foreground text-xs">
          Only the pack's sounds are listed. Pass --catalog to list the full WOW
          Sound catalog.
        </p>
      )}
      <div className="min-h-0 overflow-y-auto pr-1">
        {soundGroups(shown).map(([category, group]) => (
          <section key={category} className="mb-3">
            <h3 className="text-muted-foreground mb-1 text-xs font-semibold tracking-wide uppercase">
              {category} ({group.length})
            </h3>
            <ul>
              {group.map((sound) => (
                <SoundRow
                  key={sound.key}
                  sound={sound}
                  playing={playing === sound.key}
                  onToggle={() => toggle(sound)}
                />
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

function EventChips({ item }: { item: TuneItem }) {
  const counts = eventCounts(item);
  const chips = [
    ["A", counts.avatar_vfx],
    ["P", counts.particle_vfx],
    ["S", counts.scene_vfx],
    ["♪", counts.sfx],
  ].filter(([, count]) => count);
  return (
    <span className="flex gap-1">
      {chips.map(([label, count]) => (
        <span
          key={label}
          className="bg-muted rounded px-1 text-[11px] tabular-nums"
          title={`${count} ${label === "♪" ? "sound" : "effect"} event(s)`}
        >
          {label}
          {count}
        </span>
      ))}
    </span>
  );
}

function GestureList({
  gestures,
  applied,
  selected,
  onSelect,
}: {
  gestures: TuneItem[];
  applied: AppliedEdits;
  selected: string | null;
  onSelect: (item: TuneItem) => void;
}) {
  const [query, setQuery] = useState("");
  const shown = gestures.filter((item) =>
    `${item.name} ${item.stem}`
      .toLowerCase()
      .includes(query.trim().toLowerCase()),
  );
  return (
    <div className="flex min-h-0 flex-col gap-2">
      <Input
        placeholder={`Search ${gestures.length} Gestures`}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <ul className="min-h-0 overflow-y-auto pr-1">
        {shown.map((item) => (
          <li key={item.stem}>
            <button
              type="button"
              className={`hover:bg-muted flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm ${
                selected === item.contentId ? "bg-muted font-medium" : ""
              }`}
              onClick={() => onSelect(item)}
            >
              <span className="min-w-0 flex-1 truncate">{item.name}</span>
              {applied[item.contentId] && (
                <span
                  className="text-xs text-amber-600"
                  title="Applied, not saved"
                >
                  ●
                </span>
              )}
              <EventChips item={item} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Peak weights as the ladder shows them: `happy .75 · relaxed .35`. */
function peakSummary(item: TuneItem): string {
  return peakExpressions(item)
    .map(([name, value]) => `${name} ${value.toFixed(2).replace(/^0/, "")}`)
    .join(" · ");
}

/** The sounds an item's sound events play, by name. */
function soundNames(item: TuneItem, index: TuneIndex): string[] {
  return (item.clip.events ?? [])
    .filter((event) => event.kind === "sfx")
    .map((event) => index.targetName(item, event));
}

function ReactionLadder({
  reactions,
  applied,
  selected,
  index,
  onSelect,
}: {
  reactions: TuneItem[];
  applied: AppliedEdits;
  selected: string | null;
  index: TuneIndex;
  onSelect: (item: TuneItem) => void;
}) {
  const cells = useMemo(() => {
    const map = new Map<string, TuneItem[]>();
    for (const item of reactions) {
      const key = `${item.emotion}:${item.intensity}`;
      map.set(key, [...(map.get(key) ?? []), item]);
    }
    return map;
  }, [reactions]);
  return (
    <div className="min-h-0 overflow-auto">
      <table className="w-full border-separate border-spacing-1 text-sm">
        <thead>
          <tr>
            <th className="text-left">Emotion</th>
            {REACTION_INTENSITIES.map((intensity) => (
              <th key={intensity} className="text-left font-medium">
                {INTENSITY_LABELS[intensity]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {TRACKED_EMOTIONS.map((emotion) => (
            <tr key={emotion}>
              <th className="pr-2 text-left align-top font-medium capitalize">
                {emotion}
              </th>
              {REACTION_INTENSITIES.map((intensity) => (
                <td key={intensity} className="align-top">
                  <div className="flex flex-col gap-1">
                    {(cells.get(`${emotion}:${intensity}`) ?? []).map(
                      (item) => {
                        const notes = ladderNotes(item);
                        return (
                          <button
                            key={item.stem}
                            type="button"
                            title={notes.join("; ") || item.stem}
                            className={`hover:bg-muted flex flex-col gap-0.5 rounded border px-1.5 py-1 text-left ${
                              selected === item.contentId
                                ? "border-primary bg-muted"
                                : ""
                            } ${notes.length ? "border-amber-500" : ""}`}
                            onClick={() => onSelect(item)}
                          >
                            <span className="flex items-center justify-between gap-1">
                              <span className="text-xs">
                                {item.stem.endsWith("-b") ? "B" : "A"}
                                {applied[item.contentId] && (
                                  <span
                                    className="ml-1 text-amber-600"
                                    title="Applied, not saved"
                                  >
                                    ●
                                  </span>
                                )}
                              </span>
                              <EventChips item={item} />
                            </span>
                            <span className="text-muted-foreground text-[11px] leading-tight">
                              {peakSummary(item) || "no expression"}
                            </span>
                            {soundNames(item, index).map((name) => (
                              <span
                                key={name}
                                className="truncate text-[11px] leading-tight"
                              >
                                ♪ {name}
                              </span>
                            ))}
                          </button>
                        );
                      },
                    )}
                  </div>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * An effect as its applied (unsaved) sound change would play it, mirroring
 * `planEffectSound`: a sound it already declares becomes the default by
 * alias; otherwise the default alias plays the new sound (a silent effect
 * gains `on-apply`); null removes the default sound.
 */
function patchEffectSound(
  effect: EffectSource,
  change: AppliedEffectSounds[string] | undefined,
): EffectSource {
  if (!change) return effect;
  const definition = { ...(effect.definition as { soundAlias?: string }) };
  const cues = { ...(effect.soundCueIds ?? {}) };
  let alias = definition.soundAlias;
  const declared = change.sound
    ? Object.entries(cues).find(([, ref]) => ref === change.sound)?.[0]
    : undefined;
  if (change.sound === null) {
    if (alias) delete cues[alias];
    alias = undefined;
  } else if (declared) alias = declared;
  else {
    if (!alias) {
      alias = "on-apply";
      for (let index = 2; Object.hasOwn(cues, alias); index += 1)
        alias = `on-apply-${index}`;
    }
    cues[alias] = change.sound;
  }
  if (alias) definition.soundAlias = alias;
  else delete definition.soundAlias;
  return {
    ...effect,
    definition,
    soundCueId: change.sound,
    soundCueIds: cues,
  };
}

/** The preview's media with applied (unsaved) effect sound changes. */
function withEffectSounds(
  clipMedia: PageClipMedia | null,
  effectSounds: AppliedEffectSounds,
): PageClipMedia | null {
  if (!clipMedia) return clipMedia;
  return {
    ...clipMedia,
    avatarEffects: clipMedia.avatarEffects.map((entry) => ({
      ...entry,
      effect: patchEffectSound(
        entry.effect,
        effectSounds[entry.effect.contentId],
      ),
    })),
  };
}

function Preview({
  state,
  item,
  index,
  effectSounds,
}: {
  state: TuneState;
  item: TuneItem;
  index: TuneIndex;
  effectSounds: AppliedEffectSounds;
}) {
  const host = useRef<HTMLDivElement | null>(null);
  const player = useRef<PreviewPlayer | null>(null);
  const [status, setStatus] = useState<PlayerState | "idle">("idle");
  const [notices, setNotices] = useState<string[]>([]);
  // The review stage renders its Scene layers synchronously (flushSync), so
  // it is created, stopped and disposed outside React's effect phase.
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let created: PreviewPlayer | null = null;
    queueMicrotask(() => {
      created = new PreviewPlayer(element, STAGE_SIZE.width, STAGE_SIZE.height);
      player.current = created;
    });
    return () => {
      player.current = null;
      queueMicrotask(() => created?.dispose());
    };
  }, []);
  useEffect(() => {
    queueMicrotask(() => player.current?.stop());
    setStatus("idle");
    setNotices([]);
  }, [item]);

  // Bumped when the item changes, so a play started for the previous item
  // stops after its media request instead of starting the wrong clip.
  const playId = useRef(0);
  useEffect(() => {
    playId.current += 1;
  }, [item]);
  const play = async () => {
    const id = ++playId.current;
    const fail = (error: unknown) => {
      if (id !== playId.current) return;
      setStatus("error");
      setNotices([error instanceof Error ? error.message : String(error)]);
    };
    try {
      const { clipMedia, notices } = await api<{
        clipMedia: PageClipMedia | null;
        notices: string[];
      }>("media", {
        method: "POST",
        body: JSON.stringify({ dependencies: item.dependencies }),
      });
      if (id !== playId.current) return;
      setNotices(notices);
      await player.current?.play({
        avatarUrl: state.avatar.url,
        clip: item.clip,
        clipMedia: withEffectSounds(clipMedia, effectSounds),
        soundUrl: (cueId) => index.soundUrl(item, cueId),
        onState: setStatus,
        onError: fail,
      });
    } catch (error) {
      fail(error);
    }
  };

  return (
    <section className="flex flex-col gap-2">
      <div ref={host} style={STAGE_SIZE} className="overflow-hidden rounded" />
      <div className="flex items-center gap-2">
        <Button onClick={() => void play()} disabled={status === "loading"}>
          {status === "playing" ? "Replay" : "Play"}
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            player.current?.stop();
            setStatus("stopped");
          }}
        >
          Stop
        </Button>
        <span className="text-muted-foreground text-sm">
          {status === "loading"
            ? "Loading…"
            : status === "error"
              ? "Failed"
              : ""}
        </span>
      </div>
      {notices.map((notice) => (
        <p key={notice} className="text-destructive text-xs">
          {notice}
        </p>
      ))}
    </section>
  );
}

function ItemDetail({
  state,
  item,
  index,
  audition,
  applied,
  onApply,
  onDiscard,
  effectSounds,
  effectUses,
  onEffectSound,
  onDirty,
}: {
  state: TuneState;
  item: TuneItem;
  index: TuneIndex;
  audition: Audition;
  /** The item's applied (not yet saved) draft, or null. */
  applied: TuneDraft | null;
  /**
   * Keep the draft as applied; Save all writes it. Nothing reloads.
   * `revision` is the file revision the draft's history started from.
   */
  onApply: (draft: TuneDraft, revision: string) => void;
  /** Drop the item's applied draft. */
  onDiscard: () => void;
  /** Applied changes to Avatar Effects' own sounds. */
  effectSounds: AppliedEffectSounds;
  /** How many Gestures and Reactions use each effect. */
  effectUses: Map<string, number>;
  /** Apply a new own sound (null: silent) for an Avatar Effect. */
  onEffectSound: (effect: TuneEffect, sound: string | null) => void;
  /** Reports whether the draft has edits that aren't applied yet. */
  onDirty: (dirty: boolean) => void;
}) {
  // What the editor starts from: the applied draft, else the file.
  const baseline = useMemo(() => applied ?? draftOf(item), [applied, item]);
  // The draft's history: the last entry is the current draft, Undo pops it.
  const [history, setHistory] = useState<TuneDraft[]>(() => [baseline]);
  const [message, setMessage] = useState<{
    tone: "error" | "info";
    lines: string[];
  } | null>(null);
  const draft = history.at(-1)!;
  const unapplied = JSON.stringify(draft) !== JSON.stringify(baseline);
  // When the baseline changes under an untouched draft (Save all wrote it,
  // or Reload found a newer file), the editor follows it. Applying an edit
  // keeps the history, so Apply never resets or reloads anything.
  // The file revision this history started from: an edit begun before a
  // Reload found a newer file stays tied to the old one, so Save all
  // refuses it instead of overwriting the newer file.
  const startRevision = useRef(item.revision);
  const currentRevision = useRef(item.revision);
  currentRevision.current = item.revision;
  const previousBaseline = useRef(baseline);
  useEffect(() => {
    const previous = JSON.stringify(previousBaseline.current);
    const next = JSON.stringify(baseline);
    previousBaseline.current = baseline;
    setHistory((past) => {
      const last = JSON.stringify(past.at(-1));
      // In step with the newer file (Save all wrote this draft, or a Reload
      // changed nothing it shows): keep the history, now from this revision.
      if (last === next) {
        startRevision.current = currentRevision.current;
        return past;
      }
      // Unapplied edits stay tied to the revision they started from.
      if (last !== previous) return past;
      startRevision.current = currentRevision.current;
      return [baseline];
    });
  }, [baseline]);
  // Stable per draft: the preview restarts when what it plays changes.
  const view = useMemo(() => withDraft(item, draft), [item, draft]);
  const notes = ladderNotes(view);
  // Steps of one continuous edit (typing a number, dragging a slider) share
  // a key and replace each other, so Undo takes the whole edit back.
  const lastKey = useRef<string | null>(null);
  const change = (next: TuneDraft, key?: string) => {
    const coalesce = key !== undefined && key === lastKey.current;
    lastKey.current = key ?? null;
    setHistory((past) =>
      coalesce ? [...past.slice(0, -1), next] : [...past, next].slice(-100),
    );
    setMessage(null);
  };
  useEffect(() => onDirty(unapplied), [unapplied, onDirty]);
  // The Avatar Effects the draft names, by alias, for per-use placement.
  const avatarEffectDeps = JSON.stringify(
    draft.dependencies.filter(
      (dependency) => dependency.content_type === "avatar_effect",
    ),
  );
  const [avatarEffects, setAvatarEffects] = useState<{
    effects: Map<string, EffectSource>;
    error: string | null;
  } | null>(null);
  useEffect(() => {
    let current = true;
    setAvatarEffects(null);
    void api<{ clipMedia: PageClipMedia | null; notices: string[] }>("media", {
      method: "POST",
      body: JSON.stringify({ dependencies: JSON.parse(avatarEffectDeps) }),
    }).then(
      ({ clipMedia, notices }) =>
        current &&
        setAvatarEffects({
          effects: new Map(
            (clipMedia?.avatarEffects ?? []).map(({ alias, effect }) => [
              alias,
              effect,
            ]),
          ),
          error: notices.length ? notices.join(" ") : null,
        }),
      (error: Error) =>
        current &&
        setAvatarEffects({ effects: new Map(), error: error.message }),
    );
    return () => {
      current = false;
    };
  }, [avatarEffectDeps]);
  const soundsByRef = useMemo(
    () => new Map(state.sounds.map((sound) => [sound.ref, sound])),
    [state.sounds],
  );
  const soundNames = useMemo(
    () => new Map(state.sounds.map((sound) => [sound.ref, sound.name])),
    [state.sounds],
  );
  /** The Avatar Effect's own sound, changeable for every use of it. */
  const effectSound = (event: TuneEvent) => {
    const dependency = draft.dependencies.find(
      (entry) =>
        entry.alias === event.effectId &&
        entry.content_type === "avatar_effect",
    );
    const effect = state.effects.find(
      (candidate) =>
        candidate.kind === "avatar" && candidate.contentId === dependency?.ref,
    );
    if (!effect) return null;
    const change = effectSounds[effect.contentId];
    const sound = change ? change.sound : effectDefaultSound(effect);
    const uses = effectUses.get(effect.contentId) ?? 0;
    return (
      <SoundPicker
        sounds={state.sounds}
        audition={audition}
        onPick={(picked) => onEffectSound(effect, picked.ref)}
        // A merged effect keeps its default; its uses pick among its sounds.
        onNone={
          Object.keys(effect.sounds ?? {}).length > 1
            ? undefined
            : () => onEffectSound(effect, null)
        }
        trigger={
          <button
            type="button"
            className={`hover:bg-muted mt-1 block max-w-56 truncate rounded px-1 text-left underline decoration-dotted ${change ? "text-amber-600" : ""}`}
            title={`${effect.name}'s own sound: changing it changes ${
              uses === 1
                ? "the 1 Gesture or Reaction that uses it"
                : `all ${uses} Gestures and Reactions that use it`
            }${change ? " (applied, not saved)" : ""}`}
          >
            effect sound: {sound ? (soundNames.get(sound) ?? sound) : "none"}
            {change ? " ●" : ""}
          </button>
        }
      />
    );
  };
  const placement = (event: TuneEvent) => {
    if (!avatarEffects) return null;
    const loaded = event.effectId
      ? avatarEffects.effects.get(event.effectId)
      : undefined;
    // Shows an applied change to the effect's own sound before Save all.
    const effect =
      loaded && patchEffectSound(loaded, effectSounds[loaded.contentId]);
    if (!effect)
      return (
        <p className="text-destructive text-xs">
          This effect can&apos;t be loaded for placement
          {avatarEffects.error ? `: ${avatarEffects.error}` : "."}
        </p>
      );
    return (
      <PlacementSection
        event={event}
        effect={effect}
        sounds={soundsByRef}
        onOverride={(override, key) =>
          change(updateEvent(draft, event.id, { override }), key)
        }
      />
    );
  };
  return (
    <div className="flex min-h-0 flex-wrap gap-6 overflow-y-auto">
      <Preview
        state={state}
        item={view}
        index={index}
        effectSounds={effectSounds}
      />
      <div className="flex min-w-80 flex-1 flex-col gap-4">
        <header>
          <h2 className="text-lg font-semibold">
            {item.name}
            {unapplied ? (
              <span className="text-muted-foreground ml-2 text-sm font-normal">
                (edited, not applied)
              </span>
            ) : applied ? (
              <span className="ml-2 text-sm font-normal text-amber-600">
                (applied, not saved)
              </span>
            ) : null}
          </h2>
          <p className="text-muted-foreground text-xs">
            {item.contentId}
            {item.kind === "reaction" &&
              ` · ${item.emotion} · ${INTENSITY_LABELS[item.intensity ?? 0] ?? "?"}`}
            {` · ${item.clip.duration.toFixed(2)} s`}
          </p>
          {notes.length > 0 && (
            <p className="mt-1 text-xs text-amber-600">
              Ladder: {notes.join("; ")}
            </p>
          )}
          <div className="mt-2 flex items-center gap-2">
            <Button
              size="sm"
              disabled={!unapplied}
              title="Keep these edits; Save all writes every applied item"
              onClick={() => {
                onApply(draft, startRevision.current);
                setMessage({
                  tone: "info",
                  lines: ["Applied. Save all writes it to the files."],
                });
              }}
            >
              Apply
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={history.length < 2}
              onClick={() => {
                lastKey.current = null;
                setHistory((past) => past.slice(0, -1));
              }}
            >
              Undo
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={!unapplied}
              title="Back to the applied draft, or the file"
              onClick={() => {
                lastKey.current = null;
                startRevision.current = item.revision;
                setHistory([baseline]);
              }}
            >
              Revert
            </Button>
            {applied && (
              <Button
                size="sm"
                variant="ghost"
                title="Drop the applied edits and return to the file"
                onClick={() => {
                  lastKey.current = null;
                  onDiscard();
                  startRevision.current = item.revision;
                  setHistory([draftOf(item)]);
                  setMessage(null);
                }}
              >
                Discard applied
              </Button>
            )}
          </div>
          {message && (
            <ul
              className={`mt-2 text-xs ${message.tone === "error" ? "text-destructive" : "text-muted-foreground"}`}
            >
              {message.lines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
        </header>
        {item.kind === "reaction" && (
          <ExpressionsEditor
            draft={draft}
            base={item.clip.expressions ?? {}}
            beat={peakBeat(item)}
            onChange={change}
          />
        )}
        <EventsEditor
          item={item}
          draft={draft}
          index={index}
          effects={state.effects}
          sounds={state.sounds}
          audition={audition}
          onChange={change}
          placement={placement}
          effectSound={effectSound}
        />
      </div>
    </div>
  );
}

/** What the owner must do after Save all, in the page's words. */
function afterSave(result: SaveResult, sounds: TuneSound[]): string[] {
  const names = new Map(sounds.map((sound) => [sound.ref, sound.name]));
  return [
    `Saved ${[
      result.items.length ? `${result.items.length} item(s)` : "",
      result.effects.length ? `${result.effects.length} effect sound(s)` : "",
    ]
      .filter(Boolean)
      .join(" and ")}: ${[
      ...result.items.map((item) => item.stem),
      ...result.effects.map((effect) => effect.stem),
    ].join(", ")}.`,
    ...result.pendingSounds.map(
      (ref) =>
        `${names.get(ref) ?? ref} isn't in the comedy pack yet: it needs a new pack version before this merges (pnpm -s content:tune --pending lists them).`,
    ),
    ...(result.rebaseline.length
      ? [
          `Gesture clips changed (${result.rebaseline.join(", ")}): add them to REBASELINED in src/lib/avatar/motion-authoring/includedClipBaseline.test.ts, then run UPDATE_CLIP_BASELINE=1 pnpm exec vitest run src/lib/avatar/motion-authoring/includedClipBaseline.test.ts.`,
        ]
      : []),
  ];
}

function App() {
  const [state, setState] = useState<TuneState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<TuneItem | null>(null);
  const [notice, setNotice] = useState<string[]>([]);
  const audition = useAudition();
  // Applied edits, kept in this browser until Save all writes them.
  // Read once the checkout is known; written back on every change after.
  const [applied, setApplied] = useState<AppliedEdits>({});
  // Applied changes to Avatar Effects' own sounds, kept the same way.
  const [effectSounds, setEffectSounds] = useState<AppliedEffectSounds>({});
  const storageKey = state ? appliedStorageKey(state.checkout) : null;
  const [restored, setRestored] = useState<string | null>(null);
  useEffect(() => {
    if (!storageKey || !state || restored === storageKey) return;
    setApplied(readApplied(globalThis.localStorage, storageKey));
    setEffectSounds(
      readEffectSounds(
        globalThis.localStorage,
        effectSoundsStorageKey(state.checkout),
      ),
    );
    setRestored(storageKey);
  }, [storageKey, restored, state]);
  useEffect(() => {
    if (storageKey && restored === storageKey)
      writeApplied(globalThis.localStorage, storageKey, applied);
  }, [applied, storageKey, restored]);
  const effectsKey = state ? effectSoundsStorageKey(state.checkout) : null;
  useEffect(() => {
    if (!effectsKey || restored !== storageKey) return;
    try {
      if (Object.keys(effectSounds).length)
        globalThis.localStorage?.setItem(
          effectsKey,
          JSON.stringify(effectSounds),
        );
      else globalThis.localStorage?.removeItem(effectsKey);
    } catch {
      // Without storage the changes last for this page only.
    }
  }, [effectSounds, effectsKey, restored, storageKey]);
  const [saving, setSaving] = useState(false);
  // Whether the open item has edits not applied; switching away asks first.
  const dirty = useRef(false);
  const onDirty = useCallback((value: boolean) => {
    dirty.current = value;
  }, []);
  const select = (item: TuneItem) => {
    if (
      dirty.current &&
      !window.confirm(
        "Leave this item? Its edits that aren't applied will be lost.",
      )
    )
      return;
    dirty.current = false;
    // The lists show applied views; the editor opens the item as loaded.
    setSelected(
      [...(state?.gestures ?? []), ...(state?.reactions ?? [])].find(
        (candidate) => candidate.contentId === item.contentId,
      ) ?? item,
    );
  };
  /** Load the content again, keeping the selected item by its ID. */
  const load = async () => {
    try {
      const next = await api<TuneState>("state");
      setState(next);
      setSelected((current) =>
        current
          ? ([...next.gestures, ...next.reactions].find(
              (item) => item.contentId === current.contentId,
            ) ?? null)
          : null,
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };
  useEffect(() => {
    void load();
    // Edits not yet applied live only in the open editor.
    const warn = (event: BeforeUnloadEvent) => {
      if (dirty.current) event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);
  // Pack sounds Included content needs added or no longer plays.
  const [pack, setPack] = useState<{
    additions: string[];
    removals: string[];
  } | null>(null);
  const loadPack = () =>
    api<{ additions: string[]; removals: string[] }>("pending").then(
      setPack,
      () => setPack(null),
    );
  useEffect(() => {
    void loadPack();
  }, []);
  const items = useMemo(
    () => (state ? [...state.gestures, ...state.reactions] : []),
    [state],
  );
  const stale = useMemo(
    () => [
      ...staleApplied(applied, items),
      ...staleEffectSounds(effectSounds, state?.effects ?? []),
    ],
    [applied, items, effectSounds, state],
  );
  const pendingCount =
    Object.keys(applied).length + Object.keys(effectSounds).length;
  // How many Gestures and Reactions use each effect.
  const effectUses = useMemo(() => {
    const uses = new Map<string, number>();
    for (const item of items)
      for (const ref of new Set(item.dependencies.map((entry) => entry.ref)))
        uses.set(ref, (uses.get(ref) ?? 0) + 1);
    return uses;
  }, [items]);
  /** An item as its applied draft would play it, for the lists. */
  const viewOf = (item: TuneItem): TuneItem =>
    applied[item.contentId]
      ? withDraft(item, applied[item.contentId].draft)
      : item;
  /** Write every applied edit, all or nothing. */
  const saveAll = async () => {
    const count = pendingCount;
    if (stale.length) {
      setNotice([
        `Not saved: these files changed since their edits were applied. Discard those edits (or redo them) first: ${stale.join(", ")}.`,
      ]);
      return;
    }
    if (
      !window.confirm(
        `Write ${count} applied change(s) to content/included? Effect sound changes reach every Gesture and Reaction that uses the effect.`,
      )
    )
      return;
    setSaving(true);
    try {
      const result = await api<SaveResult>("save", {
        method: "POST",
        body: JSON.stringify(saveAllRequest(applied, items, effectSounds)),
      });
      const saved = new Map(result.items.map((item) => [item.contentId, item]));
      const savedEffects = new Map(
        result.effects.map((effect) => [effect.contentId, effect]),
      );
      setApplied((current) => discardApplied(current, [...saved.keys()]));
      setEffectSounds((current) =>
        Object.fromEntries(
          Object.entries(current).filter(([id]) => !savedEffects.has(id)),
        ),
      );
      setState(
        (current) =>
          current && {
            ...current,
            effects: current.effects.map(
              (effect) => savedEffects.get(effect.contentId) ?? effect,
            ),
            gestures: current.gestures.map(
              (item) => saved.get(item.contentId) ?? item,
            ),
            reactions: current.reactions.map(
              (item) => saved.get(item.contentId) ?? item,
            ),
          },
      );
      setSelected((current) =>
        current ? (saved.get(current.contentId) ?? current) : null,
      );
      setNotice(afterSave(result, state?.sounds ?? []));
      void loadPack();
    } catch (error) {
      setNotice([error instanceof Error ? error.message : String(error)]);
    } finally {
      setSaving(false);
    }
  };
  const index = useMemo(() => (state ? new TuneIndex(state) : null), [state]);
  if (error) return <p className="text-destructive p-6">{error}</p>;
  if (!state || !index) return <p className="p-6">Loading content…</p>;
  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-baseline gap-3 border-b px-4 py-2">
        <h1 className="text-base font-semibold">Content tuning</h1>
        <span className="text-muted-foreground text-xs">
          {state.gestures.length} Gestures · {state.reactions.length} Reactions
          · {state.sounds.length} sounds · {state.avatar.id}
        </span>
        {pack && (pack.additions.length > 0 || pack.removals.length > 0) && (
          <span
            className="text-xs text-amber-600"
            title={[
              ...pack.additions.map((ref) => `Add ${ref}`),
              ...pack.removals.map((ref) => `Remove ${ref}`),
            ].join("\n")}
          >
            Pack changes needed: {pack.additions.length} to add,{" "}
            {pack.removals.length} to remove (content:tune --pending)
          </span>
        )}
        <span className="ml-auto flex items-center gap-2">
          {pendingCount > 0 && (
            <span className="text-xs text-amber-600">
              {pendingCount} applied, not saved
              {stale.length > 0 && ` (${stale.length} out of date)`}
            </span>
          )}
          <Button
            size="sm"
            disabled={!pendingCount || saving}
            title="Write every applied item to content/included, all or nothing"
            onClick={() => void saveAll()}
          >
            {saving ? "Saving…" : "Save all"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={!pendingCount || saving}
            onClick={() => {
              if (
                window.confirm(
                  "Discard every applied edit? The files stay as they are.",
                )
              ) {
                setApplied({});
                setEffectSounds({});
              }
            }}
          >
            Discard all
          </Button>
        </span>
        <Button
          size="sm"
          variant="ghost"
          title="Load the files again, after editing them elsewhere"
          onClick={() => void load()}
        >
          Reload
        </Button>
      </header>
      {notice.length > 0 && (
        <ul className="border-b px-4 py-2 text-xs">
          {notice.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}
      {state.problems.length > 0 && (
        <ul className="text-destructive border-b px-4 py-2 text-xs">
          {state.problems.map((problem) => (
            <li key={problem}>Not loaded: {problem}</li>
          ))}
        </ul>
      )}
      <main className="grid min-h-0 flex-1 grid-cols-[minmax(360px,1.1fr)_minmax(480px,1fr)] gap-4 p-4">
        <Tabs defaultValue="gestures" className="flex min-h-0 flex-col">
          <TabsList>
            <TabsTrigger value="gestures">Gestures</TabsTrigger>
            <TabsTrigger value="ladder">Reaction ladder</TabsTrigger>
            <TabsTrigger value="sounds">Sounds</TabsTrigger>
          </TabsList>
          <TabsContent value="gestures" className="flex min-h-0 flex-col">
            <GestureList
              gestures={state.gestures.map(viewOf)}
              applied={applied}
              selected={selected?.contentId ?? null}
              onSelect={select}
            />
          </TabsContent>
          <TabsContent value="ladder" className="flex min-h-0 flex-col">
            <ReactionLadder
              reactions={state.reactions.map(viewOf)}
              applied={applied}
              selected={selected?.contentId ?? null}
              index={index}
              onSelect={select}
            />
          </TabsContent>
          <TabsContent value="sounds" className="flex min-h-0 flex-col">
            <SoundCatalog
              sounds={state.sounds}
              catalog={state.catalog}
              audition={audition}
            />
          </TabsContent>
        </Tabs>
        {selected ? (
          <ItemDetail
            key={selected.contentId}
            state={state}
            item={selected}
            index={index}
            audition={audition}
            applied={applied[selected.contentId]?.draft ?? null}
            onApply={(draft, revision) =>
              setApplied((current) =>
                applyDraft(current, selected, draft, revision),
              )
            }
            onDiscard={() =>
              setApplied((current) =>
                discardApplied(current, [selected.contentId]),
              )
            }
            effectSounds={effectSounds}
            effectUses={effectUses}
            onEffectSound={(effect, sound) =>
              setEffectSounds((current) =>
                applyEffectSound(current, effect, sound),
              )
            }
            onDirty={onDirty}
          />
        ) : (
          <p className="text-muted-foreground">
            Pick a Gesture or a Reaction to preview it.
          </p>
        )}
      </main>
    </div>
  );
}

/** Render the page into `root`. Call only once i18n exists (`main.ts`). */
export function mountTunePage(root: HTMLElement): void {
  createRoot(root).render(<App />);
}
