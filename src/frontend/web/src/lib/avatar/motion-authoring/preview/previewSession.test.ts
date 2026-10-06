import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AnimaPoseClip } from "../../poses/animaPoseClip";
import { PreviewSession } from "./previewSession";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "animama-session-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const clip = (duration: number): AnimaPoseClip => ({
  schema: "animaPoseClip/1.0",
  id: "nod",
  name: "Nod",
  duration,
  poses: { rest: { humanoid: { head: { rotation: [0, 0, 0, 1] } } } },
  poseKeyframes: [{ time: 0, pose: "rest" }],
});

async function open(sources: [string] | [string, string] = ["nod.clip.json"]) {
  return PreviewSession.open({
    sources,
    roots: { cwd: dir, included: path.join(dir, "included") },
    bake: () => clip(9),
    now: () => new Date("2026-10-06T12:00:00Z"),
  });
}

describe("PreviewSession", () => {
  it("loads the reviewed source and retains its first version", async () => {
    await writeFile(path.join(dir, "nod.clip.json"), JSON.stringify(clip(1)));
    const session = await open();
    const state = session.state();
    expect(state.rows).toHaveLength(1);
    expect(state.rows[0]).toMatchObject({ role: "main", error: null });
    expect(state.rows[0].clip?.duration).toBe(1);
    expect(state.review.sidecar?.versions.map(({ id }) => id)).toEqual([
      state.rows[0].version,
    ]);
    expect(state.review.path).toBe(path.join(dir, "nod.clip.review.json"));
  });

  it("retains each new version and replays an earlier one", async () => {
    const file = path.join(dir, "nod.clip.json");
    await writeFile(file, JSON.stringify(clip(1)));
    const session = await open();
    const first = session.state().rows[0].version!;

    await writeFile(file, JSON.stringify(clip(2)));
    expect(await session.reload()).toBe(true);
    const state = session.state();
    expect(state.rows[0].clip?.duration).toBe(2);
    expect(state.review.sidecar?.versions.map(({ id }) => id)).toEqual([
      first,
      state.rows[0].version,
    ]);
    expect((await session.versionClip(first)).duration).toBe(1);
    expect(await session.reload()).toBe(false);
  });

  it("keeps the last valid clip and reports the problem when the source breaks", async () => {
    const file = path.join(dir, "nod.clip.json");
    await writeFile(file, JSON.stringify(clip(1)));
    const session = await open();
    await writeFile(file, "{ not json");
    await session.reload();
    const row = session.state().rows[0];
    expect(row.clip?.duration).toBe(1);
    expect(row.error?.message).toMatch(/JSON/);
  });

  it("adds and deletes notes against the current version", async () => {
    await writeFile(path.join(dir, "nod.clip.json"), JSON.stringify(clip(1)));
    const session = await open();
    const version = session.state().rows[0].version;
    const added = await session.addNote({
      time: 0.4,
      region: "head",
      text: "nod deeper",
    });
    const note = added.review.sidecar!.notes[0];
    expect(note).toMatchObject({ time: 0.4, text: "nod deeper", version });
    const saved = JSON.parse(
      await readFile(path.join(dir, "nod.clip.review.json"), "utf8"),
    );
    expect(saved.notes).toHaveLength(1);
    expect(saved.source).toBe("nod.clip.json");
    expect((await session.deleteNote(note.id)).review.sidecar!.notes).toEqual(
      [],
    );
  });

  it("shows a comparison source in a second row", async () => {
    await writeFile(path.join(dir, "nod.clip.json"), JSON.stringify(clip(1)));
    await writeFile(path.join(dir, "old.json"), JSON.stringify(clip(3)));
    const session = await open(["nod.clip.json", "old.json"]);
    const rows = session.state().rows;
    expect(rows.map(({ role }) => role)).toEqual(["main", "compare"]);
    expect(rows[1].clip?.duration).toBe(3);
    // Only the reviewed source is retained.
    expect(session.state().review.sidecar?.versions).toHaveLength(1);
  });

  it("refuses notes while the notes file is malformed, without overwriting it", async () => {
    await writeFile(path.join(dir, "nod.clip.json"), JSON.stringify(clip(1)));
    await writeFile(path.join(dir, "nod.clip.review.json"), "[]");
    const session = await open();
    expect(session.state().review.error).toMatch(/nod\.clip\.review\.json/);
    await expect(session.addNote({ time: 0, text: "x" })).rejects.toThrow(
      /not valid/,
    );
    expect(await readFile(path.join(dir, "nod.clip.review.json"), "utf8")).toBe(
      "[]",
    );
  });

  it("keeps notes another process wrote since the last reload", async () => {
    await writeFile(path.join(dir, "nod.clip.json"), JSON.stringify(clip(1)));
    const session = await open();
    await session.addNote({ time: 0.2, text: "first" });
    // `animation resolve` rewrites the sidecar outside the session.
    const file = path.join(dir, "nod.clip.review.json");
    const external = JSON.parse(await readFile(file, "utf8"));
    external.notes[0] = {
      ...external.notes[0],
      status: "resolved",
      resolution: "done",
    };
    await writeFile(file, JSON.stringify(external));

    const state = await session.addNote({ time: 0.4, text: "second" });
    expect(
      state.review.sidecar!.notes.map(
        ({ text, status }) => `${text}:${status}`,
      ),
    ).toEqual(["first:resolved", "second:open"]);
  });

  it("keeps a note added while a changed source reloads", async () => {
    const source = path.join(dir, "nod.clip.json");
    await writeFile(source, JSON.stringify(clip(1)));
    const session = await open();
    await writeFile(source, JSON.stringify(clip(2)));
    await Promise.all([
      session.reload(),
      session.addNote({ time: 0.1, text: "during reload" }),
    ]);
    const saved = JSON.parse(
      await readFile(path.join(dir, "nod.clip.review.json"), "utf8"),
    );
    expect(saved.notes.map(({ text }: { text: string }) => text)).toEqual([
      "during reload",
    ]);
    expect(saved.versions).toHaveLength(2);
  });

  it("creates the folder of an explicit notes file so it can be watched", async () => {
    await writeFile(path.join(dir, "nod.clip.json"), JSON.stringify(clip(1)));
    const session = await PreviewSession.open({
      sources: ["nod.clip.json"],
      roots: { cwd: dir, included: path.join(dir, "included") },
      notes: "reviews/round-1.review.json",
      bake: () => clip(9),
    });
    expect(session.watchPaths).toContain(
      path.join(dir, "reviews/round-1.review.json"),
    );
    expect((await stat(path.join(dir, "reviews"))).isDirectory()).toBe(true);
  });

  it("retains a version it could not record while the notes file was broken", async () => {
    const source = path.join(dir, "nod.clip.json");
    const notes = path.join(dir, "nod.clip.review.json");
    await writeFile(source, JSON.stringify(clip(1)));
    const session = await open();
    const good = await readFile(notes, "utf8");
    await writeFile(notes, "[]");
    await writeFile(source, JSON.stringify(clip(2)));
    await session.reload();
    await writeFile(notes, good);
    await session.reload();
    const state = session.state();
    expect(state.review.error).toBeNull();
    expect(state.review.sidecar?.versions.map(({ id }) => id)).toContain(
      state.rows[0].version,
    );
  });
});
