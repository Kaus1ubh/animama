import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

import { resolveAvatarFile } from "./avatar-file.mjs";

let dir;
before(async () => {
  dir = await realpath(await mkdtemp(path.join(tmpdir(), "avatar-file-")));
  await writeFile(path.join(dir, "Local Avatar.vrm"), "glTF");
  await writeFile(path.join(dir, "A #1.vrm"), "glTF");
  await writeFile(path.join(dir, "notes.txt"), "");
  await mkdir(path.join(dir, "folder.vrm"));
});
after(() => rm(dir, { recursive: true, force: true }));

test("resolves a .vrm file to its real path", async () => {
  assert.equal(
    await resolveAvatarFile(path.join(dir, "Local Avatar.vrm")),
    path.join(dir, "Local Avatar.vrm"),
  );
});

test("refuses missing paths, other files and directories named .vrm", async () => {
  await assert.rejects(
    resolveAvatarFile(path.join(dir, "missing.vrm")),
    /not found/,
  );
  await assert.rejects(
    resolveAvatarFile(path.join(dir, "notes.txt")),
    /must be a \.vrm file/,
  );
  await assert.rejects(
    resolveAvatarFile(path.join(dir, "folder.vrm")),
    /must be a \.vrm file/,
  );
});

test("refuses paths Vite's /@fs route cannot serve", async () => {
  await assert.rejects(
    resolveAvatarFile(path.join(dir, "A #1.vrm")),
    /must not contain #, \? or %/,
  );
});
