import { Fragment, useMemo, useState, type ReactNode } from "react";

import { Button } from "@/ui/components/button";
import { Input } from "@/ui/components/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/ui/components/popover";

import {
  addEvent,
  removeEvent,
  removeExpression,
  replaceTarget,
  setExpressionPeak,
  updateEvent,
  type TuneDraft,
  type TuneTarget,
} from "./draft";
import {
  EVENT_KIND_LABELS,
  TuneIndex,
  eventTarget,
  peakExpressions,
  soundGroups,
  type TuneEffect,
  type TuneEvent,
  type TuneItem,
  type TuneSound,
} from "./model";

/*
 * The tuning page's editors for one item's draft: its events (add, remove,
 * replace and retime effects and sounds) and, for a Reaction, its peak
 * expression weights. Every change goes through `onChange` with a new draft.
 */

/** Expressions a Reaction can set: the VRM emotion presets and blinks. */
export const REACTION_EXPRESSIONS = [
  "happy",
  "angry",
  "sad",
  "relaxed",
  "surprised",
  "blink",
  "blinkLeft",
  "blinkRight",
];
const EFFECT_KIND_LABELS: Record<TuneEffect["kind"], string> = {
  avatar: "Avatar Effects",
  particle: "Particle Effects",
  scene: "Scene Effects",
};

/** One shared audition player, passed down so one sound plays at a time. */
export type Audition = {
  playing: string | null;
  toggle: (sound: TuneSound) => void;
};

type PickerOption<T> = {
  key: string;
  label: string;
  detail?: string;
  value: T;
};

/** A searchable popover list of grouped options. */
function Picker<T>({
  trigger,
  groups,
  onPick,
  renderLead,
  placeholder,
}: {
  trigger: ReactNode;
  groups: [string, PickerOption<T>[]][];
  onPick: (value: T) => void;
  renderLead?: (value: T) => ReactNode;
  placeholder: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const shown = groups
    .map(([group, options]): [string, PickerOption<T>[]] => [
      group,
      options.filter((option) =>
        `${option.label} ${option.detail ?? ""} ${option.key}`
          .toLowerCase()
          .includes(needle),
      ),
    ])
    .filter(([, options]) => options.length);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="start" className="w-96 p-2">
        <Input
          autoFocus
          placeholder={placeholder}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="mt-2 max-h-80 overflow-y-auto pr-1">
          {shown.map(([group, options]) => (
            <section key={group} className="mb-2">
              <h4 className="text-muted-foreground mb-1 text-xs font-semibold tracking-wide uppercase">
                {group}
              </h4>
              <ul>
                {options.map((option) => (
                  <li key={option.key} className="flex items-center gap-1">
                    {renderLead?.(option.value)}
                    <button
                      type="button"
                      className="hover:bg-muted min-w-0 flex-1 truncate rounded px-2 py-1 text-left text-sm"
                      title={option.key}
                      onClick={() => {
                        onPick(option.value);
                        setOpen(false);
                        setQuery("");
                      }}
                    >
                      {option.label}
                      {option.detail && (
                        <span className="text-muted-foreground ml-2 text-xs">
                          {option.detail}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {!shown.length && (
            <p className="text-muted-foreground p-2 text-sm">No matches.</p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** A sound dropdown in which every sound can be previewed before picking. */
export function SoundPicker({
  sounds,
  audition,
  trigger,
  onPick,
}: {
  sounds: TuneSound[];
  audition: Audition;
  trigger: ReactNode;
  onPick: (sound: TuneSound) => void;
}) {
  const groups = useMemo(
    () =>
      soundGroups(sounds).map(
        ([category, list]): [string, PickerOption<TuneSound>[]] => [
          category,
          list.map((sound) => ({
            key: sound.key,
            label: sound.name,
            detail: sound.shipped ? "In pack" : undefined,
            value: sound,
          })),
        ],
      ),
    [sounds],
  );
  return (
    <Picker
      trigger={trigger}
      groups={groups}
      onPick={onPick}
      placeholder="Search sounds"
      renderLead={(sound) => (
        <Button
          size="icon-sm"
          variant="ghost"
          disabled={!sound.available}
          aria-label={
            audition.playing === sound.key
              ? `Stop ${sound.name}`
              : `Preview ${sound.name}`
          }
          onClick={() => audition.toggle(sound)}
        >
          {audition.playing === sound.key ? "■" : "▶"}
        </Button>
      )}
    />
  );
}

/** An effect dropdown, grouped by kind (or one kind only). */
export function EffectPicker({
  effects,
  kind,
  trigger,
  onPick,
}: {
  effects: TuneEffect[];
  kind?: TuneEffect["kind"];
  trigger: ReactNode;
  onPick: (effect: TuneEffect) => void;
}) {
  const groups = useMemo(
    () =>
      (Object.keys(EFFECT_KIND_LABELS) as TuneEffect["kind"][])
        .filter((value) => !kind || value === kind)
        .map((value): [string, PickerOption<TuneEffect>[]] => [
          EFFECT_KIND_LABELS[value],
          effects
            .filter((effect) => effect.kind === value)
            .sort((a, b) => a.name.localeCompare(b.name))
            .map((effect) => ({
              key: effect.contentId,
              label: effect.name,
              detail: effect.stem,
              value: effect,
            })),
        ]),
    [effects, kind],
  );
  return (
    <Picker
      trigger={trigger}
      groups={groups}
      onPick={onPick}
      placeholder="Search effects"
    />
  );
}

const EFFECT_KINDS_BY_EVENT: Record<string, TuneEffect["kind"]> = {
  avatar_vfx: "avatar",
  particle_vfx: "particle",
  scene_vfx: "scene",
};

/**
 * A number input that keeps what is typed: it commits each parseable value
 * and shows the committed value again on blur, so clearing the field to type
 * another number never commits a 0.
 */
function NumberField({
  value,
  step,
  min,
  max,
  label,
  onCommit,
}: {
  value: number | undefined;
  step: number;
  min?: number;
  max?: number;
  label: string;
  onCommit: (value: number) => void;
}) {
  const [text, setText] = useState<string | null>(null);
  return (
    <input
      type="number"
      aria-label={label}
      className="border-input bg-background w-20 rounded border px-1.5 py-0.5 text-sm tabular-nums"
      step={step}
      min={min}
      max={max}
      value={text ?? value ?? ""}
      onChange={(event) => {
        setText(event.target.value);
        const next = Number(event.target.value);
        if (event.target.value.trim() !== "" && Number.isFinite(next))
          onCommit(next);
      }}
      onBlur={() => setText(null)}
    />
  );
}

/** The item's events, editable: time, what each plays and its settings. */
export function EventsEditor({
  item,
  draft,
  index,
  effects,
  sounds,
  audition,
  onChange,
  placement,
}: {
  item: TuneItem;
  draft: TuneDraft;
  index: TuneIndex;
  effects: TuneEffect[];
  sounds: TuneSound[];
  audition: Audition;
  /** `key` names a continuous edit, so its steps make one Undo entry. */
  onChange: (draft: TuneDraft, key?: string) => void;
  /**
   * The per-use placement controls for an Avatar Effect event, or null
   * while its effect is loading.
   */
  placement?: (event: TuneEvent) => ReactNode;
}) {
  const [placing, setPlacing] = useState<string | null>(null);
  const view: TuneItem = { ...item, dependencies: draft.dependencies };
  const events = [...draft.events].sort((a, b) => a.time - b.time);
  const nextTime = events.length ? events.at(-1)!.time + 0.3 : 0.1;
  const add = (target: TuneTarget) =>
    onChange(addEvent(draft, target, nextTime));
  const targetPicker = (event: TuneEvent) => {
    const button = (
      <button
        type="button"
        className="hover:bg-muted max-w-56 truncate rounded px-1.5 py-0.5 text-left underline decoration-dotted"
        title="Replace"
      >
        {index.targetName(view, event)}
      </button>
    );
    const replace = (target: TuneTarget) =>
      onChange(replaceTarget(draft, event.id, target));
    return eventTarget(event)?.contentType === "sound_effect" ? (
      <SoundPicker
        sounds={sounds}
        audition={audition}
        trigger={button}
        onPick={(sound) => replace({ type: "sound", sound })}
      />
    ) : (
      <EffectPicker
        effects={effects}
        kind={EFFECT_KINDS_BY_EVENT[event.kind]}
        trigger={button}
        onPick={(effect) => replace({ type: "effect", effect })}
      />
    );
  };
  return (
    <section>
      <div className="mb-1 flex items-center gap-2">
        <h3 className="text-sm font-semibold">Events ({events.length})</h3>
        <EffectPicker
          effects={effects}
          trigger={
            <Button size="sm" variant="outline">
              + Effect
            </Button>
          }
          onPick={(effect) => add({ type: "effect", effect })}
        />
        <SoundPicker
          sounds={sounds}
          audition={audition}
          trigger={
            <Button size="sm" variant="outline">
              + Sound
            </Button>
          }
          onPick={(sound) => add({ type: "sound", sound })}
        />
      </div>
      {events.length === 0 ? (
        <p className="text-muted-foreground text-sm">No effects or sounds.</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-muted-foreground text-left text-xs">
            <tr>
              <th className="font-normal">Time (s)</th>
              <th className="font-normal">Kind</th>
              <th className="font-normal">Plays</th>
              <th className="font-normal">Settings</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {events.map((event) => (
              <Fragment key={event.id}>
                <tr className="align-middle">
                  <td>
                    <NumberField
                      label={`${event.id} time`}
                      value={event.time}
                      step={0.05}
                      min={0}
                      onCommit={(time) =>
                        onChange(
                          updateEvent(draft, event.id, { time }),
                          `time:${event.id}`,
                        )
                      }
                    />
                  </td>
                  <td>{EVENT_KIND_LABELS[event.kind] ?? event.kind}</td>
                  <td>{targetPicker(event)}</td>
                  <td className="text-xs">
                    <EventSettings
                      event={event}
                      onPatch={(patch, key) =>
                        onChange(updateEvent(draft, event.id, patch), key)
                      }
                    />
                  </td>
                  <td className="whitespace-nowrap">
                    {placement && event.kind === "avatar_vfx" && (
                      <Button
                        size="sm"
                        variant={placing === event.id ? "secondary" : "ghost"}
                        aria-expanded={placing === event.id}
                        onClick={() =>
                          setPlacing((current) =>
                            current === event.id ? null : event.id,
                          )
                        }
                      >
                        Place
                      </Button>
                    )}
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label={`Remove ${event.id}`}
                      onClick={() => onChange(removeEvent(draft, event.id))}
                    >
                      ✕
                    </Button>
                  </td>
                </tr>
                {placing === event.id && placement && (
                  <tr>
                    <td colSpan={5} className="pb-3">
                      {placement(event) ?? (
                        <p className="text-muted-foreground text-xs">
                          Loading the effect…
                        </p>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function EventSettings({
  event,
  onPatch,
}: {
  event: TuneEvent;
  onPatch: (patch: Parameters<typeof updateEvent>[2], key?: string) => void;
}) {
  if (event.kind === "sfx")
    return (
      <label className="flex items-center gap-1">
        volume
        <NumberField
          label={`${event.id} volume`}
          value={event.volume ?? 1}
          step={0.05}
          min={0}
          max={1}
          onCommit={(volume) =>
            onPatch(
              { volume: volume >= 1 ? undefined : Math.max(0, volume) },
              `volume:${event.id}`,
            )
          }
        />
      </label>
    );
  return (
    <span className="flex flex-wrap items-center gap-2">
      {event.kind === "avatar_vfx" && (
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={event.playAccompanyingSound !== false}
            onChange={(change) =>
              onPatch({ playAccompanyingSound: change.target.checked })
            }
          />
          sound
        </label>
      )}
      {(event.kind === "particle_vfx" || event.duration !== undefined) && (
        <label className="flex items-center gap-1">
          for
          <NumberField
            label={`${event.id} duration`}
            value={event.duration}
            step={0.1}
            min={0}
            onCommit={(duration) =>
              onPatch(
                { duration: Math.max(0, duration) },
                `duration:${event.id}`,
              )
            }
          />
          s
        </label>
      )}
      {event.override && <span className="text-muted-foreground">placed</span>}
    </span>
  );
}

/** A Reaction's peak expression weights, editable. */
export function ExpressionsEditor({
  draft,
  base,
  beat,
  onChange,
}: {
  draft: TuneDraft;
  /** The expressions as loaded: the shapes peak changes scale. */
  base: TuneDraft["expressions"];
  /** The beat a new expression's key sits on (the Reaction's peak). */
  beat: string;
  onChange: (draft: TuneDraft, key?: string) => void;
}) {
  const setPeak = (name: string, value: number) =>
    onChange(
      setExpressionPeak(draft, name, value, beat, base[name]),
      `peak:${name}`,
    );
  const peaks = peakExpressions({
    clip: { expressions: draft.expressions },
  } as TuneItem);
  const unused = REACTION_EXPRESSIONS.filter(
    (name) => !Object.hasOwn(draft.expressions, name),
  );
  return (
    <section>
      <h3 className="mb-1 text-sm font-semibold">Peak expressions</h3>
      <ul className="flex flex-col gap-1 text-sm">
        {peaks.map(([name, value]) => (
          <li key={name} className="flex items-center gap-2">
            <span className="w-24">{name}</span>
            <input
              type="range"
              aria-label={`${name} peak`}
              min={0}
              max={1}
              step={0.05}
              value={value}
              onChange={(event) => setPeak(name, Number(event.target.value))}
            />
            <NumberField
              label={`${name} peak value`}
              value={value}
              step={0.05}
              min={0}
              max={1}
              onCommit={(next) => setPeak(name, next)}
            />
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={`Remove ${name}`}
              onClick={() => onChange(removeExpression(draft, name))}
            >
              ✕
            </Button>
          </li>
        ))}
      </ul>
      {unused.length > 0 && (
        <select
          aria-label="Add expression"
          className="border-input bg-background mt-1 rounded border px-1.5 py-0.5 text-sm"
          value=""
          onChange={(event) =>
            event.target.value &&
            onChange(
              setExpressionPeak(
                draft,
                event.target.value,
                0.5,
                beat,
                base[event.target.value],
              ),
            )
          }
        >
          <option value="">+ Expression</option>
          {unused.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      )}
    </section>
  );
}
