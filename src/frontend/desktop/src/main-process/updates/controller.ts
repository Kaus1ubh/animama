import type { UpdateStatus } from "../../../../shared/desktop-runtime.js";
import { RuntimeError, runtimeErrorCode } from "../runtime/errors.js";
import {
  updateFreeBytes,
  validateUpdateCandidate,
  type UpdateCandidate,
} from "./policy.js";

/** The adapter keeps Electron, native Squirrel and download paths outside renderer contracts. */
export type UpdateAdapter = {
  check(): Promise<{ available: boolean; info: unknown } | null>;
  download(
    candidate: UpdateCandidate,
    progress: (transferred: number) => void,
  ): Promise<void>;
  install(): Promise<void>;
  close(): void;
};
export type UpdateControllerOptions = {
  version: string;
  adapter: UpdateAdapter;
  disk(): Promise<{ free: bigint; databaseBytes: number }>;
  preflight(candidate: UpdateCandidate): Promise<void>;
  /** Must stop every owned child before invoking the install callback. */
  stopAndInstall(
    candidate: UpdateCandidate,
    install: () => Promise<void>,
  ): Promise<void>;
  onStatus(status: UpdateStatus): void;
  checkTimeoutMs?: number;
};

/** One consent-driven update transaction; discovery never downloads or changes the runtime. */
export class DesktopUpdateController {
  private current: UpdateStatus = { state: "idle" };
  private candidate?: UpdateCandidate;
  private minimumFreeBytes = 0;
  private downloaded = false;
  private busy = false;
  private closed = false;
  private startupTimer?: ReturnType<typeof setTimeout>;
  constructor(private options: UpdateControllerOptions) {}
  status(): UpdateStatus {
    return { ...this.current };
  }
  private emit(status: UpdateStatus): void {
    if (this.closed) return;
    this.current = status;
    this.options.onStatus(this.status());
  }
  private details() {
    return {
      version: this.candidate!.version,
      downloadBytes: this.candidate!.downloadBytes,
      minimumFreeBytes: this.minimumFreeBytes,
    };
  }
  start(): void {
    if (this.startupTimer || this.closed) return;
    this.startupTimer = setTimeout(() => {
      void this.check().catch(() => undefined);
    }, 15_000);
    this.startupTimer.unref?.();
  }
  private async run(
    action: "check" | "download" | "restart",
    operation: () => Promise<void>,
  ): Promise<UpdateStatus> {
    if (this.closed || this.busy)
      throw new RuntimeError("update_operation_active");
    this.busy = true;
    try {
      await operation();
    } catch (error) {
      const code =
        error instanceof RuntimeError
          ? runtimeErrorCode(error)
          : `update_${action}_failed`;
      this.emit({
        state: "error",
        code,
        retry: action,
        ...(this.candidate ? { version: this.candidate.version } : {}),
      });
    } finally {
      this.busy = false;
    }
    return this.status();
  }
  check(): Promise<UpdateStatus> {
    return this.run("check", async () => {
      if (this.downloaded) {
        this.emit({ state: "downloaded", ...this.details() });
        return;
      }
      this.emit({ state: "checking" });
      let timer: ReturnType<typeof setTimeout> | undefined;
      const result = await Promise.race([
        this.options.adapter.check(),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new RuntimeError("update_check_timeout")),
            this.options.checkTimeoutMs ?? 30_000,
          );
        }),
      ]).finally(() => clearTimeout(timer));
      if (this.closed) return;
      if (!result) {
        this.emit({ state: "unavailable" });
        return;
      }
      if (!result.available) {
        this.candidate = undefined;
        this.emit({ state: "up_to_date" });
        return;
      }
      this.candidate = validateUpdateCandidate(
        result.info,
        this.options.version,
      );
      const disk = await this.options.disk();
      this.minimumFreeBytes = updateFreeBytes(
        this.candidate,
        disk.databaseBytes,
      );
      this.emit({ state: "available", ...this.details() });
    });
  }
  download(): Promise<UpdateStatus> {
    return this.run("download", async () => {
      if (!this.candidate || this.downloaded)
        throw new RuntimeError("update_check_required");
      await this.options.preflight(this.candidate);
      const disk = await this.options.disk();
      this.minimumFreeBytes = updateFreeBytes(
        this.candidate,
        disk.databaseBytes,
      );
      if (disk.free < BigInt(this.minimumFreeBytes))
        throw new RuntimeError("update_insufficient_disk");
      if (this.closed) return;
      this.emit({ state: "downloading", ...this.details(), progress: 0 });
      await this.options.adapter.download(this.candidate, (bytes) =>
        this.emit({
          state: "downloading",
          ...this.details(),
          progress: Math.min(1, bytes / this.candidate!.downloadBytes),
        }),
      );
      if (this.closed) return;
      this.downloaded = true;
      this.emit({ state: "downloaded", ...this.details() });
    });
  }
  async restart(): Promise<void> {
    await this.run("restart", async () => {
      if (!this.candidate || !this.downloaded)
        throw new RuntimeError("update_download_required");
      await this.options.preflight(this.candidate);
      const disk = await this.options.disk();
      // Recheck the conservative full allowance; stale free-space UI is not authority.
      if (
        disk.free < BigInt(updateFreeBytes(this.candidate, disk.databaseBytes))
      )
        throw new RuntimeError("update_insufficient_disk");
      if (this.closed) return;
      this.emit({ state: "restarting", version: this.candidate.version });
      await this.options.stopAndInstall(this.candidate, () =>
        this.options.adapter.install(),
      );
    });
  }
  close(): void {
    this.closed = true;
    clearTimeout(this.startupTimer);
    this.options.adapter.close();
  }
}
