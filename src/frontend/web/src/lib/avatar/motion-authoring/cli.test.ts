import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

import { runMotionCli } from "./cli";
import {
  addReviewNote,
  createReviewSidecar,
  saveReviewSidecar,
} from "./preview/reviewNotes";
import { sourceVersion } from "./preview/sources";

const here = path.dirname(fileURLToPath(import.meta.url));
const avatarDirectory = path.resolve(
  here,
  "../../../../../../../content/included/avatars",
);
const example = path.join(here, "examples/wave-hello.clip.json");

async function run(args: string[]) {
  const lines: string[] = [];
  const code = await runMotionCli(args, {
    avatarDirectory,
    cwd: here,
    out: (text) => lines.push(text),
  });
  return { code, output: lines.join("\n") };
}

const directories: string[] = [];
const tempDirectory = async (): Promise<string> => {
  const dir = await mkdtemp(path.join(tmpdir(), "animama-motion-"));
  directories.push(dir);
  return dir;
};

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

describe("runMotionCli", () => {
  it("validates a clip, writes its compact form and checks it", async () => {
    const dir = await tempDirectory();
    const out = path.join(dir, "wave.compact.json");
    const validated = await run(["validate", example, "--out", out]);
    expect(validated.code).toBe(0);
    expect(validated.output).toContain(
      "5 beats: Start, Raise, Wave, Lower, Settle",
    );
    const compact = await readFile(out, "utf8");
    expect(compact).not.toContain("\n  ");
    expect(JSON.parse(compact).id).toBe("wave-hello");
    const checked = await run(["check", out, "--json"]);
    expect(checked.code).toBe(0);
    expect(JSON.parse(checked.output)).toMatchObject({ ok: true });
  }, 30000);

  it("reports invalid clips with paths and writes nothing", async () => {
    const dir = await tempDirectory();
    const bad = path.join(dir, "bad.clip.json");
    const out = path.join(dir, "bad.compact.json");
    const clip = JSON.parse(await readFile(example, "utf8"));
    clip.joints.rightUpperArm.elevation[1].v = 250;
    clip.expressions = { happy: [{ beat: "nowhere", v: 1 }] };
    await writeFile(bad, JSON.stringify(clip));
    const failed = await run(["validate", bad, "--out", out]);
    expect(failed.code).toBe(1);
    // Structural and anatomical problems are reported in one run.
    expect(failed.output).toContain("expressions.happy[0].beat");
    expect(failed.output).toContain(
      "joints.rightUpperArm.elevation[1].v: 250° is beyond the anatomical limit",
    );
    await expect(readFile(out)).rejects.toThrow();
  });

  it("exits 1 on failed checks or retired descriptions and 2 on bad options", async () => {
    const dir = await tempDirectory();
    const bad = path.join(dir, "bad.clip.json");
    await writeFile(
      bad,
      JSON.stringify({
        schema: "animaPoseClip/2.0",
        id: "bad",
        name: "Bad",
        duration: 1,
        beats: [{ id: "start", label: "Start", time: 0 }],
        expressions: { happy: [{ beat: "start", v: 0.5 }] },
        contacts: [
          { bone: "rightHand", target: "head", beat: "start", from: 0, to: 1 },
        ],
      }),
    );
    const failed = await run(["check", bad]);
    expect(failed.code).toBe(1);
    expect(failed.output).toContain("FAIL contact");
    expect((await run(["check", bad, "--colour", "x"])).code).toBe(2);
    expect((await run(["validate", bad, "--out"])).code).toBe(2);

    const description = path.join(dir, "old.motion.json");
    await writeFile(description, JSON.stringify({ schema: "animamaMotion/1" }));
    for (const command of ["validate", "check"]) {
      const retired = await run([command, description]);
      expect(retired.code).toBe(1);
      expect(retired.output).toContain("retired");
    }
  }, 30000);

  it("lists review notes and resolves one with the changed source's version", async () => {
    const dir = await tempDirectory();
    const source = path.join(dir, "laugh.clip.json");
    const notes = path.join(dir, "laugh.clip.review.json");
    await writeFile(source, "first");
    await saveReviewSidecar(
      notes,
      addReviewNote(
        createReviewSidecar("laugh.clip.json"),
        { time: 1.25, region: "rightHand", text: "slap the thigh here" },
        { version: sourceVersion("first"), id: () => "n1" },
      ),
    );

    const listed = await run(["review", notes]);
    expect(listed.code).toBe(0);
    expect(listed.output).toContain("1 open, 0 resolved");
    expect(listed.output).toContain("n1  open");
    expect(listed.output).toContain("slap the thigh here");

    await writeFile(source, "second");
    const resolved = await run(["resolve", notes, "n1", "Added", "a", "slap"]);
    expect(resolved.code).toBe(0);
    const sidecar = JSON.parse(await readFile(notes, "utf8"));
    expect(sidecar.notes[0]).toMatchObject({
      status: "resolved",
      resolution: "Added a slap",
      resolvedVersion: sourceVersion("second"),
    });
    expect(sidecar.versions.map(({ id }: { id: string }) => id)).toEqual([
      sourceVersion("second"),
    ]);
    expect((await run(["resolve", notes, "missing", "x"])).code).toBe(1);
    expect((await run(["resolve", notes])).code).toBe(2);
    expect((await run(["review", path.join(dir, "none.json")])).code).toBe(1);
  });
});
