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
const example = path.join(here, "examples/wave-hello.motion.json");

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
  it("generates a clip and checks it", async () => {
    const dir = await tempDirectory();
    const out = path.join(dir, "wave.clip.json");
    expect((await run(["generate", example, "--out", out])).code).toBe(0);
    const clip = JSON.parse(await readFile(out, "utf8"));
    expect(clip.id).toBe("wave-hello");
    const checked = await run(["check", out, "--json"]);
    expect(checked.code).toBe(0);
    expect(JSON.parse(checked.output)).toMatchObject({ ok: true });
  }, 30000);

  it("exits 1 on failed checks and 2 on bad options", async () => {
    const dir = await tempDirectory();
    const bad = path.join(dir, "bad.motion.json");
    await writeFile(
      bad,
      JSON.stringify({
        schema: "animamaMotion/1",
        name: "Bad",
        kind: "oneShot",
        duration: 1,
        contacts: [{ bone: "rightHand", target: "head", from: 0, to: 1 }],
      }),
    );
    const failed = await run(["check", bad]);
    expect(failed.code).toBe(1);
    expect(failed.output).toContain("FAIL contact");
    expect((await run(["check", bad, "--colour", "x"])).code).toBe(2);
    expect((await run(["generate", bad, "--out"])).code).toBe(2);
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
