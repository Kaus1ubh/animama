import assert from "node:assert/strict";
import test from "node:test";
import type { Page } from "playwright/test";
import type {
  CreatorContentFixture,
  CreatorPackageImportPlan,
} from "../fixtures/animama.ts";
import { roundTripPosePackage, type OwnedPose } from "./pose-content.ts";

const source: OwnedPose = {
  plan: {
    runId: "run-0827123456",
    journeyKey: "pose-source",
    kind: "pose",
    entryName: "salute",
    logicalKey: "source-key",
  },
  itemId: "source-item",
  revisionSha256: "a".repeat(64),
};

function scenario({ lostReply = false, pending = false } = {}) {
  const calls: string[] = [];
  const digest = "b".repeat(64);
  const stageId = "c".repeat(32);
  const archive = Buffer.from("12345678");
  const reply = (body: unknown, status = 200) => ({
    ok: () => status < 400,
    status: () => status,
    json: async () => body,
    text: async () => JSON.stringify(body),
    body: async () => archive,
  });
  const page = {
    url: () => "http://localhost:8460/a/poses/source-item",
    request: {
      async post(url: string) {
        calls.push(url);
        if (url.endsWith(":summary")) return reply({ digest });
        if (url.endsWith("package-exports"))
          return reply({ export_id: "export-id", size_bytes: archive.length });
        if (url.endsWith("package-imports"))
          return reply({ stage_id: stageId, part_size_bytes: 4 });
        if (url.endsWith("/review"))
          return reply({
            kind: "content",
            review_digest: digest,
            items: [{ entry_id: "entry-0001", kind: "pose", name: "salute" }],
          });
        if (url.endsWith("/commit")) {
          assert.ok(
            calls.includes("journal-import"),
            "operation must be durable before dispatch",
          );
          if (lostReply) throw new Error("connection lost after commit");
          return reply({});
        }
        throw new Error(`Unexpected POST ${url}`);
      },
      async get(url: string) {
        calls.push(url);
        return reply(
          url.endsWith("/file")
            ? {}
            : {
                state: pending ? "pending" : "completed",
                review_digest: digest,
              },
        );
      },
      async put(url: string, options: { data: Buffer }) {
        calls.push(url);
        assert.equal(options.data.length, 4);
        return reply({});
      },
      async delete(url: string) {
        calls.push(`DELETE ${url}`);
        return reply({}, 204);
      },
    },
  } as unknown as Page;
  const content = {
    async cleanupOwnedContent() {
      calls.push("cleanup-source");
    },
    async assertDeletedContent() {
      calls.push("source-deleted");
    },
    async planPackageImport(plan: Omit<CreatorPackageImportPlan, "runId">) {
      assert.equal("logicalKey" in plan, false);
      calls.push("journal-import");
      return { ...plan, runId: source.plan.runId };
    },
    async resolvePackageImport() {
      calls.push("resolve-receipt");
      return {
        plan: { ...source.plan, logicalKey: "fresh-key" },
        itemId: "fresh-item",
        revisionSha256: "d".repeat(64),
      };
    },
    async verifyOwnedContent() {
      calls.push("verify-copy");
    },
  } as unknown as CreatorContentFixture;
  return { calls, page, content, stageId };
}

for (const lostReply of [false, true]) {
  test(`Pose round trip uses reviewed stages and receipt ownership (lost reply=${lostReply})`, async () => {
    const value = scenario({ lostReply });
    const copy = await roundTripPosePackage(value.page, value.content, source);
    assert.equal(copy.itemId, "fresh-item");
    assert.equal(copy.plan.logicalKey, "fresh-key");
    assert.equal(
      value.calls.filter((url) => url.includes("/parts/")).length,
      2,
    );
    assert.ok(value.calls.includes("resolve-receipt"));
    assert.ok(
      value.calls.includes(
        `DELETE /v1/content/package-imports/${value.stageId}`,
      ),
    );
    assert.equal(
      value.calls.some(
        (url) => url.includes("packages:import") || url.includes(":export?"),
      ),
      false,
    );
  });
}

test("unknown commit keeps its recorded stage and never adopts a guessed item", async () => {
  const value = scenario({ lostReply: true, pending: true });
  await assert.rejects(
    roundTripPosePackage(value.page, value.content, source),
    /completed/,
  );
  assert.ok(value.calls.includes("journal-import"));
  assert.equal(value.calls.includes("resolve-receipt"), false);
  assert.equal(
    value.calls.includes(`DELETE /v1/content/package-imports/${value.stageId}`),
    false,
  );
});
