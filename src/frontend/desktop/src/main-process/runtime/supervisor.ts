import { mkdirSync } from "node:fs";
import { lstat, readdir, statfs } from "node:fs/promises";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import {
  connectionCredentialPattern,
  credentialTarget,
  maxConnectionCredentials,
  type CredentialChange,
  type CredentialStatus,
  type RuntimeStage,
  type RuntimeStatus,
  type FeaturePackStatus,
  type FeaturePackId,
} from "../../../../shared/desktop-runtime.js";
import {
  loadPackCatalog,
  manifestDigest,
  versionDirectory,
} from "../feature-packs/catalog.js";
import type { UpdateCandidate } from "../updates/policy.js";
import {
  FeaturePackManager,
  PackInUseError,
  type ActivePack,
  type ActivePacks,
  type PackTransition,
} from "../feature-packs/manager.js";
import {
  DOCUMENT_EXECUTABLE,
  verifyExecutablePack,
} from "../feature-packs/signature.js";
import { atomicWrite } from "./atomic-file.js";
import { RuntimeError, runtimeErrorCode } from "./errors.js";
import { verifyRuntime, type RuntimeManifest } from "./manifest.js";
import {
  hasDatabaseData,
  readRuntimeState,
  type RuntimePaths,
} from "./paths.js";
import { assertLoopbackPortAvailable, unusedLoopbackPort } from "./ports.js";
import { PrivatePostgres } from "./postgres.js";
import { MigrationBackup } from "./migrations.js";
import {
  readBackendReadiness,
  readDesktopControlJson,
  readTerminalStartupFailure,
} from "./readiness.js";
import { databaseSchemaDigest } from "./schema.js";
import { OwnedProcesses, type OwnedProcess, runCommand } from "./processes.js";
import { runtimeRedactor } from "./redaction.js";
import {
  CredentialVault,
  type Encryption,
  validateCredentialChanges,
} from "./vault.js";

type DatabaseState = {
  postgresql_version: string;
  pgvector_version: string | null;
  alembic_head: string | null;
  installation_principal_id: string | null;
};
export type SupervisorOptions = {
  runtimeRoot: string;
  appVersion: string;
  paths: RuntimePaths;
  encryption: Encryption;
  onStatus(status: RuntimeStatus): void;
  isPackaged?: boolean;
  packCatalogPath?: string;
  onPackProgress?(status: FeaturePackStatus): void;
  quiesceRenderers?(): Promise<void>;
};

/** The backend's private model-mount configuration for one verified active pack. */
function modelMountJson(pack: ActivePack): string {
  return JSON.stringify({
    root: pack.root,
    version: versionDirectory(pack.manifest),
    files: pack.manifest.files.map(
      ({ path, size_bytes, sha256, media_type }) => ({
        path,
        size_bytes,
        sha256,
        media_type,
      }),
    ),
  });
}

/** Own the entire local process graph; never infer authority from a port or PID. */
export class RuntimeSupervisor {
  private current: RuntimeStatus = { state: "starting", stage: "validating" };
  private applicationOrigin?: URL;
  private applicationPort?: number;
  private owned?: OwnedProcesses;
  private postgres?: PrivatePostgres;
  private backend?: OwnedProcess;
  private cleanupWorker?: OwnedProcess;
  private documentWorker?: OwnedProcess;
  private packs?: FeaturePackManager;
  private activePacks: ActivePacks = {};
  private backendOrigin?: URL;
  private renderersQuiesced = false;
  private documentInstance = randomUUID();
  private vault?: CredentialVault;
  // Main owns these bounded status entries (providers, the vault's connection
  // keys and at most 32 unsaved connection failures); product windows can be
  // replaced.
  private credentialFailures = new Map<
    string,
    { error: string; saved: boolean }
  >();
  private manifest?: RuntimeManifest;
  private migrationBackup?: MigrationBackup;
  private readonly launchId = randomUUID();
  private databaseEnv: NodeJS.ProcessEnv = {};
  private work: Promise<unknown> = Promise.resolve();
  private shutdownRequested = false;
  private updatePending = false;
  private expectedBackendExit = false;
  private expectedPostgresExit = false;
  private readonly controlToken = randomBytes(32).toString("hex");
  /** Orders credential deliveries; each backend accepts only newer generations. */
  private credentialGeneration = 0;
  private documentWorkerRestartQueued = false;
  readonly rendererCapability = randomBytes(32).toString("hex");
  constructor(private options: SupervisorOptions) {
    runtimeRedactor.add(this.controlToken, this.rendererCapability);
  }
  status(): RuntimeStatus {
    return { ...this.current };
  }
  get origin(): string | null {
    return this.applicationOrigin?.origin ?? null;
  }
  private setStatus(state: RuntimeStatus): void {
    this.current = state;
    this.options.onStatus(this.status());
  }
  private stage(stage: RuntimeStage): void {
    if (this.shutdownRequested) throw new RuntimeError("runtime_stopping");
    this.setStatus({ state: "starting", stage });
  }
  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.work.then(operation, operation);
    this.work = next.catch(() => undefined);
    return next;
  }
  private executable(): string {
    return path.join(this.options.runtimeRoot, "backend/animama-runtime");
  }
  private environment(): NodeJS.ProcessEnv {
    if (!this.vault || !this.manifest)
      throw new RuntimeError("runtime_not_initialized");
    const providerEnv = this.vault.childEnvironment();
    runtimeRedactor.add(
      this.vault.databasePassword(),
      ...Object.values(providerEnv),
    );
    return {
      ...this.databaseEnv,
      ...providerEnv,
      ANIMAMA_DATABASE_URL: `postgresql+asyncpg://animama:${this.vault.databasePassword()}@127.0.0.1:${this.postgres!.port}/animama`,
      ANIMAMA_DESKTOP_PGDATA: this.options.paths.pgData,
      ANIMAMA_CONTENT_ROOT: this.options.paths.content,
      ANIMAMA_LOCAL_CONTENT_ROOT: this.options.paths.localContent,
      ANIMAMA_DATA_ROOT: this.options.paths.data,
      ANIMAMA_INCLUDED_CONTENT_SOURCES_JSON: JSON.stringify([
        {
          id: "core",
          version: this.manifest.build_id,
          pack_id: null,
          root: path.join(this.options.runtimeRoot, "content/included-core"),
        },
        ...(this.activePacks["expanded-included-content"]
          ? [
              {
                id: "expanded",
                pack_id: "expanded-included-content",
                version: versionDirectory(
                  this.activePacks["expanded-included-content"].manifest,
                ),
                root: this.activePacks["expanded-included-content"].root,
              },
            ]
          : []),
      ]),
      ANIMAMA_USER_FILE_PROCESSING_ENABLED: this.activePacks[
        "document-processing"
      ]
        ? "1"
        : "0",
      ANIMAMA_PARAKEET_STT_ENABLED: this.activePacks["parakeet-stt"]
        ? "1"
        : "0",
      ...(this.activePacks["parakeet-stt"]
        ? {
            ANIMAMA_PARAKEET_ASSET_VERSION: versionDirectory(
              this.activePacks["parakeet-stt"].manifest,
            ),
          }
        : {}),
      ...(this.activePacks["parakeet-stt-webgpu"]
        ? {
            ANIMAMA_PARAKEET_WEBGPU_ASSET_VERSION: versionDirectory(
              this.activePacks["parakeet-stt-webgpu"].manifest,
            ),
          }
        : {}),
      ANIMAMA_DOCUMENT_WORKER_INSTANCE_ID: this.documentInstance,
      ...(this.activePacks["document-processing"]
        ? {
            ANIMAMA_DOCUMENT_PACK_VERSION: versionDirectory(
              this.activePacks["document-processing"].manifest,
            ),
          }
        : {}),
      ANIMAMA_DESKTOP_BUILD_ID: this.manifest.build_id,
      ANIMAMA_DESKTOP_APP_VERSION: this.options.appVersion,
      ANIMAMA_LOCAL_BIND_HOST: "127.0.0.1",
      ANIMAMA_LOG_TO_FILE: "0",
      ANIMAMA_LOG_TO_CONSOLE: "1",
      ANIMAMA_DISABLE_WEBUI_TELEMETRY: "1",
      OTEL_SDK_DISABLED: "true",
      PYTHONUNBUFFERED: "1",
    };
  }
  /** Children that never call a provider get no saved key. */
  private environmentWithoutCredentials(): NodeJS.ProcessEnv {
    const env = this.environment();
    for (const key of Object.keys(this.vault!.childEnvironment()))
      delete env[key];
    return env;
  }
  /** HTTP capabilities belong only to the owned HTTP child, never workers or database commands. */
  private backendEnvironment(): NodeJS.ProcessEnv {
    if (!this.applicationOrigin)
      throw new RuntimeError("runtime_not_initialized");
    const parakeet = this.activePacks["parakeet-stt"];
    // The pack manager never activates the encoder without the base pack.
    const webgpu = this.activePacks["parakeet-stt-webgpu"];
    return {
      ...this.environment(),
      ANIMAMA_PUBLIC_ORIGIN: this.applicationOrigin.origin,
      ANIMAMA_WEB_ROOT: path.join(this.options.runtimeRoot, "web"),
      ANIMAMA_DESKTOP_RENDERER_CAPABILITY: this.rendererCapability,
      ANIMAMA_DESKTOP_CONTROL_TOKEN: this.controlToken,
      ...(parakeet
        ? { ANIMAMA_PARAKEET_MODEL_MOUNT_JSON: modelMountJson(parakeet) }
        : {}),
      ...(webgpu
        ? { ANIMAMA_PARAKEET_WEBGPU_MODEL_MOUNT_JSON: modelMountJson(webgpu) }
        : {}),
    };
  }
  private async databaseCommand(operation: string): Promise<DatabaseState> {
    const text = await runCommand(
      this.executable(),
      ["database", operation],
      this.environmentWithoutCredentials(),
      this.options.paths.base,
    );
    try {
      const result = JSON.parse(text);
      if (result.schema_version !== 1) throw new Error();
      if (
        operation !== "provision" &&
        (typeof result.postgresql_version !== "string" ||
          !result.postgresql_version.startsWith("16.") ||
          !(
            result.alembic_head === null ||
            (typeof result.alembic_head === "string" &&
              /^[\w-]{1,128}$/u.test(result.alembic_head))
          ) ||
          !(
            result.pgvector_version === null ||
            (typeof result.pgvector_version === "string" &&
              /^\d+\.\d+\.\d+$/u.test(result.pgvector_version))
          ) ||
          !(
            result.installation_principal_id === null ||
            (typeof result.installation_principal_id === "string" &&
              /^[a-zA-Z0-9-]{1,128}$/u.test(result.installation_principal_id))
          ))
      )
        throw new Error();
      return result as DatabaseState;
    } catch {
      throw new RuntimeError("database_report_invalid");
    }
  }
  /** Retry serializes with provider changes; initialized data is never reset. */
  start(): Promise<void> {
    return this.serialize(async () => {
      if (this.current.state === "ready" || this.shutdownRequested) return;
      try {
        await this.stopServices();
        this.stage("validating");
        this.manifest = await verifyRuntime(
          this.options.runtimeRoot,
          this.options.appVersion,
        );
        if (!this.packs) {
          const catalog = await loadPackCatalog({
            runtimeRoot: this.options.runtimeRoot,
            appVersion: this.options.appVersion,
            isPackaged: this.options.isPackaged !== false,
            fixturePath: this.options.packCatalogPath,
          });
          const packs = new FeaturePackManager({
            root: this.options.paths.packs,
            downloads: this.options.paths.downloads,
            catalog,
            onProgress: (status) => this.options.onPackProgress?.(status),
            transition: (change) => this.transitionPack(change),
          });
          await packs.initialize();
          this.packs = packs;
        }
        this.activePacks = this.packs.activePacks();
        mkdirSync(this.options.paths.base, { recursive: true, mode: 0o700 });
        this.stage("vault");
        this.vault ??= new CredentialVault(
          this.options.paths.vault,
          this.options.encryption,
          hasDatabaseData(this.options.paths),
        );
        runtimeRedactor.add(
          this.vault.databasePassword(),
          ...Object.values(this.vault.childEnvironment()),
        );
        this.owned ??= new OwnedProcesses(this.options.paths.processes);
        this.stage("application");
        {
          const saved = readRuntimeState(this.options.paths.state);
          const port =
            this.applicationPort ??
            saved?.gatewayPort ??
            (await unusedLoopbackPort());
          try {
            await assertLoopbackPortAvailable(port);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "EADDRINUSE")
              throw new RuntimeError("gateway_port_in_use");
            throw error;
          }
          this.applicationOrigin = new URL(`http://127.0.0.1:${port}`);
          this.applicationPort = port;
          if (!saved)
            atomicWrite(
              this.options.paths.state,
              JSON.stringify({
                version: 1,
                gatewayPort: port,
              }),
            );
        }
        this.stage("database");
        this.postgres = new PrivatePostgres(
          this.options.runtimeRoot,
          this.options.paths,
          this.owned,
        );
        this.databaseEnv = await this.postgres.start(
          this.vault.databasePassword(),
        );
        this.expectedPostgresExit = false;
        const postgresChild = this.postgres.process!;
        void postgresChild.exit.then(() => {
          if (
            !this.expectedPostgresExit &&
            !this.shutdownRequested &&
            this.postgres?.process === postgresChild
          ) {
            this.setStatus({ state: "error", code: "postgres_exited" });
            void this.serialize(() => this.stopServices()).catch(
              () => undefined,
            );
          }
        });
        this.stage("migrations");
        await this.databaseCommand("provision");
        const before = await this.databaseCommand("inspect");
        const backup = new MigrationBackup(
          this.options.paths,
          (name) => this.postgres!.bin(name),
          this.databaseEnv,
        );
        this.migrationBackup = backup;
        if (
          before.alembic_head &&
          before.alembic_head !== this.manifest.alembic_head
        )
          await backup.prepare(before.alembic_head, this.manifest.alembic_head);
        // Check a current-revision profile before seeds run, so a seed that no
        // longer fits its schema cannot mask the mismatch as a migration failure.
        const current = before.alembic_head === this.manifest.alembic_head;
        if (current) await this.verifyDatabaseSchema(backup);
        let database: DatabaseState;
        try {
          database = await this.databaseCommand("bootstrap");
        } catch {
          backup.failed();
          throw new RuntimeError("migration_failed");
        }
        if (
          database.alembic_head !== this.manifest.alembic_head ||
          database.pgvector_version !== this.manifest.postgresql.pgvector ||
          !database.installation_principal_id
        ) {
          backup.failed();
          throw new RuntimeError("database_version_mismatch");
        }
        if (!current) await this.verifyDatabaseSchema(backup);
        backup.complete(database.alembic_head);
        this.stage("backend");
        this.cleanupWorker = this.owned.launch(
          "avatar-cleanup",
          this.executable(),
          ["worker", "avatar-cleanup"],
          this.environmentWithoutCredentials(),
          this.options.paths.base,
        );
        const cleanup = this.cleanupWorker;
        void cleanup.exit.then(() => {
          if (
            !this.expectedPostgresExit &&
            !this.shutdownRequested &&
            this.cleanupWorker === cleanup
          ) {
            this.setStatus({ state: "error", code: "cleanup_worker_exited" });
            void this.serialize(() => this.stopServices()).catch(
              () => undefined,
            );
          }
        });
        await this.startDocumentWorker();
        await this.startBackend(database.installation_principal_id);
        backup.successfulLaunch(database.alembic_head!, this.launchId);
      } catch (error) {
        await this.stopServices().catch(() => undefined);
        if (!this.shutdownRequested) {
          let backup: string | undefined;
          try {
            backup = this.migrationBackup?.recoveryLocation();
          } catch {
            /* Invalid metadata is not UI authority. */
          }
          this.setStatus({
            state: "error",
            code: runtimeErrorCode(error),
            ...(backup ? { backup } : {}),
          });
        }
      }
    });
  }
  /**
   * A development baseline edited in place keeps its Alembic head, so compare
   * the live schema with the staged fresh database before any service uses it.
   */
  private async verifyDatabaseSchema(backup: MigrationBackup): Promise<void> {
    const digest = await databaseSchemaDigest(
      this.postgres!.bin("pg_dump"),
      this.databaseEnv,
      this.options.paths.base,
    );
    if (digest !== this.manifest!.database_schema_sha256) {
      backup.failed();
      throw new RuntimeError("database_schema_mismatch");
    }
  }
  private async startBackend(principalId: string): Promise<void> {
    const origin = this.applicationOrigin!;
    const port = this.applicationPort!;
    const manifest = this.manifest!;
    const owned = this.owned!;
    try {
      await assertLoopbackPortAvailable(port);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EADDRINUSE")
        throw new RuntimeError("gateway_port_in_use");
      throw error;
    }
    this.expectedBackendExit = false;
    const child = owned.launch(
      "fastapi",
      this.executable(),
      ["serve", "--host", "127.0.0.1", "--port", String(port)],
      this.backendEnvironment(),
      this.options.paths.base,
    );
    this.backend = child;
    const deadline = Date.now() + 90_000;
    let ready = false;
    while (
      !this.shutdownRequested &&
      owned.children.has(child) &&
      Date.now() < deadline
    ) {
      try {
        const response = await fetch(new URL("/_desktop/health", origin), {
          headers: { "X-Animama-Desktop-Control": this.controlToken },
          redirect: "error",
          signal: AbortSignal.timeout(1500),
        });
        if (response.ok) {
          const health = await readBackendReadiness(response);
          if (
            health.schema_version !== 1 ||
            health.local_http_schema_version !==
              manifest.local_http_schema_version ||
            health.runtime_version !== this.options.appVersion ||
            health.build_id !== manifest.build_id ||
            health.alembic_head !== manifest.alembic_head ||
            health.installation_principal_id !== principalId ||
            health.process_id !== child.child.pid ||
            health.process_start_token !== child.token
          )
            throw new RuntimeError("backend_readiness_mismatch");
          ready = true;
          break;
        }
        const failure = await readTerminalStartupFailure(response);
        if (failure) throw new RuntimeError(failure);
      } catch (error) {
        if (error instanceof RuntimeError) throw error;
      }
      // Keep verified readiness responsive without changing the bounded startup deadline.
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!ready) {
      const collision = /address already in use/iu.test(child.output);
      await owned.terminate(child);
      throw new RuntimeError(
        collision ? "gateway_port_in_use" : "backend_start_failed",
      );
    }
    if (
      !owned.children.has(child) ||
      !this.postgres?.process ||
      !owned.children.has(this.postgres.process) ||
      !this.cleanupWorker ||
      !owned.children.has(this.cleanupWorker) ||
      (this.activePacks["document-processing"] &&
        (!this.documentWorker || !owned.children.has(this.documentWorker)))
    )
      throw new RuntimeError("backend_start_failed");
    this.backendOrigin = new URL(origin);
    if (this.shutdownRequested) throw new RuntimeError("runtime_stopping");
    // A successful restart consumes every value saved in the vault.
    // An unapplied busy change must still be reported to the replacement window.
    for (const [target, failure] of this.credentialFailures)
      if (failure.saved) this.credentialFailures.delete(target);
    this.renderersQuiesced = false;
    this.setStatus({ state: "ready", origin: origin.origin });
    void child.exit.then(() => {
      if (
        !this.expectedBackendExit &&
        !this.shutdownRequested &&
        this.backend === child
      ) {
        this.setStatus({ state: "error", code: "backend_exited" });
        // A queued operation may already have replaced this child (a credential
        // fallback restart does); never stop its successor.
        void this.serialize(async () => {
          if (this.backend === child) await this.stopServices();
        }).catch(() => undefined);
      }
    });
  }
  /** One renderer teardown owns each transition until a new ready runtime is exposed. */
  private async quiesceRenderers(): Promise<void> {
    if (this.renderersQuiesced) return;
    await this.options.quiesceRenderers?.();
    this.renderersQuiesced = true;
  }
  /** Close new product admission before a pointer, provider or native-app transition. */
  private async quiesceBackend(): Promise<void> {
    if (
      !this.backendOrigin ||
      !this.backend ||
      !this.owned?.children.has(this.backend)
    )
      throw new RuntimeError("runtime_not_ready");
    let response: Response;
    try {
      response = await fetch(
        new URL("/_desktop/runtime:quiesce", this.backendOrigin),
        {
          method: "POST",
          headers: { "X-Animama-Desktop-Control": this.controlToken },
          redirect: "error",
          signal: AbortSignal.timeout(16_500),
        },
      );
    } catch {
      throw new RuntimeError("runtime_quiesce_failed");
    }
    const result = (await readDesktopControlJson(response)) as {
      schema_version?: unknown;
      state?: unknown;
      detail?: { code?: unknown };
    };
    if (response.status === 409 && result.detail?.code === "runtime_busy")
      throw new RuntimeError("runtime_busy");
    if (
      !response.ok ||
      result.schema_version !== 1 ||
      result.state !== "quiesced"
    )
      throw new RuntimeError("runtime_quiesce_failed");
  }
  /** Reopen admission only by restarting the exact old configuration, never a resume endpoint. */
  private async restartConsumers(): Promise<void> {
    this.expectedBackendExit = true;
    await this.quiesceRenderers();
    await this.stopDocumentWorker();
    if (this.backend) await this.owned!.terminate(this.backend);
    this.backend = undefined;
    this.backendOrigin = undefined;
    const database = await this.databaseCommand("inspect");
    if (!database.installation_principal_id)
      throw new RuntimeError("installation_principal_missing");
    await this.startDocumentWorker();
    await this.startBackend(database.installation_principal_id);
  }
  credentials(): CredentialStatus[] {
    const restartRequired = this.current.state !== "ready";
    const statuses = (this.vault?.list() ?? []).map((status) => {
      const failure = this.credentialFailures.get(credentialTarget(status));
      return failure
        ? { ...status, error: failure.error, restartRequired }
        : status;
    });
    // A connection key that failed before it was saved has no vault entry.
    const listed = new Set(statuses.map(credentialTarget));
    for (const [target, failure] of this.credentialFailures)
      if (!listed.has(target) && connectionCredentialPattern.test(target))
        statuses.push({
          connection: target,
          configured: false,
          updatedAt: null,
          restartRequired,
          error: failure.error,
        });
    return statuses;
  }
  featurePacks(): FeaturePackManager {
    if (!this.packs) throw new RuntimeError("runtime_not_ready");
    return this.packs;
  }
  /** Keep update quiescence and pack mutation mutually exclusive at the IPC boundary. */
  changePack(
    action: "install" | "remove" | "cancel",
    id: FeaturePackId,
  ): Promise<void> | void {
    if (this.updatePending || this.current.state !== "ready")
      throw new RuntimeError("runtime_not_ready");
    return this.featurePacks()[action](id);
  }
  /** PGDATA is private and bounded by actual filesystem entries, not a renderer estimate. */
  async updateDisk(): Promise<{ free: bigint; databaseBytes: number }> {
    const disk = await statfs(this.options.paths.base, { bigint: true });
    let databaseBytes = 0;
    let entries = 0;
    const walk = async (directory: string): Promise<void> => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (++entries > 250_000 || entry.isSymbolicLink())
          throw new RuntimeError("update_disk_estimate_failed");
        const name = path.join(directory, entry.name);
        if (entry.isDirectory()) await walk(name);
        else if (entry.isFile()) databaseBytes += (await lstat(name)).size;
        else throw new RuntimeError("update_disk_estimate_failed");
      }
    };
    await walk(this.options.paths.pgData);
    return { free: disk.bavail * disk.bsize, databaseBytes };
  }
  private async checkUpdatePacks(candidate: UpdateCandidate): Promise<void> {
    if (this.current.state !== "ready" && !this.updatePending)
      throw new RuntimeError("runtime_not_ready");
    if (this.packs?.isBusy())
      throw new RuntimeError("update_pack_operation_active");
    const expanded = this.activePacks["expanded-included-content"];
    if (
      expanded &&
      (candidate.packDigests["expanded-included-content"] !==
        manifestDigest(expanded.manifest) ||
        !expanded.manifest.app_versions.includes(candidate.version))
    ) {
      try {
        await this.requirePackRemovable("expanded-included-content");
      } catch (error) {
        if (error instanceof PackInUseError)
          throw new RuntimeError("update_pack_references_blocked");
        throw error;
      }
    }
    // Never interrupt an actively leased document job to install an app update.
    if (this.activePacks["document-processing"])
      await this.requirePackRemovable("document-processing");
  }
  preflightUpdate(candidate: UpdateCandidate): Promise<void> {
    return this.serialize(() => this.checkUpdatePacks(candidate));
  }
  /** Repeat preflight after request/renderer drain, then stop exact children before Squirrel runs. */
  async stopForUpdate(candidate: UpdateCandidate): Promise<void> {
    await this.serialize(async () => {
      if (this.shutdownRequested || this.current.state !== "ready")
        throw new RuntimeError("runtime_not_ready");
      await this.checkUpdatePacks(candidate);
      this.updatePending = true;
      this.stage("backend");
      try {
        await this.quiesceBackend();
        await this.quiesceRenderers();
        await this.stopDocumentWorker();
        await this.checkUpdatePacks(candidate);
      } catch (error) {
        this.updatePending = false;
        try {
          await this.restartConsumers();
        } catch (recoveryError) {
          await this.stopServices().catch(() => undefined);
          this.setStatus({
            state: "error",
            code: runtimeErrorCode(recoveryError),
          });
        }
        throw error;
      }
      this.shutdownRequested = true;
      this.setStatus({ state: "stopping" });
      try {
        await this.stopServices();
        this.setStatus({ state: "updating" });
      } catch {
        this.setStatus({ state: "error", code: "owned_services_stop_failed" });
        throw new RuntimeError("owned_services_stop_failed");
      }
    });
    await this.packs?.close();
  }
  /** An explicit native verification failure can resume the unchanged old application. */
  async recoverFailedUpdate(): Promise<void> {
    if (!this.updatePending || this.owned?.children.size)
      throw new RuntimeError("owned_services_stop_failed");
    this.packs = undefined;
    this.activePacks = {};
    this.updatePending = false;
    this.shutdownRequested = false;
    await this.start();
  }
  /**
   * Signature verification is repeated at every launch, including provider
   * restarts. A worker-only restart keeps the instance id the running FastAPI
   * was started with, so its readiness check still recognises the worker.
   */
  private async startDocumentWorker(renewInstance = true): Promise<void> {
    const pack = this.activePacks["document-processing"];
    if (!pack) return;
    await verifyExecutablePack(pack.root, pack.manifest);
    if (renewInstance) this.documentInstance = randomUUID();
    const executable = path.join(pack.root, DOCUMENT_EXECUTABLE);
    const expected = pack.manifest.files.find(
      (file) => file.path === DOCUMENT_EXECUTABLE,
    )!;
    const env = this.environment();
    env.ANIMAMA_DOCUMENT_WORKER_EXECUTABLE = executable;
    env.ANIMAMA_DOCUMENT_WORKER_ROOT = pack.root;
    env.ANIMAMA_DOCUMENT_WORKER_EXECUTABLE_SHA256 = expected.sha256;
    this.documentWorker = this.owned!.launch(
      "document-worker",
      this.executable(),
      ["worker", "user-files"],
      env,
      this.options.paths.base,
    );
    const child = this.documentWorker;
    void child.exit.then(() => {
      if (!this.shutdownRequested && this.documentWorker === child) {
        this.setStatus({ state: "error", code: "document_worker_exited" });
        void this.serialize(() => this.stopServices()).catch(() => undefined);
      }
    });
  }
  private async stopDocumentWorker(): Promise<void> {
    const child = this.documentWorker;
    this.documentWorker = undefined;
    if (child) await this.owned!.terminate(child);
  }
  private async requirePackRemovable(id: FeaturePackId): Promise<void> {
    if (!this.backendOrigin) throw new RuntimeError("runtime_not_ready");
    const response = await fetch(
      new URL(
        `/_desktop/feature-packs/${id}:removal-check`,
        this.backendOrigin,
      ),
      {
        method: "POST",
        headers: { "X-Animama-Desktop-Control": this.controlToken },
        redirect: "error",
        signal: AbortSignal.timeout(5000),
      },
    );
    if (!response.ok) {
      await response.body?.cancel();
      throw new RuntimeError("pack_removal_check_failed");
    }
    const result = (await readDesktopControlJson(
      response,
      16 * 1024,
    )) as Record<string, unknown>;
    if (
      result.schema_version !== 1 ||
      result.pack_id !== id ||
      typeof result.removable !== "boolean" ||
      !Array.isArray(result.blockers) ||
      result.blockers.length > 32
    )
      throw new RuntimeError("pack_removal_check_failed");
    const blockers = result.blockers.map((value: unknown) => {
      const blocker = value as { kind: string; id: string; label: string };
      if (
        !blocker ||
        ![
          "anima_loadout",
          "runtime_lease",
          "preview_lease",
          "content_operation",
          "document_job",
        ].includes(blocker.kind) ||
        typeof blocker.id !== "string" ||
        blocker.id.length > 128 ||
        typeof blocker.label !== "string" ||
        blocker.label.length > 120 ||
        /[\x00-\x1f\x7f]/u.test(blocker.label)
      )
        throw new RuntimeError("pack_removal_check_failed");
      return { kind: blocker.kind, id: blocker.id, label: blocker.label };
    });
    if (!result.removable || blockers.length)
      throw new PackInUseError(blockers);
  }
  /** Drain users of the old bytes, then commit the pointer and restart or roll back. */
  private transitionPack(change: PackTransition): Promise<void> {
    return this.serialize(async () => {
      if (this.current.state !== "ready" || this.shutdownRequested)
        throw new RuntimeError("runtime_not_ready");
      await this.requirePackRemovable(change.id);
      this.stage("backend");
      let commitAttempted = false;
      try {
        await this.quiesceBackend();
        await this.quiesceRenderers();
        await this.stopDocumentWorker();
        // Recheck after stopping the worker: a job could have been claimed
        // between the first preflight and the graceful stop.
        await this.requirePackRemovable(change.id);
        this.expectedBackendExit = true;
        if (this.backend) await this.owned!.terminate(this.backend);
        this.backend = undefined;
        this.backendOrigin = undefined;
        commitAttempted = true;
        await change.commit();
        this.activePacks = change.next;
        const database = await this.databaseCommand("inspect");
        if (!database.installation_principal_id)
          throw new RuntimeError("installation_principal_missing");
        await this.startDocumentWorker();
        await this.startBackend(database.installation_principal_id);
      } catch (error) {
        try {
          this.expectedBackendExit = true;
          await this.quiesceRenderers();
          await this.stopDocumentWorker();
          if (this.backend) await this.owned!.terminate(this.backend);
          this.backend = undefined;
          this.backendOrigin = undefined;
          if (commitAttempted) await change.rollback();
          this.activePacks = change.previous;
          const database = await this.databaseCommand("inspect");
          if (!database.installation_principal_id)
            throw new RuntimeError("installation_principal_missing");
          await this.startDocumentWorker();
          await this.startBackend(database.installation_principal_id);
        } catch (recoveryError) {
          await this.stopServices().catch(() => undefined);
          this.setStatus({
            state: "error",
            code: runtimeErrorCode(recoveryError),
          });
        }
        throw error;
      }
    });
  }
  /**
   * Save or remove several provider or connection keys, then apply them to the
   * running backend without restarting it or touching any window. The vault
   * write is all-or-nothing; the backend receives the whole saved set.
   * If delivery fails twice, the backend restarts from the vault so it never
   * keeps a key the vault no longer has.
   */
  changeCredentials(changes: unknown): Promise<CredentialStatus[]> {
    const batch = validateCredentialChanges(changes);
    for (const change of batch)
      if (change.value) runtimeRedactor.add(change.value);
    return this.serialize(async () => {
      if (!this.vault || this.current.state !== "ready")
        throw new RuntimeError("runtime_not_ready");
      for (const change of batch)
        this.credentialFailures.delete(credentialTarget(change));
      try {
        // One encrypted write: either every change is saved or none is.
        this.vault.apply(batch);
      } catch (error) {
        // Nothing was saved, so the running backend already matches the vault.
        this.recordCredentialFailures(batch, runtimeErrorCode(error), false);
        return this.credentials();
      }
      try {
        await this.deliverCredentials();
      } catch {
        try {
          await this.deliverCredentials();
        } catch {
          await this.restartForSavedCredentials(batch);
          return this.credentials();
        }
      }
      this.queueDocumentWorkerRestart();
      return this.credentials();
    });
  }
  /**
   * Send the vault's complete key set to the running backend. The generation
   * lets the backend refuse a delayed older delivery. Errors carry only a code.
   */
  private async deliverCredentials(): Promise<void> {
    if (
      !this.vault ||
      !this.backendOrigin ||
      !this.backend ||
      !this.owned?.children.has(this.backend)
    )
      throw new RuntimeError("runtime_not_ready");
    const credentials = this.vault.childEnvironment();
    runtimeRedactor.add(...Object.values(credentials));
    const generation = ++this.credentialGeneration;
    let response: Response;
    let result: { schema_version?: unknown; generation?: unknown };
    try {
      response = await fetch(
        new URL("/_desktop/credentials", this.backendOrigin),
        {
          method: "PUT",
          headers: {
            "X-Animama-Desktop-Control": this.controlToken,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ schema_version: 1, generation, credentials }),
          redirect: "error",
          signal: AbortSignal.timeout(5000),
        },
      );
      result = (await readDesktopControlJson(response)) as typeof result;
    } catch {
      throw new RuntimeError("credential_delivery_failed");
    }
    if (
      !response.ok ||
      result.schema_version !== 1 ||
      result.generation !== generation
    )
      throw new RuntimeError("credential_delivery_failed");
  }
  /**
   * The running backend may hold keys that differ from the vault: restart it
   * from the vault. A busy drain still restarts, because quiesce never reopens
   * admission. A failed restart enters recovery, whose Retry uses the vault.
   */
  private async restartForSavedCredentials(
    batch: ReadonlyArray<CredentialChange>,
  ): Promise<void> {
    this.stage("backend");
    try {
      await this.quiesceBackend();
    } catch {
      // Busy or unreachable: the restart below replaces this backend anyway.
    }
    try {
      await this.restartConsumers();
    } catch (error) {
      // Record before recovery: the calling window no longer exists.
      this.recordCredentialFailures(batch, runtimeErrorCode(error), true);
      await this.stopServices().catch(() => undefined);
      this.setStatus({ state: "error", code: runtimeErrorCode(error) });
    }
  }
  /**
   * The document worker embeds with saved keys from its environment, so it
   * restarts after a delivery. Queued behind the save and coalesced.
   */
  private queueDocumentWorkerRestart(): void {
    if (
      !this.activePacks["document-processing"] ||
      this.documentWorkerRestartQueued
    )
      return;
    this.documentWorkerRestartQueued = true;
    void this.serialize(async () => {
      this.documentWorkerRestartQueued = false;
      // Transitions and shutdown that ran first have already stopped it.
      if (!this.documentWorker || this.shutdownRequested) return;
      await this.stopDocumentWorker();
      await this.startDocumentWorker(false);
    }).catch((error) => {
      this.setStatus({ state: "error", code: runtimeErrorCode(error) });
      void this.serialize(() => this.stopServices()).catch(() => undefined);
    });
  }
  /**
   * Remember a batch's failure for the replacement window. Failures for
   * connection keys that were never saved are capped, oldest first.
   */
  private recordCredentialFailures(
    batch: ReadonlyArray<CredentialChange>,
    error: string,
    saved: boolean,
  ): void {
    for (const change of batch)
      this.credentialFailures.set(credentialTarget(change), { error, saved });
    const stored = new Set(
      (this.vault?.list() ?? []).map((status) => credentialTarget(status)),
    );
    const unsaved = [...this.credentialFailures.keys()].filter(
      (target) =>
        !stored.has(target) && connectionCredentialPattern.test(target),
    );
    for (const target of unsaved.slice(
      0,
      Math.max(0, unsaved.length - maxConnectionCredentials),
    ))
      this.credentialFailures.delete(target);
  }
  private async stopServices(): Promise<void> {
    this.expectedBackendExit = true;
    this.expectedPostgresExit = true;
    let failed = false;
    const stop = async (operation: () => Promise<unknown> | undefined) => {
      try {
        await operation();
      } catch {
        failed = true;
      }
    };
    if (this.backend) await stop(() => this.quiesceRenderers());
    await stop(() =>
      this.backend ? this.owned?.terminate(this.backend) : undefined,
    );
    this.backend = undefined;
    this.backendOrigin = undefined;
    await stop(() => this.stopDocumentWorker());
    await stop(() =>
      this.cleanupWorker
        ? this.owned?.terminate(this.cleanupWorker)
        : undefined,
    );
    this.cleanupWorker = undefined;
    await stop(() => this.postgres?.stop());
    this.postgres = undefined;
    // This also covers a child spawned immediately before ownership-record IO failed.
    await stop(() => this.owned?.terminateAll());
    if (failed) throw new RuntimeError("owned_services_stop_failed");
  }
  stop(): Promise<void> {
    this.shutdownRequested = true;
    const packsClosed = this.packs?.close() ?? Promise.resolve();
    // Do not await the manager inside the supervisor queue: its last pointer
    // transition may itself be waiting for that queue.
    return packsClosed.then(() =>
      this.serialize(async () => {
        this.setStatus({ state: "stopping" });
        try {
          // Quit retains a bounded graceful path even if quiescence reports
          // busy or a child has already crashed. It never signals a port owner.
          if (this.backendOrigin)
            await this.quiesceBackend().catch(() => undefined);
          await this.stopServices();
        } finally {
          this.setStatus({ state: "stopped" });
        }
      }),
    );
  }
}
