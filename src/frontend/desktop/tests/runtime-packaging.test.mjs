import { afterEach, describe, expect, it, vi } from "vitest";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { symlinksAvailable } from "./fixtures/symlinks.mjs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  assertInventory,
  assertPortablePath,
  inventoryTree,
} from "../scripts/runtime/inventory.mjs";
import {
  desktopRoot,
  parseTarget,
  removeFinderMetadata,
  sha256,
} from "../scripts/runtime/common.mjs";
import { assertBundledImports } from "../scripts/runtime/js-audit.mjs";
import {
  javascriptLicenses,
  readStaticLicenseNotice,
} from "../scripts/runtime/licenses.mjs";
import { checkSizes, validateSizeReport } from "../scripts/runtime/size.mjs";
import {
  isPublicReleaseRepository,
  releaseTagBase,
  sealedDistribution,
  selectedDistribution,
  validateReleasePolicy,
} from "../scripts/runtime/release-policy.mjs";
import { verifyScanReceipt } from "../scripts/runtime/publication.mjs";
import {
  candidateDistribution,
  updateFeed,
  writeArtifactIndex,
  verifyArtifactIndex,
  previewAssets,
  mayResumeRelease,
} from "../scripts/runtime/release-artifacts.mjs";
import {
  acceptsRequiredNameSmoke,
  classifySmokeRequest,
  manualMacChecks,
  validateManualAcceptance,
} from "../scripts/runtime/smoke-policy.mjs";
import { nestedCode } from "../scripts/runtime/macos-signing.mjs";
import { temporarySmokeProviderRemoved } from "../scripts/runtime/smoke-macos.mjs";
import {
  assertMacosMinimum,
  auditMacosMinimum,
} from "../scripts/runtime/macos-platform.mjs";
import {
  documentLoadCommands,
  prepareDocumentLibraries,
} from "../scripts/runtime/document-native.mjs";
import {
  assertDesktopWebAssets,
  assertNoIncludedAliasCopies,
  excludeDesktopWebAssets,
  excludedDesktopWebAssets,
  includedAliasRoutes,
} from "../scripts/runtime/desktop-web.mjs";
import { componentInventory } from "../scripts/runtime/inventory.mjs";
import { validateUpdateCandidate } from "../src/main-process/updates/policy.js";
import { renderRedistributionReview } from "../scripts/runtime/review-packet.mjs";

const roots = [];
afterEach(() => {
  vi.unstubAllGlobals();
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), "animama-manifest-"));
  roots.push(root);
  writeFileSync(path.join(root, "data.json"), "{}");
  chmodSync(path.join(root, "data.json"), 0o644);
  return root;
}

describe("desktop runtime packaging", () => {
  it.skipIf(!symlinksAvailable)(
    "includes bundled dependency notices without following symlinks or nested dependencies",
    () => {
      const root = fixture();
      for (const name of ["desktop", "web"]) {
        mkdirSync(path.join(root, name));
        writeFileSync(
          path.join(root, name, "package.json"),
          JSON.stringify({
            name,
            private: true,
            dependencies: { vendor: "1.0.0" },
          }),
        );
      }
      const vendor = path.join(root, "node_modules/vendor");
      mkdirSync(vendor, { recursive: true });
      writeFileSync(
        path.join(vendor, "package.json"),
        JSON.stringify({ name: "vendor", version: "1.0.0", license: "MIT" }),
      );
      for (const name of [
        "LICENSE",
        "lib-vendor/d3/LICENSE",
        "dist/bundle.js.LICENSE.txt",
        "dist/THIRD_PARTY_NOTICES.md",
        "dist/icons/copyright.js",
        "dist/icons/copyright.js.map",
        "node_modules/undeclared/LICENSE",
      ]) {
        mkdirSync(path.dirname(path.join(vendor, name)), { recursive: true });
        writeFileSync(path.join(vendor, name), name);
      }
      symlinkSync(
        path.join(root, "data.json"),
        path.join(vendor, "NOTICE.txt"),
      );
      symlinkSync(root, path.join(vendor, "linked"));
      const record = javascriptLicenses(root).records.find(
        (item) => item.name === "vendor",
      );
      expect(record.notices).toEqual([
        { path: "LICENSE", text: "LICENSE" },
        {
          path: "dist/THIRD_PARTY_NOTICES.md",
          text: "dist/THIRD_PARTY_NOTICES.md",
        },
        {
          path: "dist/bundle.js.LICENSE.txt",
          text: "dist/bundle.js.LICENSE.txt",
        },
        { path: "lib-vendor/d3/LICENSE", text: "lib-vendor/d3/LICENSE" },
      ]);
    },
  );

  it("loads every checked-in static license notice", () => {
    const policy = JSON.parse(
      readFileSync(
        new URL("../runtime/license-sources.json", import.meta.url),
        "utf8",
      ),
    );
    for (const group of policy.groups) {
      for (const name of group.notice_files ?? []) {
        const notice = readStaticLicenseNotice(name);
        expect(notice.path).toBe(name);
        expect(notice.text.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("ships the downloadable Parakeet notices with every app", () => {
    // Speech models are downloaded later, but their notices are bundled.
    const policy = JSON.parse(
      readFileSync(
        new URL("../runtime/license-sources.json", import.meta.url),
        "utf8",
      ),
    );
    const notices = Object.fromEntries(
      policy.groups.map((group) => [group.id, group.notice_files]),
    );
    expect(notices["parakeet-input"]).toEqual([
      "parakeet-attribution.txt",
      "parakeet-onnx-asr-mit.txt",
    ]);
    expect(notices["parakeet-webgpu-input"]).toEqual([
      "parakeet-webgpu-attribution.txt",
    ]);
    expect(readStaticLicenseNotice("parakeet-onnx-asr-mit.txt").text).toContain(
      "MIT",
    );
  });

  it.each([
    "../notice.txt",
    "/notice.txt",
    "sub/notice.txt",
    "sub\\notice.txt",
    ".hidden.txt",
    "notice.html",
  ])("rejects unsafe static notice path %s", (name) => {
    expect(() => readStaticLicenseNotice(name)).toThrow(
      "Invalid static license notice path",
    );
  });

  it("inventories a clean desktop and web workspace without a retired server directory", () => {
    const root = fixture();
    for (const name of ["desktop", "web", "node_modules/shared-fixture"]) {
      const folder = path.join(root, name);
      mkdirSync(folder, { recursive: true });
      writeFileSync(
        path.join(folder, "package.json"),
        JSON.stringify({
          name: path.basename(name),
          version: "1.0.0",
          license: "MIT",
          ...(name === "desktop" || name === "web"
            ? { dependencies: { "shared-fixture": "1.0.0" } }
            : {}),
        }),
      );
      writeFileSync(path.join(folder, "LICENSE"), "Fixture notice");
    }
    expect(existsSync(path.join(root, "server"))).toBe(false);
    const inventory = javascriptLicenses(root);
    expect(inventory.records.map((record) => record.id)).toEqual([
      "npm:desktop@1.0.0",
      "npm:shared-fixture@1.0.0",
      "npm:web@1.0.0",
    ]);
    expect(inventory.absentOptional).toEqual([]);
    expect(
      inventory.records.every((record) => record.notices.length === 1),
    ).toBe(true);
  });

  it("renders the exact active/deferred redistribution review state", () => {
    const root = fixture();
    const review = renderRedistributionReview({
      target: { output: root, runtime: path.join(root, "runtime") },
      manifest: { build_id: "build-1", files: [{ path: "one" }] },
      inventory: {
        pending_review: ["one"],
        records: [{ license: "MIT" }],
      },
      sizes: {
        installed_bytes: 10,
        download_bytes: 5,
        packs: {
          "expanded-included-content": {
            installed_bytes: 4,
            download_bytes: 3,
          },
          "document-processing": {
            installed_bytes: null,
            download_bytes: null,
            state: "deferred",
          },
        },
      },
      packReport: {
        reports: [
          {
            id: "expanded-included-content",
            state: "redistribution_review_required",
            inventory_sha256: "a".repeat(64),
          },
          { id: "document-processing", state: "deferred" },
        ],
      },
      inventorySha256: "b".repeat(64),
    });
    expect(review).toContain(
      "`expanded-included-content` | `redistribution_review_required`",
    );
    expect(review).toContain(
      "`document-processing` | `deferred` | Not required",
    );
    expect(review).toContain("`NOASSERTION` records: 0");
  });

  it("removes only the explicitly excluded legacy portraits from desktop web output", () => {
    const root = fixture();
    writeFileSync(path.join(root, "keep.png"), "approved");
    for (const name of excludedDesktopWebAssets)
      writeFileSync(path.join(root, name), "unapproved");
    expect(() => assertDesktopWebAssets(root)).toThrow(
      "Unapproved desktop public asset",
    );
    excludeDesktopWebAssets(root);
    expect(readFileSync(path.join(root, "keep.png"), "utf8")).toBe("approved");
    expect(() => assertDesktopWebAssets(root)).not.toThrow();
    excludeDesktopWebAssets(root);
  });
  it("keeps public stage scenes while rejecting Included alias copies", () => {
    const web = fixture();
    const publicRoot = fixture();
    for (const root of [web, publicRoot]) {
      mkdirSync(path.join(root, "background"), { recursive: true });
      writeFileSync(path.join(root, "background/cafe-light.webp"), "scene");
    }
    excludeDesktopWebAssets(web);
    expect(
      readFileSync(path.join(web, "background/cafe-light.webp"), "utf8"),
    ).toBe("scene");
    expect(() => assertNoIncludedAliasCopies(web, publicRoot)).not.toThrow();

    writeFileSync(path.join(web, "background/cafe-light.webp"), "changed");
    expect(() => assertNoIncludedAliasCopies(web, publicRoot)).toThrow(
      "compatibility alias: background/cafe-light.webp",
    );
    writeFileSync(path.join(web, "background/cafe-light.webp"), "scene");
    writeFileSync(path.join(web, "background/included.webp"), "appearance");
    expect(() => assertNoIncludedAliasCopies(web, publicRoot)).toThrow(
      "compatibility alias: background/included.webp",
    );
    rmSync(path.join(web, "background/included.webp"));
    for (const route of includedAliasRoutes.filter((r) => r !== "background")) {
      mkdirSync(path.join(web, route), { recursive: true });
      writeFileSync(path.join(web, route, "copied.png"), "duplicate");
      expect(() => assertNoIncludedAliasCopies(web, publicRoot)).toThrow(
        `compatibility alias: ${route}/copied.png`,
      );
      rmSync(path.join(web, route), { recursive: true });
    }
  });
  it.skipIf(!symlinksAvailable)(
    "rejects a symlinked compatibility route",
    () => {
      const web = fixture();
      symlinkSync(fixture(), path.join(web, "background"), "dir");
      expect(() => assertNoIncludedAliasCopies(web, fixture())).toThrow(
        "compatibility alias: background",
      );
    },
  );
  it.skipIf(process.platform !== "darwin")(
    "launches the worker relative to its relocated app without a shell or PATH lookup",
    () => {
      const root = fixture();
      const original = path.join(root, "Original.app");
      const moved = path.join(root, "Moved app.app");
      const macos = path.join(original, "Contents/MacOS");
      const resources = path.join(
        original,
        "Contents/Resources/document-worker",
      );
      mkdirSync(macos, { recursive: true });
      mkdirSync(resources, { recursive: true });
      const compile = spawnSync(
        "/usr/bin/clang",
        [
          "-Wall",
          "-Wextra",
          "-Werror",
          "-mmacosx-version-min=15.0",
          fileURLToPath(
            new URL("../runtime/document-worker-launcher.c", import.meta.url),
          ),
          "-o",
          path.join(macos, "animama-document-worker"),
        ],
        { encoding: "utf8" },
      );
      expect(compile.stderr).toBe("");
      expect(compile.status).toBe(0);
      const payloadSource = path.join(root, "payload.c");
      writeFileSync(
        payloadSource,
        '#include <stdio.h>\nint main(int argc, char **argv) { for (int i = 1; i < argc; i++) printf("%s%s", argv[i], i + 1 == argc ? "\\n" : " "); return 0; }\n',
      );
      const payloadCompile = spawnSync(
        "/usr/bin/clang",
        [payloadSource, "-o", path.join(resources, "animama-document-worker")],
        { encoding: "utf8" },
      );
      expect(payloadCompile.status).toBe(0);
      writeFileSync(
        path.join(original, "Contents/Info.plist"),
        '<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict><key>CFBundleIdentifier</key><string>com.animama.document-worker.fixture</string><key>CFBundleExecutable</key><string>animama-document-worker</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>\n',
      );
      for (const code of [
        path.join(resources, "animama-document-worker"),
        original,
      ]) {
        const signed = spawnSync(
          "/usr/bin/codesign",
          ["--force", "--options", "runtime", "--sign", "-", code],
          { encoding: "utf8" },
        );
        expect(signed.status).toBe(0);
      }
      const verified = spawnSync(
        "/usr/bin/codesign",
        ["--verify", "--deep", "--strict", original],
        { encoding: "utf8" },
      );
      expect({ status: verified.status, stderr: verified.stderr }).toEqual({
        status: 0,
        stderr: "",
      });
      renameSync(original, moved);
      const executable = path.join(
        moved,
        "Contents/MacOS/animama-document-worker",
      );
      const arguments_ = ["--audit-resources", "literal ; $(false)"];
      const launched = spawnSync(executable, arguments_, {
        cwd: tmpdir(),
        env: { PATH: "/nonexistent" },
        encoding: "utf8",
      });
      expect({
        status: launched.status,
        signal: launched.signal,
        stderr: launched.stderr,
      }).toEqual({ status: 0, signal: null, stderr: "" });
      expect(launched.stdout).toBe(`${arguments_.join(" ")}\n`);
      rmSync(
        path.join(
          moved,
          "Contents/Resources/document-worker/animama-document-worker",
        ),
      );
      const missing = spawnSync(executable, [], { encoding: "utf8" });
      expect(missing.status).toBe(126);
      expect(missing.stderr).toContain("cannot start payload");
      const helper = "Electron Helper (GPU)";
      renameSync(executable, path.join(root, helper));
      expect(auditMacosMinimum(root, [helper], "15.0")).toEqual([
        { path: helper, minimum_macos: ["15.0"] },
      ]);
    },
  );

  it("checks the native deployment minimum independently of the SDK and host", () => {
    const modern =
      "\nLoad command 0\n cmd LC_BUILD_VERSION\n platform 1\n minos 14.0\n sdk 26.2\n";
    expect(() => assertMacosMinimum(modern, "13.0")).toThrow(
      "requires macOS 14.0",
    );
    expect(assertMacosMinimum(modern, "14.0.0")).toEqual(["14.0"]);
    expect(
      assertMacosMinimum(
        "\nLoad command 0\n cmd LC_VERSION_MIN_MACOSX\n version 10.15\n sdk 14.0\n",
        "13.0",
      ),
    ).toEqual(["10.15"]);
    expect(() =>
      assertMacosMinimum(modern.replace("minos 14.0", "minos 14.1"), "14.0"),
    ).toThrow("above advertised");
    expect(() =>
      assertMacosMinimum(modern.replace("platform 1", "platform 2"), "14.0"),
    ).toThrow("does not target macOS");
    expect(() => assertMacosMinimum("sdk 14.0", "13.0")).toThrow(
      "no macOS deployment",
    );
  });

  it("checks only arm64 native files and identifies the incompatible staged member", () => {
    const root = fixture();
    writeFileSync(
      path.join(root, "native.so"),
      Buffer.from("cffaedfe00000000", "hex"),
    );
    const runner = vi.fn(
      () =>
        "\nLoad command 0\n cmd LC_BUILD_VERSION\n platform 1\n minos 14.0\n sdk 26.2\n",
    );
    expect(() =>
      auditMacosMinimum(root, ["data.json", "native.so"], "13.0", runner),
    ).toThrow("native.so: Native binary requires macOS 14.0");
    expect(runner).toHaveBeenCalledExactlyOnceWith(
      "/usr/bin/otool",
      ["-arch", "arm64", "-l", "/dev/fd/3"],
      { capture: true, extraStdio: [expect.any(Number)] },
    );
  });

  it.each([
    { status: [{ provider: "openai", configured: false }], removed: true },
    { status: [], removed: false },
    { status: [{ provider: "openai", configured: true }], removed: false },
  ])(
    "claims smoke credential removal only for an unconfigured OpenAI status ($status)",
    async ({ status, removed }) => {
      vi.stubGlobal("window", {
        animamaDesktop: { credentials: { list: async () => status } },
      });
      await expect(temporarySmokeProviderRemoved()).resolves.toBe(removed);
    },
  );

  it("distinguishes a dylib ID from real, weak and reexported dependencies", () => {
    const output = `library:
Load command 0
          cmd LC_ID_DYLIB
      cmdsize 64
         name @rpath/libSelf.dylib (offset 24)
Load command 1
          cmd LC_LOAD_DYLIB
      cmdsize 64
         name /usr/lib/libSystem.B.dylib (offset 24)
Load command 2
          cmd LC_LOAD_WEAK_DYLIB
      cmdsize 64
         name @rpath/libWeak.dylib (offset 24)
Load command 3
          cmd LC_REEXPORT_DYLIB
      cmdsize 64
         name @loader_path/libExport.dylib (offset 24)
Load command 4
          cmd LC_RPATH
      cmdsize 32
         path @loader_path/.. (offset 12)
`;
    expect(documentLoadCommands(output)).toEqual({
      dependencies: [
        "/usr/lib/libSystem.B.dylib",
        "@rpath/libWeak.dylib",
        "@loader_path/libExport.dylib",
      ],
      rpaths: ["@loader_path/.."],
    });
    expect(() =>
      documentLoadCommands("\nLoad command 0\n cmd LC_LOAD_DYLIB\n"),
    ).toThrow("Malformed");
  });

  /** A copied PyInstaller alias, with actual files and simulated native tools. */
  function workerLibraries() {
    const root = fixture();
    const frozenRoot = path.join(root, "frozen");
    const executableRoot = path.join(root, "bundle/Contents/MacOS");
    const canonical = "_internal/torch/lib/libtorch_cpu.dylib";
    const alias = "_internal/libtorch_cpu.dylib";
    const consumer = "_internal/torch/_C.so";
    for (const base of [frozenRoot, executableRoot]) {
      for (const name of ["animama-document-worker", canonical, consumer]) {
        mkdirSync(path.dirname(path.join(base, name)), { recursive: true });
        writeFileSync(
          path.join(base, name),
          Buffer.from("cffaedfe00000000", "hex"),
        );
      }
    }
    symlinkSync("torch/lib/libtorch_cpu.dylib", path.join(frozenRoot, alias));
    writeFileSync(
      path.join(executableRoot, alias),
      Buffer.from("cffaedfe00000000", "hex"),
    );
    const commands = new Map([
      [
        consumer,
        {
          dependencies: ["@rpath/libtorch_cpu.dylib"],
          rpaths: ["@loader_path/.."],
        },
      ],
    ]);
    const runNative = vi.fn((tool, args) => {
      const name = path.relative(executableRoot, args.at(-1));
      if (tool.endsWith("/otool")) {
        const { dependencies = [], rpaths = [] } = commands.get(name) ?? {};
        return [
          ...dependencies.map(
            (value) => `cmd LC_LOAD_DYLIB\n name ${value} (offset 24)`,
          ),
          ...rpaths.map((value) => `cmd LC_RPATH\n path ${value} (offset 12)`),
        ]
          .map((block, i) => `\nLoad command ${i}\n ${block}\n`)
          .join("");
      }
      if (tool.endsWith("/install_name_tool")) {
        const entry = commands.get(name);
        const key = args[0] === "-rpath" ? "rpaths" : "dependencies";
        entry[key] = entry[key].map((value) =>
          value === args[1] ? args[2] : value,
        );
      }
      return "";
    });
    return {
      frozenRoot,
      executableRoot,
      runNative,
      commands,
      alias,
      canonical,
      consumer,
    };
  }

  it.skipIf(!symlinksAvailable)(
    "relocates proven Torch aliases before removing duplicate bytes and reaudits real references",
    () => {
      const input = workerLibraries();
      const result = prepareDocumentLibraries(input);
      expect(result.relocations).toEqual([
        {
          path: input.consumer,
          command: "-change",
          from: "@rpath/libtorch_cpu.dylib",
          to: "@loader_path/lib/libtorch_cpu.dylib",
        },
      ]);
      expect(existsSync(path.join(input.executableRoot, input.alias))).toBe(
        false,
      );
      expect(existsSync(path.join(input.frozenRoot, input.alias))).toBe(true);
      expect(
        result.files.find((file) => file.path === input.consumer).dependencies,
      ).toEqual(["@loader_path/lib/libtorch_cpu.dylib"]);
    },
  );

  it.skipIf(!symlinksAvailable).each([
    [
      "missing dependency",
      { dependencies: ["@loader_path/missing.dylib"] },
      "unresolved",
    ],
    [
      "absolute dependency",
      { dependencies: ["/opt/homebrew/lib/test.dylib"] },
      "absolute non-system",
    ],
    [
      "escaping search path",
      { rpaths: ["@loader_path/../../../../.."] },
      "external library search",
    ],
    [
      "unrelocatable search path",
      { rpaths: ["/opt/homebrew/lib"] },
      "not relocatable",
    ],
  ])("rejects a worker's %s", (_, commands, message) => {
    const input = workerLibraries();
    input.commands.set(input.consumer, commands);
    expect(() => prepareDocumentLibraries(input)).toThrow(message);
  });

  it.skipIf(!symlinksAvailable)(
    "retains non-Torch aliases for ctypes while relocating their search paths",
    () => {
      const input = workerLibraries();
      const alias = "_internal/libImage.dylib";
      const canonical = "_internal/PIL/.dylibs/libImage.dylib";
      for (const base of [input.frozenRoot, input.executableRoot]) {
        mkdirSync(path.dirname(path.join(base, canonical)), {
          recursive: true,
        });
        writeFileSync(
          path.join(base, canonical),
          Buffer.from("cffaedfe00000000", "hex"),
        );
      }
      symlinkSync(
        "PIL/.dylibs/libImage.dylib",
        path.join(input.frozenRoot, alias),
      );
      writeFileSync(
        path.join(input.executableRoot, alias),
        Buffer.from("cffaedfe00000000", "hex"),
      );
      for (const name of [alias, canonical]) {
        input.commands.set(name, {
          dependencies: ["@rpath/libtorch_cpu.dylib"],
          rpaths: ["@loader_path/../.."],
        });
      }
      const result = prepareDocumentLibraries(input);
      expect(existsSync(path.join(input.executableRoot, alias))).toBe(true);
      expect(result.relocations).toContainEqual({
        path: alias,
        command: "-rpath",
        from: "@loader_path/../..",
        to: "@loader_path/.",
      });
      expect(
        result.files.find((entry) => entry.path === alias).dependencies,
      ).toEqual(["@loader_path/torch/lib/libtorch_cpu.dylib"]);
    },
  );

  it.skipIf(!symlinksAvailable)(
    "reaudits dependencies after aliases are removed instead of trusting tool success",
    () => {
      const input = workerLibraries();
      const runner = input.runNative;
      input.runNative = (tool, args) =>
        tool.endsWith("/install_name_tool") ? "" : runner(tool, args);
      expect(() => prepareDocumentLibraries(input)).toThrow(
        "unresolved non-system library",
      );
    },
  );

  it.skipIf(!symlinksAvailable)(
    "refuses to discard a changed alias or an unexpected Torch target",
    () => {
      const input = workerLibraries();
      writeFileSync(
        path.join(input.executableRoot, input.alias),
        "different library",
      );
      expect(() => prepareDocumentLibraries(input)).toThrow("does not match");
      rmSync(path.join(input.frozenRoot, input.alias));
      symlinkSync(
        "../animama-document-worker",
        path.join(input.frozenRoot, input.alias),
      );
      expect(() => prepareDocumentLibraries(input)).toThrow(
        "Unexpected worker Torch alias",
      );
    },
  );

  it("keeps public testing previews out of the stable feed and refuses mutation of stable releases", () => {
    const names = [
      "Animama-0.1.0-arm64.dmg",
      "document-processing-0.1.0-darwin-arm64.tar.zst",
      "THIRD_PARTY_NOTICES.txt",
      "latest-mac.yml",
      "manual-acceptance.json",
      "smoke-name-report.json",
    ];
    expect(
      previewAssets({ files: names.map((name) => ({ name })) }).map(
        (file) => file.name,
      ),
    ).toEqual(names.slice(0, 3));
    const remote = { id: 1, tag_name: "v0.1.0", draft: true, prerelease: true };
    expect(mayResumeRelease(remote, "0.1.0")).toBe(true);
    expect(mayResumeRelease({ ...remote, draft: false }, "0.1.0")).toBe(true);
    expect(
      mayResumeRelease({ ...remote, draft: false, prerelease: false }, "0.1.0"),
    ).toBe(false);
    expect(mayResumeRelease(remote, "0.2.0")).toBe(false);
  });
  it("validates candidate coordinates, matching publisher/release URLs and explicit review without network access", () => {
    const request = vi.fn();
    vi.stubGlobal("fetch", request);
    const distributions = {
      r2: {
        base_url: "https://downloads.example.test/desktop",
        bucket: "example-releases",
      },
      github: { owner: "example", repo: "releases" },
    };
    const policy = {
      schema: "animama-release-policy/3",
      channel: "stable",
      distributions,
      distribution_basis: {
        commercial: false,
        pocket_tts_onnx_license: "CC-BY-4.0",
      },
      redistribution_reviews: {
        "darwin-arm64": {
          inventory_sha256: "a".repeat(64),
          reviewed_by: "Fixture reviewer",
          reviewed_on: "2026-09-01",
        },
      },
    };
    const packs = {
      macos: {
        team_id: "TESTTEAM01",
        signing_identity: "Developer ID Application: Fixture (TESTTEAM01)",
        designated_requirement: "identifier com.animama.document-worker",
      },
      packs: Object.fromEntries(
        ["expanded-included-content", "document-processing"].map((id) => [
          id,
          {
            release_status:
              id === "expanded-included-content" ? "active" : "deferred",
          },
        ]),
      ),
    };
    const r2 = validateReleasePolicy(policy, packs, "0.1.0", {
      distribution: "r2",
    });
    expect(r2.activePackIds).toEqual(["expanded-included-content"]);
    expect(r2.distribution).toEqual({ name: "r2", ...distributions.r2 });
    expect(r2.packReleaseBase).toBe(
      "https://downloads.example.test/desktop/v0.1.0",
    );
    expect(r2.updatePolicy).toEqual({
      schema: "animama-update-policy/2",
      distribution: {
        kind: "r2",
        base_url: "https://downloads.example.test/desktop",
      },
      channel: "stable",
      team_id: "TESTTEAM01",
    });
    const github = validateReleasePolicy(policy, packs, "0.1.0", {
      distribution: "github",
    });
    expect(github.packReleaseBase).toBe(
      "https://github.com/example/releases/releases/download/v0.1.0",
    );
    expect(github.updatePolicy.distribution).toEqual({
      kind: "github",
      owner: "example",
      repo: "releases",
    });
    expect(() =>
      validateReleasePolicy({ ...policy }, { ...packs, packs: {} }, "0.1.0"),
    ).toThrow("explicit active or deferred");
    expect(() =>
      validateReleasePolicy({ ...policy, distributions: null }, packs, "0.1.0"),
    ).toThrow("intended installer/update destinations");
    for (const base_url of [
      "http://downloads.example.test/desktop",
      "https://downloads.example.test/desktop/",
      "https://downloads.example.test:8443/desktop",
      "https://user@downloads.example.test/desktop",
      "https://downloads.example.test/desktop?x=1",
    ])
      expect(() =>
        validateReleasePolicy(
          {
            ...policy,
            distributions: {
              ...distributions,
              r2: { ...distributions.r2, base_url },
            },
          },
          packs,
          "0.1.0",
        ),
      ).toThrow("intended installer/update destinations");
    expect(() =>
      validateReleasePolicy(
        {
          ...policy,
          distribution_basis: {
            ...policy.distribution_basis,
            commercial: true,
          },
        },
        packs,
        "0.1.0",
      ),
    ).toThrow("noncommercial installer/update policy");
    expect(() =>
      validateReleasePolicy(
        { ...policy, redistribution_reviews: {} },
        packs,
        "0.1.0",
      ),
    ).toThrow("human redistribution review");
    // A receipt binds one target's inventory; it never stands in for another.
    expect(() =>
      validateReleasePolicy(policy, packs, "0.1.0", { target: "win32-x64" }),
    ).toThrow("human redistribution review");
    expect(() =>
      validateReleasePolicy(
        {
          ...policy,
          redistribution_reviews: {
            ...policy.redistribution_reviews,
            "linux-x64": policy.redistribution_reviews["darwin-arm64"],
          },
        },
        packs,
        "0.1.0",
      ),
    ).toThrow("human redistribution review");
    expect(() =>
      validateReleasePolicy({ ...policy, token: "secret" }, packs, "0.1.0"),
    ).toThrow();
    expect(() =>
      validateReleasePolicy(
        policy,
        {
          ...packs,
          release_base_url:
            "https://github.com/other/repo/releases/download/v0.1.0",
        },
        "0.1.0",
      ),
    ).toThrow("derived from the selected distribution");
    expect(request).not.toHaveBeenCalled();
  });

  it("selects the build-time distribution from ANIMAMA_RELEASE_DISTRIBUTION, defaulting to R2", () => {
    expect(selectedDistribution({})).toBe("r2");
    expect(selectedDistribution({ ANIMAMA_RELEASE_DISTRIBUTION: "" })).toBe(
      "r2",
    );
    expect(
      selectedDistribution({ ANIMAMA_RELEASE_DISTRIBUTION: "github" }),
    ).toBe("github");
    expect(() =>
      selectedDistribution({ ANIMAMA_RELEASE_DISTRIBUTION: "s3" }),
    ).toThrow("ANIMAMA_RELEASE_DISTRIBUTION must be r2 or github");
  });

  it("derives a retained pack's release folder for either distribution", () => {
    expect(
      releaseTagBase(
        { name: "r2", base_url: "https://downloads.example.test/desktop" },
        "v0.1.0",
      ),
    ).toBe("https://downloads.example.test/desktop/v0.1.0");
    expect(
      releaseTagBase(
        { name: "github", owner: "example", repo: "releases" },
        "v0.1.0",
      ),
    ).toBe("https://github.com/example/releases/releases/download/v0.1.0");
  });

  it.each([
    ["private", new Response(JSON.stringify({ private: true }))],
    ["missing or hidden", new Response(null, { status: 404 })],
    ["unavailable", new Response(null, { status: 503 })],
    ["malformed", new Response("not JSON")],
    ["missing visibility", new Response("{}")],
  ])(
    "refuses publication when the anonymous repository is %s",
    async (_, response) => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
      await expect(
        isPublicReleaseRepository({ owner: "example", repo: "releases" }),
      ).resolves.toBe(false);
    },
  );

  it("checks publication visibility without authentication and fails closed on network errors", async () => {
    const request = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ private: false })));
    vi.stubGlobal("fetch", request);
    const repository = { owner: "example", repo: "releases" };
    await expect(isPublicReleaseRepository(repository)).resolves.toBe(true);
    expect(request).toHaveBeenCalledWith(
      "https://api.github.com/repos/example/releases",
      {
        headers: { Accept: "application/vnd.github+json" },
        redirect: "error",
        signal: expect.any(AbortSignal),
      },
    );
    request.mockRejectedValue(new Error("offline"));
    await expect(isPublicReleaseRepository(repository)).resolves.toBe(false);
  });

  it("reaches native candidate packaging without querying a private GitHub repository", async () => {
    // Exercise the real candidate preflight, stopping before any native build/signing.
    const root = fixture();
    const output = path.join(root, "stage");
    const runtime = path.join(output, "runtime");
    const source = path.join(root, "inputs");
    mkdirSync(path.join(runtime, "licenses"), { recursive: true });
    mkdirSync(source);
    const json = (file, value) => writeFileSync(file, JSON.stringify(value));
    json(path.join(runtime, "licenses/inventory.json"), {});
    json(path.join(output, "audit-report.json"), {});
    json(path.join(root, "package.json"), { version: "0.1.0" });
    const github = { owner: "example", repo: "private-releases" };
    const r2 = {
      base_url: "https://downloads.example.test/desktop",
      bucket: "example-releases",
    };
    json(path.join(source, "release-policy.json"), {
      schema: "animama-release-policy/3",
      distributions: { r2, github },
      channel: "stable",
      distribution_basis: {
        commercial: false,
        pocket_tts_onnx_license: "CC-BY-4.0",
      },
      redistribution_reviews: {
        "darwin-arm64": {
          inventory_sha256: sha256(
            path.join(runtime, "licenses/inventory.json"),
          ),
          reviewed_by: "Fixture reviewer",
          reviewed_on: "2026-09-01",
        },
      },
    });
    json(path.join(source, "feature-pack-releases.json"), {
      macos: {
        team_id: "TESTTEAM01",
        signing_identity: "Developer ID Application: Fixture (TESTTEAM01)",
        designated_requirement: "identifier com.animama.document-worker",
      },
      packs: Object.fromEntries(
        ["expanded-included-content", "document-processing"].map((id) => [
          id,
          {
            release_status:
              id === "expanded-included-content" ? "active" : "deferred",
          },
        ]),
      ),
    });
    json(path.join(runtime, "pack-catalog.json"), {
      entries: ["expanded-included-content"].map((id) => ({
        id,
        signing: { publisher: "TESTTEAM01" },
      })),
    });
    json(path.join(runtime, "update-policy.json"), {
      schema: "animama-update-policy/2",
      distribution: { kind: "r2", base_url: r2.base_url },
      channel: "stable",
      team_id: "TESTTEAM01",
    });
    const request = vi
      .fn()
      .mockResolvedValue(new Response("{}", { status: 404 }));
    vi.stubGlobal("fetch", request);
    vi.stubEnv("ANIMAMA_MACOS_NOTARY_PROFILE", "fixture-notary");
    vi.stubEnv("ANIMAMA_RELEASE_DISTRIBUTION", "");
    const stop = new Error("Stop at native builder boundary");
    const build = vi.fn().mockRejectedValue(stop);
    const run = vi.fn();
    vi.resetModules();
    vi.doMock("node:fs", async () => ({
      ...(await vi.importActual("node:fs")),
      statfsSync: () => ({ bavail: 16n * 1024n ** 3n, bsize: 1n }),
    }));
    vi.doMock("../scripts/runtime/common.mjs", async () => ({
      ...(await vi.importActual("../scripts/runtime/common.mjs")),
      desktopRoot: root,
      sourceRoot: source,
      parseTarget: () => ({ output, runtime }),
      run,
    }));
    vi.doMock("../scripts/runtime/icon.mjs", () => ({
      buildIcon: async () => "fixture.icns",
    }));
    vi.doMock("electron-builder", () => ({
      build,
      Arch: { arm64: "arm64" },
      Platform: { MAC: { createTarget: () => "fixture-target" } },
    }));
    try {
      const { releaseMac } =
        await import("../scripts/runtime/release-macos.mjs");
      await expect(releaseMac()).rejects.toBe(stop);
      expect(request).not.toHaveBeenCalled();
      expect(run).toHaveBeenCalledWith(process.execPath, [
        path.join(root, "scripts/runtime/audit.mjs"),
        "--platform",
        "darwin",
        "--arch",
        "arm64",
      ]);
      expect(build).toHaveBeenCalledWith(
        expect.objectContaining({
          publish: "never",
          config: expect.objectContaining({
            forceCodeSigning: true,
            publish: [
              { provider: "generic", url: r2.base_url, channel: "latest" },
            ],
            mac: expect.objectContaining({
              identity: "Fixture (TESTTEAM01)",
            }),
          }),
        }),
      );
      const { macBuilderOptions, parseMacReleaseArgs } =
        await import("../scripts/runtime/release-macos.mjs");
      const submissionId = "a6210454-8054-477c-9b26-b752441828c8";
      expect(
        parseMacReleaseArgs(["--resume-app-notarization", submissionId]),
      ).toEqual({ submissionId });
      expect(() => parseMacReleaseArgs(["--resume"])).toThrow(
        "Expected no arguments",
      );
      expect(() =>
        parseMacReleaseArgs(["--resume-app-notarization", "not-a-uuid"]),
      ).toThrow("submission UUID");
      const resumed = macBuilderOptions({
        app: "/tmp/Animama.app",
        icon: "fixture.icns",
        release: {
          version: "0.1.0",
          distribution: { name: "github", ...github },
          publisher: {
            signing_identity: "Developer ID Application: Fixture (TESTTEAM01)",
          },
        },
      });
      expect(resumed.prepackaged).toBe("/tmp/Animama.app");
      expect(resumed.config.publish).toEqual([
        {
          provider: "github",
          ...github,
          private: false,
          releaseType: "release",
        },
      ]);
      expect(resumed.config.mac).not.toHaveProperty("sign");
      json(path.join(runtime, "pack-catalog.json"), {
        entries: ["document-processing", "expanded-included-content"].map(
          (id) => ({ id, signing: { publisher: "TESTTEAM01" } }),
        ),
      });
      await expect(releaseMac()).rejects.toThrow(
        "deferred packs must be absent",
      );
      json(path.join(runtime, "pack-catalog.json"), {
        entries: [
          {
            id: "expanded-included-content",
            signing: { publisher: "TESTTEAM01" },
          },
        ],
      });
      // An R2 stage cannot be packaged as a GitHub candidate, or vice versa.
      vi.stubEnv("ANIMAMA_RELEASE_DISTRIBUTION", "github");
      await expect(releaseMac()).rejects.toThrow(
        "ANIMAMA_RELEASE_DISTRIBUTION",
      );
      expect(build).toHaveBeenCalledTimes(1);
    } finally {
      for (const module of [
        "node:fs",
        "../scripts/runtime/common.mjs",
        "../scripts/runtime/icon.mjs",
        "electron-builder",
      ])
        vi.doUnmock(module);
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });

  it.each(["--confirm-preview-publication", "--confirm-publication"])(
    "refuses %s for a private repository before preparing artifacts or uploading",
    async (operation) => {
      const github = {
        kind: "github",
        owner: "example",
        repo: "private-releases",
      };
      const request = vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify({ private: true })));
      vi.stubGlobal("fetch", request);
      const verifyIndex = vi.fn();
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      const previousArgs = process.argv;
      const previousExitCode = process.exitCode;
      process.argv = [process.execPath, "publish-macos.mjs", operation];
      vi.resetModules();
      vi.doMock("../scripts/runtime/release-policy.mjs", () => ({
        isPublicReleaseRepository,
        loadReleasePolicy: () => ({
          distribution: {
            name: "github",
            owner: "example",
            repo: "private-releases",
          },
          updatePolicy: { distribution: github },
        }),
      }));
      vi.doMock("../scripts/runtime/release-artifacts.mjs", async () => ({
        ...(await vi.importActual("../scripts/runtime/release-artifacts.mjs")),
        candidateDistribution: () => github,
        verifyArtifactIndex: verifyIndex,
      }));
      try {
        await import("../scripts/runtime/publish-macos.mjs");
        expect(process.exitCode).toBe(1);
        expect(log).toHaveBeenCalledWith(
          "Publication requires an anonymously readable public release repository",
        );
        expect(verifyIndex).not.toHaveBeenCalled();
        expect(request).toHaveBeenCalledTimes(1);
        expect(request.mock.calls[0][1]).not.toHaveProperty("body");
      } finally {
        process.argv = previousArgs;
        process.exitCode = previousExitCode;
        log.mockRestore();
        vi.doUnmock("../scripts/runtime/release-policy.mjs");
        vi.doUnmock("../scripts/runtime/release-artifacts.mjs");
        vi.resetModules();
      }
    },
  );

  it.each([
    [
      "a candidate built for another distribution",
      "github",
      "r2",
      "built for a different distribution",
    ],
    [
      "a candidate that records no distribution",
      "github",
      null,
      "records none",
    ],
  ])(
    "refuses %s before any network request",
    async (_label, selected, built, message) => {
      const distributions = {
        r2: { kind: "r2", base_url: "https://downloads.example.test/desktop" },
        github: { kind: "github", owner: "example", repo: "releases" },
      };
      const request = vi.fn();
      vi.stubGlobal("fetch", request);
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      const previousArgs = process.argv;
      const previousExitCode = process.exitCode;
      process.argv = [
        process.execPath,
        "publish-macos.mjs",
        "--confirm-preview-publication",
      ];
      vi.resetModules();
      vi.doMock("../scripts/runtime/release-policy.mjs", () => ({
        isPublicReleaseRepository,
        loadReleasePolicy: () => ({
          distribution: { name: selected },
          updatePolicy: { distribution: distributions[selected] },
        }),
      }));
      vi.doMock("../scripts/runtime/release-artifacts.mjs", async () => ({
        ...(await vi.importActual("../scripts/runtime/release-artifacts.mjs")),
        candidateDistribution: () => (built ? distributions[built] : null),
      }));
      try {
        await import("../scripts/runtime/publish-macos.mjs");
        expect(process.exitCode).toBe(1);
        expect(log).toHaveBeenCalledWith(expect.stringContaining(message));
        expect(request).not.toHaveBeenCalled();
      } finally {
        process.argv = previousArgs;
        process.exitCode = previousExitCode;
        log.mockRestore();
        vi.doUnmock("../scripts/runtime/release-policy.mjs");
        vi.doUnmock("../scripts/runtime/release-artifacts.mjs");
        vi.resetModules();
      }
    },
  );

  it("checks an R2 candidate's public feed anonymously before any credential or report", async () => {
    const r2 = {
      kind: "r2",
      base_url: "https://downloads.example.test/desktop",
    };
    const request = vi
      .fn()
      .mockResolvedValue(new Response(null, { status: 503 }));
    vi.stubGlobal("fetch", request);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const verifyIndex = vi.fn();
    const previousArgs = process.argv;
    const previousExitCode = process.exitCode;
    process.argv = [
      process.execPath,
      "publish-macos.mjs",
      "--confirm-preview-publication",
    ];
    vi.resetModules();
    vi.doMock("../scripts/runtime/release-policy.mjs", () => ({
      isPublicReleaseRepository,
      loadReleasePolicy: () => ({
        version: "0.2.0",
        distribution: { name: "r2", ...r2, bucket: "example-releases" },
        updatePolicy: { distribution: r2 },
      }),
    }));
    vi.doMock("../scripts/runtime/release-artifacts.mjs", async () => ({
      ...(await vi.importActual("../scripts/runtime/release-artifacts.mjs")),
      candidateDistribution: () => r2,
      verifyArtifactIndex: verifyIndex,
    }));
    try {
      await import("../scripts/runtime/publish-macos.mjs");
      expect(process.exitCode).toBe(1);
      expect(log).toHaveBeenCalledWith(
        expect.stringContaining("public R2 domain"),
      );
      expect(request).toHaveBeenCalledTimes(1);
      expect(String(request.mock.calls[0][0])).toMatch(
        /^https:\/\/downloads\.example\.test\/desktop\/latest-mac\.yml\?noCache=/u,
      );
      expect(request.mock.calls[0][1]).not.toHaveProperty("headers");
      expect(verifyIndex).not.toHaveBeenCalled();
    } finally {
      process.argv = previousArgs;
      process.exitCode = previousExitCode;
      log.mockRestore();
      vi.doUnmock("../scripts/runtime/release-policy.mjs");
      vi.doUnmock("../scripts/runtime/release-artifacts.mjs");
      vi.resetModules();
    }
  });

  it("publishes only artifacts covered by a passing pinned release scan", () => {
    const root = fixture();
    const files = [
      { name: "Animama-0.1.0-arm64.dmg", sha256: "a".repeat(64) },
      { name: "manual-acceptance.json", sha256: "b".repeat(64) },
    ];
    const receipt = {
      schema: "animama-release-scan/1",
      result: "pass",
      scanner: {
        name: "gitleaks",
        version: "8.30.1",
        canary: "detected",
        config_sha256: sha256(
          path.join(desktopRoot, "runtime/release-scan.gitleaks.toml"),
        ),
      },
      files: [{ name: "Animama-0.1.0-arm64.dmg", sha256: "a".repeat(64) }],
    };
    const write = (value) =>
      writeFileSync(
        path.join(root, "release-scan.json"),
        JSON.stringify(value),
      );
    expect(() => verifyScanReceipt(root, files)).toThrow(
      "passing release scan",
    );
    write(receipt);
    // Post-scan files (acceptance, smoke copies, regenerated index) are exempt.
    expect(() => verifyScanReceipt(root, files)).not.toThrow();
    write({ ...receipt, result: "fail" });
    expect(() => verifyScanReceipt(root, files)).toThrow(
      "passing release scan",
    );
    write({ ...receipt, scanner: { ...receipt.scanner, version: "8.0.0" } });
    expect(() => verifyScanReceipt(root, files)).toThrow(
      "passing release scan",
    );
    // A receipt produced with a different (possibly weakened) config is refused.
    write({
      ...receipt,
      scanner: { ...receipt.scanner, config_sha256: "d".repeat(64) },
    });
    expect(() => verifyScanReceipt(root, files)).toThrow(
      "passing release scan",
    );
    write(receipt);
    expect(() =>
      verifyScanReceipt(root, [{ ...files[0], sha256: "c".repeat(64) }]),
    ).toThrow("does not cover these exact artifacts");
  });

  it("reads the distribution a runtime and a candidate were sealed for", () => {
    const root = fixture();
    const r2 = {
      kind: "r2",
      base_url: "https://downloads.example.test/desktop",
    };
    expect(candidateDistribution(root)).toBeNull();
    expect(() => sealedDistribution(root)).toThrow();
    writeFileSync(
      path.join(root, "update-policy.json"),
      JSON.stringify({ schema: "animama-update-policy/2", distribution: r2 }),
    );
    expect(sealedDistribution(root)).toEqual(r2);
    writeFileSync(
      path.join(root, "signing-report.json"),
      JSON.stringify({ distribution: r2 }),
    );
    expect(candidateDistribution(root)).toEqual(r2);
    writeFileSync(
      path.join(root, "signing-report.json"),
      JSON.stringify({ distribution: { kind: "s3" } }),
    );
    expect(candidateDistribution(root)).toBeNull();
  });

  it("writes feed sizes and checksums from final bytes and detects later artifact replacement", async () => {
    const root = fixture();
    for (const extension of ["dmg", "zip"])
      writeFileSync(
        path.join(root, `Animama-0.1.0-arm64.${extension}`),
        `archive fixture ${extension}`,
      );
    const manifest = {
      app_version: "0.1.0",
      build_id: "a".repeat(64),
      minimum_os: "15.0",
    };
    const github = { kind: "github", owner: "example", repo: "releases" };
    const feed = await updateFeed(
      root,
      manifest,
      2000,
      { entries: [] },
      github,
    );
    // GitHub's provider supplies the tag from the release itself.
    expect(feed).not.toHaveProperty("tag");
    const candidate = validateUpdateCandidate(
      { ...feed, tag: "v0.1.0" },
      "0.0.9",
      github,
    );
    // R2 feeds sit above version folders and carry their own tag.
    const r2 = {
      kind: "r2",
      base_url: "https://downloads.example.test/desktop",
    };
    const r2Feed = await updateFeed(root, manifest, 2000, { entries: [] }, r2);
    expect(r2Feed.tag).toBe("v0.1.0");
    expect(r2Feed.files.map((file) => file.url)).toEqual([
      "v0.1.0/Animama-0.1.0-arm64.zip",
      "v0.1.0/Animama-0.1.0-arm64.dmg",
    ]);
    expect(r2Feed.path).toBe("v0.1.0/Animama-0.1.0-arm64.zip");
    expect(validateUpdateCandidate(r2Feed, "0.0.9", r2).downloadBytes).toBe(
      candidate.downloadBytes,
    );
    await expect(
      updateFeed(
        root,
        { app_version: "0.1.0", minimum_os: "13.0" },
        2000,
        { entries: [] },
        github,
      ),
    ).rejects.toThrow("macOS 15 runtime manifest");
    expect(candidate.downloadBytes).toBe(
      readFileSync(path.join(root, candidate.filename)).length,
    );
    writeArtifactIndex(
      root,
      "0.1.0",
      feed.files.map((file) => file.url),
    );
    expect(verifyArtifactIndex(root).files).toHaveLength(2);
    writeFileSync(path.join(root, candidate.filename), "replacement");
    expect(() => verifyArtifactIndex(root)).toThrow(
      "changed after verification",
    );
  });

  it("sanitizes network evidence while rejecting remote storage and second media hosts", () => {
    const origin = "http://127.0.0.1:41234";
    const local = classifySmokeRequest(
      `${origin}/v1/animas/private-owner/runtime/revisions/private-revision/files/private-file`,
      origin,
    );
    expect(local).toEqual({
      origin: "gateway",
      family: "typed-byte",
      forbidden: false,
    });
    for (const url of [
      "https://bucket.r2.cloudflarestorage.com/object?X-Amz-Signature=secret",
      "https://media.invalid/private-avatar.glb",
    ]) {
      const category = classifySmokeRequest(url, origin);
      expect(category.forbidden).toBe(true);
      expect(JSON.stringify(category)).not.toMatch(
        /secret|private-avatar|private-owner/u,
      );
    }
  });

  it("rejects obsolete or mismatched setup smoke evidence before publication", () => {
    const expected = {
      artifactSha256: "a".repeat(64),
      runtimeBuildId: "build-1",
    };
    const smoke = {
      passed: true,
      setup: "name",
      dmg_sha256: expected.artifactSha256,
      runtime_build_id: expected.runtimeBuildId,
      checks: {
        required_private_name: true,
        empty_name_rejected: true,
        blank_name_rejected: true,
        adult_confirmation_required: true,
        setup_steps: true,
        first_anima_chat: true,
        temporary_provider_removed: true,
        temporary_provider_removal_persists: true,
      },
    };
    const network = { violations: 0 };
    expect(acceptsRequiredNameSmoke(smoke, network, expected)).toBe(true);
    for (const invalid of [
      { ...smoke, setup: "skip" },
      { ...smoke, checks: { optional_name: true } },
      { ...smoke, checks: { ...smoke.checks, first_anima_chat: false } },
      { ...smoke, checks: { ...smoke.checks, setup_steps: false } },
      {
        ...smoke,
        checks: { ...smoke.checks, temporary_provider_removed: false },
      },
      {
        ...smoke,
        checks: { ...smoke.checks, temporary_provider_removal_persists: false },
      },
      { ...smoke, cleanup_required: "Manual key removal required" },
      { ...smoke, dmg_sha256: "b".repeat(64) },
      { ...smoke, runtime_build_id: "another-build" },
      { ...smoke, passed: false },
      null,
    ]) {
      expect(acceptsRequiredNameSmoke(invalid, network, expected)).toBe(false);
    }
    expect(acceptsRequiredNameSmoke(smoke, { violations: 1 }, expected)).toBe(
      false,
    );
  });

  it("does not substitute automated tests for exact native/manual artifact acceptance", () => {
    const accepted = {
      schema: "animama-macos-acceptance/1",
      app_version: "0.1.0",
      dmg_sha256: "a".repeat(64),
      reviewed_by: "Fixture reviewer",
      reviewed_on: "2026-09-01",
      prior_signed_version: "0.0.9",
      checks: Object.fromEntries(manualMacChecks.map((name) => [name, true])),
    };
    expect(
      validateManualAcceptance(accepted, "a".repeat(64), "0.1.0").checks
        .pocket_tts,
    ).toBe(true);
    expect(() =>
      validateManualAcceptance(accepted, "b".repeat(64), "0.1.0"),
    ).toThrow("exact DMG");
    expect(() =>
      validateManualAcceptance(
        { ...accepted, checks: { ...accepted.checks, microphone: false } },
        "a".repeat(64),
        "0.1.0",
      ),
    ).toThrow();
    expect(() =>
      validateManualAcceptance(
        { ...accepted, prior_signed_version: "0.2.0" },
        "a".repeat(64),
        "0.1.0",
      ),
    ).toThrow();
  });

  it("orders native leaves before nested bundles so runtime hashes can be sealed last", () => {
    const root = fixture();
    for (const name of [
      "Contents/MacOS/Animama",
      "Contents/Frameworks/Helper.app/Contents/MacOS/Helper",
      "Contents/Resources/runtime/backend/native.so",
    ]) {
      mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
      writeFileSync(path.join(root, name), Buffer.from("feedfacf", "hex"));
    }
    const code = nestedCode(root, componentInventory(root));
    expect(code.native[0]).toBe(
      "Contents/Frameworks/Helper.app/Contents/MacOS/Helper",
    );
    expect(code.bundles).toEqual(["Contents/Frameworks/Helper.app"]);
    expect(code.native).toContain(
      "Contents/Resources/runtime/backend/native.so",
    );
  });

  it.each([
    [],
    ["--platform", "darwin", "--arch", "x64"],
    ["--platform", "../../", "--arch", "arm64"],
    ["--platform", "darwin", "--arch", "arm64", "--arhc", "arm64"],
  ])("rejects invalid target args before staging (%j)", (args) => {
    expect(() => parseTarget(args)).toThrow();
  });
  it.each(["/etc/passwd", "a/../b", "a//b", "a\\b", "a\u0000b", "C:/b"])(
    "rejects unsafe manifest paths (%s)",
    (name) => {
      expect(() => assertPortablePath(name)).toThrow();
    },
  );
  it("detects tampered and unexpected bytes", () => {
    const root = fixture();
    const inventory = inventoryTree(root);
    expect(assertInventory(root, inventory)).toEqual(inventory);
    writeFileSync(path.join(root, "data.json"), "changed");
    expect(() => assertInventory(root, inventory)).toThrow(
      "inventory mismatch",
    );
    writeFileSync(path.join(root, "data.json"), "{}");
    writeFileSync(path.join(root, "unexpected"), "new");
    expect(() => assertInventory(root, inventory)).toThrow(
      "inventory mismatch",
    );
  });
  it("removes Finder metadata and empty aliases without deleting application bytes", () => {
    const root = fixture();
    mkdirSync(path.join(root, "effects/vfx"), { recursive: true });
    writeFileSync(path.join(root, "effects/vfx/.DS_Store"), "metadata");
    removeFinderMetadata(root);
    expect(existsSync(path.join(root, "effects"))).toBe(false);
    expect(inventoryTree(root).map((file) => file.path)).toEqual(["data.json"]);
  });
  it.skipIf(!symlinksAvailable)(
    "rejects linked Finder metadata and staged links",
    () => {
      const root = fixture();
      symlinkSync(path.join(root, "data.json"), path.join(root, ".DS_Store"));
      expect(() => removeFinderMetadata(root)).toThrow("Non-regular");
      rmSync(path.join(root, ".DS_Store"));
      symlinkSync(path.join(root, "data.json"), path.join(root, "link"));
      expect(() => inventoryTree(root)).toThrow("Non-regular");
    },
  );
  // Windows has no POSIX execute bits.
  it.skipIf(process.platform === "win32")(
    "rejects executable-bit changes",
    () => {
      const root = fixture();
      const inventory = inventoryTree(root);
      chmodSync(path.join(root, "data.json"), 0o755);
      expect(() => assertInventory(root, inventory)).toThrow();
    },
  );
  it("does not allow a JS package to escape into developer node_modules", () => {
    const meta = (name) => ({
      inputs: {},
      outputs: { "main.js": { imports: [{ path: name, external: true }] } },
    });
    for (const name of ["electron", "node:fs"])
      expect(() => assertBundledImports(meta(name))).not.toThrow();
    expect(() => assertBundledImports(meta("hono"))).toThrow(
      "Undeclared runtime import",
    );
    expect(() =>
      assertBundledImports({
        inputs: { "node_modules/better-auth/index.js": {} },
        outputs: {},
      }),
    ).toThrow("Better Auth");
    for (const name of [
      "node_modules/hono/dist/index.js",
      "node_modules/@hono/node-server/dist/index.js",
      "../server/src/app.ts",
    ])
      expect(() =>
        assertBundledImports({ inputs: { [name]: {} }, outputs: {} }),
      ).toThrow("Hono");
  });
});

describe("size gates", () => {
  const report = {
    target: "darwin-arm64",
    app_version: "0.1.0",
    installed_bytes: 100,
    download_bytes: 50,
    components: [{ name: "electron", installed_bytes: 100 }],
    packs: {},
  };
  const budgets = {
    core: { installed_bytes: 100, download_bytes: 50 },
    regression_percent: 5,
    packs: {},
  };
  const noApprovals = { schema: "animama-size-approvals/1", approvals: [] };
  const baseline = { app_version: null, targets: {} };
  it("has no invented released baseline and enforces hard caps", () => {
    expect(
      checkSizes(report, budgets, baseline, { exceptions: [] }, noApprovals)
        .failures,
    ).toEqual([]);
    expect(
      checkSizes(
        { ...report, installed_bytes: 101 },
        budgets,
        baseline,
        { exceptions: [] },
        noApprovals,
      ).failures,
    ).toHaveLength(1);
  });
  it("rejects an unapproved or expired regression exception", () => {
    const previous = {
      app_version: "0.0.9",
      targets: { "darwin-arm64": { components: { electron: 90 } } },
    };
    const exception = {
      id: "SIZE-TEST",
      component: "electron",
      target: "darwin-arm64",
      approved_byte_ceiling: 100,
      rationale: "Runtime security update",
      author: "owner",
      approval_date: "2026-09-01",
      last_applicable_app_version: "0.1.0",
    };
    expect(
      checkSizes(
        report,
        budgets,
        previous,
        { exceptions: [exception] },
        noApprovals,
        "2026-09-01",
      ).failures,
    ).toHaveLength(1);
    expect(
      checkSizes(
        report,
        budgets,
        previous,
        { exceptions: [exception] },
        { ...noApprovals, approvals: [{ ...exception, decision: "approved" }] },
        "2026-09-01",
      ).failures,
    ).toEqual([]);
    expect(
      checkSizes(
        { ...report, app_version: "0.2.0" },
        budgets,
        previous,
        { exceptions: [exception] },
        { ...noApprovals, approvals: [{ ...exception, decision: "approved" }] },
        "2026-09-01",
      ).failures,
    ).toHaveLength(1);
  });
  it("reads durable approval inputs without any private planning checkout", () => {
    expect(validateSizeReport(report).failures).toEqual([]);
  });
  it("rejects malformed approval records and an approval for different bytes", () => {
    expect(() =>
      checkSizes(report, budgets, baseline, { exceptions: [] }, "SIZE-TEST"),
    ).toThrow("animama-size-approvals/1");
    const exception = {
      id: "SIZE-TEST",
      component: "core.installed",
      target: report.target,
      approved_byte_ceiling: 101,
      rationale: "Reviewed native dependency",
      author: "owner",
      approval_date: "2026-09-01",
      last_applicable_app_version: "0.1.0",
    };
    const approvals = {
      ...noApprovals,
      approvals: [
        { ...exception, approved_byte_ceiling: 100, decision: "approved" },
      ],
    };
    expect(
      checkSizes(
        { ...report, installed_bytes: 101 },
        budgets,
        baseline,
        { exceptions: [exception] },
        approvals,
        "2026-09-01",
      ).failures,
    ).toHaveLength(1);
  });
});
