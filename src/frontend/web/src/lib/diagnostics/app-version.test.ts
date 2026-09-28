import { readFileSync } from "node:fs";

import { expect, it } from "vitest";

import {
  releaseManifestUrl,
  resolveAppVersion,
} from "../../../vite-plugins/app-version";

const packageVersion = (url: URL) =>
  (JSON.parse(readFileSync(url, "utf8")) as { version?: string }).version;

it("reports the desktop release version in About", () => {
  // The packaged desktop app is versioned from desktop/package.json; the web
  // build must describe the same release without a second version to bump.
  expect(resolveAppVersion({})).toBe(packageVersion(releaseManifestUrl));
});

it("lets an explicit VITE_APP_VERSION override the release version", () => {
  expect(resolveAppVersion({ VITE_APP_VERSION: "9.9.9-custom" })).toBe(
    "9.9.9-custom",
  );
});

it("keeps the web package free of a second release version", () => {
  expect(
    packageVersion(new URL("../../../package.json", import.meta.url)),
  ).toBeUndefined();
});
