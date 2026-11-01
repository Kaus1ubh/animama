import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { EffectRenderFailure, renderEffectSheets } from "./effect-render.mjs";
import {
  INCLUDED_CONTENT_ROOT,
  resolveAnyEffectSource,
  resolveClipSource,
  resolveDependencies,
  resolveEffectSource,
} from "./effect-render-sources.mjs";

// Real WebGL renders of Included effects on both Included Avatars, plus an
// effect whose image cannot decode: its controller warning fails the run.
test("renders effect sheets and fails on a controller warning", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "animama-effect-render-"));
  try {
    const broken = path.join(dir, "broken");
    await mkdir(broken);
    await writeFile(path.join(broken, "broken.png"), "not an image");
    await writeFile(
      path.join(broken, "broken.json"),
      JSON.stringify({
        content_type: "avatar_effect",
        name: "Broken",
        definition: {
          schema: "animama/avatar-effect/2",
          region: "full_face",
          attachment: { kind: "face_surface", part: "face_skin", area: "full" },
          art: { image: "broken.png" },
        },
      }),
    );
    const effects = await Promise.all(
      ["library:eye", "library:texture_sick_1", broken].map((spec) =>
        resolveEffectSource(spec),
      ),
    );
    const tile = { width: 96, height: 120 };
    const error = await renderEffectSheets({
      effects,
      outFileFor: (effect) => path.join(dir, `${effect.stem}.png`),
      times: [0.1, 0.5],
      tile,
    }).then(
      () => null,
      (rejection) => rejection,
    );

    assert.ok(error instanceof EffectRenderFailure, String(error));
    const [hover, texture, failed] = error.results;
    for (const result of [hover, texture]) {
      assert.deepEqual(result.failures, [], result.stem);
      assert.deepEqual(
        result.avatars.map((avatar) => avatar.activeEffectIds.length),
        [1, 1],
      );
      const png = await readFile(result.outFile);
      assert.equal(png.subarray(1, 4).toString(), "PNG");
      // 64 px labels + 2 Avatars × 3 views wide; 28 px header + 2 rows tall.
      assert.equal(png.readUInt32BE(16), 64 + 6 * tile.width);
      assert.equal(png.readUInt32BE(20), 28 + 2 * tile.height);
    }
    assert.equal(failed.stem, "broken");
    assert.match(failed.failures.join("\n"), /warning: Failed to load VFX/);
    assert.match(error.message, /^broken: /);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

/** An Avatar Effect folder `stem` whose art is an opaque red disc. */
async function discEffect(dir, stem, definition) {
  const { default: sharp } = await import("sharp");
  const size = 128;
  const data = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1)
    for (let x = 0; x < size; x += 1)
      if ((x - 64) ** 2 + (y - 64) ** 2 <= 56 ** 2)
        data.set([230, 40, 60, 255], (y * size + x) * 4);
  const folder = path.join(dir, stem);
  await mkdir(folder);
  await sharp(data, { raw: { width: size, height: size, channels: 4 } })
    .png()
    .toFile(path.join(folder, `${stem}.png`));
  await writeFile(
    path.join(folder, `${stem}.json`),
    JSON.stringify({
      content_type: "avatar_effect",
      name: stem,
      definition: {
        schema: "animama/avatar-effect/2",
        art: { image: `${stem}.png` },
        ...definition,
      },
    }),
  );
  return folder;
}

// Effects that apply without a warning on both Included Avatars but whose
// art cannot be seen where it belongs fail, each named: a blush decal moved
// off the face texture draws nothing, and a huge disc placed at the mouth
// but pushed below the chin draws mostly outside the head. An Included
// effect passes with all its art on the head; on one sheet with the unseen
// blush, Included heart eyes still pass, since each effect is judged against
// a capture without only its own art. A Reaction is compared with its own
// clip played without the art, so its mood face does not count: with the
// unseen blush it fails too.
test("fails art that draws nothing visible or mostly outside the head", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "animama-effect-render-art-"));
  try {
    const effects = [
      await resolveEffectSource("library:blush"),
      await resolveEffectSource(
        await discEffect(dir, "unseen_blush", {
          region: "blush",
          attachment: {
            kind: "face_surface",
            area: "blush",
            part: "face_skin",
            layout: "single",
            side: "right",
            offset: { x: 2, y: 2 },
          },
        }),
      ),
      await resolveEffectSource(
        await discEffect(dir, "sunk_mouth", {
          region: "mouth",
          attachment: {
            kind: "face_landmark",
            landmark: "mouth",
            scale: { x: 20, y: 20 },
            offset: { y: -0.25, z: 0.1 },
          },
        }),
      ),
    ];
    const options = {
      outFileFor: (effect) => path.join(dir, `${effect.stem}.png`),
      times: [0.5],
      views: ["front", "face"],
      tile: { width: 96, height: 120 },
    };
    const error = await renderEffectSheets({ effects, ...options }).then(
      () => null,
      (rejection) => rejection,
    );

    assert.ok(error instanceof EffectRenderFailure, String(error));
    const [included, unseen, sunk] = error.results;
    assert.deepEqual(included.failures, []);
    for (const avatar of included.avatars) {
      const [art] = avatar.art;
      assert.equal(art.effect, "blush");
      assert.equal(art.kind, "face");
      assert.ok(art.peak >= 12, `peak ${art.peak}`);
      assert.equal(art.wide.inside, art.wide.changed);
    }
    for (const [result, pattern] of [
      [
        unseen,
        /^(Andrew|Annie): unseen_blush draws nothing visible on the head: no pixel changed there, 12 needed in a tile; 0 px changed in all tiles$/,
      ],
      [
        sunk,
        /^(Andrew|Annie): sunk_mouth draws mostly outside the head: \d+\.\d% of the \d+ px it changes in the front views are on or around the head \(50% needed\)$/,
      ],
    ]) {
      assert.equal(result.failures.length, 2, result.failures.join("\n"));
      for (const failure of result.failures) assert.match(failure, pattern);
    }
    assert.match(
      error.message,
      /^unseen_blush: Andrew: unseen_blush draws nothing visible/m,
    );

    // Together with heart eyes on one sheet, only the unseen blush fails.
    const together = await renderEffectSheets({
      ...options,
      effects: [await resolveEffectSource("library:heart_eyes"), effects[1]],
      together: true,
    }).then(
      () => null,
      (rejection) => rejection,
    );
    assert.ok(together instanceof EffectRenderFailure, String(together));
    const [pair] = together.results;
    assert.equal(pair.stem, "heart_eyes+unseen_blush");
    assert.equal(pair.failures.length, 2, pair.failures.join("\n"));
    for (const failure of pair.failures)
      assert.match(failure, /^(Andrew|Annie): unseen_blush /);
    for (const avatar of pair.avatars)
      assert.deepEqual(
        avatar.art.map((art) => art.effect),
        ["heart_eyes", "unseen_blush"],
      );

    // sadness-2 plays its one Avatar Effect at 0.1 s; play the unseen blush.
    const reaction = await resolveClipSource("library:reaction/sadness-2");
    const replay = await renderEffectSheets({
      ...options,
      effects: [],
      clip: {
        ...reaction.clip,
        events: reaction.clip.events.map((event) =>
          event.kind === "avatar_vfx"
            ? { ...event, effectId: "unseen" }
            : event,
        ),
      },
      clipMedia: {
        avatarEffects: [{ alias: "unseen", effect: effects[1] }],
        particleEffects: [],
        sceneEffects: [],
        notices: [],
      },
      clipStem: "sadness-unseen",
    }).then(
      () => null,
      (rejection) => rejection,
    );
    assert.ok(replay instanceof EffectRenderFailure, String(replay));
    const [played] = replay.results;
    assert.deepEqual(
      played.avatars.map((avatar) => avatar.activeEffectIds),
      [["unseen"], ["unseen"]],
    );
    assert.equal(played.failures.length, 2, played.failures.join("\n"));
    for (const failure of played.failures)
      assert.match(
        failure,
        /: unseen draws nothing visible on the head: no pixel changed there/,
      );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// Body, sticker and silhouette effects applied together on both Avatars:
// each attachment is active and none leaves a warning.
test("renders body, sticker and silhouette attachments together", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "animama-effect-attach-"));
  try {
    const { default: sharp } = await import("sharp");
    const attachments = {
      heart: { kind: "body", bone: "chest", offset: { z: 0.15 }, size: 0.1 },
      doki: { kind: "sticker", around: "head", offset: { x: 0.15 } },
      shade: { kind: "silhouette", patternScale: 0.5, scroll: { x: 0.2 } },
    };
    const sources = [];
    for (const [stem, attachment] of Object.entries(attachments)) {
      const folder = path.join(dir, stem);
      await mkdir(folder);
      await sharp({
        create: {
          width: 32,
          height: 32,
          channels: 4,
          background: { r: 255, g: 40, b: 120, alpha: 0.8 },
        },
      })
        .png()
        .toFile(path.join(folder, "art.png"));
      await writeFile(
        path.join(folder, `${stem}.json`),
        JSON.stringify({
          content_type: "avatar_effect",
          name: stem,
          definition: {
            schema: "animama/avatar-effect/2",
            region: attachment.kind,
            attachment,
            art: { image: "art.png" },
          },
        }),
      );
      sources.push(await resolveEffectSource(folder));
    }
    const tile = { width: 96, height: 120 };
    const [result] = await renderEffectSheets({
      effects: sources,
      together: true,
      outFileFor: (effect) => path.join(dir, `${effect.stem}.png`),
      times: [0.1],
      tile,
    });

    assert.equal(result.stem, "heart+doki+shade");
    assert.deepEqual(result.failures, []);
    // The body and sticker art planes were found and judged in view.
    assert.deepEqual(result.notes, []);
    for (const avatar of result.avatars) {
      const planes = avatar.art.filter((art) => art.artId);
      assert.deepEqual(planes.map((art) => art.effect).sort(), [
        "doki",
        "heart",
      ]);
      for (const art of planes) assert.equal(art.artSeen, true, art.effect);
    }
    for (const avatar of result.avatars) {
      assert.deepEqual(avatar.activeEffectIds.sort(), [
        "doki",
        "heart",
        "shade",
      ]);
    }
    const png = await readFile(result.outFile);
    assert.equal(png.readUInt32BE(16), 64 + 6 * tile.width);
    assert.equal(png.readUInt32BE(20), 28 + tile.height);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// Avatar, Particle and Scene Effects applied together, and a Reaction whose
// events start all three, render as the chat draws them; a Reaction with one
// Particle Effect renders the same on every run, however long its effects take
// to load (two Particle Effects started in one frame can differ by a few
// pixels between runs; see avatar-vfx.md).
test("renders every effect kind together and a Reaction's effects", async () => {
  const dir = await mkdtemp(
    path.join(tmpdir(), "animama-effect-render-kinds-"),
  );
  try {
    const effects = await Promise.all(
      [
        "library:star3",
        "library:particle-effect/confetti",
        "library:scene-effect/scene-vfx-emotion-joy",
      ].map((spec) => resolveAnyEffectSource(spec)),
    );
    const tile = { width: 96, height: 120 };
    const [together] = await renderEffectSheets({
      effects,
      together: true,
      outFileFor: () => path.join(dir, "together.png"),
      times: [0.5],
      // star3's iris art is a few pixels in a front tile this small; the art
      // check sees it in the face view.
      views: ["front", "face"],
      tile,
    });
    assert.equal(together.stem, "star3+confetti+scene-vfx-emotion-joy");
    assert.deepEqual(together.failures, []);
    // The art is judged without the particles and Scene layers.
    for (const avatar of together.avatars)
      for (const art of avatar.art)
        assert.equal(art.wide.inside, art.wide.changed, art.effect);
    for (const avatar of together.avatars)
      assert.deepEqual(avatar.activeEffectIds.sort(), [
        "builtin:avatar-effect:star3",
        "builtin:scene-effect:background:scene-vfx-emotion-joy",
        "review:builtin:particle-effect:confetti",
      ]);

    const reaction = await resolveClipSource("library:reaction/sadness-4");
    const clipMedia = await resolveDependencies(reaction.dependencies);
    const renderReaction = async (file) => {
      const [played] = await renderEffectSheets({
        effects: [],
        clip: reaction.clip,
        clipMedia,
        clipStem: "sadness-4",
        outFileFor: () => path.join(dir, file),
        times: [0.5],
        views: ["front"],
        tile,
      });
      return played;
    };
    const played = await renderReaction("sadness-4.png");
    assert.equal(played.stem, "sadness-4");
    assert.deepEqual(played.failures, []);
    // Each of its Avatar Effects was measured against the clip without it.
    for (const avatar of played.avatars)
      assert.deepEqual(avatar.art.map((art) => art.effect).sort(), [
        "streaming_tears",
        "texture_black_1",
      ]);
    for (const avatar of played.avatars)
      for (const id of [
        "texture_black_1",
        "streaming_tears",
        "rain-cloud",
        "scene-vfx-emotion-sadness",
      ])
        assert.ok(
          avatar.activeEffectIds.includes(id),
          `${avatar.id}: ${avatar.activeEffectIds.join(", ")}`,
        );
    const png = await readFile(path.join(dir, "sadness-4.png"));
    assert.equal(png.readUInt32BE(16), 64 + 2 * tile.width);
    // One Particle Effect: a Reaction that starts two in one frame can differ
    // by a few pixels between runs.
    await renderReaction("sadness-4-again.png");
    assert.ok(
      png.equals(await readFile(path.join(dir, "sadness-4-again.png"))),
      "a second render of the Reaction differs",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

/**
 * A Particle Effect of one large, opaque, normally blended square of grey
 * `level` in front of the head, from hearts-v1 with `toneMapped` (when given)
 * on its material.
 */
async function greySquareEffect(dir, stem, level, toneMapped) {
  const { default: sharp } = await import("sharp");
  const folder = path.join(dir, stem);
  await cp(
    path.join(INCLUDED_CONTENT_ROOT, "vfx/particle/quark/hearts-v1"),
    folder,
    { recursive: true },
  );
  await writeFile(
    path.join(folder, "textures/pearl-heart.png"),
    await sharp({
      create: {
        width: 16,
        height: 16,
        channels: 4,
        background: { r: level, g: level, b: level, alpha: 1 },
      },
    })
      .png()
      .toBuffer(),
  );
  const manifestPath = path.join(folder, "particle.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const [material] = manifest.materials;
  material.blending = 1;
  if (toneMapped === undefined) delete material.toneMapped;
  else material.toneMapped = toneMapped;
  // The promoted effect has several emitters; this fixture draws one square.
  manifest.object.children = manifest.object.children.slice(0, 1);
  manifest.object.children[0].matrix = [
    1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
  ];
  const constant = (value) => ({ type: "ConstantValue", value });
  Object.assign(manifest.object.children[0].ps, {
    shape: { type: "point" },
    startLife: constant(10),
    startSpeed: constant(0),
    startSize: constant(3),
    startColor: {
      type: "ConstantColor",
      color: { r: 1, g: 1, b: 1, a: 1 },
    },
    emissionOverTime: constant(0),
    emissionBursts: [
      { time: 0, count: constant(1), probability: 1, interval: 0.01, cycle: 1 },
    ],
    behaviors: [],
  });
  await writeFile(manifestPath, JSON.stringify(manifest));
  const descriptorPath = path.join(folder, "hearts-v1.json");
  const descriptor = JSON.parse(await readFile(descriptorPath, "utf8"));
  await rm(descriptorPath);
  const slot = descriptor.runtime_defaults.slots.particle_vfx;
  slot.transform.offset = { x: 0, y: 0, z: 0 };
  slot.transform.rotation = { x: 0, y: 0, z: 0 };
  slot.transform.depth_offset = 0.3;
  delete descriptor.content_id;
  delete descriptor.version;
  await writeFile(
    path.join(folder, `${stem}.json`),
    JSON.stringify(descriptor),
  );
  return folder;
}

// The chat tone-maps particles (Neutral at exposure 1.1 with the default
// enhanced rendering) unless a material opts out with `toneMapped: false`;
// then the art's stored values reach the canvas as authored, with no extra
// sRGB step.
test("renders particle art without tone mapping when its material opts out", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "animama-effect-tone-"));
  try {
    const { default: sharp } = await import("sharp");
    const squares = [
      ["white_default", 255, undefined],
      ["white_untoned", 255, false],
      ["grey_untoned", 128, false],
    ];
    const effects = await Promise.all(
      squares.map(async ([stem, level, toneMapped]) =>
        resolveAnyEffectSource(
          await greySquareEffect(dir, stem, level, toneMapped),
        ),
      ),
    );
    const tile = { width: 96, height: 120 };
    const results = await renderEffectSheets({
      effects,
      outFileFor: (effect) => path.join(dir, `${effect.stem}.png`),
      times: [0.5],
      views: ["front"],
      tile,
    });
    // The centre pixel of each Avatar's front tile, which the square covers.
    const centres = await Promise.all(
      results.map(async (result) => {
        const { data, info } = await sharp(result.outFile)
          .raw()
          .toBuffer({ resolveWithObject: true });
        return [0, 1].map((avatarIndex) => {
          const x = 64 + avatarIndex * tile.width + tile.width / 2;
          const y = 28 + tile.height / 2;
          const offset = (y * info.width + x) * info.channels;
          return [...data.subarray(offset, offset + 3)];
        });
      }),
    );
    const [whiteDefault, whiteUntoned, greyUntoned] = centres;
    for (const [r, g, b] of whiteDefault)
      assert.ok(r > 205 && r < 245 && r === g && g === b, `${[r, g, b]}`);
    for (const pixel of whiteUntoned) assert.deepEqual(pixel, [255, 255, 255]);
    for (const pixel of greyUntoned)
      for (const channel of pixel)
        assert.ok(Math.abs(channel - 128) <= 2, `${pixel}`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// A local Avatar file outside the repository replaces both Included Avatars,
// and an upper-case extension does not leak into the sheet's label.
test("renders on a local Avatar file instead of the Included Avatars", async () => {
  const dir = await mkdtemp(
    path.join(tmpdir(), "animama-effect-render-avatar-file-"),
  );
  try {
    const avatarFile = path.join(dir, "Local-Avatar.VRM");
    await cp(
      path.resolve(
        import.meta.dirname,
        "../../../../content/included/avatars/Andrew.vrm",
      ),
      avatarFile,
    );
    const tile = { width: 96, height: 120 };
    const [result] = await renderEffectSheets({
      effects: [await resolveEffectSource("library:blush")],
      outFileFor: (effect) => path.join(dir, `${effect.stem}.png`),
      times: [0.1],
      tile,
      avatarFile,
    });

    assert.deepEqual(result.failures, []);
    assert.deepEqual(
      result.avatars.map((avatar) => avatar.id),
      ["Local-Avatar"],
    );
    const png = await readFile(result.outFile);
    assert.equal(png.readUInt32BE(16), 64 + 3 * tile.width);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
