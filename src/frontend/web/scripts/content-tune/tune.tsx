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
  type TuneEvent,
  type TuneItem,
  type TuneSound,
  type TuneState,
} from "./model";
import { useAudition } from "./audition";
import {
  draftOf,
  isDirty,
  saveRequest,
  updateEvent,
  type TuneDraft,
} from "./draft";
import { EventsEditor, ExpressionsEditor, type Audition } from "./editor";
import { PlacementSection } from "./placement";
import { PreviewPlayer, type PlayerState } from "./player";

/*
 * The owner's content-tuning page (served by `scripts/content-tune.mjs`):
 * Included Gestures, the Reaction ladder and the WOW Sound catalog, with a
 * live preview of the selected item on an Included Avatar and editing of
 * its events and (Reactions) peak expressions, saved to Included content.
 */

/** A save's answer: the reloaded item and what the owner must do next. */
type SaveResult = {
  item: TuneItem;
  pendingSounds: string[];
  rebaseline: string | null;
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
  selected,
  onSelect,
}: {
  gestures: TuneItem[];
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
  selected,
  index,
  onSelect,
}: {
  reactions: TuneItem[];
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

function Preview({
  state,
  item,
  index,
}: {
  state: TuneState;
  item: TuneItem;
  index: TuneIndex;
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
        clipMedia,
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
  onSaved,
  onDirty,
}: {
  state: TuneState;
  item: TuneItem;
  index: TuneIndex;
  audition: Audition;
  onSaved: (result: SaveResult) => void;
  /** Reports whether the draft has unsaved edits. */
  onDirty: (dirty: boolean) => void;
}) {
  // The draft's history: the last entry is the current draft, Undo pops it.
  const [history, setHistory] = useState<TuneDraft[]>(() => [draftOf(item)]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{
    tone: "error" | "info";
    lines: string[];
  } | null>(null);
  const draft = history.at(-1)!;
  const dirty = isDirty(item, draft);
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
  useEffect(() => onDirty(dirty), [dirty, onDirty]);
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
  const placement = (event: TuneEvent) => {
    if (!avatarEffects) return null;
    const effect = event.effectId
      ? avatarEffects.effects.get(event.effectId)
      : undefined;
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
  const save = async () => {
    setSaving(true);
    try {
      const result = await api<SaveResult>("save", {
        method: "POST",
        body: JSON.stringify(saveRequest(item, draft)),
      });
      onSaved(result);
    } catch (error) {
      setMessage({
        tone: "error",
        lines: (error instanceof Error ? error.message : String(error)).split(
          "\n",
        ),
      });
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="flex min-h-0 flex-wrap gap-6 overflow-y-auto">
      <Preview state={state} item={view} index={index} />
      <div className="flex min-w-80 flex-1 flex-col gap-4">
        <header>
          <h2 className="text-lg font-semibold">
            {item.name}
            {dirty && (
              <span className="text-muted-foreground ml-2 text-sm font-normal">
                (edited)
              </span>
            )}
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
              disabled={!dirty || saving}
              onClick={() => void save()}
            >
              {saving ? "Saving…" : "Save"}
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
              disabled={!dirty}
              onClick={() => {
                lastKey.current = null;
                setHistory([draftOf(item)]);
              }}
            >
              Revert
            </Button>
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
        />
      </div>
    </div>
  );
}

/** What the owner must do after a save, in the page's words. */
function afterSave(result: SaveResult, sounds: TuneSound[]): string[] {
  const names = new Map(sounds.map((sound) => [sound.ref, sound.name]));
  return [
    `Saved ${result.item.contentId}.`,
    ...result.pendingSounds.map(
      (ref) =>
        `${names.get(ref) ?? ref} isn't in the comedy pack yet: it needs a new pack version before this merges (pnpm -s content:tune --pending lists them).`,
    ),
    ...(result.rebaseline
      ? [
          `The Gesture clip changed: add "${result.rebaseline}" to REBASELINED in src/lib/avatar/motion-authoring/includedClipBaseline.test.ts, then run UPDATE_CLIP_BASELINE=1 pnpm exec vitest run src/lib/avatar/motion-authoring/includedClipBaseline.test.ts.`,
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
  // Whether the open item has unsaved edits; switching away asks first.
  const dirty = useRef(false);
  const onDirty = useCallback((value: boolean) => {
    dirty.current = value;
  }, []);
  const select = (item: TuneItem) => {
    if (
      dirty.current &&
      !window.confirm("Discard the unsaved edits to this item?")
    )
      return;
    dirty.current = false;
    setSelected(item);
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
  }, []);
  const saved = (result: SaveResult) => {
    setNotice(afterSave(result, state?.sounds ?? []));
    setState(
      (current) =>
        current && {
          ...current,
          gestures: current.gestures.map((item) =>
            item.contentId === result.item.contentId ? result.item : item,
          ),
          reactions: current.reactions.map((item) =>
            item.contentId === result.item.contentId ? result.item : item,
          ),
        },
    );
    setSelected(result.item);
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
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto"
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
              gestures={state.gestures}
              selected={selected?.contentId ?? null}
              onSelect={select}
            />
          </TabsContent>
          <TabsContent value="ladder" className="flex min-h-0 flex-col">
            <ReactionLadder
              reactions={state.reactions}
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
            key={`${selected.contentId}:${selected.revision}`}
            state={state}
            item={selected}
            index={index}
            audition={audition}
            onSaved={saved}
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
