import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RuntimeSupervisor } from "../src/main-process/runtime/supervisor.js";
import { runtimePaths } from "../src/main-process/runtime/paths.js";
import { atomicWrite } from "../src/main-process/runtime/atomic-file.js";
import {
  manifestDigest,
  versionDirectory,
  PACK_METADATA,
  type PackManifest,
} from "../src/main-process/feature-packs/catalog.js";

const fixture = vi.hoisted(() => {
  type Child = {
    name: string;
    env: Record<string, string>;
    args: string[];
    child: { pid: number };
    output: string;
    exit: Promise<void>;
    finish(): void;
  };
  const launches: Child[] = [];
  const owners: Set<Child>[] = [];
  const state = {
    schema_version: 1,
    postgresql_version: "16.15",
    pgvector_version: "0.8.6",
    alembic_head: "baseline_20260908",
    installation_principal_id: "11111111-1111-4111-8111-111111111111",
  };
  const health = {
    schema_version: 1,
    runtime_version: "0.1.0",
    build_id: "b".repeat(64),
    alembic_head: state.alembic_head,
    installation_principal_id: state.installation_principal_id,
  };
  const promote = vi.fn(async () => undefined);
  const drain = vi.fn(async () => undefined);
  const close = vi.fn(async () => undefined);
  const bootstrap = vi.fn();
  const bind = vi.fn(async (config: { port: number }) => ({
    origin: new URL(`http://127.0.0.1:${config.port || 41234}`),
    promote,
    drain,
    close,
    setBootstrapState: bootstrap,
  }));
  return {
    launches,
    owners,
    state,
    health,
    promote,
    drain,
    close,
    bootstrap,
    bind,
    verify: vi.fn(),
    postgresStarts: vi.fn(),
    postgresStops: vi.fn(),
    command: vi.fn(),
  };
});

vi.mock("animama-frontend-server/gateway", () => ({
  createFrontendGateway: fixture.bind,
}));
vi.mock("../src/main-process/runtime/manifest.js", () => ({
  verifyRuntime: fixture.verify,
}));
vi.mock("../src/main-process/runtime/ports.js", () => ({
  unusedLoopbackPort: async () => 41235,
}));
vi.mock("../src/main-process/runtime/processes.js", () => ({
  runCommand: fixture.command,
  OwnedProcesses: class {
    children = new Set<(typeof fixture.launches)[number]>();
    constructor() {
      fixture.owners.push(this.children);
    }
    launch(
      name: string,
      _executable: string,
      args: string[],
      env: Record<string, string>,
    ) {
      let done!: () => void;
      const exit = new Promise<void>((resolve) => {
        done = resolve;
      });
      const child = {
        name,
        env,
        args,
        child: { pid: 1000 + fixture.launches.length },
        output: "",
        exit,
        finish: () => {
          this.children.delete(child);
          done();
        },
      };
      this.children.add(child);
      fixture.launches.push(child);
      return child;
    }
    async terminate(child: (typeof fixture.launches)[number]) {
      if (this.children.has(child)) child.finish();
    }
    async terminateAll() {
      for (const child of this.children) child.finish();
    }
  },
}));
vi.mock("../src/main-process/runtime/postgres.js", () => ({
  PrivatePostgres: class {
    port = 41236;
    process?: (typeof fixture.launches)[number];
    constructor(
      _runtime: string,
      private paths: ReturnType<typeof runtimePaths>,
      private owned: {
        launch: (...args: unknown[]) => (typeof fixture.launches)[number];
        terminate: (child: unknown) => Promise<void>;
      },
    ) {}
    bin(name: string) {
      return name;
    }
    async start(password: string) {
      fixture.postgresStarts();
      mkdirSync(this.paths.pgData, { recursive: true });
      writeFileSync(path.join(this.paths.pgData, "PG_VERSION"), "16\n");
      this.process = this.owned.launch("postgres", "postgres", [], {});
      return { PGPORT: String(this.port), PGPASSWORD: password };
    }
    async stop() {
      fixture.postgresStops();
      if (this.process) await this.owned.terminate(this.process);
    }
  },
}));

const roots: string[] = [];
let runtime: RuntimeSupervisor | undefined;
beforeEach(() => {
  vi.clearAllMocks();
  fixture.launches.splice(0);
  fixture.owners.splice(0);
  fixture.verify.mockResolvedValue({
    app_version: "0.1.0",
    build_id: fixture.health.build_id,
    alembic_head: fixture.state.alembic_head,
    postgresql: { pgvector: "0.8.6" },
  });
  fixture.command.mockResolvedValue(JSON.stringify(fixture.state));
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json(fixture.health)),
  );
});
afterEach(async () => {
  await runtime?.stop();
  runtime = undefined;
  vi.unstubAllGlobals();
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});
function create(
  paths = runtimePaths(
    mkdtempSync(path.join(realpathSync(tmpdir()), "animama-supervisor-")),
  ),
) {
  roots.push(paths.base);
  const options = {
    runtimeRoot: path.join(paths.base, "fixture-runtime"),
    appVersion: "0.1.0",
    paths,
    // Fake encryption isolates orchestration; vault tests exercise encryption separately.
    encryption: {
      isEncryptionAvailable: () => true,
      encryptString: (value: string) => Buffer.from(value),
      decryptString: (value: Buffer) => value.toString(),
    },
    bootstrapHtml: () => "starting",
    onStatus: vi.fn(),
    quiesceRenderers: vi.fn(async () => undefined),
  };
  mkdirSync(options.runtimeRoot, { recursive: true });
  const catalog = {
    schema: "animama-pack-catalog/1",
    app_version: options.appVersion,
    entries: [],
  };
  writeFileSync(
    path.join(options.runtimeRoot, "pack-catalog.json"),
    JSON.stringify({
      id: createHash("sha256").update(JSON.stringify(catalog)).digest("hex"),
      ...catalog,
    }),
  );
  runtime = new RuntimeSupervisor(options);
  return { runtime, options };
}

/** A data-only fixture exercises custody and transitions, not real model inference. */
function seedSpeechPack(
  options: ReturnType<typeof create>["options"],
  id: "parakeet-stt" | "expanded-included-content" = "parakeet-stt",
  appVersions = ["0.1.0"],
) {
  const manifest: PackManifest = {
    schema: "animama-feature-pack/1",
    id,
    display_name: "Fixture speech",
    version: "0.1.0",
    app_versions: appVersions,
    platform: "data-only",
    architecture: "data-only",
    url: "https://github.com/example/animama/releases/download/v0.1.0/speech.tar.zst",
    archive_bytes: 100,
    archive_sha256: "a".repeat(64),
    installed_bytes: 2,
    minimum_peak_free_bytes: 100,
    license_refs: ["fixture"],
    signing: null,
    files: [
      {
        path: "config.json",
        size_bytes: 2,
        sha256: createHash("sha256").update("{}").digest("hex"),
        media_type: "application/json",
        mode: "0644",
      },
    ],
  };
  const root = path.join(
    options.paths.packs,
    `${id}/versions`,
    versionDirectory(manifest),
  );
  mkdirSync(root, { recursive: true });
  writeFileSync(path.join(root, "config.json"), "{}", { mode: 0o644 });
  writeFileSync(path.join(root, PACK_METADATA), JSON.stringify(manifest));
  atomicWrite(
    path.join(options.paths.packs, "active.json"),
    JSON.stringify({
      schema: 1,
      packs: {
        [id]: {
          directory: versionDirectory(manifest),
          digest: manifestDigest(manifest),
        },
      },
    }),
  );
  const catalog = {
    schema: "animama-pack-catalog/1",
    app_version: "0.1.0",
    entries: [manifest],
  };
  writeFileSync(
    path.join(options.runtimeRoot, "pack-catalog.json"),
    JSON.stringify({
      id: createHash("sha256").update(JSON.stringify(catalog)).digest("hex"),
      ...catalog,
    }),
  );
  return root;
}

function allowRemoval() {
  vi.mocked(fetch).mockImplementation(async (input) => {
    if (String(input).includes(":removal-check"))
      return Response.json({
        schema_version: 1,
        pack_id: "parakeet-stt",
        removable: true,
        blockers: [],
      });
    return Response.json(fixture.health);
  });
}

describe("runtime supervision", () => {
  const update = {
    version: "0.2.0",
    filename: "Animama-0.2.0-arm64.zip",
    sha512: "",
    downloadBytes: 1000,
    installedBytes: 5000,
    runtimeBuildId: "c".repeat(64),
    packDigests: {},
  };

  it("blocks an update that withdraws referenced expanded content before draining any service", async () => {
    const current = create();
    seedSpeechPack(current.options, "expanded-included-content");
    await current.runtime.start();
    fixture.drain.mockClear();
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({
        schema_version: 1,
        pack_id: "expanded-included-content",
        removable: false,
        blockers: [{ kind: "anima_loadout", id: "anima", label: "My Anima" }],
      }),
    );
    await expect(current.runtime.stopForUpdate(update)).rejects.toThrow(
      "update_pack_references_blocked",
    );
    expect(current.runtime.status().state).toBe("ready");
    expect(fixture.drain).not.toHaveBeenCalled();
    expect(fixture.owners.some((children) => children.size > 0)).toBe(true);
  });

  it("accepts an exact compatible expanded manifest without withdrawing its references", async () => {
    const current = create();
    seedSpeechPack(current.options, "expanded-included-content", [
      "0.1.0",
      "0.2.0",
    ]);
    await current.runtime.start();
    const expanded = current.runtime.featurePacks().activePacks()[
      "expanded-included-content"
    ]!;
    vi.mocked(fetch).mockClear();
    await current.runtime.preflightUpdate({
      ...update,
      packDigests: {
        "expanded-included-content": manifestDigest(expanded.manifest),
      },
    });
    expect(current.runtime.status().state).toBe("ready");
    expect(fetch).not.toHaveBeenCalled();
    expect(existsSync(expanded.root)).toBe(true);
  });

  it("stops every owned service for an approved update and resumes only on explicit native failure", async () => {
    const current = create();
    await current.runtime.start();
    await current.runtime.stopForUpdate(update);
    expect(current.runtime.status()).toEqual({ state: "updating" });
    expect(fixture.owners.every((children) => children.size === 0)).toBe(true);
    expect(current.options.quiesceRenderers).toHaveBeenCalledOnce();
    expect(() => current.runtime.changePack("install", "parakeet-stt")).toThrow(
      "runtime_not_ready",
    );
    await current.runtime.start(); // An ordinary Retry cannot resume writes during native replacement.
    expect(current.runtime.status()).toEqual({ state: "updating" });
    expect(fixture.owners.every((children) => children.size === 0)).toBe(true);
    await current.runtime.recoverFailedUpdate();
    expect(current.runtime.status().state).toBe("ready");
    expect(current.runtime.origin).toBe("http://127.0.0.1:41234");
    expect(
      existsSync(path.join(current.options.paths.pgData, "PG_VERSION")),
    ).toBe(true);
  });

  it.each([false, true])(
    "aborts an update safely when renderer drain fails (recovery failure=%s)",
    async (failRecovery) => {
      const current = create();
      await current.runtime.start();
      current.options.quiesceRenderers.mockRejectedValueOnce(
        new Error("fixture drain failure"),
      );
      if (failRecovery)
        fixture.promote.mockRejectedValueOnce(
          new Error("fixture backend recovery failure"),
        );
      await expect(current.runtime.stopForUpdate(update)).rejects.toThrow(
        "fixture drain failure",
      );
      expect(current.runtime.status().state).toBe(
        failRecovery ? "error" : "ready",
      );
      expect(fixture.owners.every((children) => children.size === 0)).toBe(
        failRecovery,
      );
      expect(
        existsSync(path.join(current.options.paths.pgData, "PG_VERSION")),
      ).toBe(true);
    },
  );

  it("rejects an invalid replacement manifest before PostgreSQL or schema commands run", async () => {
    fixture.verify.mockRejectedValueOnce(new Error("invalid manifest"));
    const current = create();
    await current.runtime.start();
    expect(current.runtime.status().state).toBe("error");
    expect(fixture.postgresStarts).not.toHaveBeenCalled();
    expect(fixture.command).not.toHaveBeenCalled();
  });

  it("reports a bounded removal blocker without draining the app or changing the pack", async () => {
    const current = create();
    const root = seedSpeechPack(current.options);
    await current.runtime.start();
    const drainsBefore = fixture.drain.mock.calls.length;
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({
        schema_version: 1,
        pack_id: "parakeet-stt",
        removable: false,
        blockers: [
          { kind: "runtime_lease", id: "lease", label: "Active preview" },
        ],
      }),
    );
    await expect(
      current.runtime.featurePacks().remove("parakeet-stt"),
    ).rejects.toThrow("pack_in_use");
    expect(current.runtime.status().state).toBe("ready");
    expect(current.options.quiesceRenderers).not.toHaveBeenCalled();
    expect(fixture.drain.mock.calls.length).toBe(drainsBefore);
    expect(existsSync(root)).toBe(true);
    expect(current.runtime.featurePacks().list()[0].blockers?.[0].label).toBe(
      "Active preview",
    );
  });

  it.each([false, true])(
    "quiesces the renderer and keeps a stable gateway through removal (rollback=%s)",
    async (fail) => {
      const current = create();
      const root = seedSpeechPack(current.options);
      await current.runtime.start();
      expect(current.runtime.status().state).toBe("ready");
      const pointer = readFileSync(
        path.join(current.options.paths.packs, "active.json"),
        "utf8",
      );
      allowRemoval();
      if (fail)
        fixture.promote.mockRejectedValueOnce(
          new Error("fixture restart failed"),
        );
      const removal = current.runtime.featurePacks().remove("parakeet-stt");
      if (fail) await expect(removal).rejects.toThrow();
      else await removal;
      expect(current.options.quiesceRenderers).toHaveBeenCalledOnce();
      expect(fixture.bind).toHaveBeenCalledOnce();
      expect(fixture.postgresStarts).toHaveBeenCalledOnce();
      expect(current.runtime.status()).toEqual({
        state: "ready",
        origin: "http://127.0.0.1:41234",
      });
      const backend = fixture.launches
        .filter((child) => child.name === "fastapi")
        .at(-1)!;
      expect(backend.env.ANIMAMA_PARAKEET_STT_ENABLED).toBe(fail ? "1" : "0");
      expect(existsSync(root)).toBe(fail);
      if (fail)
        expect(
          readFileSync(
            path.join(current.options.paths.packs, "active.json"),
            "utf8",
          ),
        ).toBe(pointer);
    },
  );

  it("provisions once, reuses the stable origin, rotates launch tokens, and preserves the database identity", async () => {
    const first = create();
    await first.runtime.start();
    expect(first.runtime.status()).toEqual({
      state: "ready",
      origin: "http://127.0.0.1:41234",
    });
    const firstBackend = fixture.launches.find(
      (child) => child.name === "fastapi",
    )!;
    const firstPassword = firstBackend.env.PGPASSWORD;
    expect(firstBackend.args).not.toContain(firstPassword);
    expect(JSON.stringify(first.runtime.status())).not.toContain(
      firstBackend.env.ANIMAMA_INTERNAL_GATEWAY_TOKEN,
    );
    await first.runtime.stop();
    expect(fixture.owners.every((children) => children.size === 0)).toBe(true);
    const second = create(first.options.paths);
    await second.runtime.start();
    const backend = fixture.launches
      .filter((child) => child.name === "fastapi")
      .at(-1)!;
    expect(backend.env.PGPASSWORD).toBe(firstPassword);
    expect(backend.env.ANIMAMA_INTERNAL_GATEWAY_TOKEN).not.toBe(
      firstBackend.env.ANIMAMA_INTERNAL_GATEWAY_TOKEN,
    );
    expect(second.runtime.rendererCapability).not.toBe(
      first.runtime.rendererCapability,
    );
    expect(fixture.bind.mock.calls.at(-1)?.[0].port).toBe(41234);
    expect(
      JSON.parse(readFileSync(second.options.paths.state, "utf8")).gatewayPort,
    ).toBe(41234);
  });

  it("shows stable-port collision recovery without starting a database or changing the saved origin", async () => {
    const current = create();
    atomicWrite(
      current.options.paths.state,
      JSON.stringify({ version: 1, gatewayPort: 45678 }),
    );
    fixture.bind.mockRejectedValueOnce(
      Object.assign(new Error("occupied"), { code: "EADDRINUSE" }),
    );
    await current.runtime.start();
    expect(current.runtime.status()).toEqual({
      state: "error",
      code: "gateway_port_in_use",
    });
    expect(fixture.postgresStarts).not.toHaveBeenCalled();
    await current.runtime.start();
    expect(current.runtime.status()).toEqual({
      state: "ready",
      origin: "http://127.0.0.1:45678",
    });
  });

  it("drains and restarts the provider consumer without restarting PostgreSQL or leaking a key to cleanup", async () => {
    const current = create();
    await current.runtime.start();
    const result = await current.runtime.changeCredential(
      "openai",
      "fixture-provider-key",
    );
    expect(result).toMatchObject({ configured: true, restartRequired: false });
    expect(JSON.stringify(result)).not.toContain("fixture-provider-key");
    expect(fixture.postgresStarts).toHaveBeenCalledOnce();
    expect(
      fixture.launches.filter((child) => child.name === "fastapi"),
    ).toHaveLength(2);
    expect(
      fixture.launches.filter((child) => child.name === "fastapi").at(-1)?.env
        .OPENAI_API_KEY,
    ).toBe("fixture-provider-key");
    expect(
      fixture.launches.find((child) => child.name === "avatar-cleanup")?.env
        .OPENAI_API_KEY,
    ).toBeUndefined();
    await current.runtime.changeCredential("openai");
    expect(
      fixture.launches.filter((child) => child.name === "fastapi").at(-1)?.env
        .OPENAI_API_KEY,
    ).toBeUndefined();
    expect(fixture.drain).toHaveBeenCalledWith(15000);
  });

  it("rejects mismatched backend identity and stops every owned child", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json({
        ...fixture.health,
        installation_principal_id: "another-owner",
      }),
    );
    const current = create();
    await current.runtime.start();
    expect(current.runtime.status()).toEqual({
      state: "error",
      code: "backend_readiness_mismatch",
    });
    expect(fixture.promote).not.toHaveBeenCalled();
    expect(fixture.owners.every((children) => children.size === 0)).toBe(true);
  });

  it("recovers after an owned backend exit without deleting initialized data", async () => {
    const current = create();
    await current.runtime.start();
    fixture.launches.find((child) => child.name === "fastapi")!.finish();
    await vi.waitFor(() =>
      expect(current.runtime.status()).toEqual({
        state: "error",
        code: "backend_exited",
      }),
    );
    await current.runtime.start();
    expect(current.runtime.status().state).toBe("ready");
    expect(
      existsSync(path.join(current.options.paths.pgData, "PG_VERSION")),
    ).toBe(true);
  });
});
