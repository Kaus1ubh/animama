import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  clipFrom,
  gestureStart,
  listSheetItems,
  namespaceClip,
  parseCueSheet,
  readAlignment,
  resolveAvatarFile,
} from "./animation-reel-sheet.mjs";

const BEATS_CLIP = {
  duration: 2.5,
  beats: [
    { id: "start", time: 0 },
    { id: "pop", time: 0.5 },
    { id: "settle", time: 2 },
  ],
};

test("parses a cue sheet's takes and rejects invalid ones", () => {
  const [take] = parseCueSheet(
    {
      title: "Joy",
      camera: "landing",
      duration: 3,
      cues: [
        {
          gesture: "library:gesture/double-peace-pop",
          beat: "pop",
          beatAt: 1,
          enter: 0.35,
        },
        { reaction: "library:reaction/joy-3-b", at: 0.3, until: 2.5 },
      ],
      speech: { alignment: "take.json", audio: "take.mp3", at: 0.5 },
    },
    { dir: "/sheets" },
  );
  assert.equal(take.title, "Joy");
  assert.equal(take.camera, "landing");
  assert.deepEqual(
    parseCueSheet(
      { cues: [{ gesture: "a" }], camera: { distance: 1, lift: 0 } },
      { dir: "/" },
    )[0].camera,
    { distance: 1, lift: 0 },
  );
  assert.equal(take.duration, 3);
  assert.deepEqual(
    take.cues.map(({ kind, spec, at, beat, beatAt, enter, until }) => ({
      kind,
      spec,
      at,
      beat,
      beatAt,
      enter,
      until,
    })),
    [
      {
        kind: "gesture",
        spec: "library:gesture/double-peace-pop",
        at: null,
        beat: "pop",
        beatAt: 1,
        enter: 0.35,
        until: null,
      },
      {
        kind: "reaction",
        spec: "library:reaction/joy-3-b",
        at: 0.3,
        beat: null,
        beatAt: null,
        enter: null,
        until: 2.5,
      },
    ],
  );
  assert.equal(take.speech.alignment, "/sheets/take.json");
  assert.equal(take.speech.audio, "/sheets/take.mp3");
  assert.equal(take.speech.at, 0.5);
  assert.equal(take.speech.text, null);
  // A sheet of takes; a take may be speech alone.
  assert.equal(
    parseCueSheet(
      {
        takes: [
          { cues: [{ gesture: "a" }] },
          { speech: { alignment: "t.json" } },
        ],
      },
      { dir: "/" },
    ).length,
    2,
  );

  for (const [sheet, message] of [
    [{ takes: [] }, /no takes/],
    [{ takes: [{ cues: [] }], fps: 30 }, /no other fields/],
    [{ cues: [] }, /at least one cue or speech/],
    [{ cues: [{ wave: "a" }] }, /"reaction", "vrma", "face" or "mood"/],
    [
      { cues: [{ gesture: "a", reaction: "b" }] },
      /"reaction", "vrma", "face" or "mood"/,
    ],
    [{ cues: [{ reaction: "a", from: 1 }] }, /unknown field "from"/],
    [{ cues: [{ reaction: "a", enter: 1 }] }, /unknown field "enter"/],
    [{ cues: [{ gesture: "a", enter: -1 }] }, /enter must be/],
    [{ cues: [{ gesture: "a", at: -1 }] }, /at must be/],
    [{ cues: [{ gesture: "a", beat: "pop" }] }, /go together/],
    [
      { cues: [{ gesture: "a", beat: "pop", beatAt: 1, from: 0.2 }] },
      /not both/,
    ],
    [{ cues: [{ gesture: "a" }], duration: 0 }, /more than 0/],
    [{ cues: [{ gesture: "a" }], fps: 30 }, /unknown field "fps"/],
    [{ speech: { audio: "a.mp3" } }, /alignment must name/],
    [
      { cues: [{ gesture: "a", from: -1 }] },
      /from must be seconds or a beat id/,
    ],
    [{ cues: [{ gesture: "a" }], camera: { zoom: 2 } }, /unknown field "zoom"/],
    [
      { cues: [{ gesture: "a" }], camera: { distance: "1" } },
      /distance must be a number/,
    ],
    [{ cues: [{ gesture: "a" }], camera: 3 }, /preset name or a framing/],
    [
      { speech: { alignment: "t.json", volume: "loud" } },
      /volume must be a number, 0 or more/,
    ],
  ])
    assert.throws(() => parseCueSheet(sheet, { dir: "/" }), message);
});

test("parses face and mood cues and the speech's mouth options", () => {
  const [take] = parseCueSheet(
    {
      cues: [
        { gesture: "a" },
        { face: { happy: 0.5, ウィンク: 1 }, at: 1, until: 2 },
        { face: { relaxed: 0.4 }, at: 2, until: 3, fade: 0.4 },
        { mood: { joy: 18 }, at: 0.5, until: 4 },
      ],
      speech: {
        alignment: "t.json",
        shaping: "arkit",
        lead: 0.05,
        gain: 1.5,
      },
    },
    { dir: "/" },
  );
  // Face and mood cues leave the clip cues.
  assert.deepEqual(
    take.cues.map(({ kind }) => kind),
    ["gesture"],
  );
  assert.deepEqual(take.faces, [
    { at: 1, until: 2, fade: 0.2, weights: { happy: 0.5, ウィンク: 1 } },
    { at: 2, until: 3, fade: 0.4, weights: { relaxed: 0.4 } },
  ]);
  assert.deepEqual(take.moods, [{ at: 0.5, until: 4, values: { joy: 18 } }]);
  assert.equal(take.speech.shaping, "arkit");
  assert.equal(take.speech.lead, 0.05);
  assert.equal(take.speech.gain, 1.5);
  const [plain] = parseCueSheet(
    { speech: { alignment: "t.json" } },
    { dir: "/" },
  );
  assert.equal(plain.speech.shaping, "visemes");
  assert.equal(plain.speech.lead, 0);
  assert.equal(plain.speech.gain, 1);

  const speech = { alignment: "t.json" };
  for (const [sheet, message] of [
    [{ cues: [{ face: { happy: 0.5 }, at: 1 }], speech }, /give at and until/],
    [
      { cues: [{ face: { happy: 0.5 }, at: 2, until: 1 }], speech },
      /must be later than at/,
    ],
    [{ cues: [{ face: {}, at: 0, until: 1 }], speech }, /maps expression/],
    [
      { cues: [{ face: { happy: 2 }, at: 0, until: 1 }], speech },
      /happy must be a number from 0 to 1/,
    ],
    [
      { cues: [{ face: { happy: 1 }, at: 0, until: 1, ease: "in" }], speech },
      /unknown field "ease"/,
    ],
    [
      { cues: [{ mood: { joy: 40 }, at: 0, until: 1 }], speech },
      /joy must be a number from 0 to 30/,
    ],
    [
      { cues: [{ gesture: "a" }, { mood: { joy: 10 }, at: 0, until: 1 }] },
      /mood cues need speech/,
    ],
    [{ speech: { alignment: "t.json", shaping: "jaw" } }, /visemes or arkit/],
    [{ speech: { alignment: "t.json", gain: -1 } }, /gain must be/],
  ])
    assert.throws(() => parseCueSheet(sheet, { dir: "/" }), message);
});

test("starts a Gesture from a clip time or beat, or lands a beat on a time", () => {
  const cue = (fields) => ({
    at: null,
    from: null,
    beat: null,
    beatAt: null,
    where: "cue",
    ...fields,
  });
  assert.deepEqual(gestureStart(cue({}), BEATS_CLIP), { at: 0, from: 0 });
  assert.deepEqual(gestureStart(cue({ at: 1, from: 0.25 }), BEATS_CLIP), {
    at: 1,
    from: 0.25,
  });
  assert.deepEqual(gestureStart(cue({ at: 1, from: "pop" }), BEATS_CLIP), {
    at: 1,
    from: 0.5,
  });
  // Without `at` the clip starts early enough for its beat to land.
  assert.deepEqual(
    gestureStart(cue({ beat: "settle", beatAt: 3 }), BEATS_CLIP),
    { at: 1, from: 0 },
  );
  // With `at` it starts part-way through.
  assert.deepEqual(
    gestureStart(cue({ at: 1, beat: "settle", beatAt: 1.5 }), BEATS_CLIP),
    { at: 1, from: 1.5 },
  );
  assert.throws(
    () => gestureStart(cue({ beat: "settle", beatAt: 1 }), BEATS_CLIP),
    /cannot land at 1 s/,
  );
  assert.throws(
    () => gestureStart(cue({ at: 1, beat: "pop", beatAt: 2 }), BEATS_CLIP),
    /cannot land at 2 s when the clip starts at 1 s/,
  );
  assert.throws(
    () => gestureStart(cue({ from: "wink" }), BEATS_CLIP),
    /no beat "wink"; its beats are start, pop, settle/,
  );
  // A start at or past the clip's end leaves nothing to play.
  assert.throws(
    () => gestureStart(cue({ from: 2.98 }), { ...BEATS_CLIP, duration: 3 }),
    /at or past the end of the 3 s clip/,
  );
});

test("carries events still running into a clip started part-way", () => {
  const clip = {
    duration: 3,
    events: [
      { id: "early-sound", kind: "sfx", time: 0.2, cueId: "a" },
      { id: "at-cut-sound", kind: "sfx", time: 1, cueId: "b" },
      {
        id: "ended",
        kind: "avatar_vfx",
        time: 0.1,
        duration: 0.5,
        effectId: "x",
      },
      {
        id: "running",
        kind: "particle_vfx",
        time: 0.5,
        duration: 2,
        effectId: "y",
      },
      { id: "held", kind: "avatar_vfx", time: 0.3, effectId: "z" },
      { id: "later", kind: "avatar_vfx", time: 2, effectId: "w" },
    ],
  };
  assert.equal(clipFrom(clip, 0), clip);
  const cut = clipFrom(clip, 1);
  assert.deepEqual(
    cut.events.map(({ id, time, duration }) => [
      id,
      Number(time.toFixed(3)),
      duration === undefined ? null : Number(duration.toFixed(3)),
    ]),
    [
      ["at-cut-sound", 1.002, null],
      ["running", 1.002, 1.498],
      ["held", 1.002, null],
      ["later", 2, null],
    ],
  );
  assert.equal(clip.events.length, 6, "the source clip is unchanged");
});

test("namespaces a clip's dependency aliases in its events", () => {
  const { clip, dependencies } = namespaceClip(
    {
      events: [
        { kind: "avatar_vfx", effectId: "blush" },
        { kind: "scene_vfx", presetId: "glow" },
        { kind: "sfx", cueId: "pop" },
        { kind: "sfx", cueId: "builtin:sound-effect:direct" },
      ],
    },
    [
      { alias: "blush", ref: "builtin:avatar-effect:blush" },
      { alias: "glow", ref: "builtin:scene-effect:glow" },
      {
        alias: "pop",
        ref: "builtin:sound-effect:pop",
        content_type: "sound_effect",
      },
    ],
    "c2",
  );
  assert.deepEqual(
    clip.events.map((event) => event.effectId ?? event.presetId ?? event.cueId),
    ["c2:blush", "c2:glow", "c2:pop", "builtin:sound-effect:direct"],
  );
  assert.deepEqual(
    dependencies.map(({ alias }) => alias),
    ["c2:blush", "c2:glow", "c2:pop"],
  );
});

test("reads ElevenLabs timing from a response or a bare alignment", () => {
  const alignment = {
    characters: ["H", "i"],
    character_start_times_seconds: [0, 0.1],
    character_end_times_seconds: [0.1, 0.2],
  };
  assert.deepEqual(readAlignment({ alignment, audio_base64: "AAA=" }, "s"), {
    alignment,
    audioBase64: "AAA=",
  });
  assert.deepEqual(readAlignment(alignment, "s"), {
    alignment,
    audioBase64: null,
  });
  assert.throws(
    () => readAlignment({ characters: [] }, "s"),
    /needs characters/,
  );
});

test("lists a sheet's takes with their clips resolved and started", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "animama-sheet-"));
  try {
    await writeFile(
      path.join(dir, "take.json"),
      JSON.stringify({
        alignment: {
          characters: ["H", "i"],
          character_start_times_seconds: [0, 0.1],
          character_end_times_seconds: [0.1, 0.2],
        },
        audio_base64: "AAA=",
      }),
    );
    const sheet = path.join(dir, "takes.json");
    await writeFile(
      sheet,
      JSON.stringify({
        takes: [
          {
            title: "Love",
            avatar: "andrew",
            cues: [
              {
                gesture: "library:gesture/big-arm-heart",
                at: 0.5,
                from: "heart",
              },
              { reaction: "library:reaction/love-3", at: 0.5 },
            ],
          },
          { speech: { alignment: "take.json", at: 0.2 } },
        ],
      }),
    );
    const [love, speech] = await listSheetItems(sheet);
    assert.equal(love.kind, "take");
    assert.equal(love.stem, "takes#1");
    assert.equal(love.name, "Love");
    assert.match(love.avatarFile, /content\/included\/avatars\/Andrew\.vrm$/);
    assert.deepEqual(
      love.cues.map(({ kind, at, from }) => [kind, at, from]),
      [
        ["gesture", 0.5, 0.92],
        ["reaction", 0.5, 0],
      ],
    );
    // The heart's sparkles started at its beat, so they carry over the cut.
    const sparkles = love.cues[0].clip.events.find(
      (event) => event.kind === "particle_vfx",
    );
    assert.equal(sparkles.effectId, "c1:sparkle_hearts");
    assert.ok(sparkles.time > 0.92);
    assert.ok(love.dependencies.every(({ alias }) => /^c[12]:/.test(alias)));
    assert.match(love.description, /Big Arm Heart|Big arm heart/i);
    assert.equal(speech.cues.length, 0);
    assert.equal(speech.speech.audioBase64, "AAA=");
    assert.equal(speech.speech.audio, null);
    await assert.rejects(
      listSheetItems(sheet.replace("takes", "missing")),
      /Cannot read the sheet/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("cuts a carried event's parameter keyframes at the start point", () => {
  const values = (scale) => ({ scale });
  const [event] = clipFrom(
    {
      duration: 3,
      events: [
        {
          kind: "avatar_vfx",
          time: 0.5,
          duration: 2,
          effectId: "x",
          parameterKeyframes: [
            { time: 0, values: values(1) },
            { time: 0.4, values: values(2) },
            { time: 1, values: values(3) },
            { time: 2, values: values(4) },
          ],
        },
      ],
    },
    1,
  ).events;
  assert.deepEqual(
    event.parameterKeyframes.map(({ time, values }) => [
      Number(time.toFixed(3)),
      values.scale,
    ]),
    [
      [0, 2],
      [0.498, 3],
      [1.498, 4],
    ],
  );
  assert.ok(event.parameterKeyframes.at(-1).time <= event.duration);
});

test("rejects a cue stopped before it starts and a missing Avatar file", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "animama-sheet-"));
  try {
    const sheet = path.join(dir, "takes.json");
    await writeFile(
      sheet,
      JSON.stringify({
        cues: [{ reaction: "library:reaction/joy-2", at: 1, until: 1 }],
      }),
    );
    await assert.rejects(listSheetItems(sheet), /until \(1 s\) must be later/);
    // A file is never taken for an Included Avatar id.
    await assert.rejects(
      resolveAvatarFile("Annie", dir, "--avatar-file", { file: true }),
      /Annie is not a \.vrm file/,
    );
    assert.match(
      await resolveAvatarFile("annie", dir, "--avatar"),
      /avatars\/Annie\.vrm$/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("lists a VRMA cue with its file, start, speed and fade", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "animama-sheet-"));
  try {
    await writeFile(path.join(dir, "cheer.vrma"), "glTF");
    const sheet = path.join(dir, "takes.json");
    await writeFile(
      sheet,
      JSON.stringify({
        duration: 4,
        cues: [
          { vrma: "cheer.vrma", at: 0.5, from: 0.45, speed: 0.95, enter: 0 },
          { face: { happy: 0.3 }, at: 0, until: 4 },
        ],
      }),
    );
    const [item] = await listSheetItems(sheet);
    assert.equal(item.cues.length, 1);
    const [cue] = item.cues;
    assert.equal(cue.kind, "vrma");
    assert.equal(cue.at, 0.5);
    assert.equal(cue.from, 0.45);
    assert.equal(cue.speed, 0.95);
    assert.equal(cue.enter, 0);
    assert.equal(cue.until, null);
    assert.equal(path.basename(cue.file), "cheer.vrma");
    assert.equal(item.description, "cheer");

    const bad = (cue) => parseCueSheet({ cues: [cue] }, { dir, name: "s" });
    assert.throws(
      () => bad({ vrma: "cheer.glb" }),
      /vrma must name a \.vrma file/,
    );
    assert.throws(
      () => bad({ vrma: "cheer.vrma", speed: 0 }),
      /speed must be more than 0/,
    );
    assert.throws(
      () => bad({ vrma: "cheer.vrma", beat: "x" }),
      /unknown field "beat"/,
    );
    await writeFile(
      sheet,
      JSON.stringify({ cues: [{ vrma: "missing.vrma" }] }),
    );
    await assert.rejects(listSheetItems(sheet), /cannot read the VRMA file/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("lists a looping walk with its root path and a fixed camera", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "animama-sheet-"));
  try {
    await writeFile(path.join(dir, "walk.vrma"), "glTF");
    const sheet = path.join(dir, "takes.json");
    const camera = {
      position: [0, 1.05, 6.2],
      target: [0, 0.78, 0],
      fov: 22.5,
    };
    await writeFile(
      sheet,
      JSON.stringify({
        duration: 4,
        camera,
        root: [
          { at: 0, x: -3, z: -1, yaw: 90 },
          { at: 2, x: 0 },
          { at: 2.5, yaw: 0, ease: "inOut" },
        ],
        cues: [{ vrma: "walk.vrma", at: 0, speed: 1.02, loop: true, until: 2 }],
      }),
    );
    const [item] = await listSheetItems(sheet);
    assert.equal(item.cues[0].loop, true);
    assert.deepEqual(item.camera, camera);
    // Each key holds the fields it omits from the key before.
    assert.deepEqual(item.root, [
      { at: 0, x: -3, z: -1, yaw: 90, ease: "linear" },
      { at: 2, x: 0, z: -1, yaw: 90, ease: "linear" },
      { at: 2.5, x: 0, z: -1, yaw: 0, ease: "inOut" },
    ]);

    const bad = (take) =>
      parseCueSheet(
        { cues: [{ face: { happy: 1 }, at: 0, until: 1 }], ...take },
        { dir, name: "s" },
      );
    assert.throws(
      () => bad({ cues: [{ vrma: "walk.vrma", loop: true }] }),
      /a looping VRMA cue needs until/,
    );
    assert.throws(
      () => bad({ root: [{ at: 1 }, { at: 0 }] }),
      /keys go in time order/,
    );
    assert.throws(
      () => bad({ root: [{ at: 0, ease: "bounce" }] }),
      /ease must be/,
    );
    assert.throws(
      () => bad({ camera: { position: [0, 1, 6] } }),
      /a fixed camera gives position and target/,
    );
    assert.throws(
      () => bad({ camera: { position: [0, 1], target: [0, 1, 0] } }),
      /position must be \[x, y, z\]/,
    );
    assert.throws(
      () =>
        bad({ camera: { position: [0, 1, 6], target: [0, 1, 0], yaw: 20 } }),
      /unknown field "yaw"/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
