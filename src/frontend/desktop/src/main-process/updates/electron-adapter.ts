import { autoUpdater as nativeUpdater } from "electron";
import { MacUpdater, type UpdateCheckResult } from "electron-updater";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import { RuntimeError } from "../runtime/errors.js";
import { runCommand } from "../runtime/processes.js";
import {
  allowedUpdateUrl,
  validateUpdateCandidate,
  type UpdateCandidate,
  type UpdatePolicy,
} from "./policy.js";
import type { UpdateAdapter } from "./controller.js";

/** A developer/ad-hoc core cannot participate in the production update chain. */
export async function verifyUpdaterPublisher(
  appPath: string,
  policy: UpdatePolicy,
): Promise<void> {
  try {
    await runCommand(
      "/usr/bin/codesign",
      [
        "--verify",
        "--deep",
        "--strict",
        "-R",
        `=anchor apple generic and identifier "com.animama.desktop" and certificate leaf[subject.OU] = "${policy.team_id}"`,
        appPath,
      ],
      {},
      appPath,
    );
  } catch {
    throw new RuntimeError("update_publisher_invalid");
  }
}

/** Pin transport/publisher policy while leaving update ZIP and OS verification to the supported updater. */
export function createMacUpdateAdapter(
  policy: UpdatePolicy,
  currentVersion: string,
  permitQuit: () => void,
): UpdateAdapter {
  const { distribution } = policy;
  const updater = new MacUpdater(
    distribution.kind === "r2"
      ? { provider: "generic", url: distribution.base_url }
      : {
          provider: "github",
          owner: distribution.owner,
          repo: distribution.repo,
          private: false,
        },
  );
  updater.logger = null; // Library logs contain paths, signed redirect URLs and Squirrel capabilities.
  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = false;
  updater.autoRunAppAfterInstall = true;
  updater.channel = "latest";
  updater.allowDowngrade = false; // Setting channel above otherwise turns this on.
  updater.allowPrerelease = false;
  updater.disableDifferentialDownload = true;
  updater.disableWebInstaller = true;
  updater.forceDevUpdateConfig = false;
  updater.requestHeaders = { "Accept-Encoding": "identity" };
  let checked: UpdateCheckResult | null = null;
  let candidate: UpdateCandidate | undefined;
  let downloadedFile: string | undefined;
  let progress: ((bytes: number) => void) | undefined;
  let closed = false;
  updater.netSession.webRequest.onBeforeRequest((details, callback) =>
    callback({ cancel: !allowedUpdateUrl(details.url, policy) }),
  );
  updater.netSession.webRequest.onHeadersReceived((details, callback) => {
    const length = Object.entries(details.responseHeaders ?? {}).find(
      ([key]) => key.toLowerCase() === "content-length",
    )?.[1]?.[0];
    const archive =
      candidate &&
      new URL(details.url).pathname.endsWith(`/${candidate.filename}`);
    callback({
      cancel: Boolean(
        archive &&
        details.statusCode === 200 &&
        length !== String(candidate!.downloadBytes),
      ),
    });
  });
  updater.on("download-progress", (event) => {
    if (candidate && event.transferred > candidate.downloadBytes)
      checked?.cancellationToken?.cancel();
    else progress?.(event.transferred);
  });
  updater.on("update-downloaded", (event) => {
    downloadedFile = event.downloadedFile;
  });
  // Errors are delivered by the awaited operations. Never forward raw messages to IPC/logs.
  updater.on("error", () => undefined);
  return {
    async check() {
      if (closed) return null;
      checked = await updater.checkForUpdates();
      return checked
        ? { available: checked.isUpdateAvailable, info: checked.updateInfo }
        : null;
    },
    async download(expected, listener) {
      if (closed) throw new RuntimeError("update_download_failed");
      // Refresh the library's internal provider state and token; never download a
      // different release than the one the person approved in the UI.
      checked = await updater.checkForUpdates();
      if (closed) {
        checked?.cancellationToken?.cancel();
        throw new RuntimeError("update_download_failed");
      }
      if (
        !checked?.isUpdateAvailable ||
        JSON.stringify(
          validateUpdateCandidate(
            checked.updateInfo,
            currentVersion,
            distribution,
          ),
        ) !== JSON.stringify(expected)
      ) {
        throw new RuntimeError("update_changed_check_again");
      }
      candidate = expected;
      downloadedFile = undefined;
      progress = listener;
      try {
        await updater.downloadUpdate(checked.cancellationToken);
        if (closed || !downloadedFile)
          throw new RuntimeError("update_download_failed");
        const file = await open(
          downloadedFile,
          constants.O_RDONLY | constants.O_NOFOLLOW,
        );
        try {
          const metadata = await file.stat();
          if (
            !metadata.isFile() ||
            metadata.nlink !== 1 ||
            metadata.size !== expected.downloadBytes
          )
            throw new RuntimeError("update_download_invalid");
          const hash = createHash("sha512");
          for await (const chunk of file.createReadStream({ autoClose: false }))
            hash.update(chunk);
          if (hash.digest("base64") !== expected.sha512)
            throw new RuntimeError("update_download_invalid");
        } finally {
          await file.close();
        }
      } finally {
        progress = undefined;
      }
    },
    async install() {
      if (closed || !downloadedFile)
        throw new RuntimeError("update_download_required");
      // Only called after explicit Restart and successful owned-service shutdown.
      // With autoInstallOnAppQuit=false, Squirrel has not yet read this ZIP.
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          clearTimeout(timeout);
          nativeUpdater.removeListener("update-downloaded", ready);
          nativeUpdater.removeListener("error", failed);
        };
        const ready = () => {
          cleanup();
          resolve();
        };
        const failed = () => {
          cleanup();
          reject(new RuntimeError("update_install_failed"));
        };
        const timeout = setTimeout(() => {
          cleanup();
          reject(new RuntimeError("update_install_timeout"));
        }, 180_000);
        nativeUpdater.once("update-downloaded", ready);
        nativeUpdater.once("error", failed);
        try {
          nativeUpdater.checkForUpdates();
        } catch {
          failed();
        }
      });
      permitQuit();
      updater.quitAndInstall();
    },
    close() {
      closed = true;
      checked?.cancellationToken?.cancel();
      progress = undefined;
    },
  };
}
