import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import sharp from "sharp";

import {
  listReelItems,
  loadSoundCatalog,
  recordReel,
} from "./animation-reel.mjs";

const hasFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;

// A real recording: a looping Gesture without effects, a Reaction with an
// Avatar Effect (and its sound), a Particle Effect and a Scene Effect, then a
// Scene Effect on its own.
test(
  "records a reel with chapters and the sounds clip events play",
  { skip: !hasFfmpeg && "ffmpeg is not installed" },
  async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "animama-reel-"));
    try {
      // eye_vv names builtin:sound-effect:cute_chirpy_03 as its sound.
      execFileSync("ffmpeg", [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=880:duration=0.5",
        path.join(dir, "cute_chirpy_03.wav"),
      ]);
      await writeFile(
        path.join(dir, "cute_chirpy_03.meta.json"),
        JSON.stringify({
          content_type: "sound_effect",
          content_id: "builtin:sound-effect:cute_chirpy_03",
          name: "Test Chirp",
          duration_seconds: 0.5,
        }),
      );
      const items = await listReelItems({
        gestures: false,
        reactions: false,
        sources: [
          "library:gesture/arms-crossed",
          "library:reaction/amusement-4",
          "library:scene-effect/dark",
        ],
        cwd: process.cwd(),
        localContent: null,
        hold: 0.5,
      });
      const out = path.join(dir, "reel.mp4");
      const { results, duration, soundCount } = await recordReel({
        items,
        out,
        avatar: "Annie",
        camera: "portrait",
        size: { width: 640, height: 360 },
        fps: 10,
        lead: 0.2,
        tail: 0.2,
        talk: 0.5,
        maxSec: 20,
        crf: 30,
        catalog: await loadSoundCatalog([dir]),
        localContent: null,
        software: true,
        log: () => undefined,
      });

      assert.deepEqual(
        results.map(({ stem, failure, warnings }) => ({
          stem,
          failure,
          warnings,
        })),
        [
          { stem: "arms-crossed", failure: null, warnings: [] },
          { stem: "amusement-4", failure: null, warnings: [] },
          { stem: "dark", failure: null, warnings: [] },
        ],
      );
      assert.equal(soundCount, 1);
      const probe = JSON.parse(
        execFileSync("ffprobe", [
          "-v",
          "error",
          "-show_streams",
          "-show_chapters",
          "-show_format",
          "-of",
          "json",
          out,
        ]),
      );
      const video = probe.streams.find((s) => s.codec_type === "video");
      const audio = probe.streams.find((s) => s.codec_type === "audio");
      assert.equal(video.codec_name, "h264");
      assert.equal(`${video.width}x${video.height}`, "640x360");
      assert.equal(audio.codec_name, "aac");
      assert.ok(Math.abs(Number(probe.format.duration) - duration) < 0.2);
      assert.deepEqual(
        probe.chapters.map((chapter) => chapter.tags.title),
        [
          "Gesture · 1 / 3 · Arms Crossed",
          "Reaction · 2 / 3 · Amusement Reaction 4 (Amusement · Intense · intensity 4 · model 9–10)",
          "Scene Effect · 3 / 3 · Focus Lines Dark (Scene focus-lines effect preset)",
        ],
      );
      // The test tone (lavfi's default amplitude, about -21 dB) is mixed in
      // during the Reaction only; the rest is the silent base track.
      const maxVolume = ({ start, end }) => {
        const { stderr } = spawnSync(
          "ffmpeg",
          [
            "-hide_banner",
            "-ss",
            String(start),
            "-t",
            String(end - start),
            "-i",
            out,
            "-vn",
            "-af",
            "volumedetect",
            "-f",
            "null",
            "-",
          ],
          { encoding: "utf8" },
        );
        return Number(/max_volume: (-?[\d.]+) dB/.exec(stderr)?.[1]);
      };
      assert.ok(maxVolume(results[0]) < -60);
      assert.ok(maxVolume(results[1]) > -30);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);

// A cue sheet take recorded for compositing: a Gesture started part-way with
// a Reaction beside it and a voice take, as PNG frames and as ProRes 4444,
// both with a transparent background.
test(
  "records a cue sheet take with speech as alpha frames and ProRes 4444",
  { skip: !hasFfmpeg && "ffmpeg is not installed" },
  async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "animama-reel-sheet-"));
    try {
      execFileSync("ffmpeg", [
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=220:duration=1",
        path.join(dir, "take.mp3"),
      ]);
      const text = "Hi there";
      await writeFile(
        path.join(dir, "take.json"),
        JSON.stringify({
          alignment: {
            characters: [...text],
            character_start_times_seconds: [...text].map((_, i) => i * 0.1),
            character_end_times_seconds: [...text].map((_, i) => i * 0.1 + 0.1),
          },
        }),
      );
      const sheet = path.join(dir, "takes.json");
      await writeFile(
        sheet,
        JSON.stringify({
          title: "Love",
          duration: 1.5,
          cues: [
            {
              gesture: "library:gesture/big-arm-heart",
              at: 0.2,
              from: "heart",
            },
            { reaction: "library:reaction/love-3", at: 0.2 },
          ],
          speech: { audio: "take.mp3", alignment: "take.json", at: 0.3 },
        }),
      );
      const items = await listReelItems({
        gestures: false,
        reactions: false,
        sources: [],
        sheets: [sheet],
        cwd: process.cwd(),
        localContent: null,
      });
      const record = (out, format) =>
        recordReel({
          items,
          out,
          format,
          avatar: "Annie",
          camera: "landing",
          label: false,
          background: "transparent",
          size: { width: 320, height: 180 },
          fps: 10,
          lead: 0,
          tail: 0,
          talk: 3,
          maxSec: 20,
          crf: 30,
          catalog: new Map(),
          localContent: null,
          software: true,
          log: () => undefined,
        });

      const frames = path.join(dir, "frames");
      const { results } = await record(frames, "png");
      assert.equal(results[0].failure, null);
      const names = (await readdir(frames)).sort();
      assert.equal(names.filter((name) => name.endsWith(".png")).length, 15);
      assert.ok(names.includes("audio.wav"));
      const takes = JSON.parse(
        await readFile(path.join(frames, "takes.json"), "utf8"),
      );
      assert.deepEqual(
        takes.takes.map(({ firstFrame, lastFrame }) => [firstFrame, lastFrame]),
        [[1, 15]],
      );
      // The corners are transparent; the Avatar is opaque.
      const { data, info } = await sharp(path.join(frames, "frame-000010.png"))
        .raw()
        .toBuffer({ resolveWithObject: true });
      assert.equal(info.channels, 4);
      assert.equal(data[3], 0);
      let opaque = 0;
      for (let i = 3; i < data.length; i += 4) if (data[i] === 255) opaque += 1;
      assert.ok(opaque > 1000, `${opaque} opaque pixels`);

      const mov = path.join(dir, "take.mov");
      assert.equal((await record(mov, "mov")).results[0].failure, null);
      const probe = JSON.parse(
        execFileSync("ffprobe", [
          "-v",
          "error",
          "-show_streams",
          "-of",
          "json",
          mov,
        ]),
      );
      const video = probe.streams.find((s) => s.codec_type === "video");
      assert.equal(video.codec_name, "prores");
      assert.match(video.pix_fmt, /^yuva/);
      assert.ok(probe.streams.some((s) => s.codec_name === "pcm_s16le"));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);
