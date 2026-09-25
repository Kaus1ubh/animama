import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CredentialVault,
  validateCredential,
  validateProvider,
  type Encryption,
} from "../src/main-process/runtime/vault.js";
import { atomicWrite } from "../src/main-process/runtime/atomic-file.js";
import {
  migrateLegacyTree,
  prepareDesktopIdentity,
  readRuntimeState,
  runtimePaths,
} from "../src/main-process/runtime/paths.js";
import { SecretRedactor } from "../src/main-process/runtime/redaction.js";
import {
  OwnedProcesses,
  runCommand,
} from "../src/main-process/runtime/processes.js";
import {
  createRendererCapability,
  installRendererCapability,
} from "../src/main-process/security/renderer-capability.js";
import type { App, Session } from "electron";
import { PrivatePostgres } from "../src/main-process/runtime/postgres.js";
import { readBackendReadiness } from "../src/main-process/runtime/readiness.js";
import {
  verifyRuntime,
  supportsRuntimePlatform,
  type RuntimeManifest,
} from "../src/main-process/runtime/manifest.js";

const roots: string[] = [];
function fixture(): string {
  const root = mkdtempSync(
    path.join(realpathSync(tmpdir()), "animama-runtime-state-"),
  );
  roots.push(root);
  return root;
}
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function encryption(): Encryption {
  const key = randomBytes(32);
  return {
    isEncryptionAvailable: () => true,
    encryptString(value) {
      const nonce = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, nonce);
      const ciphertext = Buffer.concat([
        cipher.update(value, "utf8"),
        cipher.final(),
      ]);
      return Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]);
    },
    decryptString(value) {
      const decipher = createDecipheriv(
        "aes-256-gcm",
        key,
        value.subarray(0, 12),
      );
      decipher.setAuthTag(value.subarray(12, 28));
      return Buffer.concat([
        decipher.update(value.subarray(28)),
        decipher.final(),
      ]).toString("utf8");
    },
  };
}

describe("private local state and vault", () => {
  it("persists encrypted credentials and the database password, returning only status", () => {
    const file = path.join(fixture(), "vault.bin");
    const crypto = encryption();
    const vault = new CredentialVault(file, crypto, false);
    const password = vault.databasePassword();
    const key = "fixture-provider-key-not-a-real-credential";
    vault.set("openai", key);
    expect(readFileSync(file).includes(Buffer.from(key))).toBe(false);
    expect(readFileSync(file).includes(Buffer.from(password))).toBe(false);
    expect(lstatSync(file).mode & 0o777).toBe(0o600);
    expect(JSON.stringify(vault.list())).not.toContain(key);
    const restarted = new CredentialVault(file, crypto, true);
    expect(restarted.databasePassword()).toBe(password);
    expect(restarted.childEnvironment()).toEqual({ OPENAI_API_KEY: key });
    expect(
      restarted.list().find((item) => item.provider === "openai"),
    ).toMatchObject({ configured: true, restartRequired: false });
    restarted.delete("openai");
    expect(new CredentialVault(file, crypto, true).childEnvironment()).toEqual(
      {},
    );
    expect(
      new CredentialVault(
        path.join(fixture(), "vault.bin"),
        crypto,
        false,
      ).databasePassword(),
    ).not.toBe(password);
  });

  it("fails closed on unavailable encryption, loss, corruption, and links without replacing data", () => {
    const root = fixture();
    const file = path.join(root, "vault.bin");
    const crypto = encryption();
    expect(
      () =>
        new CredentialVault(
          file,
          { ...crypto, isEncryptionAvailable: () => false },
          false,
        ),
    ).toThrow("secure_storage_unavailable");
    expect(existsSync(file)).toBe(false);
    expect(() => new CredentialVault(file, crypto, true)).toThrow(
      "vault_missing_for_database",
    );
    atomicWrite(file, "corrupt");
    expect(() => new CredentialVault(file, crypto, true)).toThrow(
      "vault_unreadable",
    );
    expect(readFileSync(file, "utf8")).toBe("corrupt");
    const target = path.join(root, "outside");
    mkdirSync(target);
    const link = path.join(root, "linked");
    symlinkSync(target, link);
    expect(() => atomicWrite(path.join(link, "secret"), "secret")).toThrow(
      "private_state_path_invalid",
    );
    expect(existsSync(path.join(target, "secret"))).toBe(false);
  });

  it.each(["", " ", "a\nb", "x".repeat(8193), 42, null])(
    "rejects invalid key inputs without echoing them",
    (value) => {
      expect(() => validateCredential(value)).toThrow(
        "credential_value_invalid",
      );
    },
  );
  it.each(["__proto__", "OPENAI_API_KEY", "../openai", undefined])(
    "rejects unknown providers",
    (provider) => {
      expect(() => validateProvider(provider)).toThrow(
        "credential_provider_invalid",
      );
    },
  );

  it("keeps one stable-port state and refuses malformed or linked state", () => {
    const root = fixture();
    const state = runtimePaths(root).state;
    expect(readRuntimeState(state)).toBeNull();
    atomicWrite(state, JSON.stringify({ version: 1, gatewayPort: 41234 }));
    expect(readRuntimeState(state)?.gatewayPort).toBe(41234);
    expect(readRuntimeState(state)?.gatewayPort).toBe(41234);
    atomicWrite(state, JSON.stringify({ version: 1, gatewayPort: 0 }));
    expect(() => readRuntimeState(state)).toThrow("runtime_state_invalid");
  });

  it("moves one legacy tree once and never merges a second profile", () => {
    const root = fixture();
    const legacy = path.join(root, "Anima");
    const destination = path.join(root, "Animama");
    mkdirSync(legacy);
    writeFileSync(path.join(legacy, "keep"), "profile");
    const journal = path.join(root, "migration.json");
    migrateLegacyTree(legacy, destination, journal);
    migrateLegacyTree(legacy, destination, journal);
    expect(readFileSync(path.join(destination, "keep"), "utf8")).toBe(
      "profile",
    );
    expect(JSON.parse(readFileSync(journal, "utf8")).state).toBe("complete");
    mkdirSync(legacy);
    writeFileSync(path.join(legacy, "new"), "other");
    expect(() => migrateLegacyTree(legacy, destination, journal)).toThrow(
      "legacy_profile_conflict",
    );
    expect(readFileSync(path.join(legacy, "new"), "utf8")).toBe("other");
  });

  it("rejects development-only overrides before creating packaged state", () => {
    const setName = vi.fn();
    const setPath = vi.fn();
    const app = {
      isPackaged: true,
      setName,
      setPath,
      getPath: () => fixture(),
    } as unknown as App;
    vi.stubEnv("ANIMAMA_DESKTOP_WEB_URL", "https://unexpected.invalid");
    expect(() => prepareDesktopIdentity(app)).toThrow(
      "packaged_runtime_override_rejected",
    );
    expect(setName).toHaveBeenCalledWith("Animama");
    expect(setPath).not.toHaveBeenCalled();
  });

  it("creates the selected userData directory before Electron setPath", () => {
    const base = path.join(fixture(), "new-profile");
    vi.stubEnv("ANIMAMA_DESKTOP_DEV_USER_DATA", base);
    const setPath = vi.fn((_name: string, value: string) => {
      // Electron's real setPath rejects a directory that does not exist yet.
      expect(lstatSync(value).isDirectory()).toBe(true);
    });
    const app = {
      isPackaged: false,
      setName: vi.fn(),
      setPath,
      getPath: () => fixture(),
    } as unknown as App;
    expect(prepareDesktopIdentity(app).base).toBe(base);
    expect(setPath).toHaveBeenCalledWith("userData", base);
  });

  it("refuses unsupported database majors before launching or changing the cluster", async () => {
    const paths = runtimePaths(fixture());
    mkdirSync(paths.pgData, { recursive: true });
    writeFileSync(path.join(paths.pgData, "PG_VERSION"), "15\n");
    const owned = new OwnedProcesses(paths.processes);
    const launch = vi.spyOn(owned, "launch");
    await expect(
      new PrivatePostgres("/unused-runtime", paths, owned).start(
        "fixture-password",
      ),
    ).rejects.toThrow("unsupported_postgresql_major");
    expect(launch).not.toHaveBeenCalled();
    expect(readFileSync(path.join(paths.pgData, "PG_VERSION"), "utf8")).toBe(
      "15\n",
    );
  });

  it("installs a fresh, host-only HttpOnly renderer capability without exposing it as runtime status", async () => {
    const first = createRendererCapability();
    const second = createRendererCapability();
    expect(first).toMatch(/^[a-f0-9]{64}$/u);
    expect(second).not.toBe(first);
    const set = vi.fn(async () => undefined);
    await installRendererCapability(
      { cookies: { set } } as unknown as Session,
      "http://127.0.0.1:41234",
      first,
    );
    expect(set).toHaveBeenCalledWith({
      url: "http://127.0.0.1:41234/",
      name: "animama_renderer_capability",
      value: first,
      httpOnly: true,
      secure: false,
      sameSite: "strict",
      path: "/",
    });
  });
});

describe("bounded private readiness", () => {
  it("accepts bounded JSON and rejects malformed or oversized response streams", async () => {
    const report = {
      schema_version: 1,
      runtime_version: "0.1.0",
      build_id: "fixture",
      alembic_head: "fixture",
      installation_principal_id: "owner",
    };
    expect(await readBackendReadiness(Response.json(report))).toEqual(report);
    await expect(
      readBackendReadiness(new Response("not JSON")),
    ).rejects.toThrow("backend_readiness_mismatch");
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(8193));
      },
      cancel,
    });
    await expect(readBackendReadiness(new Response(stream))).rejects.toThrow(
      "backend_readiness_mismatch",
    );
    expect(cancel).toHaveBeenCalledOnce();
  });
});

describe("runtime macOS support boundary", () => {
  it("admits macOS 15 and newer Apple silicon kernels, rejecting older or unknown targets", () => {
    expect(supportsRuntimePlatform("darwin", "arm64", "24.0.0")).toBe(true);
    expect(supportsRuntimePlatform("darwin", "arm64", "25.6.0")).toBe(true);
    for (const release of ["22.0.0", "23.6.0", "unknown", "24", ""])
      expect(supportsRuntimePlatform("darwin", "arm64", release)).toBe(false);
    expect(supportsRuntimePlatform("darwin", "x64", "24.0.0")).toBe(false);
    expect(supportsRuntimePlatform("win32", "arm64", "24.0.0")).toBe(false);
  });
});

describe.skipIf(process.platform !== "darwin" || process.arch !== "arm64")(
  "runtime manifest custody",
  () => {
    async function manifestFixture() {
      const root = fixture();
      const id = "a".repeat(64);
      const payloads = {
        "backend/animama-runtime": "fixture-backend",
        "postgres/bin/postgres": "fixture-postgres",
        "postgres/bin/initdb": "fixture-initdb",
        "postgres/bin/pg_ctl": "fixture-control",
        "postgres/bin/pg_isready": "fixture-ready",
        "postgres/bin/pg_dump": "fixture-dump",
        "postgres/bin/pg_restore": "fixture-restore",
        "web/index.html": "fixture-html",
        "content/included-core/inventory.json": JSON.stringify({ id }),
        "pack-catalog.json": JSON.stringify({ id }),
      };
      const files = Object.entries(payloads)
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([name, payload]) => {
          const target = path.join(root, name);
          mkdirSync(path.dirname(target), { recursive: true });
          writeFileSync(target, payload, { mode: 0o644 });
          return {
            path: name,
            size_bytes: Buffer.byteLength(payload),
            sha256: createHash("sha256").update(payload).digest("hex"),
            mode: "0644",
            critical: false,
            component: "fixture",
          };
        });
      const manifest: RuntimeManifest = {
        schema: "animama-desktop-runtime/2",
        app_version: "0.1.0",
        build_id: createHash("sha256")
          .update(JSON.stringify(files))
          .digest("hex"),
        platform: "darwin",
        architecture: "arm64",
        minimum_os: "15.0",
        postgresql: { major: 16, version: "16.15", pgvector: "0.8.6" },
        alembic_head: "0011_included_mounts",
        local_http_schema_version: 1,
        core_content_inventory_id: id,
        pack_catalog_id: id,
        files,
      };
      writeFileSync(path.join(root, "manifest.json"), JSON.stringify(manifest));
      return { root, manifest };
    }

    it("checks executable hashes even if their manifest critical flag is false", async () => {
      const { root, manifest } = await manifestFixture();
      expect(await verifyRuntime(root, "0.1.0")).toEqual(manifest);
      writeFileSync(
        path.join(root, "backend/animama-runtime"),
        "changed-backend",
      );
      await expect(verifyRuntime(root, "0.1.0")).rejects.toThrow(
        "runtime_manifest_invalid",
      );
    });

    it.each([
      { schema: "animama-desktop-runtime/1" },
      { local_http_schema_version: 0 },
      { gateway_schema_version: 1 },
    ])(
      "rejects old or mixed runtime composition before native launch: %j",
      async (change) => {
        const { root, manifest } = await manifestFixture();
        writeFileSync(
          path.join(root, "manifest.json"),
          JSON.stringify({ ...manifest, ...change }),
        );
        await expect(verifyRuntime(root, "0.1.0")).rejects.toThrow(
          "runtime_manifest_invalid",
        );
      },
    );

    it("rejects composition identifiers that disagree with verified inventories", async () => {
      const { root, manifest } = await manifestFixture();
      manifest.core_content_inventory_id = "b".repeat(64);
      writeFileSync(path.join(root, "manifest.json"), JSON.stringify(manifest));
      await expect(verifyRuntime(root, "0.1.0")).rejects.toThrow(
        "runtime_manifest_invalid",
      );
    });

    it("refuses a stale manifest advertising the earlier OS target", async () => {
      const { root, manifest } = await manifestFixture();
      manifest.minimum_os = "13.0";
      writeFileSync(path.join(root, "manifest.json"), JSON.stringify(manifest));
      await expect(verifyRuntime(root, "0.1.0")).rejects.toThrow(
        "runtime_manifest_invalid",
      );
    });
  },
);

describe("owned processes and secret-safe logs", () => {
  it("redacts values, encoded URLs, headers and provider fields", () => {
    const redactor = new SecretRedactor();
    redactor.add("fake/key+with&symbols");
    const safe = redactor.redact(
      "value=fake/key+with&symbols\nencoded=fake%2Fkey%2Bwith%26symbols\npostgresql+asyncpg://owner:password@localhost/db\nAuthorization: Bearer bearer-fixture\nCookie: private=value\nX-Animama-Principal-Id: owner-fixture\nOPENAI_API_KEY=key-fixture",
    );
    for (const value of [
      "fake/key",
      "fake%2Fkey",
      "password",
      "bearer-fixture",
      "private=value",
      "owner-fixture",
      "key-fixture",
    ])
      expect(safe).not.toContain(value);
  });

  it("keeps ordinary words readable when an implausibly short value is registered", () => {
    const redactor = new SecretRedactor();
    redactor.add("a", "key/1", "x.y");
    expect(redactor.redact("Runtime starting: migrations")).toBe(
      "Runtime starting: migrations",
    );
    expect(redactor.redact("value=a id:key/1 path=monkey/12")).toBe(
      "value=[REDACTED] id:[REDACTED] path=monkey/12",
    );
    expect(redactor.redact("wildcard=xzy literal=x.y")).toBe(
      "wildcard=xzy literal=[REDACTED]",
    );
    expect(redactor.redact("encoded=key%2F1&next=a")).toBe(
      "encoded=[REDACTED]&next=[REDACTED]",
    );
  });

  it("still redacts real-length keys embedded in other text", () => {
    const redactor = new SecretRedactor();
    const key = "sk-proj-0123456789abcdefghijklmn";
    redactor.add(key);
    expect(redactor.redact(`prefix${key}suffix a`)).toBe(
      "prefix[REDACTED]suffix a",
    );
  });

  it("never adopts or signals a live process from an earlier record", () => {
    const file = path.join(fixture(), "processes.json");
    atomicWrite(
      file,
      JSON.stringify({
        version: 1,
        children: [
          {
            pid: process.pid,
            name: "unrelated",
            startToken: "stale",
            executable: "/unrelated",
          },
        ],
      }),
    );
    const kill = vi.spyOn(process, "kill");
    expect(() => new OwnedProcesses(file)).toThrow("previous_runtime_running");
    expect(kill.mock.calls).toEqual([[process.pid, 0]]);
  });

  it("stops only an exact owned child handle and clears the ownership record", async () => {
    const root = fixture();
    const file = path.join(root, "processes.json");
    const owned = new OwnedProcesses(file);
    const child = owned.launch(
      "fixture",
      process.execPath,
      ["-e", "setInterval(()=>{},1000)"],
      {},
      root,
    );
    const unrelatedKill = vi.fn();
    try {
      await owned.terminate({ child: { kill: unrelatedKill } } as never, 100);
      expect(unrelatedKill).not.toHaveBeenCalled();
      await owned.terminate(child, 1000);
      expect(owned.children.size).toBe(0);
      expect(JSON.parse(readFileSync(file, "utf8")).children).toEqual([]);
    } finally {
      await owned.terminate(child, 100);
    }
  });

  it("does not inherit unrelated developer credentials into commands", async () => {
    vi.stubEnv("ANIMAMA_TEST_PRIVATE_SENTINEL", "must-not-leak");
    const output = await runCommand(
      process.execPath,
      [
        "-e",
        "process.stdout.write(String(process.env.ANIMAMA_TEST_PRIVATE_SENTINEL === undefined))",
      ],
      {},
      fixture(),
    );
    expect(output).toBe("true");
  });
});
