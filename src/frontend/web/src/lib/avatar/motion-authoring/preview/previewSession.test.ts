import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { AnimaPoseClipV2 } from "../../poses/animaPoseClip";
import type { PreviewMedia } from "./previewMedia";
import { PreviewSession } from "./previewSession";
import {
  sourceVersion,
  type PreviewMediaAdapter,
  type PreviewRoots,
} from "./sources";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "animama-session-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const clip = (duration: number): AnimaPoseClipV2 => ({
  schema: "animaPoseClip/2.0",
  id: "nod",
  name: "Nod",
  duration,
  beats: [{ id: "rest", label: "Rest", time: 0 }],
  rotations: { head: [{ beat: "rest", q: [0, 0, 0, 1] }] },
});

async function open(sources: [string] | [string, string] = ["nod.clip.json"]) {
  return PreviewSession.open({
    sources,
    roots: { cwd: dir, included: path.join(dir, "included") },
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

  describe("with effects", () => {
    const definition = (region = "eyes") => ({
      schema: "animama/avatar-effect/2",
      region,
      attachment: { kind: "face_landmark", landmark: "eyes", side: "right" },
      art: { image: "swirl.png" },
    });
    const media: PreviewMedia = {
      avatarEffects: [],
      particleEffects: [],
      notices: ["resolved"],
    };

    /**
     * Stands in for the CLI server's adapter: `effect:<folder>` names an
     * effect whose version covers its descriptor and image.
     */
    function adapter(calls: unknown[] = []): PreviewMediaAdapter {
      const folderOf = (spec: string, roots: PreviewRoots) =>
        path.join(roots.cwd, spec.slice("effect:".length));
      return {
        async resolve(spec, roots) {
          if (!spec.startsWith("effect:")) return null;
          const folder = folderOf(spec, roots);
          return {
            spec,
            kind: "file",
            type: "effect",
            path: path.join(folder, "swirl.json"),
            name: "swirl",
            label: "swirl",
            notesDir: path.dirname(folder),
          };
        },
        async load(source, roots) {
          const folder = folderOf(source.spec, roots);
          const text = await readFile(path.join(folder, "swirl.json"), "utf8");
          const image = await readFile(path.join(folder, "swirl.png"), "utf8");
          const descriptor = JSON.parse(text);
          return {
            version: sourceVersion(text + image),
            text,
            files: [
              path.join(folder, "swirl.json"),
              path.join(folder, "swirl.png"),
            ],
            effect: {
              stem: "swirl",
              contentId: "local:avatar-effect:swirl",
              name: "Swirl",
              description: "",
              definition: descriptor.definition,
              imageUrl: "/swirl.png",
              otherImageUrl: null,
              duration: null,
            },
          };
        },
        async media(dependencies) {
          calls.push(dependencies);
          return media;
        },
      };
    }

    async function writeEffect(
      region = "eyes",
      image: string | null = "png-1",
      at = "swirl",
    ) {
      const folder = path.join(dir, at);
      await mkdir(folder, { recursive: true });
      await writeFile(
        path.join(folder, "swirl.json"),
        JSON.stringify({ definition: definition(region) }),
      );
      if (image !== null)
        await writeFile(path.join(folder, "swirl.png"), image);
    }

    const openEffect = (at = "swirl") =>
      PreviewSession.open({
        sources: [`effect:${at}`],
        roots: { cwd: dir, included: path.join(dir, "included") },
        media: adapter(),
      });

    it("picks up an image that appears after the descriptor names it", async () => {
      await writeEffect("eyes", null);
      // Opening needs only the descriptor, so the folder can be watched.
      const session = await openEffect();
      expect(session.state().rows[0]).toMatchObject({
        effect: null,
        error: { message: expect.stringMatching(/swirl\.png/) },
      });
      expect(session.watchDirs).toEqual([path.join(dir, "swirl")]);
      await writeFile(path.join(dir, "swirl/swirl.png"), "png-1");
      expect(await session.reload()).toBe(true);
      expect(session.state().rows[0]).toMatchObject({ error: null });
      expect(session.state().rows[0].effect?.name).toBe("Swirl");
    });

    it("never writes notes inside Library content", async () => {
      await writeEffect("eyes", "png-1", "included/vfx/avatar/swirl");
      const session = await openEffect("included/vfx/avatar/swirl");
      expect(session.reviewPaths.sidecar).toBe(
        path.join(dir, "swirl.review.json"),
      );
      // A clip given by path inside a Library item folder, too.
      const item = path.join(dir, "elsewhere/reactions/nod");
      await mkdir(item, { recursive: true });
      await writeFile(path.join(item, "nod.meta.json"), "{}");
      await writeFile(path.join(item, "nod.json"), JSON.stringify(clip(1)));
      const clipSession = await PreviewSession.open({
        sources: ["elsewhere/reactions/nod/nod.json"],
        roots: { cwd: dir, included: path.join(dir, "included") },
      });
      expect(clipSession.reviewPaths.sidecar).toBe(
        path.join(dir, "nod.review.json"),
      );
    });

    it("plays an effect source, watches its images and keeps notes beside its folder", async () => {
      await writeEffect();
      const session = await openEffect();
      const row = session.state().rows[0];
      expect(row).toMatchObject({ type: "effect", error: null });
      expect(row.effect?.name).toBe("Swirl");
      expect(session.watchPaths).toEqual(
        expect.arrayContaining([
          path.join(dir, "swirl/swirl.json"),
          path.join(dir, "swirl/swirl.png"),
        ]),
      );
      expect(session.reviewPaths.sidecar).toBe(
        path.join(dir, "swirl.review.json"),
      );
      await expect(session.versionClip(row.version!)).rejects.toThrow(
        /cannot be replayed/,
      );
    });

    it("reloads when only an image changes", async () => {
      await writeEffect();
      const session = await openEffect();
      const first = session.state().rows[0].version;
      await writeEffect("eyes", "png-2");
      expect(await session.reload()).toBe(true);
      expect(session.state().rows[0].version).not.toBe(first);
      expect(await session.reload()).toBe(false);
    });

    it("reports an invalid definition by field and keeps the last valid effect", async () => {
      await writeEffect();
      const session = await openEffect();
      await writeEffect("nowhere");
      await session.reload();
      const row = session.state().rows[0];
      expect(row.effect?.definition).toMatchObject({ region: "eyes" });
      expect(row.error?.issues).toEqual([
        expect.objectContaining({ path: "definition.region" }),
      ]);
    });

    it("resolves a Library item's dependencies for its effect events", async () => {
      const folder = path.join(dir, "included/reactions/confused");
      await mkdir(folder, { recursive: true });
      const dependencies = [
        {
          ref: "builtin:avatar-effect:swirl",
          alias: "swirl",
          content_type: "avatar_effect",
        },
      ];
      await writeFile(
        path.join(folder, "confused.meta.json"),
        JSON.stringify({
          name: "Confused",
          dependencies,
          files: [{ path: "confused.json", role: "sequence" }],
        }),
      );
      await writeFile(
        path.join(folder, "confused.json"),
        JSON.stringify({
          ...clip(1),
          events: [{ id: "e", time: 0, kind: "avatar_vfx", effectId: "swirl" }],
        }),
      );
      const calls: unknown[] = [];
      const session = await PreviewSession.open({
        sources: ["library:confused"],
        roots: { cwd: dir, included: path.join(dir, "included") },
        media: adapter(calls),
      });
      expect(calls).toEqual([dependencies]);
      expect(session.state().rows[0].media).toEqual(media);
    });

    it("needs no media for a clip without effect events", async () => {
      await writeFile(path.join(dir, "nod.clip.json"), JSON.stringify(clip(1)));
      const calls: unknown[] = [];
      const session = await PreviewSession.open({
        sources: ["nod.clip.json"],
        roots: { cwd: dir, included: path.join(dir, "included") },
        media: adapter(calls),
      });
      expect(session.state().rows[0]).toMatchObject({
        type: "clip",
        media: null,
      });
      expect(calls).toEqual([]);
    });
  });
});
