/**
 * Provider character timing as evidence for the aligner (ElevenLabs): each
 * unit gets the window the provider gave its characters. The windows are soft,
 * because provider times are hints. A word's end often runs into the pause
 * after it, and a tag's span is often much shorter than its sound. So:
 *
 * - speech units may stray 60 ms without cost; a word's units share its window
 *   in proportion to their weights;
 * - a punctuation pause may start as early as the unit before it and end as late
 *   as the unit after it;
 * - a tag may stray 0.4 s, so the audio decides where its sound is;
 * - where the provider leaves a gap of 0.1 s or more between words, an optional
 *   pause is added;
 * - timing arrives with its audio, so while a part is still arriving, a word
 *   whose characters have not been timed has not started yet: it may start no
 *   earlier than shortly before the end of the audio (`horizonSec`). Tags are
 *   exempt, because their characters can be timed after their sound. A word
 *   timed only in part keeps an open end.
 *
 * The provider's characters are matched to the planned text in order, ignoring
 * whitespace: the dialogue socket adds spaces between sentence inputs and can
 * split a number at its decimal point.
 */

import type { TimedChar } from "@/lib/speech/provider-speech-timing";
import type { LipSyncUnit } from "@/lib/lipsync/text/units";
import type { UnitWindow } from "./aligner";

const SPEECH_TOLERANCE_SEC = 0.06;
const PAUSE_TOLERANCE_SEC = 0.1;
const TAG_TOLERANCE_SEC = 0.4;
/** A silence between words this long becomes an optional pause. */
const GAP_PAUSE_SEC = 0.1;
/** How early an untimed unit may start before the timing's horizon. */
const HORIZON_TOLERANCE_SEC = 0.1;
/** How far ahead matching looks to recover from a character that differs. */
const LOOKAHEAD = 12;

export type TimedUnits = {
  units: LipSyncUnit[];
  /** Parallel to `units`; `null` where the provider has not timed the unit. */
  windows: Array<UnitWindow | null>;
};

const isSpace = (char: string) => /^\s+$/u.test(char);

/**
 * The provider character that times each text character, matched in order and
 * ignoring whitespace; `null` where none matched (or none has arrived yet).
 */
export function matchTimingToText(
  text: string,
  timeline: readonly TimedChar[],
): Array<TimedChar | null> {
  const out: Array<TimedChar | null> = new Array(text.length).fill(null);
  const nextText = (from: number) => {
    let i = from;
    while (i < text.length && isSpace(text[i]!)) i += 1;
    return i;
  };
  const nextTimed = (from: number) => {
    let j = from;
    while (j < timeline.length && isSpace(timeline[j]!.char)) j += 1;
    return j;
  };
  const matches = (i: number, j: number) =>
    timeline[j]!.char.length > 0 && text.startsWith(timeline[j]!.char, i);

  let i = nextText(0);
  let j = nextTimed(0);
  while (i < text.length && j < timeline.length) {
    if (matches(i, j)) {
      const length = timeline[j]!.char.length;
      for (let k = i; k < i + length; k += 1) out[k] = timeline[j]!;
      i = nextText(i + length);
      j = nextTimed(j + 1);
      continue;
    }
    // The provider skipped or added characters: find the closest place where
    // both agree again.
    let resumed = false;
    for (let step = 1, jj = j; step <= LOOKAHEAD; step += 1) {
      jj = nextTimed(jj + 1);
      if (jj >= timeline.length) break;
      if (matches(i, jj)) {
        j = jj;
        resumed = true;
        break;
      }
    }
    if (resumed) continue;
    for (let step = 1, ii = i; step <= LOOKAHEAD; step += 1) {
      ii = nextText(ii + 1);
      if (ii >= text.length) break;
      if (matches(ii, j)) {
        i = ii;
        resumed = true;
        break;
      }
    }
    if (resumed) continue;
    i = nextText(i + 1);
    j = nextTimed(j + 1);
  }
  return out;
}

/**
 * The provider's window for text range [start, end), or `null`. When `open`,
 * characters after the timed ones may still arrive, so the end is open.
 */
function rangeWindow(
  text: string,
  times: Array<TimedChar | null>,
  start: number,
  end: number,
  open: boolean,
): [number, number] | null {
  let first = Infinity;
  let last = -Infinity;
  let lastTimed = -1;
  for (let k = start; k < end; k += 1) {
    const time = times[k];
    if (!time) continue;
    first = Math.min(first, time.startSec);
    last = Math.max(last, time.endSec);
    lastTimed = k;
  }
  if (first > last) return null;
  const untimedAfter = text.slice(lastTimed + 1, end).trim().length > 0;
  return [first, open && untimedAfter ? Infinity : last];
}

const isSpeech = (unit: LipSyncUnit) =>
  unit.kind !== "pause" && unit.kind !== "tag";

export type TimingWindowOptions = {
  /**
   * While audio is still arriving: the end of the audio the timing covers.
   * Units after the last timed one start no earlier than this.
   */
  horizonSec?: number;
};

export function unitTimingWindows(
  text: string,
  units: readonly LipSyncUnit[],
  timeline: readonly TimedChar[],
  options: TimingWindowOptions = {},
): TimedUnits {
  const times = matchTimingToText(text, timeline);
  const open = options.horizonSec !== undefined;
  const raw: Array<[number, number] | null> = new Array(units.length).fill(
    null,
  );
  // Speech units that share a source range (a word's syllables, or a spelled
  // number's words) divide its window by weight.
  for (let index = 0; index < units.length; ) {
    const unit = units[index]!;
    let end = index + 1;
    if (isSpeech(unit)) {
      while (
        end < units.length &&
        isSpeech(units[end]!) &&
        units[end]!.start === unit.start &&
        units[end]!.end === unit.end
      ) {
        end += 1;
      }
    }
    const window = rangeWindow(text, times, unit.start, unit.end, open);
    if (window && window[1] === Infinity) {
      // Still being spoken: only the group's start is known.
      raw[index] = window;
    } else if (window) {
      const group = units.slice(index, end);
      const total = group.reduce((sum, member) => sum + member.weight, 0);
      let at = window[0];
      for (let k = index; k < end; k += 1) {
        const share =
          total > 0
            ? ((window[1] - window[0]) * units[k]!.weight) / total
            : (window[1] - window[0]) / group.length;
        raw[k] = [at, at + share];
        at += share;
      }
    }
    index = end;
  }

  const out: TimedUnits = { units: [], windows: [] };
  /** The index in `out` of the last unit that is not a pause. */
  let lastSound = -1;
  let pauseSinceSound = false;
  units.forEach((unit, index) => {
    const window = raw[index];
    if (unit.kind === "pause") {
      // Loose: from the start of the unit before to the end of the one after.
      const before = lastSound >= 0 ? out.windows[lastSound] : null;
      out.units.push(unit);
      out.windows.push(
        window
          ? {
              startSec: Math.min(window[0], before?.startSec ?? window[0]),
              endSec: window[1],
              toleranceSec: PAUSE_TOLERANCE_SEC,
            }
          : null,
      );
      pauseSinceSound = true;
      return;
    }
    const previous = lastSound >= 0 ? out.windows[lastSound] : null;
    if (window && pauseSinceSound) {
      // Punctuation pauses since the last sound may end as late as this unit.
      for (let k = lastSound + 1; k < out.windows.length; k += 1) {
        const pause = out.windows[k];
        if (pause) pause.endSec = Math.max(pause.endSec, window[1]);
      }
    } else if (
      window &&
      previous &&
      // Between words: a word's own units can be timed letter by letter.
      (unit.word === undefined || unit.word !== out.units[lastSound]!.word)
    ) {
      const previousEnd = previous.endSec;
      if (window[0] - previousEnd >= GAP_PAUSE_SEC) {
        out.units.push({
          kind: "pause",
          pause: "break",
          weight: window[0] - previousEnd,
          start: unit.start,
          end: unit.start,
        });
        out.windows.push({
          startSec: previousEnd,
          endSec: window[0],
          toleranceSec: PAUSE_TOLERANCE_SEC,
        });
      }
    }
    out.units.push(unit);
    out.windows.push(
      window
        ? {
            startSec: window[0],
            endSec: window[1],
            toleranceSec:
              unit.kind === "tag" ? TAG_TOLERANCE_SEC : SPEECH_TOLERANCE_SEC,
          }
        : null,
    );
    lastSound = out.units.length - 1;
    pauseSinceSound = false;
  });
  if (options.horizonSec !== undefined) {
    // Units after the last timed one have not started yet; those that share
    // its word are being spoken.
    let last = out.windows.length - 1;
    while (last >= 0 && out.windows[last] === null) last -= 1;
    let first = last + 1;
    while (
      last >= 0 &&
      first < out.units.length &&
      out.units[first]!.start === out.units[last]!.start &&
      out.units[first]!.end === out.units[last]!.end
    ) {
      first += 1;
    }
    for (let k = first; k < out.units.length; k += 1) {
      // A tag's characters are often timed after its sound ("gosh, [laughs]"
      // credits the laugh to the comma), so an untimed tag may have begun.
      if (out.units[k]!.kind === "tag") continue;
      out.windows[k] = {
        startSec: options.horizonSec,
        endSec: Infinity,
        toleranceSec: HORIZON_TOLERANCE_SEC,
      };
    }
    // Until the next unit starts, a pause may hold the silence or breath before
    // it: the punctuation pauses there stay open, or one is added.
    let opened = last >= 0 && out.units[last]!.kind === "pause";
    if (opened) out.windows[last]!.endSec = Infinity;
    for (let k = last + 1; k < first; k += 1) {
      const pause = out.windows[k];
      if (out.units[k]!.kind === "pause" && pause) {
        pause.endSec = Infinity;
        opened = true;
      }
    }
    const before = last >= 0 ? out.windows[last] : null;
    if (!opened && before && first < out.units.length) {
      out.units.splice(first, 0, {
        kind: "pause",
        pause: "break",
        weight: Math.max(GAP_PAUSE_SEC, options.horizonSec - before.endSec),
        start: out.units[first]!.start,
        end: out.units[first]!.start,
      });
      out.windows.splice(first, 0, {
        startSec: before.endSec,
        endSec: Infinity,
        toleranceSec: PAUSE_TOLERANCE_SEC,
      });
    }
  }
  return out;
}
