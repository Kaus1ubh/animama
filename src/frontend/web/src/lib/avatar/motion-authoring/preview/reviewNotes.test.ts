import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  REVIEW_SIDECAR_SCHEMA,
  addReviewNote,
  createReviewSidecar,
  deleteReviewNote,
  loadReviewSidecar,
  readRetainedVersion,
  resolveReviewNote,
  retainReviewVersion,
  reviewPathsFor,
  saveReviewSidecar,
} from "./reviewNotes";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "animama-review-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const now = () => new Date("2026-10-06T12:00:00Z");

describe("review paths", () => {
  it("places a file source's sidecar and versions beside it", () => {
    const paths = reviewPathsFor(
      { kind: "file", path: "/work/laugh.clip.json", name: "laugh" },
      { cwd: "/elsewhere" },
    );
    expect(paths.sidecar).toBe("/work/laugh.review.json");
    expect(paths.versions).toBe("/work/laugh.review");
  });

  it("places a Library item's sidecar in the working directory, never the Library", () => {
    const paths = reviewPathsFor(
      {
        kind: "library",
        path: "/library/arms-crossed.json",
        name: "arms-crossed",
      },
      { cwd: "/work" },
    );
    expect(paths.sidecar).toBe("/work/arms-crossed.review.json");
  });

  it("keeps versions apart from a notes file without a .json suffix", () => {
    const paths = reviewPathsFor(
      { kind: "file", path: "/work/laugh.clip.json", name: "laugh" },
      { cwd: "/work", notes: "review-notes" },
    );
    expect(paths.sidecar).toBe("/work/review-notes");
    expect(paths.versions).toBe("/work/review-notes.versions");
  });

  it("honours an explicit notes file", () => {
    const paths = reviewPathsFor(
      { kind: "file", path: "/work/laugh.clip.json", name: "laugh" },
      { cwd: "/work", notes: "/notes/round-2.review.json" },
    );
    expect(paths.sidecar).toBe("/notes/round-2.review.json");
    expect(paths.versions).toBe("/notes/round-2.review");
  });
});

describe("notes", () => {
  it("adds a note at a time, beat and region against the current version", () => {
    const sidecar = addReviewNote(
      createReviewSidecar("laugh.clip.json"),
      {
        time: 2.4,
        beat: "slap",
        region: "rightHand",
        text: "slap the thigh here",
      },
      { version: "v1", now, id: () => "n1" },
    );
    expect(sidecar.notes).toEqual([
      {
        id: "n1",
        createdAt: "2026-10-06T12:00:00.000Z",
        time: 2.4,
        beat: "slap",
        region: "rightHand",
        text: "slap the thigh here",
        version: "v1",
        status: "open",
      },
    ]);
  });

  it("rejects an empty note, a negative time and an unknown region", () => {
    const empty = createReviewSidecar("laugh.clip.json");
    const options = { version: "v1", now, id: () => "n1" };
    expect(() =>
      addReviewNote(empty, { time: 1, text: "  " }, options),
    ).toThrow(/text/);
    expect(() =>
      addReviewNote(empty, { time: -1, text: "x" }, options),
    ).toThrow(/time/);
    expect(() =>
      addReviewNote(
        empty,
        { time: 1, text: "x", region: "tail" as never },
        options,
      ),
    ).toThrow(/region/);
  });

  it("resolves a note with the version that resolved it, and deletes notes", () => {
    let sidecar = addReviewNote(
      createReviewSidecar("laugh.clip.json"),
      { time: 1, text: "settle slower" },
      { version: "v1", now, id: () => "n1" },
    );
    sidecar = resolveReviewNote(
      sidecar,
      "n1",
      "Lengthened the settle by 0.3 s",
      {
        version: "v2",
        now,
      },
    );
    expect(sidecar.notes[0]).toMatchObject({
      status: "resolved",
      resolution: "Lengthened the settle by 0.3 s",
      resolvedVersion: "v2",
      resolvedAt: "2026-10-06T12:00:00.000Z",
    });
    expect(() =>
      resolveReviewNote(sidecar, "missing", "x", { version: "v2", now }),
    ).toThrow(/missing/);
    expect(deleteReviewNote(sidecar, "n1").notes).toEqual([]);
  });
});

describe("sidecar files", () => {
  it("returns an empty sidecar when none exists and round-trips a saved one", async () => {
    const file = path.join(dir, "laugh.review.json");
    const empty = await loadReviewSidecar(file, "laugh.clip.json");
    expect(empty).toEqual({
      schema: REVIEW_SIDECAR_SCHEMA,
      source: "laugh.clip.json",
      notes: [],
      versions: [],
    });
    const sidecar = addReviewNote(
      empty,
      { time: 0.5, text: "lead with the head" },
      {
        version: "v1",
        now,
        id: () => "n1",
      },
    );
    await saveReviewSidecar(file, sidecar);
    expect(await loadReviewSidecar(file, "laugh.clip.json")).toEqual(sidecar);
    // Atomic write leaves no temporary files behind.
    expect(await readdir(dir)).toEqual(["laugh.review.json"]);
  });

  it("reports a malformed sidecar instead of replacing it", async () => {
    const file = path.join(dir, "laugh.review.json");
    await writeFile(file, '{"schema":"animamaReview/1","notes":[{"id":1}]}');
    await expect(loadReviewSidecar(file, "laugh.clip.json")).rejects.toThrow(
      /laugh\.review\.json/,
    );
    expect(await readFile(file, "utf8")).toContain('"id":1');
  });
});

describe("retained versions", () => {
  it("keeps each distinct source version once, in order", async () => {
    const paths = {
      sidecar: path.join(dir, "laugh.review.json"),
      versions: path.join(dir, "laugh.review"),
    };
    let sidecar = createReviewSidecar("laugh.clip.json");
    sidecar = await retainReviewVersion(sidecar, paths, "aaa", "first", now);
    sidecar = await retainReviewVersion(sidecar, paths, "aaa", "first", now);
    sidecar = await retainReviewVersion(sidecar, paths, "bbb", "second", now);
    expect(sidecar.versions.map(({ id }) => id)).toEqual(["aaa", "bbb"]);
    expect(await readRetainedVersion(paths, "aaa")).toBe("first");
    expect(await readRetainedVersion(paths, "bbb")).toBe("second");
    await expect(readRetainedVersion(paths, "../escape")).rejects.toThrow(
      /version/,
    );
  });
});
