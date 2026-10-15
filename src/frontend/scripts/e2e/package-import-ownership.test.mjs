import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { appendContentLedgerEvent } from "./content-ledger.mjs";
import { resolvePackageImportOwnership } from "./package-import-ownership.mjs";
import { cleanupOwnedContent } from "./content-cleanup.mjs";

const entries = [
  { entryId: "avatar", kind: "avatar", name: "Fixture-2", selected: true },
  { entryId: "gesture", kind: "gesture", name: "Wave-2", selected: true },
];
const definition = {
  display_name: "Sharing Fixture-2",
  identity_markdown: "# Public fixture",
  avatar: "avatar",
  gestures: [
    { entry_id: "gesture", semantic_key: "wave", config: { loop: true } },
  ],
  reactions: {},
  idle: { default: ["gesture"], cells: { joy: { 2: ["gesture"] } } },
  appearance: { profile: null, background: null },
};
const installed = {
  ...definition,
  avatar: "avatar-copy",
  gestures: [{ ...definition.gestures[0], entry_id: "gesture-copy" }],
  idle: { default: ["gesture-copy"], cells: { joy: { 2: ["gesture-copy"] } } },
};
const privateAvatar = {
  id: "logical-avatar",
  catalog_item_id: "avatar-copy",
  private: true,
  identity: "",
  model_type: "vrm",
  animation_profile: null,
  presentation_revision: 1,
  name: entries[0].name,
};

async function fixture(run) {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "animama-package-ownership-"),
  );
  const localRoot = path.join(root, "isolated-stack/local");
  const repositoryRoot = path.join(root, "repo");
  await mkdir(localRoot, { recursive: true });
  await mkdir(repositoryRoot);
  const ledgerPath = path.join(root, "ledger.jsonl");
  const base = {
    runId: "run-0827123456",
    operationId: "whole-package",
    stageId: "a".repeat(32),
    reviewDigest: "b".repeat(64),
    packageEntries: entries,
    packageAnima: definition,
  };
  const plans = [
    ...entries,
    { entryId: "anima", kind: "anima", name: definition.display_name },
  ].map((entry) => ({
    ...base,
    entryId: entry.entryId,
    kind: entry.kind,
    entryName: entry.name,
    journeyKey: `sharing-${entry.entryId}`,
    event: "import_planned",
  }));
  for (const plan of plans) await appendContentLedgerEvent(ledgerPath, plan);
  const receipt = {
    operation_id: base.operationId,
    state: "completed",
    review_digest: base.reviewDigest,
    result: {
      schema_version: 1,
      operation_id: base.operationId,
      review_digest: base.reviewDigest,
      anima_id: "anima-copy",
      items: entries.map((entry) => ({
        entry_id: entry.entryId,
        item_id: `${entry.entryId}-copy`,
        kind: entry.kind,
        name: entry.name,
        selected: entry.selected,
        logical_key: `local:${entry.entryId}:copy`,
        revision_sha256: "c".repeat(64),
      })),
    },
  };
  const catalogClient = {
    getPackageOperation: async () => receipt,
    getItem: async (id) => {
      const item = receipt.result.items.find((value) => value.item_id === id);
      return {
        ...item,
        source: "local",
        origin: "local",
        relative_locator: `${item.kind}/${item.name}`,
      };
    },
    getAnima: async () => ({
      id: "anima-copy",
      aggregate_revision: 1,
      avatar: privateAvatar,
    }),
    getAnimaExport: async () => ({ anima: installed }),
  };
  try {
    await run({
      ledgerPath,
      plans,
      receipt,
      catalogClient,
      localRoot,
      repositoryRoot,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("whole package binds every copied item and Anima to the original reviewed receipt", async () => {
  await fixture(async (value) => {
    const avatar = await resolvePackageImportOwnership({
      ...value,
      journeyKey: "sharing-avatar",
    });
    assert.equal(avatar.itemId, "avatar-copy");
    assert.equal(avatar.revisionSha256, "c".repeat(64));
    const anima = await resolvePackageImportOwnership({
      ...value,
      journeyKey: "sharing-anima",
    });
    assert.equal(anima.itemId, "anima-copy");
    assert.deepEqual(anima.animaDefinition, installed);
  });
});

for (const scenario of [
  "complete",
  "definition_drift",
  "avatar_drift",
  "restart",
]) {
  test(`Anima cleanup handles ${scenario} without adopting changed or unrelated content`, async () => {
    await fixture(async (value) => {
      const present = new Set(
        value.receipt.result.items.map((item) => item.item_id),
      );
      const deleted = [];
      let animaPresent = true;
      let avatarPresent = true;
      let failAvatarDelete = scenario === "restart";
      const getItem = value.catalogClient.getItem;
      const client = {
        ...value.catalogClient,
        getAnima: async (id) => {
          assert.equal(id, "anima-copy");
          return animaPresent
            ? { id, aggregate_revision: 1, avatar: privateAvatar }
            : null;
        },
        getAnimaExport: async () => ({
          anima: {
            ...installed,
            identity_markdown:
              scenario === "definition_drift"
                ? "manually edited"
                : definition.identity_markdown,
          },
        }),
        deleteAnima: async (id) => {
          deleted.push(id);
          animaPresent = false;
          return { status: 204 };
        },
        getAvatar: async () =>
          avatarPresent
            ? {
                ...privateAvatar,
                name:
                  scenario === "avatar_drift" ? "Manual" : privateAvatar.name,
              }
            : null,
        deleteAvatar: async (id) => {
          assert.equal(id, privateAvatar.id);
          assert.equal(animaPresent, false);
          if (failAvatarDelete) {
            failAvatarDelete = false;
            throw new Error("Interrupted after Anima deletion");
          }
          avatarPresent = false;
          deleted.push(id);
          return { status: 204 };
        },
        getItem: async (id) =>
          present.has(id)
            ? {
                ...(await getItem(id)),
                dependencies:
                  id === "gesture-copy" ? ["local:avatar:copy"] : [],
              }
            : null,
        deleteItem: async (id, revision) => {
          assert.equal(animaPresent, false);
          assert.equal(avatarPresent, false);
          assert.equal(revision, "c".repeat(64));
          present.delete(id);
          deleted.push(id);
          return { status: 204 };
        },
      };
      const cleanup = () =>
        cleanupOwnedContent({
          ...value,
          actor: "recovery",
          catalogClient: client,
        });
      if (scenario.endsWith("drift")) {
        await assert.rejects(cleanup(), /cleanup failed/);
        assert.deepEqual(deleted, []);
        assert.equal(present.size, 2);
      } else {
        if (scenario === "restart") {
          await assert.rejects(cleanup(), /cleanup failed/);
          assert.deepEqual(deleted, ["anima-copy"]);
          assert.equal(present.size, 2);
        }
        const result = await cleanup();
        assert.equal(result.deleted, 3);
        assert.deepEqual(deleted, [
          "anima-copy",
          "logical-avatar",
          "gesture-copy",
          "avatar-copy",
        ]);
        assert.equal((await cleanup()).attempted, 0);
      }
    });
  });
}

test("whole-package receipt with an unexpected entry grants no ownership", async () => {
  await fixture(async (value) => {
    value.receipt.result.items.push({
      ...value.receipt.result.items[0],
      entry_id: "unexpected",
    });
    await assert.rejects(
      resolvePackageImportOwnership({ ...value, journeyKey: "sharing-avatar" }),
      /receipt/,
    );
  });
});

test("whole-package receipt with altered companion facts grants no ownership", async () => {
  await fixture(async (value) => {
    value.receipt.result.items[1].name = "other";
    await assert.rejects(
      resolvePackageImportOwnership({ ...value, journeyKey: "sharing-avatar" }),
      /receipt/,
    );
  });
});
