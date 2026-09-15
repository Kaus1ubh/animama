import { app, BrowserWindow, safeStorage, session, shell } from "electron";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  resolveDesktopConfig,
  type DesktopConfig,
} from "./main-process/config.js";
import {
  initializeLogging,
  installProcessErrorLogging,
  writeLog,
} from "./main-process/logging.js";
import { installFullscreenIpc } from "./main-process/fullscreen/fullscreen-ipc.js";
import { installPipIpc } from "./main-process/pip/pip-ipc.js";
import { installQuickChatIpc } from "./main-process/quick-chat/quick-chat-ipc.js";
import { installShortcutsIpc } from "./main-process/shortcuts/shortcuts-ipc.js";
import { installSessionGuards } from "./main-process/security/guards.js";
import {
  createRendererCapability,
  installRendererCapability,
} from "./main-process/security/renderer-capability.js";
import { createWindow } from "./main-process/window/create-window.js";
import {
  RuntimeError,
  runtimeErrorCode,
} from "./main-process/runtime/errors.js";
import {
  RuntimeIpcCallers,
  installRuntimeIpc,
} from "./main-process/runtime/ipc.js";
import {
  prepareDesktopIdentity,
  runtimePaths,
} from "./main-process/runtime/paths.js";
import {
  createRecoveryWindow,
  createRuntimePage,
} from "./main-process/runtime/recovery.js";
import { RuntimeSupervisor } from "./main-process/runtime/supervisor.js";
import {
  closeProductSession,
  destroyProductWindows,
  installProductRequestGate,
  ProductSessionCleanup,
} from "./main-process/runtime/product-windows.js";
import type { RuntimeStatus } from "../../shared/desktop-runtime.js";
import { readBoundedJson } from "./main-process/feature-packs/catalog.js";
import { DesktopUpdateController } from "./main-process/updates/controller.js";
import { validateUpdatePolicy } from "./main-process/updates/policy.js";
import {
  createMacUpdateAdapter,
  verifyUpdaterPublisher,
} from "./main-process/updates/electron-adapter.js";

const currentDir = dirname(fileURLToPath(import.meta.url));
const preloadPath = join(currentDir, "preload.cjs");
const embedded =
  app.isPackaged || Boolean(process.env.ANIMAMA_DESKTOP_DEV_RUNTIME_ROOT);
let identityError: unknown;
let paths: ReturnType<typeof runtimePaths>;
try {
  paths = prepareDesktopIdentity(app);
} catch (error) {
  identityError = error;
  paths = runtimePaths(app.getPath("userData"));
}

// The lock precedes database migrations, sessions, safeStorage, logs and services.
const ownsInstance = app.requestSingleInstanceLock();
if (!ownsInstance) app.quit();
else {
  if (!identityError) {
    try {
      initializeLogging(app);
    } catch (error) {
      identityError = error;
    }
  }
  installProcessErrorLogging();
  if (
    !app.isPackaged &&
    process.env.ANIMAMA_DESKTOP_DISABLE_CHROMIUM_SANDBOX === "1"
  ) {
    app.commandLine.appendSwitch("no-sandbox");
    writeLog(
      "info",
      "Chromium sandbox disabled for explicit development launch",
    );
  }
  if (process.platform === "linux")
    app.commandLine.appendSwitch("enable-features", "GlobalShortcutsPortal");

  const callers = new RuntimeIpcCallers();
  const recoveryHtml = createRuntimePage();
  let supervisor: RuntimeSupervisor | undefined;
  let currentStatus: RuntimeStatus = { state: "starting", stage: "validating" };
  let desktopConfig: DesktopConfig | undefined;
  let mainWindow: BrowserWindow | undefined;
  let recoveryWindow: BrowserWindow | undefined;
  let mainTask: Promise<void> | undefined;
  let recoveryTask: Promise<void> | undefined;
  let windowGeneration = 0;
  let applicationRoute = "/";
  const sessionCleanup = new ProductSessionCleanup(async () => {
    if (desktopConfig)
      await closeProductSession(
        session.fromPartition(desktopConfig.sessionPartition),
        desktopConfig.allowedWebOrigin,
      );
  });
  let allowQuit = false;
  let quitting = false;
  let updates: DesktopUpdateController | undefined;
  let updateInitialization: Promise<void> | undefined;

  /** Updates are optional, packaged-only infrastructure and never delay application readiness. */
  function initializeUpdates(): Promise<void> {
    if (
      !app.isPackaged ||
      process.platform !== "darwin" ||
      process.arch !== "arm64" ||
      !supervisor
    )
      return Promise.resolve();
    updateInitialization ??= (async () => {
      const policy = validateUpdatePolicy(
        await readBoundedJson(
          join(process.resourcesPath, "runtime/update-policy.json"),
          4096,
        ),
      );
      await verifyUpdaterPublisher(
        resolve(process.resourcesPath, "../.."),
        policy,
      );
      if (quitting) return;
      const adapter = createMacUpdateAdapter(policy, app.getVersion(), () => {
        allowQuit = true;
        quitting = true;
      });
      updates = new DesktopUpdateController({
        version: app.getVersion(),
        adapter,
        disk: () => supervisor!.updateDisk(),
        preflight: (candidate) => supervisor!.preflightUpdate(candidate),
        stopAndInstall: async (candidate, install) => {
          await supervisor!.stopForUpdate(candidate);
          try {
            await install();
          } catch (error) {
            if (
              error instanceof RuntimeError &&
              error.code === "update_install_failed"
            )
              await supervisor!.recoverFailedUpdate();
            else
              updateStatus({ state: "error", code: runtimeErrorCode(error) });
            throw error;
          }
        },
        onStatus: (status) => callers.broadcastUpdate(status),
      });
      callers.broadcastUpdate(updates.status());
      updates.start();
    })().catch(() => {
      callers.broadcastUpdate({ state: "unavailable" });
    });
    return updateInitialization;
  }

  /** A single independent recovery window survives even when no HTTP listener exists. */
  async function showRecovery(): Promise<void> {
    if (quitting) return;
    if (recoveryWindow && !recoveryWindow.isDestroyed()) {
      recoveryWindow.show();
      recoveryWindow.focus();
      return;
    }
    recoveryTask ??= createRecoveryWindow(preloadPath, recoveryHtml, callers)
      .then((window) => {
        recoveryWindow = window;
        window.on("closed", () => {
          recoveryWindow = undefined;
        });
      })
      .finally(() => {
        recoveryTask = undefined;
      });
    await recoveryTask;
  }

  /** Invalidate pending loads before destroying every product document and worker. */
  function quiesceProductWindows(): Promise<void> {
    windowGeneration++;
    applicationRoute =
      destroyProductWindows(
        BrowserWindow.getAllWindows(),
        mainWindow,
        recoveryWindow,
        desktopConfig?.allowedWebOrigin,
      ) ?? applicationRoute;
    return sessionCleanup.close();
  }

  /** Install the HttpOnly capability before the first main/PiP/quick-chat load. */
  async function showApplication(origin?: string): Promise<void> {
    if (
      quitting ||
      (embedded &&
        (currentStatus.state !== "ready" || currentStatus.origin !== origin))
    )
      return;
    if (mainTask) {
      await mainTask;
      if (!mainWindow || mainWindow.isDestroyed())
        await showApplication(origin);
      return;
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
      recoveryWindow?.hide();
      return;
    }
    const generation = windowGeneration;
    const current = () =>
      !quitting &&
      generation === windowGeneration &&
      (!embedded ||
        (currentStatus.state === "ready" && currentStatus.origin === origin));
    mainTask = (async () => {
      await sessionCleanup.close();
      if (!current()) return;
      if (!desktopConfig) {
        desktopConfig = resolveDesktopConfig(origin);
        const desktopSession = session.fromPartition(
          desktopConfig.sessionPartition,
        );
        if (embedded)
          installProductRequestGate(
            desktopSession,
            desktopConfig.allowedWebOrigin,
            () =>
              !quitting &&
              !sessionCleanup.blocked &&
              currentStatus.state === "ready" &&
              supervisor?.status().state === "ready",
          );
        installSessionGuards(desktopConfig.allowedWebOrigin, desktopSession);
        installFullscreenIpc();
        installPipIpc({ config: desktopConfig, preloadPath });
        installQuickChatIpc({ config: desktopConfig, preloadPath });
        installShortcutsIpc();
      }
      const desktopSession = session.fromPartition(
        desktopConfig.sessionPartition,
      );
      sessionCleanup.markActive();
      await installRendererCapability(
        desktopSession,
        desktopConfig.allowedWebOrigin,
        supervisor?.rendererCapability ?? createRendererCapability(),
      );
      if (!current()) {
        // A status change may have raced the asynchronous cookie write.
        sessionCleanup.markActive();
        await quiesceProductWindows();
        return;
      }
      await createWindow({
        config: {
          ...desktopConfig,
          webUrl: embedded
            ? new URL(applicationRoute, desktopConfig.allowedWebOrigin)
            : desktopConfig.webUrl,
        },
        preloadPath,
        failOnLoadError: embedded,
        onCreated: (window) => {
          mainWindow = window;
          callers.register(window, "main", desktopConfig!.allowedWebOrigin);
          window.webContents.on("render-process-gone", () => {
            if (mainWindow === window && currentStatus.state === "ready")
              updateStatus({ state: "error", code: "renderer_load_failed" });
          });
          window.on("closed", () => {
            if (mainWindow === window) mainWindow = undefined;
          });
        },
      });
      if (currentStatus.state === "ready" || currentStatus.state === "external")
        recoveryWindow?.hide();
    })()
      .catch((error) => {
        if (current()) throw error;
      })
      .finally(() => {
        mainTask = undefined;
      });
    await mainTask;
  }

  function updateStatus(status: RuntimeStatus): void {
    currentStatus = status;
    if (embedded && status.state !== "ready") {
      void quiesceProductWindows().catch(() =>
        writeLog("error", "renderer_cleanup_failed"),
      );
      if (status.state !== "stopped")
        void showRecovery().catch(() =>
          writeLog("error", "recovery_window_failed"),
        );
    }
    callers.broadcast(status);
    writeLog(
      "info",
      `Runtime ${status.state}${status.state === "error" ? `: ${status.code}` : status.state === "starting" ? `: ${status.stage}` : ""}`,
    );
    if (status.state === "ready") {
      void initializeUpdates();
      void showApplication(status.origin).catch((error) =>
        updateStatus({ state: "error", code: runtimeErrorCode(error) }),
      );
    } else if (status.state === "error") {
      void showRecovery().catch(() =>
        writeLog("error", "recovery_window_failed"),
      );
    }
  }

  installRuntimeIpc(callers, {
    status: () => currentStatus,
    retry: async () => {
      if (identityError) throw identityError;
      if (!supervisor) throw new RuntimeError("embedded_runtime_unavailable");
      await supervisor.start();
      // A renderer load can fail after services become ready. Retry that window
      // without resetting a healthy database or changing the stable origin.
      if (supervisor.status().state === "ready")
        updateStatus(supervisor.status());
    },
    openLogs: async () => {
      if (await shell.openPath(paths.logs))
        throw new RuntimeError("logs_unavailable");
    },
    openBackups: async () => {
      if (await shell.openPath(paths.backups))
        throw new RuntimeError("backups_unavailable");
    },
    quit: () => app.quit(),
    credentials: () => {
      if (!supervisor) throw new RuntimeError("embedded_runtime_unavailable");
      return supervisor.credentials();
    },
    changeCredential: (provider, value) => {
      if (!supervisor) throw new RuntimeError("embedded_runtime_unavailable");
      return supervisor.changeCredential(provider, value);
    },
    featurePacks: () => supervisor?.featurePacks().list() ?? [],
    changePack: (action, id) => {
      if (!supervisor) throw new RuntimeError("embedded_runtime_unavailable");
      return supervisor.changePack(action, id);
    },
    updateStatus: () => updates?.status() ?? { state: "unavailable" },
    checkUpdate: async () => {
      await initializeUpdates();
      return updates?.check() ?? { state: "unavailable" };
    },
    downloadUpdate: async () => {
      if (!updates) throw new RuntimeError("updates_not_configured");
      return updates.download();
    },
    restartUpdate: async () => {
      if (!updates) throw new RuntimeError("updates_not_configured");
      return updates.restart();
    },
  });

  app.on("second-instance", () => {
    const window =
      mainWindow && !mainWindow.isDestroyed() ? mainWindow : recoveryWindow;
    if (window) {
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
    }
  });
  app.on("before-quit", (event) => {
    if (allowQuit) return;
    event.preventDefault();
    if (quitting) return;
    quitting = true;
    updates?.close();
    void (supervisor?.stop() ?? Promise.resolve())
      .then(() => {
        allowQuit = true;
        app.quit();
      })
      .catch((error) => {
        quitting = false;
        updateStatus({ state: "error", code: runtimeErrorCode(error) });
      });
  });
  app.on("activate", () => {
    const task =
      currentStatus.state === "ready"
        ? showApplication(currentStatus.origin)
        : currentStatus.state === "external"
          ? showApplication()
          : showRecovery();
    void task.catch(() => writeLog("error", "window_reopen_failed"));
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  void app
    .whenReady()
    .then(async () => {
      if (identityError) {
        await showRecovery();
        updateStatus({ state: "error", code: runtimeErrorCode(identityError) });
        return;
      }
      if (!embedded) {
        currentStatus = { state: "external" };
        await showApplication();
        return;
      }
      await showRecovery();
      supervisor = new RuntimeSupervisor({
        runtimeRoot: app.isPackaged
          ? join(process.resourcesPath, "runtime")
          : resolve(process.env.ANIMAMA_DESKTOP_DEV_RUNTIME_ROOT!),
        appVersion: app.getVersion(),
        paths,
        encryption: safeStorage,
        onStatus: updateStatus,
        isPackaged: app.isPackaged,
        packCatalogPath: process.env.ANIMAMA_DESKTOP_DEV_PACK_CATALOG_PATH,
        onPackProgress: (status) => callers.broadcastPack(status),
        quiesceRenderers: quiesceProductWindows,
      });
      await supervisor.start();
    })
    .catch((error) =>
      updateStatus({ state: "error", code: runtimeErrorCode(error) }),
    );
}
