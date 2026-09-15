import type { App } from "electron";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
} from "node:fs";
import path from "node:path";
import { atomicWrite, privateDirectory } from "./atomic-file.js";
import { RuntimeError } from "./errors.js";

export type RuntimePaths = ReturnType<typeof runtimePaths>;
export function runtimePaths(userData: string) {
  const base = path.resolve(userData);
  return {
    base,
    state: path.join(base, "runtime/state.json"),
    processes: path.join(base, "runtime/processes.json"),
    logs: path.join(base, "runtime/logs"),
    vault: path.join(base, "secrets/vault.bin"),
    pgData: path.join(base, "postgres/16/data"),
    localContent: path.join(base, "content/local"),
    content: path.join(base, "content"),
    data: path.join(base, "data"),
    backups: path.join(base, "backups/pre-migration"),
    packs: path.join(base, "packs"),
    downloads: path.join(base, "downloads"),
  };
}

/** Move a legacy tree only into an absent destination. Never merge two profiles. */
export function migrateLegacyTree(
  source: string,
  destination: string,
  journal: string,
): void {
  if (!existsSync(source)) return;
  if (lstatSync(source).isSymbolicLink())
    throw new RuntimeError("legacy_profile_invalid");
  if (existsSync(destination)) {
    // An existing destination is a conflict even if a journal exists; never merge profiles.
    throw new RuntimeError("legacy_profile_conflict");
  }
  mkdirSync(path.dirname(destination), { recursive: true });
  atomicWrite(
    journal,
    JSON.stringify({ version: 1, state: "moving", source, destination }),
  );
  renameSync(source, destination);
  try {
    atomicWrite(
      journal,
      JSON.stringify({ version: 1, state: "complete", source, destination }),
    );
  } catch (error) {
    // Failure must leave the original profile available, never a half-merged tree.
    renameSync(destination, source);
    throw error;
  }
}

/** Call before creating sessions, logs or safeStorage; no packaged URL overrides. */
export function prepareDesktopIdentity(application: App): RuntimePaths {
  application.setName("Animama");
  const root =
    process.platform === "win32"
      ? path.join(
          process.env.LOCALAPPDATA || application.getPath("appData"),
          "Animama",
        )
      : path.join(application.getPath("appData"), "Animama");
  const override = !application.isPackaged
    ? process.env.ANIMAMA_DESKTOP_DEV_USER_DATA
    : undefined;
  const paths = runtimePaths(override || root);
  if (
    application.isPackaged &&
    Object.keys(process.env).some(
      (name) =>
        (name === "ANIMAMA_DESKTOP_WEB_URL" ||
          name.startsWith("ANIMAMA_DESKTOP_DEV_") ||
          name === "ANIMAMA_DESKTOP_DISABLE_CHROMIUM_SANDBOX") &&
        process.env[name],
    )
  ) {
    throw new RuntimeError("packaged_runtime_override_rejected");
  }
  // Electron requires an existing directory for setPath. Rename the legacy tree
  // before creating the destination; the instance lock still precedes services,
  // sessions, logs and safeStorage. Concurrent cold starts never merge profiles.
  migrateLegacyIdentity(application, paths);
  privateDirectory(paths.base);
  application.setPath("userData", paths.base);
  return paths;
}

/** Run before logs or Chromium can create a conflicting destination tree. */
function migrateLegacyIdentity(application: App, paths: RuntimePaths): void {
  if (application.isPackaged || !process.env.ANIMAMA_DESKTOP_DEV_USER_DATA) {
    migrateLegacyTree(
      path.join(application.getPath("appData"), "Anima"),
      paths.base,
      `${paths.base}.migration.json`,
    );
    const legacyLogs = path.join(
      process.env.XDG_CONFIG_HOME ||
        path.join(application.getPath("home"), ".config"),
      "Anima/logs",
    );
    migrateLegacyTree(
      legacyLogs,
      paths.logs,
      `${paths.base}.logs-migration.json`,
    );
  }
}

/** gatewayPort stores the application port; preserving it keeps the saved browser origin stable. */
export type RuntimeState = { version: 1; gatewayPort: number };
export function readRuntimeState(file: string): RuntimeState | null {
  privateDirectory(path.dirname(file));
  if (!existsSync(file)) return null;
  if (
    !lstatSync(file).isFile() ||
    lstatSync(file).isSymbolicLink() ||
    lstatSync(file).size > 4096
  )
    throw new RuntimeError("runtime_state_invalid");
  try {
    const state = JSON.parse(readFileSync(file, "utf8"));
    if (
      state.version !== 1 ||
      !Number.isInteger(state.gatewayPort) ||
      state.gatewayPort < 1 ||
      state.gatewayPort > 65535
    )
      throw new Error();
    return state;
  } catch {
    throw new RuntimeError("runtime_state_invalid");
  }
}

/** A lost vault cannot be regenerated over an existing database. */
export function hasDatabaseData(paths: RuntimePaths): boolean {
  return existsSync(paths.pgData) && readdirSync(paths.pgData).length > 0;
}
