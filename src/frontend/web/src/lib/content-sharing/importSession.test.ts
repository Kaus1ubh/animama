import { describe, expect, it, vi } from "vitest";
import { SharingError } from "./errors";
import {
  PackageImportSession,
  type ImportApi,
  type ImportRecovery,
  type RecoveryStore,
} from "./importSession";
import type {
  PackageImportResult,
  PackageStageStatus,
  ReviewedPackageImport,
} from "@animama/runtime-contracts/api-types";
const digest = "a".repeat(64);
const stage: PackageStageStatus = {
  stage_id: "stage",
  operation_id: "op",
  filename: "one.zip",
  state: "uploading",
  active: false,
  expected_size_bytes: 10,
  received_bytes: 0,
  next_part_index: 0,
  part_size_bytes: 4,
  expires_at: "2099-01-01",
  review: null,
};
const review: ReviewedPackageImport = {
  stage_id: "stage",
  operation_id: "op",
  filename: "one.zip",
  package_sha256: digest,
  size_bytes: 10,
  expires_at: "2099-01-01",
  kind: "content",
  selected_count: 1,
  required_count: 0,
  items: [],
  anima: null,
  review_digest: digest,
};
const result: PackageImportResult = {
  schema_version: 1,
  operation_id: "op",
  review_digest: digest,
  package_sha256: digest,
  items: [],
  anima_id: null,
};
function fixture(saved: ImportRecovery | null = null) {
  let record = saved;
  let operationId = saved?.operation_id ?? "op";
  let filename = stage.filename;
  const storage: RecoveryStore = {
    read: () => record,
    write: (value) => {
      record = value;
    },
  };
  const api: ImportApi = {
    allocate: vi.fn(async (file, id) => {
      operationId = id;
      filename = file.name;
      return { ...stage, filename, operation_id: id };
    }),
    status: vi.fn(async () => ({
      ...stage,
      filename,
      operation_id: operationId,
    })),
    part: vi.fn(async (_s, i, b) => ({
      stage_id: "stage",
      index: i,
      sha256: digest,
      size_bytes: b.size,
      complete: i === 2,
      next_part_index: i + 1,
      received_bytes: Math.min(10, i * 4 + b.size),
    })),
    review: vi.fn(async () => ({
      ...review,
      filename,
      operation_id: operationId,
    })),
    commit: vi.fn(async () => ({ ...result, operation_id: operationId })),
    operation: vi.fn(async () => ({
      operation_id: "op",
      state: "not_found" as const,
    })),
    discard: vi.fn(async () => {}),
  };
  const session = new PackageImportSession(api, storage);
  return { session, api, storage, getRecord: () => record };
}
describe("reviewed package import", () => {
  it.each(["one.zip", "one.ZIP"])(
    "accepts %s for server package validation",
    async (filename) => {
      const { session, api } = fixture();
      await session.upload(new File([new Uint8Array(10)], filename));
      expect(api.allocate).toHaveBeenCalledOnce();
      expect(api.review).toHaveBeenCalledOnce();
      expect(session.getSnapshot().phase).toBe("review");
    },
  );
  it.each(["one.animama", "one.txt", "one.zip.exe"])(
    "rejects %s before allocating an upload",
    async (filename) => {
      const { session, api } = fixture();
      await session.upload(new File([new Uint8Array(10)], filename));
      expect(api.allocate).not.toHaveBeenCalled();
      expect(session.getSnapshot().error).toContain(".zip");
    },
  );
  it("does not make an unrelated ZIP actionable when server validation rejects it", async () => {
    const { session, api } = fixture();
    vi.mocked(api.review).mockRejectedValue(
      new SharingError("package_invalid", 422),
    );
    await session.upload(new File([new Uint8Array(10)], "unrelated.zip"));
    expect(api.review).toHaveBeenCalledOnce();
    expect(session.getSnapshot().review).toBeNull();
    expect(session.getSnapshot().error).toContain("supported Animama package");
    await session.commit();
    expect(api.commit).not.toHaveBeenCalled();
  });
  it("releases a completed stage before forgetting its recovery identifiers", async () => {
    const { session, api, getRecord } = fixture();
    await session.upload(new File([new Uint8Array(10)], "one.zip"));
    await session.commit();
    vi.mocked(api.discard).mockImplementation(async (id) => {
      expect(id).toBe("stage");
      expect(getRecord()).not.toBeNull();
    });
    expect(await session.discard()).toBe(true);
    expect(api.discard).toHaveBeenCalledOnce();
    expect(getRecord()).toBeNull();
  });
  it("preserves a completed result when cleanup fails, but acknowledges confirmed absence", async () => {
    const { session, api, getRecord } = fixture();
    await session.upload(new File([new Uint8Array(10)], "one.zip"));
    await session.commit();
    const completed = session.getSnapshot().result;
    vi.mocked(api.discard).mockRejectedValueOnce(new Error("Offline"));
    expect(await session.discard()).toBe(false);
    expect(session.getSnapshot().result).toBe(completed);
    expect(getRecord()).not.toBeNull();
    vi.mocked(api.discard).mockRejectedValueOnce(
      new SharingError("package_stage_unavailable", 409),
    );
    expect(await session.discard()).toBe(true);
    expect(getRecord()).toBeNull();
  });
  it("keeps a failed review blocked and prepares a fresh operation after safe discard", async () => {
    const { session, api, getRecord } = fixture();
    await session.upload(new File([new Uint8Array(10)], "one.zip"));
    const old = getRecord()!;
    const oldReview = session.getSnapshot().review!;
    vi.mocked(api.commit).mockRejectedValue(
      new SharingError("package_destination_changed", 409),
    );
    await session.commit();
    vi.mocked(api.operation).mockImplementation(async (id) =>
      id === old.operation_id
        ? { operation_id: id, state: "pending", stage_id: "stage" }
        : { operation_id: id, state: "not_found" },
    );
    vi.mocked(api.status).mockResolvedValueOnce({
      ...stage,
      operation_id: old.operation_id,
      state: "failed",
      review: oldReview,
    });
    await session.recover();
    expect(session.getSnapshot()).toMatchObject({
      phase: "review",
      pending: false,
      error: expect.stringContaining("fresh review"),
    });
    await session.commit();
    expect(api.commit).toHaveBeenCalledTimes(1);
    vi.mocked(api.review).mockImplementation(async () => ({
      ...review,
      operation_id: getRecord()!.operation_id,
      review_digest: "b".repeat(64),
    }));
    await session.refresh();
    expect(api.discard).toHaveBeenCalledWith("stage");
    expect(api.allocate).toHaveBeenCalledTimes(2);
    expect(getRecord()?.operation_id).not.toBe(old.operation_id);
    expect(session.getSnapshot()).toMatchObject({
      phase: "review",
      error: null,
      review: { review_digest: "b".repeat(64) },
    });
    expect(api.commit).toHaveBeenCalledTimes(1);
  });
  it("asks for the file again after refreshing a recovered failed review", async () => {
    const { session, api, getRecord } = fixture({
      operation_id: "op",
      stage_id: "stage",
      review_digest: digest,
      commit_requested: true,
    });
    vi.mocked(api.operation).mockResolvedValue({
      operation_id: "op",
      state: "pending",
      stage_id: "stage",
    });
    vi.mocked(api.status).mockResolvedValue({
      ...stage,
      state: "failed",
      review,
    });
    await session.recover();
    await session.refresh();
    expect(getRecord()).toBeNull();
    expect(session.getSnapshot()).toMatchObject({
      phase: "idle",
      error: expect.stringContaining("Choose the .zip file again"),
    });
    expect(api.allocate).not.toHaveBeenCalled();
  });
  it("sends bounded sequential slices and reviews only after all acknowledgements", async () => {
    const { session, api } = fixture();
    const file = new File([new Uint8Array(10)], "one.zip");
    await session.upload(file);
    expect(
      vi.mocked(api.part).mock.calls.map(([, i, b]) => [i, b.size]),
    ).toEqual([
      [0, 4],
      [1, 4],
      [2, 2],
    ]);
    expect(session.getSnapshot().review).toMatchObject({
      review_digest: digest,
      stage_id: "stage",
    });
  });
  it("reselecting a file rechecks acknowledged parts instead of trusting filename and size", async () => {
    const { session, api } = fixture({
      operation_id: "op",
      stage_id: "stage",
      review_digest: null,
      commit_requested: false,
    });
    vi.mocked(api.status).mockResolvedValue({
      ...stage,
      next_part_index: 1,
      received_bytes: 4,
    });
    await session.upload(new File([new Uint8Array(10)], "one.zip"));
    expect(api.allocate).not.toHaveBeenCalled();
    expect(vi.mocked(api.part).mock.calls.map(([, i]) => i)).toEqual([0, 1, 2]);
  });
  it("recovers a completed outcome after a lost commit response without another installation", async () => {
    const { session, api, storage } = fixture({
      operation_id: "op",
      stage_id: "stage",
      review_digest: digest,
      commit_requested: true,
    });
    vi.mocked(api.operation).mockResolvedValue({
      operation_id: "op",
      state: "completed",
      review_digest: digest,
      result,
    });
    await session.recover();
    expect(session.getSnapshot().result).toEqual(result);
    expect(api.commit).not.toHaveBeenCalled();
    expect(storage.read()?.operation_id).toBe("op");
  });
  it("persists the operation before commit and suppresses repeated submissions while its outcome is unknown", async () => {
    const { session, api, getRecord } = fixture();
    await session.upload(new File([new Uint8Array(10)], "one.zip"));
    let finish!: () => void;
    vi.mocked(api.commit).mockImplementation(async () => {
      expect(getRecord()?.commit_requested).toBe(true);
      await new Promise<void>((r) => {
        finish = r;
      });
      throw new Error("Response lost");
    });
    const pending = session.commit();
    await session.commit();
    finish();
    await pending;
    expect(api.commit).toHaveBeenCalledTimes(1);
    expect(session.getSnapshot()).toMatchObject({
      phase: "recovery",
      pending: true,
    });
    expect(await session.discard()).toBe(false);
    expect(getRecord()?.commit_requested).toBe(true);
  });
  it("does not send a commit when recovery identifiers cannot be persisted", async () => {
    const { session, api, storage } = fixture();
    await session.upload(new File([new Uint8Array(10)], "one.zip"));
    storage.write = () => {
      throw new Error("Storage unavailable");
    };
    await session.commit();
    expect(api.commit).not.toHaveBeenCalled();
    expect(session.getSnapshot()).toMatchObject({
      phase: "review",
      pending: false,
      error: "Storage unavailable",
    });
  });
  it("recovers a lost review response and submits its original digest", async () => {
    const { session, api } = fixture({
      operation_id: "op",
      stage_id: "stage",
      review_digest: null,
      commit_requested: false,
    });
    vi.mocked(api.operation).mockResolvedValue({
      operation_id: "op",
      state: "pending",
      stage_id: "stage",
      review_digest: digest,
    });
    vi.mocked(api.status).mockResolvedValue({
      ...stage,
      state: "reviewed",
      review,
    });
    await session.recover();
    await session.commit();
    expect(api.commit).toHaveBeenCalledWith("stage", "op", digest);
    expect(session.getSnapshot().result).toEqual(result);
  });
  it("keeps unknown commit recovery when the local server cannot be reached", async () => {
    const { session, api, getRecord } = fixture({
      operation_id: "op",
      stage_id: "stage",
      review_digest: digest,
      commit_requested: true,
    });
    vi.mocked(api.operation).mockRejectedValue(new Error("Offline"));
    await session.recover();
    expect(session.getSnapshot()).toMatchObject({
      phase: "recovery",
      pending: true,
    });
    await session.upload(new File([new Uint8Array(10)], "one.zip"));
    expect(api.allocate).not.toHaveBeenCalled();
    expect(api.commit).not.toHaveBeenCalled();
    expect(getRecord()?.commit_requested).toBe(true);
  });
  it("rejects unsupported and oversized files before allocation", async () => {
    const { session, api } = fixture();
    await session.upload(new File(["abc"], "image.png"));
    const huge = new File(["abc"], "big.zip");
    Object.defineProperty(huge, "size", { value: 4 * 1024 ** 3 + 1 });
    await session.upload(huge);
    expect(api.allocate).not.toHaveBeenCalled();
    expect(session.getSnapshot().error).toContain("4 GiB");
  });
  it("does not discard an import that completed in another request", async () => {
    const { session, api, getRecord } = fixture({
      operation_id: "op",
      stage_id: "stage",
      review_digest: digest,
      commit_requested: false,
    });
    vi.mocked(api.operation).mockResolvedValue({
      operation_id: "op",
      state: "completed",
      result,
    });
    expect(await session.discard()).toBe(false);
    expect(session.getSnapshot().result).toEqual(result);
    expect(api.discard).not.toHaveBeenCalled();
    expect(getRecord()).not.toBeNull();
  });
});
