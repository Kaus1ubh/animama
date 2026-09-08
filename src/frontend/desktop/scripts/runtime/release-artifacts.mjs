import { createHash } from "node:crypto";
import {
  createReadStream,
  lstatSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { readJson, sha256, writeJson } from "./common.mjs";
import { componentInventory } from "./inventory.mjs";
import { validateSizeReport } from "./size.mjs";

async function sha512(file) {
  const hash = createHash("sha512");
  for await (const bytes of createReadStream(file)) hash.update(bytes);
  return hash.digest("base64");
}

/** Feed metadata is derived from the final signed bytes, never hand-entered estimates. */
export async function updateFeed(directory, manifest, installedBytes, catalog) {
  const version = manifest.app_version;
  if (!/^\d+\.\d+\.\d+$/u.test(version))
    throw new Error("Invalid release version");
  if (manifest.minimum_os !== "15.0")
    throw new Error("Update feed requires the macOS 15 runtime manifest");
  const files = [];
  for (const extension of ["zip", "dmg"]) {
    const url = `Animama-${version}-arm64.${extension}`;
    const file = path.join(directory, url);
    const stat = lstatSync(file);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.nlink !== 1 ||
      stat.size <= 0 ||
      stat.size > 750 * 1024 ** 2
    )
      throw new Error(
        "Update artifact is missing, unsafe or over its size ceiling",
      );
    files.push({ url, sha512: await sha512(file), size: stat.size });
  }
  return {
    version,
    files,
    path: files[0].url,
    sha512: files[0].sha512,
    // macOS 15 is Darwin 24. electron-updater compares os.release(), not the product version.
    minimumSystemVersion: "24.0.0",
    releaseDate: new Date().toISOString(),
    animama: {
      schema: "animama-update/1",
      platform: "darwin",
      architecture: "arm64",
      installed_bytes: installedBytes,
      runtime_build_id: manifest.build_id,
      packs: catalog.entries.map((pack) => ({
        id: pack.id,
        manifest_sha256: createHash("sha256")
          .update(JSON.stringify(pack))
          .digest("hex"),
      })),
    },
  };
}

/** Measure the actual app and both distribution archives, including signature/installer overhead. */
export function releaseSizes(app, directory, manifest, catalog) {
  const installed = componentInventory(app).reduce(
    (sum, file) => sum + file.size_bytes,
    0,
  );
  const runtimeBytes =
    manifest.files.reduce((sum, file) => sum + file.size_bytes, 0) +
    lstatSync(path.join(app, "Contents/Resources/runtime/manifest.json")).size;
  const components = new Map([["electron", installed - runtimeBytes]]);
  for (const file of manifest.files)
    components.set(
      file.component,
      (components.get(file.component) ?? 0) + file.size_bytes,
    );
  components.set(
    "package_overhead",
    (components.get("package_overhead") ?? 0) +
      lstatSync(path.join(app, "Contents/Resources/runtime/manifest.json"))
        .size,
  );
  const downloads = Object.fromEntries(
    ["dmg", "zip"].map((extension) => [
      extension,
      lstatSync(
        path.join(
          directory,
          `Animama-${manifest.app_version}-arm64.${extension}`,
        ),
      ).size,
    ]),
  );
  const report = {
    schema: "animama-size-report/1",
    target: "darwin-arm64",
    app_version: manifest.app_version,
    measurement: "signed-stapled-app-and-final-distribution-archives",
    installed_bytes: installed,
    download_bytes: Math.max(...Object.values(downloads)),
    downloads,
    components: [...components].map(([name, installed_bytes]) => ({
      name,
      installed_bytes,
    })),
    packs: Object.fromEntries(
      catalog.entries.map((pack) => [
        pack.id,
        {
          installed_bytes: pack.installed_bytes,
          download_bytes: pack.archive_bytes,
          minimum_peak_free_bytes: pack.minimum_peak_free_bytes,
        },
      ]),
    ),
  };
  report.validation = validateSizeReport(report);
  if (report.validation.failures.length)
    throw new Error(report.validation.failures.join("\n"));
  return report;
}

/** CycloneDX inventory distinguishes exact runtime file hashes from conservative dependency groups. */
export function releaseSbom(manifest, inventory) {
  return {
    bomFormat: "CycloneDX",
    specVersion: "1.6",
    version: 1,
    metadata: {
      component: {
        type: "application",
        name: "Animama",
        version: manifest.app_version,
      },
      properties: [
        { name: "animama:coverage", value: inventory.coverage },
        { name: "animama:runtime-build-id", value: manifest.build_id },
      ],
    },
    components: [
      ...inventory.records.map((record, index) => ({
        type: "library",
        "bom-ref": `dependency:${index}`,
        name: record.name ?? record.id,
        ...(record.version ? { version: record.version } : {}),
        properties: [
          { name: "animama:inventory-id", value: record.id },
          {
            name: "animama:license-observation",
            value: String(record.license ?? "NOASSERTION"),
          },
        ],
      })),
      ...manifest.files.map((file) => ({
        type: "file",
        "bom-ref": `runtime:${file.path}`,
        name: file.path,
        hashes: [{ alg: "SHA-256", content: file.sha256 }],
      })),
    ],
  };
}

/** Publish only a fixed allowlist, not release directories, build logs, or source maps. */
export function writeArtifactIndex(directory, version, names, extra = {}) {
  const files = [...new Set(names)].sort().map((name) => {
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,150}$/u.test(name))
      throw new Error("Unsafe release artifact name");
    const file = path.join(directory, name);
    const stat = lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1)
      throw new Error("Unsafe release artifact");
    return { name, size_bytes: stat.size, sha256: sha256(file) };
  });
  const index = {
    schema: "animama-release-artifacts/1",
    app_version: version,
    ...extra,
    files,
  };
  writeJson(path.join(directory, "release-artifacts.json"), index);
  writeFileSync(
    path.join(directory, "SHA256SUMS.txt"),
    files.map((file) => `${file.sha256}  ${file.name}\n`).join(""),
  );
  return index;
}

export function verifyArtifactIndex(directory) {
  for (const name of ["release-artifacts.json", "SHA256SUMS.txt"]) {
    const stat = lstatSync(path.join(directory, name));
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.nlink !== 1 ||
      stat.size > 64 * 1024
    )
      throw new Error("Invalid release artifact index");
  }
  const index = readJson(path.join(directory, "release-artifacts.json"));
  if (
    index.schema !== "animama-release-artifacts/1" ||
    !Array.isArray(index.files) ||
    !index.files.length ||
    index.files.length > 64
  )
    throw new Error("Invalid release artifact index");
  const names = new Set();
  for (const file of index.files) {
    if (
      !file ||
      typeof file.name !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,150}$/u.test(file.name) ||
      typeof file.sha256 !== "string" ||
      !/^[a-f0-9]{64}$/u.test(file.sha256) ||
      !Number.isSafeInteger(file.size_bytes) ||
      file.size_bytes < 1 ||
      names.has(file.name) ||
      ["release-artifacts.json", "SHA256SUMS.txt"].includes(file.name)
    )
      throw new Error("Invalid release artifact entry");
    names.add(file.name);
    const target = path.join(directory, file.name);
    const stat = lstatSync(target);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.nlink !== 1 ||
      stat.size !== file.size_bytes ||
      sha256(target) !== file.sha256
    )
      throw new Error("Release artifact changed after verification");
  }
  const sums = index.files
    .map((file) => `${file.sha256}  ${file.name}\n`)
    .join("");
  if (readFileSync(path.join(directory, "SHA256SUMS.txt"), "utf8") !== sums)
    throw new Error("Release checksum list changed");
  return index;
}

/** A public testing preview exposes immutable payloads/notices, never the stable feed or final acceptance. */
export function previewAssets(index) {
  return index.files.filter(
    (file) =>
      ![
        "latest-mac.yml",
        "manual-acceptance.json",
        "release-artifacts.json",
        "SHA256SUMS.txt",
      ].includes(file.name) &&
      !/^(?:smoke|network)-(?:skip|name)-report\.json$/u.test(file.name),
  );
}

/** Only the exact version's draft or explicit prerelease can advance; stable releases are immutable. */
export function mayResumeRelease(remote, version) {
  return (
    Number.isSafeInteger(remote?.id) &&
    remote.id > 0 &&
    remote.tag_name === `v${version}` &&
    typeof remote.draft === "boolean" &&
    typeof remote.prerelease === "boolean" &&
    (remote.draft || remote.prerelease)
  );
}
