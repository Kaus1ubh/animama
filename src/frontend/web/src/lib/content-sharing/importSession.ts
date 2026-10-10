import type {
  PackageImportResult,
  PackageOperationStatus,
  PackageStageStatus,
  PartAck,
  ReviewedPackageImport,
} from "@animama/runtime-contracts/api-types";
import { getI18n } from "react-i18next";

import { isAbsentPackageStage, sharingErrorMessage } from "./errors";

export type ImportRecovery = {
  operation_id: string;
  stage_id: string | null;
  review_digest: string | null;
  commit_requested: boolean;
};
export type ImportApi = {
  allocate: (file: File, operationId: string) => Promise<PackageStageStatus>;
  status: (stageId: string) => Promise<PackageStageStatus>;
  part: (
    stageId: string,
    index: number,
    bytes: Blob,
    signal: AbortSignal,
  ) => Promise<PartAck>;
  review: (stageId: string) => Promise<ReviewedPackageImport>;
  commit: (
    stageId: string,
    operationId: string,
    digest: string,
  ) => Promise<PackageImportResult>;
  operation: (operationId: string) => Promise<PackageOperationStatus>;
  discard: (stageId: string) => Promise<void>;
};
export type RecoveryStore = {
  read: () => ImportRecovery | null;
  write: (value: ImportRecovery | null) => void;
};
export type ImportSnapshot = {
  phase: "idle" | "upload" | "review" | "recovery" | "complete";
  busy: boolean;
  stage: PackageStageStatus | null;
  review: ReviewedPackageImport | null;
  result: PackageImportResult | null;
  progress: { received: number; total: number } | null;
  error: string | null;
  pending: boolean;
  hasRecovery: boolean;
};

/** One file import, whose durable operation survives UI, network and process lifetimes. */
export class PackageImportSession {
  private state: ImportSnapshot = {
    phase: "idle",
    busy: false,
    stage: null,
    review: null,
    result: null,
    progress: null,
    error: null,
    pending: false,
    hasRecovery: false,
  };
  private listeners = new Set<() => void>();
  private record: ImportRecovery | null = null;
  private file: File | null = null;
  private uploadAbort: AbortController | null = null;

  readonly api: ImportApi;
  readonly storage: RecoveryStore;
  constructor(api: ImportApi, storage: RecoveryStore) {
    const t = getI18n().getFixedT(null, "library");
    this.api = api;
    this.storage = storage;
    try {
      this.record = storage.read();
      if (this.record)
        this.state = {
          ...this.state,
          phase: "recovery",
          hasRecovery: true,
          pending: this.record.commit_requested,
        };
    } catch {
      this.state = {
        ...this.state,
        phase: "recovery",
        hasRecovery: true,
        error: t("sharing.import.recoveryUnreadable"),
      };
    }
  }
  getSnapshot = (): ImportSnapshot => this.state;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(change: Partial<ImportSnapshot>) {
    this.state = { ...this.state, ...change };
    this.listeners.forEach((listener) => listener());
  }
  private save(record: ImportRecovery | null) {
    this.storage.write(record);
    this.record = record;
    this.update({ hasRecovery: record !== null });
  }
  private complete(result: PackageImportResult) {
    const t = getI18n().getFixedT(null, "library");
    if (
      !this.record ||
      result.operation_id !== this.record.operation_id ||
      (this.record.review_digest &&
        result.review_digest !== this.record.review_digest)
    )
      throw new Error(t("sharing.import.resultMismatch"));
    this.update({
      phase: "complete",
      result,
      pending: false,
      error: null,
      progress: null,
    });
  }

  /** Upload every part on reselection, including acknowledged parts, to prove file identity. */
  async upload(file: File): Promise<void> {
    const t = getI18n().getFixedT(null, "library");
    if (this.state.busy) return;
    if (this.record?.commit_requested) {
      await this.recover();
      return;
    }
    if (
      !/\.zip$/i.test(file.name) ||
      file.size <= 0 ||
      file.size > 4 * 1024 ** 3 ||
      file.name.length > 255
    ) {
      this.update({
        error: t("sharing.import.fileRequirements"),
      });
      return;
    }
    this.update({ busy: true, error: null, phase: "upload", review: null });
    this.file = file;
    this.uploadAbort = new AbortController();
    try {
      if (!this.record)
        this.save({
          operation_id: crypto.randomUUID(),
          stage_id: null,
          review_digest: null,
          commit_requested: false,
        });
      const record = this.record!;
      if (!record.stage_id) {
        // Allocation may have succeeded before its acknowledgement was lost.
        const outcome = await this.api.operation(record.operation_id);
        if (
          outcome.state === "completed" &&
          outcome.result?.schema_version === 1
        ) {
          this.complete(outcome.result);
          return;
        }
        if (outcome.state === "recovery_needed")
          throw new Error(t("sharing.import.needsRecoveryBeforeUpload"));
        if (outcome.stage_id)
          this.save({ ...record, stage_id: outcome.stage_id });
      }
      const current = this.record!;
      let stage = current.stage_id
        ? await this.api.status(current.stage_id)
        : await this.api.allocate(file, current.operation_id);
      if (stage.operation_id !== current.operation_id)
        throw new Error(t("sharing.import.stageMismatch"));
      this.save({ ...current, stage_id: stage.stage_id });
      this.update({ stage, progress: { received: 0, total: file.size } });
      if (
        stage.active ||
        ["committing", "recovery_needed", "completed"].includes(stage.state)
      ) {
        this.update({ phase: "recovery", pending: true });
        throw new Error(t("sharing.import.beingProcessed"));
      }
      if (stage.review) {
        this.save({
          ...this.record!,
          review_digest: stage.review.review_digest,
        });
        this.update({
          phase: "review",
          review: stage.review,
          progress: null,
          error: t("sharing.import.alreadyReviewed"),
        });
        return;
      }
      if (
        stage.expected_size_bytes !== file.size ||
        stage.filename !== file.name
      )
        throw new Error(t("sharing.import.sameFileOrDiscard"));
      if (
        !(stage.part_size_bytes > 0 && stage.part_size_bytes <= 8 * 1024 ** 2)
      )
        throw new Error(t("sharing.import.partLimitInvalid"));
      for (
        let index = 0, offset = 0;
        offset < file.size;
        index++, offset += stage.part_size_bytes
      ) {
        this.uploadAbort.signal.throwIfAborted();
        const bytes = file.slice(
          offset,
          Math.min(offset + stage.part_size_bytes, file.size),
        );
        const ack = await this.api.part(
          stage.stage_id,
          index,
          bytes,
          this.uploadAbort.signal,
        );
        if (
          ack.next_part_index < index + 1 ||
          ack.received_bytes < offset + bytes.size
        )
          throw new Error(t("sharing.import.acknowledgementIncomplete"));
        this.update({
          progress: { received: offset + bytes.size, total: file.size },
        });
      }
      stage = await this.api.status(stage.stage_id);
      this.update({ stage });
      await this.reviewCurrent();
    } catch (error) {
      this.update({ error: sharingErrorMessage(error) });
    } finally {
      this.uploadAbort = null;
      this.update({ busy: false });
    }
  }
  retryUpload = async (): Promise<void> => {
    const t = getI18n().getFixedT(null, "library");
    if (this.file) await this.upload(this.file);
    else
      this.update({
        error: t("sharing.import.chooseSameZip"),
      });
  };
  private async reviewCurrent() {
    const t = getI18n().getFixedT(null, "library");
    if (!this.record?.stage_id)
      throw new Error(t("sharing.import.chooseFileFirst"));
    const review = await this.api.review(this.record.stage_id);
    if (
      review.operation_id !== this.record.operation_id ||
      review.stage_id !== this.record.stage_id
    )
      throw new Error(t("sharing.import.reviewMismatch"));
    this.save({
      ...this.record,
      review_digest: review.review_digest,
      commit_requested: false,
    });
    this.update({
      phase: "review",
      review,
      pending: false,
      error: null,
      progress: null,
    });
  }
  async refresh(): Promise<void> {
    const t = getI18n().getFixedT(null, "library");
    if (this.state.busy || this.record?.commit_requested) return;
    // A sealed review is immutable. Resolve/discard the old operation before
    // re-uploading retained bytes under a fresh ID and showing new collision names.
    const file = this.file;
    if (!(await this.discard())) return;
    if (file) await this.upload(file);
    else
      this.update({
        error: t("sharing.import.chooseAgainForReview"),
      });
  }
  async commit(): Promise<void> {
    if (this.state.busy || !this.record?.stage_id || !this.record.review_digest)
      return;
    if (this.record.commit_requested) {
      await this.recover();
      return;
    }
    if (this.state.phase !== "review" || this.state.error) return;
    this.update({ busy: true, error: null });
    try {
      // Persist before sending: aborting a browser request cannot cancel installation.
      this.save({ ...this.record, commit_requested: true });
      this.update({ pending: true });
      const result = await this.api.commit(
        this.record.stage_id!,
        this.record.operation_id,
        this.record.review_digest!,
      );
      this.complete(result);
    } catch (error) {
      this.update({
        phase: this.record?.commit_requested ? "recovery" : "review",
        error: sharingErrorMessage(error),
      });
    } finally {
      this.update({ busy: false });
    }
  }
  async recover(): Promise<void> {
    const t = getI18n().getFixedT(null, "library");
    if (this.state.busy || !this.record) return;
    this.update({ busy: true, error: null });
    try {
      const record = this.record;
      const outcome = await this.api.operation(record.operation_id);
      if (outcome.state === "completed") {
        if (outcome.result?.schema_version !== 1)
          throw new Error(t("sharing.import.unsupportedReceipt"));
        this.complete(outcome.result);
        return;
      }
      if (outcome.state === "recovery_needed") {
        this.update({
          phase: "recovery",
          pending: true,
          error: t("sharing.import.needsStorageRecovery"),
        });
        return;
      }
      const stageId = outcome.stage_id ?? record.stage_id;
      if (!stageId || outcome.state === "not_found") {
        // The server has checked receipts and journals. No completed/active outcome exists.
        this.save({ ...record, commit_requested: false });
        this.update({
          phase: "recovery",
          pending: false,
          error: t("sharing.import.noActiveImport"),
        });
        return;
      }
      const stage = await this.api.status(stageId);
      if (stage.operation_id !== record.operation_id)
        throw new Error(t("sharing.import.stageChanged"));
      this.save({ ...record, stage_id: stageId });
      this.update({ stage });
      if (
        stage.active ||
        ["committing", "recovery_needed"].includes(stage.state)
      ) {
        this.update({
          phase: "recovery",
          pending: true,
          error: t("sharing.import.stillProcessing"),
        });
        return;
      }
      this.save({
        ...this.record!,
        review_digest: stage.review?.review_digest ?? record.review_digest,
        commit_requested: false,
      });
      this.update({
        phase: stage.review ? "review" : "upload",
        review: stage.review ?? null,
        pending: false,
        progress: {
          received: stage.received_bytes,
          total: stage.expected_size_bytes,
        },
        error: stage.review
          ? stage.state === "failed"
            ? t("sharing.import.didNotComplete")
            : null
          : t("sharing.import.sameFileToResume"),
      });
    } catch (error) {
      this.update({ phase: "recovery", error: sharingErrorMessage(error) });
    } finally {
      this.update({ busy: false });
    }
  }
  /** Release the owned temporary stage; durable results remain in receipt authority. */
  async discard(): Promise<boolean> {
    const t = getI18n().getFixedT(null, "library");
    if (this.state.busy || (this.state.pending && !this.state.result))
      return false;
    this.update({ busy: true, error: null });
    try {
      let discardId = this.state.result ? this.record?.stage_id : null;
      if (this.record && !this.state.result) {
        const outcome = await this.api.operation(this.record.operation_id);
        if (
          outcome.state === "completed" &&
          outcome.result?.schema_version === 1
        ) {
          this.complete(outcome.result);
          return false;
        }
        if (outcome.state === "recovery_needed") {
          this.update({ pending: true, phase: "recovery" });
          throw new Error(t("sharing.import.recoverBeforeClose"));
        }
        const stageId = outcome.stage_id ?? this.record.stage_id;
        if (outcome.state !== "not_found" && stageId) discardId = stageId;
      }
      if (discardId) {
        try {
          await this.api.discard(discardId);
        } catch (error) {
          if (!isAbsentPackageStage(error)) throw error;
        }
      }
      this.save(null);
      this.file = null;
      this.update({
        phase: "idle",
        review: null,
        stage: null,
        result: null,
        progress: null,
        pending: false,
        error: null,
      });
      return true;
    } catch (error) {
      this.update({ error: sharingErrorMessage(error) });
      return false;
    } finally {
      this.update({ busy: false });
    }
  }
  /** Navigating away stops only bounded upload transport, preserving resumable ownership. */
  pause() {
    const t = getI18n().getFixedT(null, "library");
    this.uploadAbort?.abort(new Error(t("sharing.import.uploadPaused")));
  }
}
