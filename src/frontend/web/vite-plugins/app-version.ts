import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * The release version manifest. Web and desktop ship as one release, and
 * electron-builder versions the packaged app from this file, so it is the only
 * place a release sets its version.
 */
export const releaseManifestUrl = new URL(
  "../../desktop/package.json",
  import.meta.url,
);

/**
 * Resolves the version shown in App Settings → About. An explicit
 * VITE_APP_VERSION still wins for custom builds.
 */
export function resolveAppVersion(
  env: Record<string, string | undefined> = process.env,
): string {
  if (env.VITE_APP_VERSION) return env.VITE_APP_VERSION;

  const manifestPath = fileURLToPath(releaseManifestUrl);
  let version: unknown;
  try {
    version = (
      JSON.parse(readFileSync(manifestPath, "utf8")) as {
        version?: unknown;
      }
    ).version;
  } catch (error) {
    throw new Error(`Cannot read the release version from ${manifestPath}`, {
      cause: error,
    });
  }
  if (typeof version !== "string" || version === "") {
    throw new Error(`${manifestPath} has no release version`);
  }
  return version;
}
