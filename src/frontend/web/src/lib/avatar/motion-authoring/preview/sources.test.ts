import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  unsupportedAnimaPoseClipFormatMessage,
  type AnimaPoseClipV2,
} from "../../poses/animaPoseClip";
import {
  PreviewSourceError,
  listPreviewChoices,
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

const clip = (overrides: Partial<AnimaPoseClipV2> = {}): AnimaPoseClipV2 => ({
  schema: "animaPoseClip/2.0",
  id: "nod",
  name: "Nod",
  duration: 1.5,
  fadeOut: { duration: 0.4 },
  beats: [
    { id: "rest", label: "Rest", time: 0 },
    { id: "down", label: "Down", time: 0.5 },
    { id: "back", label: "Back", time: 1.5 },
  ],
  rotations: {
    head: [
      { beat: "rest", q: [0, 0, 0, 1] },
      { beat: "down", q: [0.1305, 0, 0, 0.9914] },
      { beat: "back", q: [0, 0, 0, 1] },
    ],
  },
  ...overrides,
});

/** A retired `animaPoseClip/1.0` clip, which preview must reject. */
const retiredClip = {
  schema: "animaPoseClip/1.0",
  id: "nod",
  name: "Nod",
  duration: 1.5,
  poses: { rest: { humanoid: { head: { rotation: [0, 0, 0, 1] } } } },
  poseKeyframes: [{ time: 0, pose: "rest" }],
};

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
  it("plays a clip with its duration, fade-out tail and loop flag", () => {
    const result = previewClipFromText(JSON.stringify(clip()));
    expect(result.format).toBe("animaPoseClip/2.0");
    expect(result.duration).toBe(1.5);
    expect(result.fadeOut).toBe(0.4);
    expect(result.loop).toBe(false);
    expect(result.markers).toEqual([
      { id: "rest", time: 0, label: "Rest" },
      { id: "down", time: 0.5, label: "Down" },
      { id: "back", time: 1.5, label: "Back" },
    ]);
    expect(previewClipFromText(JSON.stringify(clip({ loop: true }))).loop).toBe(
      true,
    );
  });

  it("rejects a retired 1.0 clip, alone or inside a project", () => {
    const message = unsupportedAnimaPoseClipFormatMessage("animaPoseClip/1.0");
    const plain = () => previewClipFromText(JSON.stringify(retiredClip));
    expect(plain).toThrow(PreviewSourceError);
    expect(plain).toThrow(message);
    expect(() =>
      previewClipFromText(
        JSON.stringify({
          schema: "animamaActionProject/1.0",
          intent: "gesture",
          sequence: retiredClip,
          dependencies: [],
        }),
      ),
    ).toThrow(message);
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
      );
      throw new Error("expected a failure");
    } catch (error) {
      expect(
        (error as PreviewSourceError).issues.map(({ path }) => path),
      ).toEqual(["expressions.happy[0].beat"]);
    }
  });

  it("unwraps a project envelope with the dependencies its events name", () => {
    const dependencies = [
      {
        ref: "builtin:avatar-effect:star",
        alias: "star",
        content_type: "avatar_effect",
        config: {},
      },
    ];
    const result = previewClipFromText(
      JSON.stringify({
        schema: "animamaActionProject/1.0",
        intent: "gesture",
        sequence: clip({ id: "wrapped" }),
        dependencies,
      }),
    );
    expect(result.clip.id).toBe("wrapped");
    expect(result.dependencies).toEqual(dependencies);
    // A plain clip carries none: its events cannot resolve effects.
    expect(previewClipFromText(JSON.stringify(clip())).dependencies).toBe(
      undefined,
    );
  });

  it("explains that motion descriptions are retired", () => {
    expect(() =>
      previewClipFromText(JSON.stringify({ schema: "animamaMotion/1" })),
    ).toThrow(/retired.*animaPoseClip\/2\.0/);
  });

  it("reports invalid input with its problems", () => {
    const failure = (text: string) => {
      try {
        previewClipFromText(text);
      } catch (error) {
        return error as PreviewSourceError;
      }
      throw new Error("expected a failure");
    };
    expect(failure("{").message).toMatch(/JSON/);
    expect(failure('{"schema":"other/1"}').message).toMatch(/other\/1/);
    const issues = failure(
      JSON.stringify({ schema: "animaPoseClip/2.0", name: "", beats: [] }),
    ).issues;
    expect(issues.map(({ path }) => path)).toEqual(
      expect.arrayContaining(["id", "name", "duration"]),
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
      // Its dependencies resolve the effects its events name.
      metaPath: path.join(
        included,
        "gestures/arms-crossed/arms-crossed.meta.json",
      ),
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

describe("listPreviewChoices", () => {
  it("lists clip files, then Library Gestures and Reactions with a clip", async () => {
    // Only playable JSON is listed: not sidecars, configs or other files.
    const clips = path.join(dir, "clips");
    const included = path.join(dir, "included");
    const local = path.join(dir, "local");
    await mkdir(path.join(clips, "wave.clip.review"), { recursive: true });
    for (const name of ["wave.clip.json", "nod.clip.json", "notes.txt"])
      await writeFile(path.join(clips, name), JSON.stringify(clip()));
    for (const name of ["wave.clip.review.json", "package.json", "broken.json"])
      await writeFile(
        path.join(clips, name),
        name === "broken.json" ? "{" : "{}",
      );
    await libraryItem(
      included,
      "gestures",
      "salute",
      { name: "Salute" },
      clip(),
    );
    await libraryItem(included, "reactions", "gasp", {}, clip());
    await libraryItem(local, "gestures", "laugh", { name: "Laugh" }, clip());
    await mkdir(path.join(local, "gestures", "no-clip"), { recursive: true });
    await writeFile(
      path.join(local, "gestures", "no-clip", "no-clip.meta.json"),
      JSON.stringify({ files: [] }),
    );

    const choices = await listPreviewChoices({ cwd: dir, included, local }, [
      clips,
      `${clips}/`,
      path.join(dir, "missing"),
    ]);
    expect(choices).toEqual([
      {
        spec: path.join(clips, "nod.clip.json"),
        label: "nod.clip.json",
        group: "clips/",
        path: path.join(clips, "nod.clip.json"),
      },
      {
        spec: path.join(clips, "wave.clip.json"),
        label: "wave.clip.json",
        group: "clips/",
        path: path.join(clips, "wave.clip.json"),
      },
      {
        spec: "library:included/salute",
        label: "Salute",
        group: "Included Gestures",
        path: path.join(included, "gestures/salute/salute.json"),
      },
      {
        spec: "library:included/gasp",
        label: "gasp",
        group: "Included Reactions",
        path: path.join(included, "reactions/gasp/gasp.json"),
      },
      {
        spec: "library:local/laugh",
        label: "Laugh",
        group: "Local Gestures",
        path: path.join(local, "gestures/laugh/laugh.json"),
      },
    ]);
    // Every choice resolves to the file it names.
    for (const choice of choices)
      expect(
        (await resolvePreviewSource(choice.spec, { cwd: dir, included, local }))
          .path,
      ).toBe(choice.path);
  });
});
