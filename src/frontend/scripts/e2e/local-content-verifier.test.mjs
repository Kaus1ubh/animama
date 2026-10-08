import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  validateLocalContentRoot,
  verifyExpectedLocalPathAbsent,
  verifyLocalCatalogItemFiles,
} from "./local-content-verifier.mjs";

function digest(body) {
  return createHash("sha256").update(body).digest("hex");
}

async function fixture() {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "animama-files-"));
  const repositoryRoot = path.join(temporary, "repo");
  const localRoot = path.join(temporary, "isolated-stack", "local");
  const entryRoot = path.join(localRoot, "reactions", "react-0827123456");
  await mkdir(repositoryRoot, { recursive: true });
  await mkdir(entryRoot, { recursive: true });
  const descriptor = Buffer.from('{"schema":"animaPoseClip/2.0"}\n');
  const metadata = Buffer.from('{"dependencies":[]}\n');
  await writeFile(path.join(entryRoot, "reaction.json"), descriptor);
  await writeFile(path.join(entryRoot, "meta.json"), metadata);
  const item = {
    item_id: "item-1",
    source: "local",
    origin: "local",
    status: "valid",
    revision_sha256: "a".repeat(64),
    relative_locator: "reactions/react-0827123456",
    files: [
      {
        relative_path: "reactions/react-0827123456/reaction.json",
        role: "descriptor",
        media_type: "application/json",
        size_bytes: descriptor.length,
        sha256: digest(descriptor),
      },
      {
        relative_path: "reactions/react-0827123456/meta.json",
        role: "metadata",
        media_type: "application/json",
        size_bytes: metadata.length,
        sha256: digest(metadata),
      },
    ],
  };
  return { temporary, repositoryRoot, localRoot, entryRoot, item };
}

async function withFixture(run) {
  const value = await fixture();
  try {
    await run(value);
  } finally {
    await rm(value.temporary, { recursive: true, force: true });
  }
}

test("verifies isolated Local content and exact files", async () => {
  await withFixture(async ({ repositoryRoot, localRoot, item }) => {
    assert.equal(
      await validateLocalContentRoot(localRoot, { repositoryRoot }),
      await realpath(localRoot),
    );
    const verified = await verifyLocalCatalogItemFiles({
      item,
      localRoot,
      repositoryRoot,
    });
    assert.equal(verified.fileCount, 2);
    assert.equal(
      verified.parsedJson["reactions/react-0827123456/reaction.json"].schema,
      "animaPoseClip/2.0",
    );
    assert.match(verified.manifestSha256, /^[0-9a-f]{64}$/);
  });
});

test("rejects the main Local root through direct and ancestor-link aliases", async () => {
  await withFixture(async ({ temporary, repositoryRoot }) => {
    const mainLocal = path.join(repositoryRoot, "content", "local");
    await mkdir(mainLocal, { recursive: true });
    const repositoryAlias = path.join(temporary, "repo-alias");
    await symlink(repositoryRoot, repositoryAlias, "dir");
    for (const candidate of [
      mainLocal,
      path.join(repositoryAlias, "content", "local"),
    ]) {
      await assert.rejects(
        validateLocalContentRoot(candidate, { repositoryRoot }),
        /main installation Local content root/,
      );
    }
    // A symlink in the selected repository path must not change its identity.
    await assert.rejects(
      validateLocalContentRoot(mainLocal, { repositoryRoot: repositoryAlias }),
      /main installation Local content root/,
    );
  });
});

test("preflights one exact name-derived path without treating it as authority", async () => {
  await withFixture(async ({ repositoryRoot, localRoot, entryRoot }) => {
    await assert.rejects(
      verifyExpectedLocalPathAbsent({
        expectedRelativePath: "reactions/react-0827123456",
        localRoot,
        repositoryRoot,
      }),
      /artifact still exists/,
    );
    await rm(entryRoot, { recursive: true });
    assert.deepEqual(
      await verifyExpectedLocalPathAbsent({
        expectedRelativePath: "reactions/react-0827123456",
        localRoot,
        repositoryRoot,
      }),
      {
        relativePath: "reactions/react-0827123456",
        artifactLocator: "reactions/react-0827123456",
        absent: true,
      },
    );
    await assert.rejects(
      verifyExpectedLocalPathAbsent({
        expectedRelativePath: "reactions/../escape",
        localRoot,
        repositoryRoot,
      }),
      /traversal/,
    );
  });
});

test("rejects broad roots, absolute paths, and traversal", async () => {
  await withFixture(async ({ repositoryRoot, localRoot, item }) => {
    await assert.rejects(
      validateLocalContentRoot(repositoryRoot, { repositoryRoot }),
      /too broad/,
    );
    await assert.rejects(
      verifyLocalCatalogItemFiles({
        item: { ...item, relative_locator: "/tmp/escape" },
        localRoot,
        repositoryRoot,
      }),
      /safe POSIX relative path/,
    );
    await assert.rejects(
      verifyLocalCatalogItemFiles({
        item: {
          ...item,
          files: [
            { ...item.files[0], relative_path: "reactions/../escape.json" },
          ],
        },
        localRoot,
        repositoryRoot,
      }),
      /traversal/,
    );
  });
});

test("rejects symlinks and missing registered files", async () => {
  await withFixture(async ({ repositoryRoot, localRoot, entryRoot, item }) => {
    await rm(path.join(entryRoot, "reaction.json"));
    await symlink(
      path.join(entryRoot, "meta.json"),
      path.join(entryRoot, "reaction.json"),
    );
    await assert.rejects(
      verifyLocalCatalogItemFiles({ item, localRoot, repositoryRoot }),
      /symbolic links/,
    );
    await rm(path.join(entryRoot, "reaction.json"));
    await assert.rejects(
      verifyLocalCatalogItemFiles({ item, localRoot, repositoryRoot }),
      /ENOENT/,
    );
  });
});

test("rejects size and digest mismatches", async () => {
  await withFixture(async ({ repositoryRoot, localRoot, item }) => {
    await assert.rejects(
      verifyLocalCatalogItemFiles({
        item: {
          ...item,
          files: [
            { ...item.files[0], size_bytes: item.files[0].size_bytes + 1 },
          ],
        },
        localRoot,
        repositoryRoot,
      }),
      /size mismatch/,
    );
    await assert.rejects(
      verifyLocalCatalogItemFiles({
        item: {
          ...item,
          files: [{ ...item.files[0], sha256: "f".repeat(64) }],
        },
        localRoot,
        repositoryRoot,
      }),
      /digest mismatch/,
    );
  });
});

test("rejects unbounded catalog paths and manifest labels", async () => {
  await withFixture(async ({ repositoryRoot, localRoot, item }) => {
    await assert.rejects(
      verifyLocalCatalogItemFiles({
        item: {
          ...item,
          files: [
            {
              ...item.files[0],
              relative_path: `reactions/${"a".repeat(256)}/reaction.json`,
            },
          ],
        },
        localRoot,
        repositoryRoot,
      }),
      /traversal, empty, or overlong segment/,
    );
    await assert.rejects(
      verifyLocalCatalogItemFiles({
        item: {
          ...item,
          files: [{ ...item.files[0], role: "r".repeat(129) }],
        },
        localRoot,
        repositoryRoot,
      }),
      /role must be a non-empty bounded string/,
    );
  });
});
