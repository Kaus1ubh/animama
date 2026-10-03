import { afterEach, describe, expect, it } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { validateReleasePolicy } from "../scripts/runtime/release-policy.mjs";
import {
  releaseName,
  releaseSizes,
  updateFeed,
  verifyArtifactIndex,
  writeArtifactIndex,
} from "../scripts/runtime/release-artifacts.mjs";
import {
  portableExecutables,
  signatureEntry,
  signingOrder,
  signtoolArguments,
  validateSigningReport,
} from "../scripts/runtime/windows-signing.mjs";
import {
  parseWindowsReleaseArgs,
  windowsBuilderOptions,
} from "../scripts/runtime/release-windows.mjs";

const roots = [];
function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "animama-windows-release-"));
  roots.push(root);
  return root;
}
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

const publisher = {
  endpoint: "https://eus.codesigning.azure.net/",
  account: "fixture-signing",
  certificate_profile: "fixture-public",
  certificate_subject: "CN=Fixture Publisher, O=Fixture Publisher, C=CA",
  identity_validation_eku: "1.3.6.1.4.1.311.97.11.22.33.44",
};
const review = {
  inventory_sha256: "a".repeat(64),
  reviewed_by: "Fixture reviewer",
  reviewed_on: "2026-09-01",
};
const policy = {
  schema: "animama-release-policy/3",
  channel: "stable",
  distributions: {
    r2: {
      base_url: "https://downloads.example.test/desktop",
      bucket: "example-releases",
    },
    github: { owner: "example", repo: "releases" },
  },
  distribution_basis: {
    commercial: false,
    pocket_tts_onnx_license: "CC-BY-4.0",
  },
  redistribution_reviews: { "win32-x64": review },
};
const packs = {
  macos: {
    team_id: "TESTTEAM01",
    signing_identity: "Developer ID Application: Fixture (TESTTEAM01)",
    designated_requirement: "identifier com.animama.document-worker",
  },
  windows: publisher,
  packs: {
    "expanded-included-content": { release_status: "deferred" },
    "document-processing": { release_status: "deferred" },
  },
};

describe("Windows release policy", () => {
  it("binds the Windows receipt and the Artifact Signing publisher to the win32-x64 target", () => {
    const release = validateReleasePolicy(policy, packs, "0.1.0", {
      distribution: "r2",
      target: "win32-x64",
    });
    expect(release.review).toEqual(review);
    expect(release.windowsPublisher).toEqual(publisher);
    // A macOS release neither needs nor uses the Windows receipt.
    expect(() =>
      validateReleasePolicy(policy, packs, "0.1.0", { distribution: "r2" }),
    ).toThrow("darwin-arm64 licenses/inventory.json");
    // Staging seals the distribution before any review exists.
    expect(
      validateReleasePolicy(
        { ...policy, redistribution_reviews: {} },
        packs,
        "0.1.0",
        { distribution: "r2", target: "win32-x64", requireReview: false },
      ).review,
    ).toBeNull();
  });

  it("refuses a Windows release without a complete, pinned publisher", () => {
    const check = (windows) => () =>
      validateReleasePolicy(policy, { ...packs, windows }, "0.1.0", {
        distribution: "r2",
        target: "win32-x64",
      });
    const message = "Windows Artifact Signing publisher";
    expect(check(undefined)).toThrow(message);
    expect(
      check({ ...publisher, endpoint: "http://eus.codesigning.azure.net/" }),
    ).toThrow(message);
    expect(
      check({ ...publisher, endpoint: "https://codesigning.example.test/" }),
    ).toThrow(message);
    // 311.97.1.0 marks public trust; it identifies no validated identity.
    expect(
      check({
        ...publisher,
        identity_validation_eku: "1.3.6.1.4.1.311.97.1.0",
      }),
    ).toThrow(message);
    expect(check({ ...publisher, certificate_subject: "Fixture" })).toThrow(
      message,
    );
    expect(check({ ...publisher, client_secret: "x" })).toThrow(message);
  });
});

describe("Windows signing", () => {
  it("finds every PE file and orders nested code deepest first, then the outer app with Animama.exe last", () => {
    const root = fixture();
    const pe = Buffer.alloc(256);
    pe.write("MZ", 0, "latin1");
    pe.writeUInt32LE(128, 0x3c);
    pe.write("PE\0\0", 128, "latin1");
    for (const name of [
      "Animama.exe",
      "ffmpeg.dll",
      "resources/app.asar.unpacked/dist/native/global_input_hook.node",
      "resources/runtime/bin/animama-process-guard.exe",
      "resources/runtime/postgresql/bin/postgres.exe",
      "resources/runtime/postgresql/lib/vector.dll",
      "resources/runtime/backend/_internal/python312.dll",
    ]) {
      mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
      writeFileSync(path.join(root, name), pe);
    }
    writeFileSync(path.join(root, "resources/runtime/manifest.json"), "{}");
    writeFileSync(path.join(root, "LICENSE.electron.txt"), "MZ text");
    const files = portableExecutables(root);
    expect(files).toHaveLength(7);
    const order = signingOrder(files);
    expect(order.nested).toEqual([
      "resources/app.asar.unpacked/dist/native/global_input_hook.node",
      "resources/runtime/backend/_internal/python312.dll",
      "resources/runtime/postgresql/bin/postgres.exe",
      "resources/runtime/postgresql/lib/vector.dll",
      "resources/runtime/bin/animama-process-guard.exe",
    ]);
    expect(order.outer).toEqual(["ffmpeg.dll", "Animama.exe"]);
  });

  it("signs with SHA-256 file and timestamp digests through the pinned client, never a credential argument", () => {
    const args = signtoolArguments(
      {
        dlib: "C:\\tools\\Azure.CodeSigning.Dlib.dll",
        timestampUrl: "http://timestamp.acs.microsoft.com",
      },
      "C:\\temp\\metadata.json",
      ["C:\\app\\a.dll", "C:\\app\\b.exe"],
    );
    expect(args).toEqual([
      "sign",
      "/fd",
      "SHA256",
      "/tr",
      "http://timestamp.acs.microsoft.com",
      "/td",
      "SHA256",
      "/dlib",
      "C:\\tools\\Azure.CodeSigning.Dlib.dll",
      "/dmdf",
      "C:\\temp\\metadata.json",
      "C:\\app\\a.dll",
      "C:\\app\\b.exe",
    ]);
  });

  it("accepts only valid signatures: Animama's with its identity and a timestamp, or a kept vendor signature", () => {
    const ours = {
      status: "Valid",
      subject: publisher.certificate_subject,
      timestamped: true,
      eku: ["1.3.6.1.5.5.7.3.3", publisher.identity_validation_eku],
    };
    expect(
      signatureEntry("a.dll", "f".repeat(64), ours, publisher, true),
    ).toEqual({
      path: "a.dll",
      sha256: "f".repeat(64),
      signer: "animama",
      status: "Valid",
      subject: publisher.certificate_subject,
      timestamped: true,
    });
    const vendor = {
      status: "Valid",
      subject: "CN=Microsoft Corporation",
      timestamped: false,
      eku: [],
    };
    expect(
      signatureEntry("d3d.dll", "e".repeat(64), vendor, publisher, false)
        .signer,
    ).toBe("vendor");
    for (const bad of [
      { ...ours, status: "HashMismatch" },
      { ...ours, timestamped: false },
      { ...ours, subject: "CN=Someone Else" },
      { ...ours, eku: ["1.3.6.1.5.5.7.3.3"] },
    ])
      expect(() =>
        signatureEntry("a.dll", "f".repeat(64), bad, publisher, true),
      ).toThrow("a.dll");
    expect(() =>
      signatureEntry(
        "x.dll",
        "f".repeat(64),
        { ...vendor, status: "NotSigned" },
        publisher,
        false,
      ),
    ).toThrow("x.dll");
  });

  it("rejects a signing report with any unsigned file or an unsigned installer", () => {
    const entry = {
      path: "Animama.exe",
      sha256: "f".repeat(64),
      signer: "animama",
      status: "Valid",
      subject: publisher.certificate_subject,
      timestamped: true,
    };
    const report = {
      schema: "animama-windows-signing/1",
      app_version: "0.1.0",
      release_ready: true,
      stage_build_id: "a".repeat(64),
      runtime_build_id: "b".repeat(64),
      certificate_subject: publisher.certificate_subject,
      files: [entry],
      installer: { ...entry, path: "Animama-0.1.0-x64-setup.exe" },
      uninstaller: { ...entry, path: "uninstaller" },
      signed_files: 3,
    };
    expect(validateSigningReport(report, publisher)).toBe(report);
    expect(() =>
      validateSigningReport(
        { ...report, files: [{ ...entry, status: "NotSigned" }] },
        publisher,
      ),
    ).toThrow("Animama.exe");
    expect(() =>
      validateSigningReport({ ...report, uninstaller: null }, publisher),
    ).toThrow("uninstaller");
    expect(() =>
      validateSigningReport({ ...report, signed_files: 2 }, publisher),
    ).toThrow("count of signed files");
    expect(() =>
      validateSigningReport(
        { ...report, runtime_build_id: report.stage_build_id },
        publisher,
      ),
    ).toThrow("re-inventoried");
  });
});

describe("Windows release candidate", () => {
  it("accepts only the signing rehearsal option", () => {
    expect(parseWindowsReleaseArgs([])).toEqual({ rehearsal: false });
    expect(parseWindowsReleaseArgs(["--signing-rehearsal"])).toEqual({
      rehearsal: true,
    });
    expect(() => parseWindowsReleaseArgs(["--skip-review"])).toThrow();
  });

  it("signs only through the repository hook: no electron-builder editing, Azure module or SHA-1", () => {
    const sign = () => {};
    const afterPack = () => {};
    const options = windowsBuilderOptions({
      icon: "icon.ico",
      release: {
        distribution: {
          name: "r2",
          base_url: "https://downloads.example.test/desktop",
        },
      },
      afterPack,
      sign,
    });
    expect(options.publish).toBe("never");
    expect(options.config.forceCodeSigning).toBe(true);
    expect(options.config.afterPack).toBe(afterPack);
    expect(options.config.extraMetadata).toEqual({ name: "Animama" });
    expect(options.config.win).toEqual({
      icon: "icon.ico",
      signAndEditExecutable: false,
      signtoolOptions: { signingHashAlgorithms: ["sha256"], sign },
    });
    expect(options.config.win).not.toHaveProperty("azureSignOptions");
    expect(options.config.publish).toEqual([
      {
        provider: "generic",
        url: "https://downloads.example.test/desktop",
        channel: "latest",
      },
    ]);
  });

  it("names Windows evidence so it cannot collide with macOS files in the shared version folder", () => {
    expect(releaseName("win32-x64", "size-report.json")).toBe(
      "size-report-win32-x64.json",
    );
    expect(releaseName("win32-x64", "sbom.cdx.json")).toBe(
      "sbom-win32-x64.cdx.json",
    );
    expect(releaseName("darwin-arm64", "size-report.json")).toBe(
      "size-report.json",
    );
    const root = fixture();
    writeFileSync(path.join(root, "Animama-0.1.0-x64-setup.exe"), "installer");
    writeArtifactIndex(
      root,
      "0.1.0",
      ["Animama-0.1.0-x64-setup.exe"],
      {},
      "win32-x64",
    );
    expect(
      readFileSync(path.join(root, "SHA256SUMS-win32-x64.txt"), "utf8"),
    ).toContain("Animama-0.1.0-x64-setup.exe");
    expect(verifyArtifactIndex(root, "win32-x64").files).toHaveLength(1);
    expect(() => verifyArtifactIndex(root)).toThrow();
  });

  it("writes latest.yml from the signed installer's bytes", async () => {
    const root = fixture();
    writeFileSync(path.join(root, "Animama-0.1.0-x64-setup.exe"), "installer");
    const manifest = {
      app_version: "0.1.0",
      build_id: "a".repeat(64),
      minimum_os: "10.0.22000",
    };
    const r2 = {
      kind: "r2",
      base_url: "https://downloads.example.test/desktop",
    };
    const feed = await updateFeed(
      root,
      manifest,
      2000,
      { entries: [] },
      r2,
      "win32-x64",
    );
    expect(feed.path).toBe("v0.1.0/Animama-0.1.0-x64-setup.exe");
    expect(feed.files).toEqual([
      {
        url: "v0.1.0/Animama-0.1.0-x64-setup.exe",
        sha512: expect.any(String),
        size: 9,
      },
    ]);
    expect(feed.minimumSystemVersion).toBe("10.0.22000");
    expect(feed.animama).toMatchObject({
      platform: "win32",
      architecture: "x64",
      installed_bytes: 2000,
    });
    await expect(
      updateFeed(
        root,
        { ...manifest, minimum_os: "15.0" },
        2000,
        { entries: [] },
        r2,
        "win32-x64",
      ),
    ).rejects.toThrow("Windows 11 runtime manifest");
  });

  it("measures the unpacked app and the installer against the Windows caps", () => {
    const root = fixture();
    const app = path.join(root, "win-unpacked");
    const runtime = path.join(app, "resources/runtime");
    mkdirSync(runtime, { recursive: true });
    writeFileSync(path.join(app, "Animama.exe"), "x".repeat(100));
    writeFileSync(path.join(runtime, "postgres.exe"), "y".repeat(40));
    writeFileSync(path.join(runtime, "manifest.json"), "{}");
    writeFileSync(
      path.join(root, "Animama-0.1.0-x64-setup.exe"),
      "z".repeat(70),
    );
    const manifest = {
      app_version: "0.1.0",
      files: [
        { path: "postgres.exe", size_bytes: 40, component: "postgresql" },
      ],
    };
    const report = releaseSizes(
      app,
      root,
      manifest,
      { entries: [] },
      "win32-x64",
    );
    expect(report).toMatchObject({
      target: "win32-x64",
      measurement: "signed-app-and-installer",
      installed_bytes: 142,
      download_bytes: 70,
      downloads: { nsis: 70 },
    });
    expect(report.components).toEqual(
      expect.arrayContaining([
        { name: "electron", installed_bytes: 100 },
        { name: "postgresql", installed_bytes: 40 },
        { name: "package_overhead", installed_bytes: 2 },
      ]),
    );
  });
});
