import { randomUUID } from "node:crypto";
import { lstat, readdir, rename, rm, statfs } from "node:fs/promises";
import path from "node:path";
import {
  featurePackIds,
  featurePackRequires,
  type FeaturePackId,
  type FeaturePackStatus,
} from "../../../../shared/desktop-runtime.js";
import { atomicWrite, privateDirectory } from "../runtime/atomic-file.js";
import { RuntimeError, runtimeErrorCode } from "../runtime/errors.js";
import {
  PACK_METADATA,
  downloadBytes,
  manifestDigest,
  validateManifest,
  packId,
  readBoundedJson,
  requiredFreeBytes,
  versionDirectory,
  type PackCatalog,
  type PackManifest,
} from "./catalog.js";
import {
  modelDownloadDirectory,
  prepareModelDownloads,
  stageModelFiles,
  removeModelDownloads,
} from "./model-files.js";
import { downloadPack } from "./download.js";
import { extractPack } from "./extract.js";
import { realDirectory, syncDirectory, verifyPackFiles } from "./files.js";
import { verifyExecutablePack } from "./signature.js";

export type ActivePack = { manifest: PackManifest; root: string };
/** Only validated, bounded control-response labels may cross into renderer status. */
export class PackInUseError extends RuntimeError {
  constructor(
    readonly blockers: NonNullable<FeaturePackStatus["blockers"]>,
    code = "pack_in_use",
  ) {
    super(code);
  }
}
export type ActivePacks = Partial<Record<FeaturePackId, ActivePack>>;
type Pointer = { directory: string; digest: string };
type Pointers = Partial<Record<FeaturePackId, Pointer>>;
export type PackTransition = {
  id: FeaturePackId;
  removing: boolean;
  previous: ActivePacks;
  next: ActivePacks;
  /** Called only after requests/workers have drained; failure recovery restores it. */
  commit(): Promise<void>;
  rollback(): Promise<void>;
};
export type PackManagerOptions = {
  root: string;
  downloads: string;
  catalog: PackCatalog;
  onProgress(status: FeaturePackStatus): void;
  transition(change: PackTransition): Promise<void>;
  // Narrow seams let tests exercise files and HTTP without pretending to sign code.
  freeBytes?: () => Promise<bigint>;
  verifyExecutable?: typeof verifyExecutablePack;
};

/** One serialized installer, with cancellation outside the queue and atomic active pointers. */
export class FeaturePackManager {
  private statuses = new Map<FeaturePackId, FeaturePackStatus>();
  private active: ActivePacks = {};
  private pointers: Pointers = {};
  private retainedFiles = new Set<FeaturePackId>();
  private pending = new Map<FeaturePackId, AbortController>();
  private work: Promise<unknown> = Promise.resolve();
  private closed = false;
  constructor(private options: PackManagerOptions) {
    for (const id of featurePackIds) this.statuses.set(id, this.baseStatus(id));
  }
  private get pointerFile(): string {
    return path.join(this.options.root, "active.json");
  }
  private manifest(id: FeaturePackId): PackManifest | undefined {
    return this.options.catalog.entries.find((entry) => entry.id === id);
  }
  private baseStatus(id: FeaturePackId): FeaturePackStatus {
    const manifest = this.manifest(id);
    return {
      id,
      state: "not_installed",
      available: Boolean(manifest),
      hasInstalledFiles:
        Boolean(this.pointers[id]) || this.retainedFiles.has(id),
      ...(manifest
        ? {
            version: manifest.version,
            downloadBytes: downloadBytes(manifest),
            installedBytes: manifest.installed_bytes,
            minimumFreeBytes: requiredFreeBytes(manifest),
          }
        : {}),
    };
  }
  private emit(id: FeaturePackId, patch: Partial<FeaturePackStatus>): void {
    const status = { ...this.baseStatus(id), ...patch };
    this.statuses.set(id, status);
    this.options.onProgress({ ...status });
  }
  list(): FeaturePackStatus[] {
    return featurePackIds.map((id) => ({ ...this.statuses.get(id)! }));
  }
  activePacks(): ActivePacks {
    return { ...this.active };
  }
  /** Update shutdown must not race a download or pointer transition. */
  isBusy(): boolean {
    return this.pending.size > 0;
  }
  private installedRoot(id: FeaturePackId, directory: string): string {
    if (!/^\d{1,5}\.\d{1,5}\.\d{1,5}-[a-f0-9]{16}$/u.test(directory))
      throw new RuntimeError("pack_state_invalid");
    return path.join(this.options.root, id, "versions", directory);
  }
  private async verify(root: string, manifest: PackManifest): Promise<void> {
    const saved = await readBoundedJson(path.join(root, PACK_METADATA));
    if (
      manifest.schema === "animama-model-pack/1"
        ? manifestDigest(validateManifest(saved)) !== manifestDigest(manifest)
        : JSON.stringify(saved) !== JSON.stringify(manifest)
    )
      throw new RuntimeError("pack_manifest_invalid");
    await verifyPackFiles(root, manifest);
    await (this.options.verifyExecutable ?? verifyExecutablePack)(
      root,
      manifest,
    );
  }
  /** Status flags never authorize a mount: reconstruct it from a catalog-matched inventory. */
  async initialize(): Promise<void> {
    privateDirectory(this.options.root);
    privateDirectory(this.options.downloads);
    // Interrupted extraction never grants authority and can be cleaned without
    // touching any version named by an active pointer.
    for (const id of featurePackIds) {
      const versions = path.join(this.options.root, id, "versions");
      try {
        await realDirectory(versions);
        for (const name of await readdir(versions)) {
          if (/^\.staging-[a-f0-9-]{36}$/u.test(name))
            await rm(path.join(versions, name), {
              recursive: true,
              force: true,
            });
          else if (
            /^\d{1,5}\.\d{1,5}\.\d{1,5}-[a-f0-9]{16}$/u.test(name) ||
            /^\.rejected-[a-f0-9-]{36}$/u.test(name)
          )
            this.retainedFiles.add(id);
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    try {
      const saved = (await readBoundedJson(this.pointerFile, 8192)) as {
        schema: number;
        packs: Pointers;
      };
      if (
        saved.schema !== 1 ||
        !saved.packs ||
        Object.keys(saved.packs).some(
          (id) => !featurePackIds.includes(id as FeaturePackId),
        )
      )
        throw new RuntimeError("pack_state_invalid");
      for (const [id, pointer] of Object.entries(saved.packs)) {
        this.installedRoot(packId(id), pointer.directory);
        if (!/^[a-f0-9]{64}$/u.test(pointer.digest))
          throw new RuntimeError("pack_state_invalid");
      }
      this.pointers = saved.packs;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        throw new RuntimeError("pack_state_invalid");
    }
    for (const id of featurePackIds) {
      const pointer = this.pointers[id];
      if (!pointer) {
        this.emit(id, { state: "not_installed" });
        continue;
      }
      const manifest = this.manifest(id);
      if (
        !manifest ||
        pointer.digest !== manifestDigest(manifest) ||
        pointer.directory !== versionDirectory(manifest)
      ) {
        this.emit(id, { state: "update_available" });
        continue; // Retain untrusted/incompatible old bytes, never execute or mount them.
      }
      try {
        const root = this.installedRoot(id, pointer.directory);
        await this.verify(root, manifest);
        this.active[id] = { root, manifest };
        this.emit(id, {
          state: "installed",
          activeVersion: manifest.version,
          assetVersion: pointer.directory,
        });
      } catch (error) {
        this.emit(id, { state: "failed", error: runtimeErrorCode(error) });
      }
    }
    // A dependent pack is useless without its requirement; keep its files but
    // never mount it alone (for example after the base pack failed verification).
    for (const id of featurePackIds) {
      const current = this.active[id];
      if (
        current &&
        (featurePackRequires[id] ?? []).some(
          (required) => !this.active[required],
        )
      ) {
        delete this.active[id];
        this.emit(id, { state: "failed", error: "pack_dependency_missing" });
      }
    }
  }
  private enqueue(
    id: FeaturePackId,
    operation: (signal: AbortSignal) => Promise<void>,
  ): Promise<void> {
    if (this.closed)
      return Promise.reject(new RuntimeError("runtime_stopping"));
    if (this.pending.has(id))
      return Promise.reject(new RuntimeError("pack_operation_active"));
    const controller = new AbortController();
    this.pending.set(id, controller);
    const result = this.work.then(async () => {
      try {
        controller.signal.throwIfAborted();
        await operation(controller.signal);
      } catch (error) {
        const current = this.active[id];
        this.emit(id, {
          state: "failed",
          error: controller.signal.aborted
            ? "pack_cancelled"
            : runtimeErrorCode(error),
          ...(error instanceof PackInUseError
            ? { blockers: error.blockers }
            : {}),
          ...(current
            ? {
                activeVersion: current.manifest.version,
                assetVersion: versionDirectory(current.manifest),
              }
            : {}),
        });
        throw new RuntimeError(
          controller.signal.aborted
            ? "pack_cancelled"
            : runtimeErrorCode(error),
        );
      } finally {
        this.pending.delete(id);
      }
    });
    this.work = result.catch(() => undefined);
    return result;
  }
  cancel(value: unknown): void {
    this.pending.get(packId(value))?.abort();
  }
  async close(): Promise<void> {
    this.closed = true;
    for (const controller of this.pending.values()) controller.abort();
    await this.work;
  }
  private async change(
    id: FeaturePackId,
    nextPack?: ActivePack,
  ): Promise<void> {
    const previous = { ...this.active };
    const priorPointers = { ...this.pointers };
    const next = { ...this.active };
    const nextPointers = { ...this.pointers };
    if (nextPack) {
      next[id] = nextPack;
      nextPointers[id] = {
        directory: versionDirectory(nextPack.manifest),
        digest: manifestDigest(nextPack.manifest),
      };
    } else {
      delete next[id];
      delete nextPointers[id];
    }
    const persist = async (pointers: Pointers, active: ActivePacks) => {
      atomicWrite(
        this.pointerFile,
        JSON.stringify({ schema: 1, packs: pointers }),
      );
      this.pointers = pointers;
      this.active = active;
    };
    try {
      await this.options.transition({
        id,
        removing: !nextPack,
        previous,
        next,
        commit: () => persist(nextPointers, next),
        rollback: () => persist(priorPointers, previous),
      });
    } catch (error) {
      await persist(priorPointers, previous);
      throw error;
    }
  }
  install(value: unknown): Promise<void> {
    const id = packId(value);
    return this.enqueue(id, async (signal) => {
      const manifest = this.manifest(id);
      if (!manifest) throw new RuntimeError("pack_unpublished");
      // Checked inside the serialized queue, so a concurrent removal cannot race it.
      if (
        (featurePackRequires[id] ?? []).some(
          (required) => !this.active[required],
        )
      )
        throw new RuntimeError("pack_dependency_missing");
      if (
        this.active[id] &&
        manifestDigest(this.active[id]!.manifest) === manifestDigest(manifest)
      ) {
        await this.verify(this.active[id]!.root, manifest);
        this.emit(id, {
          state: "installed",
          activeVersion: manifest.version,
          assetVersion: versionDirectory(manifest),
        });
        return;
      }
      // A version this installation already activated (for example, an encoder
      // left unmounted while its required pack was missing) is reactivated
      // from its verified files instead of being downloaded again.
      const retained = this.pointers[id];
      if (
        retained?.digest === manifestDigest(manifest) &&
        retained.directory === versionDirectory(manifest)
      ) {
        const root = this.installedRoot(id, retained.directory);
        const verified = await this.verify(root, manifest).then(
          () => true,
          () => false,
        );
        if (verified) {
          signal.throwIfAborted();
          this.emit(id, { state: "installing" });
          await this.change(id, { root, manifest });
          this.emit(id, {
            state: "installed",
            activeVersion: manifest.version,
            assetVersion: versionDirectory(manifest),
          });
          return;
        }
      }
      const modelDownloads =
        manifest.schema === "animama-model-pack/1"
          ? modelDownloadDirectory(this.options.downloads, manifest)
          : undefined;
      const retainedBytes =
        modelDownloads && manifest.schema === "animama-model-pack/1"
          ? await prepareModelDownloads(modelDownloads, manifest, signal)
          : 0;
      const free = this.options.freeBytes
        ? await this.options.freeBytes()
        : await statfs(this.options.root, { bigint: true }).then(
            (info) => info.bavail * info.bsize,
          );
      if (free < BigInt(requiredFreeBytes(manifest) - retainedBytes))
        throw new RuntimeError("pack_insufficient_disk");
      const partial = path.join(
        this.options.downloads,
        `${id}.${manifest.version}.partial`,
      );
      const versions = path.join(this.options.root, id, "versions");
      privateDirectory(versions);
      const staging = path.join(versions, `.staging-${randomUUID()}`);
      const destination = this.installedRoot(id, versionDirectory(manifest));
      let lastProgress = 0;
      this.emit(id, { state: "downloading", progress: 0, transferredBytes: 0 });
      try {
        const progress = (bytes: number) => {
          if (
            Date.now() - lastProgress > 100 ||
            bytes === downloadBytes(manifest)
          ) {
            lastProgress = Date.now();
            this.emit(id, {
              state: "downloading",
              transferredBytes: bytes,
              progress: Math.min(1, bytes / downloadBytes(manifest)),
            });
          }
        };
        if (manifest.schema === "animama-model-pack/1") {
          await stageModelFiles({
            directory: modelDownloads!,
            staging,
            manifest,
            signal,
            progress,
          });
        } else {
          await downloadPack({
            manifest,
            partial,
            development: this.options.catalog.development,
            distribution: this.options.catalog.distribution,
            signal,
            progress,
          });
          await extractPack(partial, staging, manifest, signal);
        }
        this.emit(id, { state: "verifying", progress: 1 });
        await (this.options.verifyExecutable ?? verifyExecutablePack)(
          staging,
          manifest,
        );
        signal.throwIfAborted();
        this.emit(id, { state: "installing" });
        const exists = await lstat(destination)
          .then(() => true)
          .catch((error) => {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
            return false;
          });
        let rejected: string | undefined;
        if (exists) {
          try {
            await this.verify(destination, manifest);
          } catch {
            // A failed cold-start verification can be repaired without erasing
            // its evidence or changing any still-active version in place.
            if (this.active[id]?.root === destination)
              throw new RuntimeError("pack_in_use");
            rejected = path.join(versions, `.rejected-${randomUUID()}`);
            await rename(destination, rejected);
          }
        }
        let promoted = false;
        try {
          if (!exists || rejected) {
            await rename(staging, destination);
            promoted = true;
            this.retainedFiles.add(id);
            await syncDirectory(versions);
          } else await rm(staging, { recursive: true });
          // From the pointer switch onwards, finish or roll back the transition;
          // cancellation never strands a half-switched service graph.
          await this.change(id, { root: destination, manifest });
        } catch (error) {
          if (rejected) {
            // Restore even when promotion itself fails, before a pointer switch.
            if (promoted)
              await rm(destination, { recursive: true, force: true });
            await rename(rejected, destination);
            await syncDirectory(versions);
          }
          throw error;
        }
        if (modelDownloads)
          await rm(modelDownloads, { recursive: true, force: true });
        await rm(partial, { force: true });
        await rm(`${partial}.json`, { force: true });
        this.emit(id, {
          state: "installed",
          activeVersion: manifest.version,
          assetVersion: versionDirectory(manifest),
        });
      } finally {
        await rm(staging, { recursive: true, force: true });
      }
    });
  }
  remove(value: unknown): Promise<void> {
    const id = packId(value);
    return this.enqueue(id, async (signal) => {
      signal.throwIfAborted();
      const dependents = featurePackIds.filter(
        (other) =>
          this.active[other] && featurePackRequires[other]?.includes(id),
      );
      if (dependents.length)
        throw new PackInUseError(
          dependents.map((other) => ({
            kind: "feature_pack",
            id: other,
            label: `Remove ${this.active[other]!.manifest.display_name} first`,
          })),
          "pack_dependent_installed",
        );
      this.emit(id, { state: "installing" });
      await this.change(id);
      const versions = path.join(this.options.root, id, "versions");
      try {
        await realDirectory(versions);
        for (const directory of await readdir(versions)) {
          // Retained prior versions are deleted only after the same lease and
          // renderer-quiescence barrier as the active version.
          if (/^\d+\.\d+\.\d+-[a-f0-9]{16}$/u.test(directory))
            await rm(this.installedRoot(id, directory), {
              recursive: true,
              force: true,
            });
          else if (/^\.rejected-[a-f0-9-]{36}$/u.test(directory))
            await rm(path.join(versions, directory), {
              recursive: true,
              force: true,
            });
        }
        await syncDirectory(versions);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          this.retainedFiles.add(id);
          throw new RuntimeError("pack_cleanup_pending");
        }
      }
      try {
        await removeModelDownloads(this.options.downloads, id);
      } catch {
        this.retainedFiles.add(id);
        throw new RuntimeError("pack_cleanup_pending");
      }
      this.retainedFiles.delete(id);
      this.emit(id, { state: "not_installed" });
    });
  }
}
