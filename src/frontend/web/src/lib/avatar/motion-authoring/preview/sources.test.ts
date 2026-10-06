import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AnimaPoseClip } from "../../poses/animaPoseClip";
import {
  PreviewSourceError,
  previewClipFromText,
  resolvePreviewSource,
  sourceVersion,
} from "./sources";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "animama-preview-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const clip = (overrides: Partial<AnimaPoseClip> = {}): AnimaPoseClip => ({
  schema: "animaPoseClip/1.0",
  id: "nod",
  name: "Nod",
  duration: 1.5,
  fadeOut: { duration: 0.4 },
  poses: {
    rest: { humanoid: { head: { rotation: [0, 0, 0, 1] } } },
    down: { humanoid: { head: { rotation: [0.1305, 0, 0, 0.9914] } } },
  },
  poseKeyframes: [
    { time: 0, pose: "rest" },
    { time: 0.5, pose: "down" },
    { time: 1.5, pose: "rest" },
  ],
  ...overrides,
});

/** A Library item folder as the content store lays it out. */
async function libraryItem(
  root: string,
  kind: "gestures" | "reactions",
  stem: string,
  meta: Record<string, unknown>,
  sequence: unknown,
) {
  const folder = path.join(root, kind, stem);
  await mkdir(folder, { recursive: true });
  await writeFile(
    path.join(folder, `${stem}.meta.json`),
    JSON.stringify({
      files: [{ path: `${stem}.json`, role: "sequence" }],
      ...meta,
    }),
  );
  await writeFile(path.join(folder, `${stem}.json`), JSON.stringify(sequence));
}

describe("previewClipFromText", () => {
  const bake = () => clip({ id: "baked" });

  it("plays a 1.0 clip with its keyframes as markers and its fade-out tail", () => {
    const result = previewClipFromText(JSON.stringify(clip()), { bake });
    expect(result.format).toBe("animaPoseClip/1.0");
    expect(result.duration).toBe(1.5);
    expect(result.fadeOut).toBe(0.4);
    expect(result.loop).toBe(false);
    expect(result.markers).toEqual([
      { id: "k0", time: 0, label: "rest" },
      { id: "k1", time: 0.5, label: "down" },
      { id: "k2", time: 1.5, label: "rest" },
    ]);
  });

  it("plays a 2.0 clip with its beats as markers", () => {
    const result = previewClipFromText(
      JSON.stringify({
        schema: "animaPoseClip/2.0",
        id: "wave",
        name: "Wave",
        duration: 2,
        fadeOut: { duration: 0.3 },
        beats: [
          { id: "start", label: "Start", time: 0 },
          { id: "raise", label: "Raise", time: 0.5 },
        ],
        expressions: { happy: [{ beat: "raise", v: 1 }] },
      }),
      { bake },
    );
    expect(result).toMatchObject({
      format: "animaPoseClip/2.0",
      duration: 2,
      fadeOut: 0.3,
      markers: [
        { id: "start", time: 0, label: "Start" },
        { id: "raise", time: 0.5, label: "Raise" },
      ],
    });
  });

  it("reports a 2.0 clip's problems with their paths", () => {
    try {
      previewClipFromText(
        JSON.stringify({
          schema: "animaPoseClip/2.0",
          id: "wave",
          name: "Wave",
          duration: 2,
          beats: [{ id: "start", label: "Start", time: 0 }],
          expressions: { happy: [{ beat: "missing", v: 1 }] },
        }),
        { bake },
      );
      throw new Error("expected a failure");
    } catch (error) {
      expect(
        (error as PreviewSourceError).issues.map(({ path }) => path),
      ).toEqual(["expressions.happy[0].beat"]);
    }
  });

  it("omits markers for densely baked clips", () => {
    const poseKeyframes = Array.from({ length: 60 }, (_, index) => ({
      time: index / 40,
      pose: "rest",
    }));
    const result = previewClipFromText(
      JSON.stringify(clip({ poseKeyframes })),
      { bake },
    );
    expect(result.markers).toEqual([]);
  });

  it("unwraps a project envelope", () => {
    const result = previewClipFromText(
      JSON.stringify({
        schema: "animamaActionProject/1.0",
        intent: "gesture",
        sequence: clip({ id: "wrapped" }),
      }),
      { bake },
    );
    expect(result.clip.id).toBe("wrapped");
  });

  it("generates a motion description through the injected baker", () => {
    const description = {
      schema: "animamaMotion/1",
      name: "Nod",
      kind: "oneShot",
      duration: 1,
      joints: {
        head: {
          flexion: [
            { t: 0, v: 0 },
            { t: 1, v: 5 },
          ],
        },
      },
    };
    const result = previewClipFromText(JSON.stringify(description), { bake });
    expect(result.format).toBe("animamaMotion/1");
    expect(result.clip.id).toBe("baked");
  });

  it("reports invalid input with its problems", () => {
    const failure = (text: string) => {
      try {
        previewClipFromText(text, { bake });
      } catch (error) {
        return error as PreviewSourceError;
      }
      throw new Error("expected a failure");
    };
    expect(failure("{").message).toMatch(/JSON/);
    expect(failure('{"schema":"other/1"}').message).toMatch(/other\/1/);
    expect(
      failure(JSON.stringify(clip({ poseKeyframes: [] }))).message,
    ).toMatch(/animaPoseClip\/1\.0/);
    const issues = failure(
      JSON.stringify({ schema: "animamaMotion/1", name: "", kind: "x" }),
    ).issues;
    expect(issues.map(({ path }) => path)).toEqual(
      expect.arrayContaining(["name", "kind", "duration"]),
    );
  });

  it("identifies versions by content", () => {
    expect(sourceVersion("a")).toBe(sourceVersion("a"));
    expect(sourceVersion("a")).not.toBe(sourceVersion("b"));
    expect(sourceVersion("a")).toMatch(/^[a-f0-9]{12}$/);
  });
});

describe("resolvePreviewSource", () => {
  it("resolves a file relative to the working directory", async () => {
    await writeFile(path.join(dir, "nod.clip.json"), JSON.stringify(clip()));
    const source = await resolvePreviewSource("nod.clip.json", {
      cwd: dir,
      included: path.join(dir, "included"),
    });
    expect(source).toMatchObject({
      kind: "file",
      path: path.join(dir, "nod.clip.json"),
      name: "nod.clip",
      label: "nod.clip.json",
    });
  });

  it("finds Library items by folder, selector or name, in Included and Local content", async () => {
    const included = path.join(dir, "included");
    const local = path.join(dir, "local");
    await libraryItem(
      included,
      "gestures",
      "arms-crossed",
      { semantic_key: "arms-crossed", name: "arms-crossed" },
      clip(),
    );
    await libraryItem(
      local,
      "gestures",
      "laugh",
      { semantic_key: "laugh_medium", name: "Hearty Laugh" },
      clip(),
    );
    const roots = { cwd: dir, included, local };

    expect(
      await resolvePreviewSource("library:arms-crossed", roots),
    ).toMatchObject({
      kind: "library",
      path: path.join(included, "gestures/arms-crossed/arms-crossed.json"),
      label: "Included · arms-crossed",
    });
    for (const query of ["laugh_medium", "hearty laugh", "local/laugh"])
      expect(
        await resolvePreviewSource(`library:${query}`, roots),
      ).toMatchObject({
        path: path.join(local, "gestures/laugh/laugh.json"),
        label: "Local · Hearty Laugh",
      });
  });

  it("explains a missing, ambiguous or unsafe Library item", async () => {
    const included = path.join(dir, "included");
    const local = path.join(dir, "local");
    await libraryItem(included, "gestures", "wave", { name: "wave" }, clip());
    await libraryItem(local, "gestures", "wave", { name: "wave" }, clip());
    await libraryItem(
      local,
      "gestures",
      "sneaky",
      { files: [{ path: "../wave/wave.json", role: "sequence" }] },
      clip(),
    );
    const roots = { cwd: dir, included, local };
    await expect(
      resolvePreviewSource("library:nothing", roots),
    ).rejects.toThrow(/No Library item/);
    await expect(resolvePreviewSource("library:wave", roots)).rejects.toThrow(
      /included\/wave.*local\/wave/,
    );
    await expect(resolvePreviewSource("library:sneaky", roots)).rejects.toThrow(
      /outside/,
    );
    await expect(
      resolvePreviewSource("library:local/wave", { cwd: dir, included }),
    ).rejects.toThrow(/Local content/);
    await expect(resolvePreviewSource("missing.json", roots)).rejects.toThrow(
      /missing\.json/,
    );
  });
});
