import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import sharp from "sharp";

import { checkEffects } from "./effect-check.mjs";
import { resolveEffectSource } from "./effect-render-sources.mjs";

/** A 128 px PNG: a disc of `alpha`, or nothing visible at all. */
async function disc(alpha, rgb = [230, 40, 60]) {
  const size = 128;
  const data = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1)
    for (let x = 0; x < size; x += 1)
      if ((x - 64) ** 2 + (y - 64) ** 2 <= 56 ** 2)
        data.set([...rgb, alpha], (y * size + x) * 4);
  return sharp(data, { raw: { width: size, height: size, channels: 4 } })
    .png()
    .toBuffer();
}

async function writeEffect(dir, stem, { definition, alpha = 255, rgb }) {
  const folder = path.join(dir, stem);
  await mkdir(folder);
  await writeFile(path.join(folder, `${stem}.png`), await disc(alpha, rgb));
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

const floating = {
  region: "emote",
  attachment: { kind: "face_landmark", landmark: "top", position: "middle" },
};

// Real WebGL on both Included Avatars: a visible effect passes; art too faint
// to see and an invalid definition fail with a named reason.
test("effects check passes visible art and fails invisible or invalid effects", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "animama-effect-check-"));
  try {
    const sources = [
      await writeEffect(dir, "visible", { definition: floating }),
      await writeEffect(dir, "faint", { definition: floating, alpha: 5 }),
      // Eye effects close and clean the eyes by default; that alone must not
      // count as visible art.
      await writeEffect(dir, "faint_eye", {
        definition: {
          region: "eyes",
          attachment: {
            kind: "face_landmark",
            landmark: "eyes",
            side: "right",
            mirror: true,
          },
        },
        alpha: 5,
      }),
      // Faint art beside the head, where no Avatar is behind it.
      await writeEffect(dir, "faint_sticker", {
        definition: {
          region: "sticker",
          attachment: { kind: "sticker", around: "head", offset: { x: 0.15 } },
        },
        alpha: 5,
      }),
      // A tinted silhouette with white art is coloured by its tint.
      await writeEffect(dir, "white_tint", {
        definition: {
          region: "silhouette",
          attachment: { kind: "silhouette", fill: "tint" },
          appearance: { tint: "#ff4060", opacity: 0.6 },
        },
        rgb: [255, 255, 255],
      }),
      await writeEffect(dir, "invalid", {
        definition: {
          ...floating,
          appearance: { opacity: 3 },
        },
      }),
    ];
    const effects = await Promise.all(
      sources.map((source) => resolveEffectSource(source)),
    );
    const [visible, faint, faintEye, faintSticker, whiteTint, invalid] =
      await checkEffects({
        effects,
        times: [0.5],
        views: ["front"],
        tile: { width: 96, height: 120 },
      });
    const levels = (result) => result.lines.map((line) => line.level);

    assert.ok(!levels(visible).includes("FAIL"), JSON.stringify(visible.lines));
    assert.equal(
      visible.lines.filter((line) =>
        /visible in 1 of 1 frames/.test(line.message),
      ).length,
      2,
    );

    assert.ok(
      faint.lines.some(
        (line) => line.level === "FAIL" && /no visible art/.test(line.message),
      ),
      JSON.stringify(faint.lines),
    );

    assert.equal(
      faintEye.lines.filter(
        (line) => line.level === "FAIL" && /no visible art/.test(line.message),
      ).length,
      2,
      JSON.stringify(faintEye.lines),
    );

    assert.equal(
      faintSticker.lines.filter(
        (line) => line.level === "FAIL" && /no visible art/.test(line.message),
      ).length,
      2,
      JSON.stringify(faintSticker.lines),
    );
    assert.ok(
      !levels(whiteTint).includes("FAIL"),
      JSON.stringify(whiteTint.lines),
    );

    assert.deepEqual(levels(invalid), ["FAIL"]);
    assert.match(invalid.lines[0].message, /^definition: .*opacity/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// Art on a hand is out of frame arms down; posed by a Gesture that raises
// the hand beside the head (as --with-clip does), it is checked where the
// Gesture puts it.
test("effects check poses both Avatars with a Gesture clip", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "animama-effect-check-clip-"));
  try {
    const effect = await resolveEffectSource(
      await writeEffect(dir, "fingertip", {
        definition: {
          region: "body",
          // Past the fingertips of a raised right index finger.
          attachment: {
            kind: "body",
            bone: "rightHand",
            offset: { x: -0.21, z: 0.02 },
            size: 0.1,
            facing: "camera",
          },
        },
      }),
    );
    const raiseRightHand = {
      schema: "animaPoseClip/2.0",
      id: "raise-right-hand",
      name: "Raise Right Hand",
      duration: 1,
      beats: [{ id: "up", label: "Hand up", time: 0 }],
      joints: {
        rightUpperArm: {
          elevation: [{ beat: "up", v: 75 }],
          planeOfElevation: [{ beat: "up", v: 40 }],
          rotation: [{ beat: "up", v: 82 }],
        },
        rightLowerArm: { flexion: [{ beat: "up", v: 102 }] },
      },
    };
    const check = (clip) =>
      checkEffects({
        effects: [effect],
        times: [0.5],
        views: ["front"],
        tile: { width: 96, height: 120 },
        clip,
      }).then(([result]) => result.lines);

    const armsDown = await check(null);
    assert.equal(
      armsDown.filter(
        (line) =>
          line.level === "FAIL" &&
          /no visible art .*--with-clip <gesture>/.test(line.message),
      ).length,
      2,
      JSON.stringify(armsDown),
    );
    const posed = await check(raiseRightHand);
    assert.deepEqual(
      posed.map((line) => line.level),
      ["PASS", "PASS"],
      JSON.stringify(posed),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
