import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";

import {
  EffectSourceError,
  INCLUDED_CONTENT_ROOT,
  resolveClipSource,
} from "./effect-render-sources.mjs";

/**
 * Cue sheets for `pnpm -s animation:reel --sheet <file.json>`: scripted takes
 * for trailers and reviews. A sheet is one take, or `{ "takes": [...] }`:
 *
 *   {
 *     "title": "Joy",                     label title (optional)
 *     "detail": "Joy 3 (B) · Double peace pop",   label second line (optional)
 *     "avatar": "../Lapwing.vrm",         a .vrm file or Included Avatar id (optional)
 *     "camera": "landing",                camera preset, or a framing (optional)
 *     "duration": 3.5,                    fixed length in seconds (optional)
 *     "cues": [
 *       { "gesture": "library:gesture/double-peace-pop", "beat": "pop", "beatAt": 0.8 },
 *       { "reaction": "library:reaction/joy-3-b", "at": 0.3, "until": 3 }
 *     ],
 *     "speech": { "audio": "take.mp3", "alignment": "take.json", "at": 0.5 }
 *   }
 *
 * A framing object (`{ "distance": 1, "aim": 1 }`) overrides the landing hero
 * close-up's fields: `yaw` (degrees), `distance`, `aim` and `rise` in head
 * heights, `fov` (degrees), and `shift` and `lift` (lens shifts as shares of
 * the frame).
 *
 * Times are seconds on the take's clock, from the moment its Avatar stands
 * ready. A Gesture plays on the Avatar's clip player and a Reaction on its
 * reaction layer, so one of each plays together, as in chat; a later cue of
 * the same kind replaces the earlier one. A Gesture may start part-way
 * through: `from` is a clip time or beat id, or `beat` and `beatAt` start it
 * so that beat lands at that take time (from its start when `at` is
 * omitted). `enter` sets a Gesture's fade-in in seconds in place of its
 * own, as chat's planner does (it fades Gestures in over 0.35 s). `until`
 * stops a clip, with its fade; otherwise a looping clip
 * stops after one pass, and a talking-scoped one (a Reaction) after `--talk`
 * seconds or, in a take that speaks, once the speech has ended, as chat
 * holds it while the Anima speaks. `speech` plays a voice take with ElevenLabs
 * character timing (`with-timestamps`): `alignment` names the JSON response
 * (its `alignment`) or the alignment itself, `audio` the audio file (or the
 * response's `audio_base64` is used), `text` the text sent, tags included
 * (default: the alignment's characters), `shaping` how the mouth is shaped
 * (`visemes`, the default, or `arkit` mouth mixes on an Avatar with ARKit
 * shapes, as the debug modal's switch), `lead` how many seconds the mouth
 * moves ahead of the sound and `gain` a scale on its openness (default 1). Paths are relative to the sheet.
 *
 * A VRMA cue, `{ "vrma": "wave.vrma", "at": 1, "from": 0.5, "speed": 1.2,
 * "enter": 0.3, "until": 4 }`, plays a VRM Animation file (a converted
 * Mixamo or VRoid motion) on the Avatar's animation mixer, as the app plays
 * a VRMA Gesture: from `from` seconds into it, `speed` times as fast, fading
 * in over `enter` seconds (default 0.25), once, until it ends or `until`.
 *
 * Two more cue kinds direct her face while she speaks. A face cue,
 * `{ "face": { "happy": 0.5, "browInnerUp": 0.3 }, "at": 2, "until": 4,
 * "fade": 0.25 }`, adds expression weights (Avatar expressions or ARKit
 * shapes) over the face from `at` to `until`, ramping in and out over `fade`
 * seconds (default 0.2); overlapping face cues add up. A mood cue,
 * `{ "mood": { "joy": 18 }, "at": 2, "until": 9 }`, sets the feelings chat
 * would report (tracked emotions, 0 to 30) for the Avatar's emotion face and
 * posture; feelings are neutral outside mood cues. Mood cues need speech,
 * which feeds the Avatar's state.
 */

const TAKE_KEYS = new Set([
  "title",
  "detail",
  "avatar",
  "camera",
  "duration",
  "cues",
  "speech",
]);
const GESTURE_KEYS = new Set([
  "gesture",
  "at",
  "from",
  "beat",
  "beatAt",
  "enter",
  "until",
]);
const REACTION_KEYS = new Set(["reaction", "at", "until"]);
const VRMA_KEYS = new Set(["vrma", "at", "from", "speed", "enter", "until"]);
const FACE_KEYS = new Set(["face", "at", "until", "fade"]);
const MOOD_KEYS = new Set(["mood", "at", "until"]);
const SPEECH_KEYS = new Set([
  "audio",
  "alignment",
  "text",
  "at",
  "volume",
  "shaping",
  "lead",
  "gain",
]);
const SHAPINGS = new Set(["visemes", "arkit"]);
/** Default ramp (s) of a face cue. */
const FACE_FADE_SEC = 0.2;
/** Highest feeling a mood cue can set (`EMOTION_MAX_VALUE`). */
const MOOD_MAX = 30;
/** A landing-style framing's fields (`landing-stage/stops.ts` StageCamera). */
const CAMERA_KEYS = new Set([
  "yaw",
  "distance",
  "aim",
  "rise",
  "fov",
  "shift",
  "lift",
]);
/**
 * A carried event's start just after the time a clip is sought to: seeking
 * counts events at or before that time as fired.
 */
const CARRY_EPSILON_SEC = 0.002;
/** Least of a Gesture left to play after a part-way start. */
const MIN_REMAINING_SEC = 0.05;

const isRecord = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function fail(where, message) {
  throw new EffectSourceError(`${where}: ${message}`);
}

function seconds(value, where, name, unit = "a number of seconds") {
  if (value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0)
    fail(where, `${name} must be ${unit}, 0 or more.`);
  return value;
}

function checkKeys(value, allowed, where) {
  for (const key of Object.keys(value))
    if (!allowed.has(key))
      fail(where, `unknown field "${key}"; use ${[...allowed].join(", ")}.`);
}

/**
 * The takes of a parsed sheet, validated, with file paths resolved against
 * `dir`. Clip specs stay as written (resolved by `listSheetItems`).
 */
export function parseCueSheet(sheet, { dir, name = "sheet" }) {
  const takes =
    isRecord(sheet) && Array.isArray(sheet.takes) ? sheet.takes : [sheet];
  if (isRecord(sheet) && "takes" in sheet && Object.keys(sheet).length > 1)
    fail(name, 'a sheet with "takes" has no other fields.');
  if (takes.length === 0) fail(name, "it has no takes.");
  return takes.map((take, takeIndex) => {
    const where = `${name} take ${takeIndex + 1}`;
    if (!isRecord(take)) fail(where, "a take is an object.");
    checkKeys(take, TAKE_KEYS, where);
    for (const key of ["title", "detail", "avatar"])
      if (take[key] !== undefined && typeof take[key] !== "string")
        fail(where, `${key} must be a string.`);
    if (isRecord(take.camera)) {
      checkKeys(take.camera, CAMERA_KEYS, `${where} camera`);
      for (const [key, value] of Object.entries(take.camera))
        if (typeof value !== "number" || !Number.isFinite(value))
          fail(`${where} camera`, `${key} must be a number.`);
    } else if (take.camera !== undefined && typeof take.camera !== "string")
      fail(where, "camera must be a preset name or a framing object.");
    const duration = seconds(take.duration, where, "duration");
    if (duration === 0) fail(where, "duration must be more than 0.");
    if (take.cues !== undefined && !Array.isArray(take.cues))
      fail(where, "cues must be a list of Gestures and Reactions.");
    if (!take.cues?.length && take.speech === undefined)
      fail(where, "give at least one cue or speech.");
    const faces = [];
    const moods = [];
    const cues = (take.cues ?? []).flatMap((cue, cueIndex) => {
      const at = `${where} cue ${cueIndex + 1}`;
      if (!isRecord(cue)) fail(at, "a cue is an object.");
      if ("face" in cue) {
        faces.push(parseFace(cue, at));
        return [];
      }
      if ("mood" in cue) {
        moods.push(parseMood(cue, at));
        return [];
      }
      if ("vrma" in cue) return [parseVrma(cue, at, dir)];
      const kind =
        "gesture" in cue ? "gesture" : "reaction" in cue ? "reaction" : null;
      if (!kind || ("gesture" in cue && "reaction" in cue))
        fail(at, 'name one "gesture", "reaction", "vrma", "face" or "mood".');
      checkKeys(cue, kind === "gesture" ? GESTURE_KEYS : REACTION_KEYS, at);
      if (typeof cue[kind] !== "string" || !cue[kind])
        fail(at, `${kind} must name a source.`);
      if (cue.from !== undefined && typeof cue.from !== "string")
        seconds(cue.from, at, "from", "seconds or a beat id");
      if ((cue.beat === undefined) !== (cue.beatAt === undefined))
        fail(at, "beat and beatAt go together.");
      if (cue.beat !== undefined && typeof cue.beat !== "string")
        fail(at, "beat must be a beat id.");
      if (cue.beat !== undefined && cue.from !== undefined)
        fail(at, "give from or beat and beatAt, not both.");
      return [
        {
          kind,
          spec: cue[kind],
          at: seconds(cue.at, at, "at"),
          from: cue.from ?? null,
          beat: cue.beat ?? null,
          beatAt: seconds(cue.beatAt, at, "beatAt"),
          enter: seconds(cue.enter, at, "enter"),
          until: seconds(cue.until, at, "until"),
          where: at,
        },
      ];
    });
    if (moods.length && take.speech === undefined)
      fail(where, "mood cues need speech, which feeds the Avatar's state.");
    let speech = null;
    if (take.speech !== undefined) {
      const at = `${where} speech`;
      if (!isRecord(take.speech)) fail(at, "speech is an object.");
      checkKeys(take.speech, SPEECH_KEYS, at);
      if (typeof take.speech.alignment !== "string")
        fail(at, "alignment must name the timing JSON file.");
      if (
        take.speech.shaping !== undefined &&
        !SHAPINGS.has(take.speech.shaping)
      )
        fail(at, `shaping must be ${[...SHAPINGS].join(" or ")}.`);
      for (const key of ["audio", "text"])
        if (
          take.speech[key] !== undefined &&
          typeof take.speech[key] !== "string"
        )
          fail(at, `${key} must be a string.`);
      speech = {
        at: seconds(take.speech.at, at, "at") ?? 0,
        alignment: path.resolve(dir, take.speech.alignment),
        audio:
          take.speech.audio === undefined
            ? null
            : path.resolve(dir, take.speech.audio),
        text: take.speech.text ?? null,
        volume: seconds(take.speech.volume, at, "volume", "a number") ?? 1,
        shaping: take.speech.shaping ?? "visemes",
        lead: seconds(take.speech.lead, at, "lead") ?? 0,
        gain: seconds(take.speech.gain, at, "gain", "a number") ?? 1,
        where: at,
      };
    }
    return {
      title: take.title ?? null,
      detail: take.detail ?? null,
      avatar: take.avatar ?? null,
      camera: take.camera ?? null,
      duration,
      cues,
      faces,
      moods,
      speech,
      where,
    };
  });
}

/** A cue's `at` and `until`, both required, `until` the later. */
function cueWindow(cue, where) {
  const at = seconds(cue.at, where, "at");
  const until = seconds(cue.until, where, "until");
  if (at === null || until === null) fail(where, "give at and until.");
  if (until <= at)
    fail(where, `until (${until} s) must be later than at (${at} s).`);
  return { at, until };
}

/** A VRMA cue: a VRM Animation file played from `from`, at `speed`. */
function parseVrma(cue, where, dir) {
  checkKeys(cue, VRMA_KEYS, where);
  if (typeof cue.vrma !== "string" || !/\.vrma$/i.test(cue.vrma))
    fail(where, "vrma must name a .vrma file.");
  const speed = seconds(cue.speed, where, "speed", "a number") ?? 1;
  if (speed === 0) fail(where, "speed must be more than 0.");
  return {
    kind: "vrma",
    spec: cue.vrma,
    file: path.resolve(dir, cue.vrma),
    at: seconds(cue.at, where, "at") ?? 0,
    from: seconds(cue.from, where, "from") ?? 0,
    speed,
    enter: seconds(cue.enter, where, "enter"),
    until: seconds(cue.until, where, "until"),
    where,
  };
}

/** A face cue: expression weights (0 to 1) over a window, with its ramp. */
function parseFace(cue, where) {
  checkKeys(cue, FACE_KEYS, where);
  if (!isRecord(cue.face) || Object.keys(cue.face).length === 0)
    fail(where, "face maps expression names to weights.");
  for (const [name, weight] of Object.entries(cue.face))
    if (typeof weight !== "number" || !(weight >= 0 && weight <= 1))
      fail(where, `face weight ${name} must be a number from 0 to 1.`);
  return {
    ...cueWindow(cue, where),
    fade: seconds(cue.fade, where, "fade") ?? FACE_FADE_SEC,
    weights: { ...cue.face },
  };
}

/** A mood cue: tracked emotions (0 to 30) over a window. */
function parseMood(cue, where) {
  checkKeys(cue, MOOD_KEYS, where);
  if (!isRecord(cue.mood) || Object.keys(cue.mood).length === 0)
    fail(where, "mood maps tracked emotions to values.");
  for (const [name, value] of Object.entries(cue.mood))
    if (typeof value !== "number" || !(value >= 0 && value <= MOOD_MAX))
      fail(where, `mood ${name} must be a number from 0 to ${MOOD_MAX}.`);
  return { ...cueWindow(cue, where), values: { ...cue.mood } };
}

/** A clip's beat times by id. */
function beatTimes(clip) {
  return new Map(
    (Array.isArray(clip?.beats) ? clip.beats : [])
      .filter((beat) => typeof beat?.id === "string")
      .map((beat) => [beat.id, Number(beat.time) || 0]),
  );
}

/**
 * Where a Gesture cue starts on the take's clock (`at`) and in its clip
 * (`from`): `from` as given (seconds or a beat id), or, with `beat` and
 * `beatAt`, so that beat plays at `beatAt`.
 */
export function gestureStart(cue, clip) {
  const beats = beatTimes(clip);
  const length = Number(clip?.duration) || 0;
  const checkFrom = (from) => {
    if (from > 0 && from >= length - MIN_REMAINING_SEC)
      fail(
        cue.where,
        `it would start ${from} s in, at or past the end of the ${length} s clip.`,
      );
    return from;
  };
  const beatTime = (id) => {
    if (!beats.has(id))
      fail(
        cue.where,
        `the clip has no beat "${id}"; its beats are ${[...beats.keys()].join(", ") || "none"}.`,
      );
    return beats.get(id);
  };
  if (cue.beat !== null) {
    const time = beatTime(cue.beat);
    if (cue.at === null) {
      const at = cue.beatAt - time;
      if (at < -1e-9)
        fail(
          cue.where,
          `beat "${cue.beat}" is ${time} s in, so it cannot land at ${cue.beatAt} s from the clip's start; give an earlier at to start part-way through.`,
        );
      return { at: Math.max(0, at), from: 0 };
    }
    const from = time - (cue.beatAt - cue.at);
    if (from < -1e-9 || cue.beatAt < cue.at)
      fail(
        cue.where,
        `beat "${cue.beat}" (${time} s in) cannot land at ${cue.beatAt} s when the clip starts at ${cue.at} s.`,
      );
    return { at: cue.at, from: checkFrom(Math.max(0, from)) };
  }
  const from =
    typeof cue.from === "string" ? beatTime(cue.from) : (cue.from ?? 0);
  return { at: cue.at ?? 0, from: checkFrom(from) };
}

/**
 * `clip` prepared to start `from` seconds in (`Avatar.seekPoseClip` fires
 * nothing at or before that time): events still running then (a duration
 * that ends later, or none) restart just after it for what remains of them,
 * so a sticker or a particle stream the cut lands in is still on screen.
 * Sounds that started earlier are dropped.
 */
export function clipFrom(clip, from) {
  if (!from) return clip;
  const events = (Array.isArray(clip.events) ? clip.events : []).flatMap(
    (event) => {
      const time = Number(event.time) || 0;
      if (time > from) return [event];
      if (event.kind === "sfx") {
        return time < from
          ? []
          : [{ ...event, time: from + CARRY_EPSILON_SEC }];
      }
      const duration = Number.isFinite(event.duration) ? event.duration : null;
      if (duration !== null && time + duration <= from + CARRY_EPSILON_SEC)
        return [];
      const start = from + CARRY_EPSILON_SEC;
      const remaining = duration === null ? null : time + duration - start;
      return [
        {
          ...event,
          time: start,
          ...(remaining !== null ? { duration: remaining } : {}),
          ...(Array.isArray(event.parameterKeyframes) && remaining !== null
            ? {
                parameterKeyframes: cutKeyframes(
                  event.parameterKeyframes,
                  start - time,
                  remaining,
                ),
              }
            : {}),
        },
      ];
    },
  );
  return { ...clip, events };
}

/**
 * An event's parameter keyframes from `offset` seconds into it, for
 * `remaining` seconds: the last one at or before the cut holds from 0 (its
 * ease into the next one restarts there), later ones shift earlier.
 */
function cutKeyframes(keyframes, offset, remaining) {
  const held = keyframes.filter((keyframe) => keyframe.time <= offset).at(-1);
  return [
    ...(held ? [{ ...held, time: 0 }] : []),
    ...keyframes
      .filter((keyframe) => keyframe.time > offset)
      .map((keyframe) => ({ ...keyframe, time: keyframe.time - offset }))
      .filter((keyframe) => keyframe.time <= remaining),
  ];
}

/**
 * `clip` and its dependencies with every dependency alias prefixed
 * (`<prefix>:<alias>`), in its events too, so the clips of one take cannot
 * claim each other's effects and sounds.
 */
export function namespaceClip(clip, dependencies, prefix) {
  const renamed = new Map(
    (Array.isArray(dependencies) ? dependencies : [])
      .filter((dependency) => typeof dependency?.alias === "string")
      .map((dependency) => [dependency.alias, `${prefix}:${dependency.alias}`]),
  );
  const rename = (value) => renamed.get(value) ?? value;
  return {
    clip: {
      ...clip,
      events: (Array.isArray(clip.events) ? clip.events : []).map((event) => {
        const next = { ...event };
        for (const key of ["effectId", "presetId", "cueId"])
          if (typeof next[key] === "string") next[key] = rename(next[key]);
        return next;
      }),
    },
    dependencies: (Array.isArray(dependencies) ? dependencies : []).map(
      (dependency) =>
        typeof dependency?.alias === "string"
          ? { ...dependency, alias: rename(dependency.alias) }
          : dependency,
    ),
  };
}

/**
 * The provider alignment in a speech timing file: an ElevenLabs
 * `with-timestamps` response (its `alignment`) or the alignment itself, plus
 * the response's audio when it carries `audio_base64`.
 */
export function readAlignment(json, where) {
  const alignment = isRecord(json?.alignment) ? json.alignment : json;
  if (
    !isRecord(alignment) ||
    !Array.isArray(alignment.characters) ||
    !Array.isArray(alignment.character_start_times_seconds) ||
    !Array.isArray(alignment.character_end_times_seconds)
  )
    fail(
      where,
      "the alignment needs characters, character_start_times_seconds and character_end_times_seconds.",
    );
  return {
    alignment: {
      characters: alignment.characters,
      character_start_times_seconds: alignment.character_start_times_seconds,
      character_end_times_seconds: alignment.character_end_times_seconds,
    },
    audioBase64:
      typeof json?.audio_base64 === "string" ? json.audio_base64 : null,
  };
}

/** Short names of the Included Avatars, by lower-case alias. */
export const AVATAR_ALIASES = { annie: "Annie", andrew: "Andrew" };

/** An Included Avatar's file, by id or alias. */
export const includedAvatarFile = (id) =>
  path.join(
    INCLUDED_CONTENT_ROOT,
    "avatars",
    `${AVATAR_ALIASES[id.toLowerCase()] ?? id}.vrm`,
  );

/**
 * An Avatar file: a `.vrm` path, or (unless `file` is set) an Included
 * Avatar id.
 */
export async function resolveAvatarFile(
  value,
  dir,
  where,
  { file = false } = {},
) {
  if (!file && /^[A-Za-z0-9_-]+$/.test(value) && !/\.vrm$/i.test(value)) {
    const included = includedAvatarFile(value);
    if (!(await stat(included).catch(() => null)))
      fail(where, `no Included Avatar ${value}.`);
    return included;
  }
  const resolved = path.resolve(dir, value);
  if (!/\.vrm$/i.test(resolved)) fail(where, `${value} is not a .vrm file.`);
  if (!(await stat(resolved).catch(() => null))?.isFile())
    fail(where, `cannot read the Avatar file ${resolved}.`);
  return realpath(resolved);
}

/** A Library item's display name: its meta name, else the clip's, else its stem. */
function clipName(source) {
  return typeof source.meta?.name === "string"
    ? source.meta.name
    : typeof source.clip?.name === "string"
      ? source.clip.name
      : path.basename(source.clipPath, ".json");
}

/**
 * Reel items for a sheet file: one per take, with its cues' clips resolved,
 * started where they say and namespaced, and its speech timing read.
 */
export async function listSheetItems(file, { localContent = null } = {}) {
  const sheetPath = await realpath(file).catch(() => null);
  if (!sheetPath) throw new EffectSourceError(`Cannot read the sheet ${file}.`);
  const dir = path.dirname(sheetPath);
  const name = path.basename(sheetPath);
  let json;
  try {
    json = JSON.parse(await readFile(sheetPath, "utf8"));
  } catch (error) {
    throw new EffectSourceError(`${name} is not valid JSON: ${error.message}`);
  }
  const takes = parseCueSheet(json, { dir, name });
  const items = [];
  for (const [takeIndex, take] of takes.entries()) {
    const cues = [];
    const dependencies = [];
    const names = [];
    for (const [cueIndex, cue] of take.cues.entries()) {
      if (cue.kind === "vrma") {
        if (!(await stat(cue.file).catch(() => null))?.isFile())
          fail(cue.where, `cannot read the VRMA file ${cue.file}.`);
        if (cue.until !== null && cue.until <= cue.at)
          fail(
            cue.where,
            `until (${cue.until} s) must be later than its start (${cue.at} s).`,
          );
        cues.push({
          kind: "vrma",
          id: cue.spec,
          at: cue.at,
          from: cue.from,
          enter: cue.enter,
          until: cue.until,
          speed: cue.speed,
          file: await realpath(cue.file),
        });
        names.push(path.basename(cue.file, path.extname(cue.file)));
        continue;
      }
      const source = await resolveClipSource(cue.spec, {
        cwd: dir,
        localContent,
      });
      const contentType = source.meta?.content_type;
      if (contentType && contentType !== cue.kind)
        fail(cue.where, `${cue.spec} is a ${contentType}, not a ${cue.kind}.`);
      const { at, from } =
        cue.kind === "gesture"
          ? gestureStart(cue, source.clip)
          : { at: cue.at ?? 0, from: 0 };
      if (cue.until !== null && cue.until <= at)
        fail(
          cue.where,
          `until (${cue.until} s) must be later than its start (${at} s).`,
        );
      const named = namespaceClip(
        source.clip,
        source.dependencies,
        `c${cueIndex + 1}`,
      );
      cues.push({
        kind: cue.kind,
        id: cue.spec,
        at,
        from,
        enter: cue.enter,
        until: cue.until,
        clip: clipFrom(named.clip, from),
      });
      dependencies.push(...named.dependencies);
      names.push(clipName(source));
    }
    let speech = null;
    if (take.speech) {
      let timing;
      try {
        timing = JSON.parse(await readFile(take.speech.alignment, "utf8"));
      } catch (error) {
        fail(
          take.speech.where,
          `cannot read ${take.speech.alignment}: ${error.message}`,
        );
      }
      const { alignment, audioBase64 } = readAlignment(
        timing,
        take.speech.where,
      );
      if (!take.speech.audio && !audioBase64)
        fail(
          take.speech.where,
          "name the audio file; the timing JSON has no audio_base64.",
        );
      speech = {
        at: take.speech.at,
        audio: take.speech.audio,
        audioBase64: take.speech.audio ? null : audioBase64,
        alignment,
        text: take.speech.text,
        volume: take.speech.volume,
        shaping: take.speech.shaping,
        lead: take.speech.lead,
        gain: take.speech.gain,
      };
    }
    items.push({
      kind: "take",
      stem: `${path.basename(name, ".json")}#${takeIndex + 1}`,
      name: take.title ?? `Take ${takeIndex + 1}`,
      description: take.detail ?? names.join(" + "),
      emotion: null,
      intensity: null,
      cues,
      dependencies,
      avatarFile: take.avatar
        ? await resolveAvatarFile(take.avatar, dir, take.where)
        : null,
      camera: take.camera,
      duration: take.duration,
      faces: take.faces,
      moods: take.moods,
      speech,
    });
  }
  return items;
}
