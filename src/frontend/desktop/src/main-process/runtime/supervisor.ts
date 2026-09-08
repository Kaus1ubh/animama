import { mkdirSync } from "node:fs";
import { lstat, readdir, statfs } from "node:fs/promises";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import {
  createFrontendGateway,
  type FrontendGateway,
} from "animama-frontend-server/gateway";
import type {
  CredentialProvider,
  CredentialStatus,
  RuntimeStage,
  RuntimeStatus,
  FeaturePackStatus,
  FeaturePackId,
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
import { unusedLoopbackPort } from "./ports.js";
import { PrivatePostgres } from "./postgres.js";
import { MigrationBackup } from "./migrations.js";
import { readBackendReadiness, readDesktopControlJson } from "./readiness.js";
import { OwnedProcesses, type OwnedProcess, runCommand } from "./processes.js";
import { runtimeRedactor } from "./redaction.js";
import {
  CredentialVault,
  type Encryption,
  validateCredential,
  validateProvider,
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
  bootstrapHtml(): string;
  onStatus(status: RuntimeStatus): void;
  isPackaged?: boolean;
  packCatalogPath?: string;
  onPackProgress?(status: FeaturePackStatus): void;
  quiesceRenderers?(): Promise<void>;
};

/** Own the entire local process graph; never infer authority from a port or PID. */
export class RuntimeSupervisor {
  private current: RuntimeStatus = { state: "starting", stage: "validating" };
  private gateway?: FrontendGateway;
  private owned?: OwnedProcesses;
  private postgres?: PrivatePostgres;
  private backend?: OwnedProcess;
  private cleanupWorker?: OwnedProcess;
  private documentWorker?: OwnedProcess;
  private packs?: FeaturePackManager;
  private activePacks: ActivePacks = {};
  private backendOrigin?: URL;
  private documentInstance = randomUUID();
  private vault?: CredentialVault;
  private manifest?: RuntimeManifest;
  private migrationBackup?: MigrationBackup;
  private readonly launchId = randomUUID();
  private databaseEnv: NodeJS.ProcessEnv = {};
  private work: Promise<unknown> = Promise.resolve();
  private shutdownRequested = false;
  private updatePending = false;
  private expectedBackendExit = false;
  private expectedPostgresExit = false;
  private readonly gatewayToken = randomBytes(32).toString("hex");
  private readonly controlToken = randomBytes(32).toString("hex");
  readonly rendererCapability = randomBytes(32).toString("hex");
  constructor(private options: SupervisorOptions) {
    runtimeRedactor.add(
      this.gatewayToken,
      this.controlToken,
      this.rendererCapability,
    );
  }
  status(): RuntimeStatus {
    return { ...this.current };
  }
  get origin(): string | null {
    return this.gateway?.origin.origin ?? null;
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
      ANIMAMA_DOCUMENT_WORKER_INSTANCE_ID: this.documentInstance,
      ...(this.activePacks["document-processing"]
        ? {
            ANIMAMA_DOCUMENT_PACK_VERSION: versionDirectory(
              this.activePacks["document-processing"].manifest,
            ),
          }
        : {}),
      ANIMAMA_INTERNAL_GATEWAY_TOKEN: this.gatewayToken,
      ANIMAMA_DESKTOP_CONTROL_TOKEN: this.controlToken,
      ANIMAMA_DESKTOP_BUILD_ID: this.manifest.build_id,
      ANIMAMA_LOCAL_BIND_HOST: "127.0.0.1",
      ANIMAMA_LOG_TO_FILE: "0",
      ANIMAMA_LOG_TO_CONSOLE: "1",
      ANIMAMA_DISABLE_WEBUI_TELEMETRY: "1",
      OTEL_SDK_DISABLED: "true",
      PYTHONUNBUFFERED: "1",
    };
  }
  private async databaseCommand(operation: string): Promise<DatabaseState> {
    const text = await runCommand(
      this.executable(),
      ["database", operation],
      this.environment(),
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
        this.stage("gateway");
        if (!this.gateway) {
          const saved = readRuntimeState(this.options.paths.state);
          try {
            this.gateway = await createFrontendGateway({
              port: saved?.gatewayPort ?? 0,
              rendererCapability: { value: this.rendererCapability },
              bootstrapHtml: this.options.bootstrapHtml,
            });
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "EADDRINUSE")
              throw new RuntimeError("gateway_port_in_use");
            throw error;
          }
          if (!saved)
            atomicWrite(
              this.options.paths.state,
              JSON.stringify({
                version: 1,
                gatewayPort: Number(this.gateway.origin.port),
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
            this.gateway?.setBootstrapState();
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
        backup.complete(database.alembic_head);
        this.stage("backend");
        const cleanupEnvironment = this.environment();
        for (const key of [
          ...Object.keys(this.vault.childEnvironment()),
          "ANIMAMA_INTERNAL_GATEWAY_TOKEN",
          "ANIMAMA_DESKTOP_CONTROL_TOKEN",
        ])
          delete cleanupEnvironment[key];
        this.cleanupWorker = this.owned.launch(
          "avatar-cleanup",
          this.executable(),
          ["worker", "avatar-cleanup"],
          cleanupEnvironment,
          this.options.paths.base,
        );
        const cleanup = this.cleanupWorker;
        void cleanup.exit.then(() => {
          if (
            !this.expectedPostgresExit &&
            !this.shutdownRequested &&
            this.cleanupWorker === cleanup
          ) {
            this.gateway?.setBootstrapState();
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
  private async startBackend(principalId: string): Promise<void> {
    const gateway = this.gateway!;
    const manifest = this.manifest!;
    const owned = this.owned!;
    this.expectedBackendExit = false;
    for (let attempt = 0; attempt < 8; attempt++) {
      const port = await unusedLoopbackPort();
      const child = owned.launch(
        "fastapi",
        this.executable(),
        ["serve", "--host", "127.0.0.1", "--port", String(port)],
        this.environment(),
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
          const response = await fetch(
            `http://127.0.0.1:${port}/_desktop/health`,
            {
              headers: { "X-Animama-Desktop-Control": this.controlToken },
              signal: AbortSignal.timeout(1500),
            },
          );
          if (response.ok) {
            const health = await readBackendReadiness(response);
            if (
              health.schema_version !== 1 ||
              health.runtime_version !== this.options.appVersion ||
              health.build_id !== manifest.build_id ||
              health.alembic_head !== manifest.alembic_head ||
              health.installation_principal_id !== principalId
            )
              throw new RuntimeError("backend_readiness_mismatch");
            ready = true;
            break;
          }
        } catch (error) {
          if (error instanceof RuntimeError) throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      if (ready) {
        if (
          !owned.children.has(child) ||
          !this.postgres?.process ||
          !owned.children.has(this.postgres.process)
        )
          throw new RuntimeError("backend_start_failed");
        this.backendOrigin = new URL(`http://127.0.0.1:${port}`);
        const parakeet = this.activePacks["parakeet-stt"];
        await gateway.promote({
          publicOrigin: gateway.origin,
          fastApiOrigin: new URL(`http://127.0.0.1:${port}`),
          staticRoot: path.join(this.options.runtimeRoot, "web"),
          principalProvider: {
            async getInstallationPrincipalId() {
              return principalId;
            },
          },
          internalTokenSource: { kind: "value", value: this.gatewayToken },
          rendererCapability: { value: this.rendererCapability },
          telemetryEnabled: false,
          ...(parakeet
            ? {
                parakeetMount: {
                  root: parakeet.root,
                  version: versionDirectory(parakeet.manifest),
                  files: parakeet.manifest.files,
                },
              }
            : {}),
        });
        if (this.shutdownRequested) throw new RuntimeError("runtime_stopping");
        this.setStatus({ state: "ready", origin: gateway.origin.origin });
        void child.exit.then(() => {
          if (
            !this.expectedBackendExit &&
            !this.shutdownRequested &&
            this.backend === child
          ) {
            gateway.setBootstrapState();
            this.setStatus({ state: "error", code: "backend_exited" });
          }
        });
        return;
      }
      const collision = /address already in use/iu.test(child.output);
      await owned.terminate(child);
      if (!collision) throw new RuntimeError("backend_start_failed");
    }
    throw new RuntimeError("internal_port_unavailable");
  }
  credentials(): CredentialStatus[] {
    return this.vault?.list() ?? [];
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
        await this.gateway!.drain(15_000);
        await this.options.quiesceRenderers?.();
        await this.stopDocumentWorker();
        await this.checkUpdatePacks(candidate);
      } catch (error) {
        this.updatePending = false;
        try {
          this.expectedBackendExit = true;
          if (this.backend) await this.owned!.terminate(this.backend);
          const database = await this.databaseCommand("inspect");
          if (!database.installation_principal_id)
            throw new RuntimeError("database_version_mismatch");
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
      this.shutdownRequested = true;
      this.setStatus({ state: "stopping" });
      try {
        await this.stopServices();
        await this.gateway?.close();
        this.gateway = undefined;
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
  /** Signature verification is repeated at every launch, including provider restarts. */
  private async startDocumentWorker(): Promise<void> {
    const pack = this.activePacks["document-processing"];
    if (!pack) return;
    await verifyExecutablePack(pack.root, pack.manifest);
    this.documentInstance = randomUUID();
    const executable = path.join(pack.root, DOCUMENT_EXECUTABLE);
    const expected = pack.manifest.files.find(
      (file) => file.path === DOCUMENT_EXECUTABLE,
    )!;
    const env = this.environment();
    delete env.ANIMAMA_INTERNAL_GATEWAY_TOKEN;
    delete env.ANIMAMA_DESKTOP_CONTROL_TOKEN;
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
  }
  private async stopDocumentWorker(): Promise<void> {
    if (this.documentWorker) await this.owned!.terminate(this.documentWorker);
    this.documentWorker = undefined;
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
      try {
        await this.gateway!.drain(15_000);
        await this.options.quiesceRenderers?.();
        await this.stopDocumentWorker();
        // Recheck after stopping the worker: a job could have been claimed
        // between the first preflight and the graceful stop.
        await this.requirePackRemovable(change.id);
        this.expectedBackendExit = true;
        if (this.backend) await this.owned!.terminate(this.backend);
        await change.commit();
        this.activePacks = change.next;
        const database = await this.databaseCommand("inspect");
        if (!database.installation_principal_id)
          throw new RuntimeError("installation_principal_missing");
        await this.startDocumentWorker();
        await this.startBackend(database.installation_principal_id);
      } catch (error) {
        this.expectedBackendExit = true;
        await this.gateway!.drain();
        await this.stopDocumentWorker();
        if (this.backend) await this.owned!.terminate(this.backend);
        await change.rollback();
        this.activePacks = change.previous;
        try {
          const database = await this.databaseCommand("inspect");
          if (!database.installation_principal_id)
            throw new RuntimeError("installation_principal_missing");
          await this.startDocumentWorker();
          await this.startBackend(database.installation_principal_id);
        } catch (recoveryError) {
          this.setStatus({
            state: "error",
            code: runtimeErrorCode(recoveryError),
          });
        }
        throw error;
      }
    });
  }
  changeCredential(
    provider: unknown,
    value?: unknown,
  ): Promise<CredentialStatus> {
    const key = validateProvider(provider);
    const plaintext =
      value === undefined ? undefined : validateCredential(value);
    if (plaintext) runtimeRedactor.add(plaintext);
    return this.serialize(async () => {
      if (!this.vault || this.current.state !== "ready")
        throw new RuntimeError("runtime_not_ready");
      if (plaintext === undefined) this.vault.delete(key);
      else this.vault.set(key, plaintext);
      this.stage("backend");
      try {
        this.expectedBackendExit = true;
        await this.gateway!.drain(15_000);
        await this.stopDocumentWorker();
        if (this.backend) await this.owned!.terminate(this.backend);
        const database = await this.databaseCommand("inspect");
        if (!database.installation_principal_id)
          throw new RuntimeError("installation_principal_missing");
        await this.startDocumentWorker();
        await this.startBackend(database.installation_principal_id);
        return this.vault.list().find((item) => item.provider === key)!;
      } catch (error) {
        this.gateway?.setBootstrapState();
        this.setStatus({ state: "error", code: runtimeErrorCode(error) });
        return {
          ...this.vault.list().find((item) => item.provider === key)!,
          restartRequired: true,
          error: runtimeErrorCode(error),
        };
      }
    });
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
    await stop(() => this.gateway?.drain());
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
          await this.stopServices();
        } finally {
          await this.gateway?.close();
          this.gateway = undefined;
          this.setStatus({ state: "stopped" });
        }
      }),
    );
  }
}
