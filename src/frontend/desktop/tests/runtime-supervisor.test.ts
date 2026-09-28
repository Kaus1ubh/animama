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
import { normalizeSchemaDump } from "../src/main-process/runtime/schema.js";
import {
  manifestDigest,
  MODEL_PACK_IDS,
  modelObjectUrl,
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
    token: string;
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
  // Stands in for the bundled pg_dump --schema-only output of a current profile.
  const schema =
    "-- Dumped from database version 16.15\nCREATE TABLE public.fixture (id integer);\n";
  return {
    launches,
    owners,
    state,
    health,
    schema,
    ready: vi.fn(),
    quiesce: vi.fn(),
    available: vi.fn(),
    verify: vi.fn(),
    postgresStarts: vi.fn(),
    postgresStops: vi.fn(),
    command: vi.fn(),
  };
});

vi.mock("../src/main-process/runtime/manifest.js", () => ({
  verifyRuntime: fixture.verify,
}));
vi.mock("../src/main-process/runtime/ports.js", () => ({
  unusedLoopbackPort: async () => 41234,
  assertLoopbackPortAvailable: fixture.available,
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
        token: `fixture-process-token-${fixture.launches.length}`,
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
  vi.resetAllMocks();
  fixture.launches.splice(0);
  fixture.owners.splice(0);
  fixture.verify.mockResolvedValue({
    app_version: "0.1.0",
    build_id: fixture.health.build_id,
    alembic_head: fixture.state.alembic_head,
    postgresql: { pgvector: "0.8.6" },
    local_http_schema_version: 1,
    database_schema_sha256: createHash("sha256")
      .update(normalizeSchemaDump(fixture.schema))
      .digest("hex"),
  });
  fixture.command.mockImplementation(async (executable, args) =>
    executable === "pg_dump" && args[0] === "--schema-only"
      ? fixture.schema
      : JSON.stringify(fixture.state),
  );
  fixture.available.mockResolvedValue(undefined);
  fixture.ready.mockImplementation(async () => {
    const child = fixture.launches
      .filter((item) => item.name === "fastapi")
      .at(-1)!;
    return Response.json({
      ...fixture.health,
      local_http_schema_version: 1,
      process_id: child.child.pid,
      process_start_token: child.token,
    });
  });
  fixture.quiesce.mockImplementation(async () =>
    Response.json({ schema_version: 1, state: "quiesced" }),
  );
  vi.stubGlobal("fetch", vi.fn(defaultFetch));
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
  id:
    | "parakeet-stt"
    | "expanded-included-content"
    | ("parakeet-stt" | "parakeet-stt-webgpu")[] = "parakeet-stt",
  appVersions = ["0.1.0"],
) {
  const manifests = (Array.isArray(id) ? id : [id]).map(
    (packId): PackManifest => {
      const common = {
        display_name: "Fixture speech",
        version: "0.1.0",
        app_versions: appVersions,
        platform: "data-only" as const,
        architecture: "data-only" as const,
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
            mode: "0644" as const,
          },
        ],
      };
      if (packId === "expanded-included-content")
        return {
          ...common,
          schema: "animama-feature-pack/1",
          id: packId,
          url: `https://github.com/example/animama/releases/download/v0.1.0/${packId}.tar.zst`,
          archive_bytes: 100,
          archive_sha256: "a".repeat(64),
        };
      const modelId = MODEL_PACK_IDS[packId];
      return {
        ...common,
        schema: "animama-model-pack/1",
        id: packId,
        model_id: modelId,
        files: common.files.map((file) => ({
          ...file,
          url: modelObjectUrl(modelId, file),
        })),
      };
    },
  );
  const roots = manifests.map((manifest) => {
    const root = path.join(
      options.paths.packs,
      `${manifest.id}/versions`,
      versionDirectory(manifest),
    );
    mkdirSync(root, { recursive: true });
    writeFileSync(path.join(root, "config.json"), "{}", { mode: 0o644 });
    writeFileSync(path.join(root, PACK_METADATA), JSON.stringify(manifest));
    return root;
  });
  atomicWrite(
    path.join(options.paths.packs, "active.json"),
    JSON.stringify({
      schema: 1,
      packs: Object.fromEntries(
        manifests.map((manifest) => [
          manifest.id,
          {
            directory: versionDirectory(manifest),
            digest: manifestDigest(manifest),
          },
        ]),
      ),
    }),
  );
  const catalog = {
    schema: "animama-pack-catalog/1",
    app_version: "0.1.0",
    entries: manifests,
  };
  writeFileSync(
    path.join(options.runtimeRoot, "pack-catalog.json"),
    JSON.stringify({
      id: createHash("sha256").update(JSON.stringify(catalog)).digest("hex"),
      ...catalog,
    }),
  );
  return roots[0];
}

async function defaultFetch(input: unknown): Promise<Response> {
  return String(input).includes("runtime:quiesce")
    ? fixture.quiesce()
    : fixture.ready();
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
    return defaultFetch(input);
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
    fixture.quiesce.mockClear();
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
    expect(fixture.quiesce).not.toHaveBeenCalled();
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
        fixture.ready.mockResolvedValueOnce(
          Response.json({ ...fixture.health, build_id: "wrong" }),
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
    const drainsBefore = fixture.quiesce.mock.calls.length;
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
    expect(fixture.quiesce.mock.calls.length).toBe(drainsBefore);
    expect(existsSync(root)).toBe(true);
    expect(current.runtime.featurePacks().list()[0].blockers?.[0].label).toBe(
      "Active preview",
    );
  });

  it.each([false, true])(
    "quiesces the renderer and keeps the saved origin through removal (rollback=%s)",
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
        fixture.ready.mockResolvedValueOnce(
          Response.json({ ...fixture.health, build_id: "wrong" }),
        );
      const removal = current.runtime.featurePacks().remove("parakeet-stt");
      if (fail) await expect(removal).rejects.toThrow();
      else await removal;
      expect(current.options.quiesceRenderers).toHaveBeenCalledOnce();
      expect(
        fixture.available.mock.calls.every(([port]) => port === 41234),
      ).toBe(true);
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
      firstBackend.env.ANIMAMA_DESKTOP_CONTROL_TOKEN,
    );
    await first.runtime.stop();
    expect(fixture.owners.every((children) => children.size === 0)).toBe(true);
    const second = create(first.options.paths);
    await second.runtime.start();
    const backend = fixture.launches
      .filter((child) => child.name === "fastapi")
      .at(-1)!;
    expect(backend.env.PGPASSWORD).toBe(firstPassword);
    expect(backend.env.ANIMAMA_DESKTOP_CONTROL_TOKEN).not.toBe(
      firstBackend.env.ANIMAMA_DESKTOP_CONTROL_TOKEN,
    );
    expect(second.runtime.rendererCapability).not.toBe(
      first.runtime.rendererCapability,
    );
    expect(fixture.available.mock.calls.at(-1)?.[0]).toBe(41234);
    expect(
      JSON.parse(readFileSync(second.options.paths.state, "utf8")).gatewayPort,
    ).toBe(41234);
  });

  it("preserves saved port 80 through failed startup, retry and consumer restart", async () => {
    const current = create();
    const saved = JSON.stringify({ version: 1, gatewayPort: 80 });
    atomicWrite(current.options.paths.state, saved);
    fixture.ready.mockResolvedValueOnce(Response.json({ invalid: true }));
    await current.runtime.start();
    expect(current.runtime.status().state).toBe("error");
    await current.runtime.start();
    expect(current.runtime.status()).toEqual({
      state: "ready",
      origin: "http://127.0.0.1",
    });
    await current.runtime.changeCredential("openai", "fixture-key");
    expect(current.runtime.status().state).toBe("ready");
    expect(fixture.available.mock.calls.every(([port]) => port === 80)).toBe(
      true,
    );
    for (const child of fixture.launches.filter(
      (item) => item.name === "fastapi",
    ))
      expect(child.args).toEqual([
        "serve",
        "--host",
        "127.0.0.1",
        "--port",
        "80",
      ]);
    expect(readFileSync(current.options.paths.state, "utf8")).toBe(saved);
  });

  it("shows stable-port collision recovery without starting a database or changing the saved origin", async () => {
    const current = create();
    atomicWrite(
      current.options.paths.state,
      JSON.stringify({ version: 1, gatewayPort: 45678 }),
    );
    fixture.available.mockRejectedValueOnce(
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
    expect(fixture.quiesce).toHaveBeenCalled();
  });

  it.each(["set", "delete"])(
    "retains a busy credential %s result before replacement-window readiness and until a new attempt",
    async (action) => {
      const current = create();
      await current.runtime.start();
      await current.runtime.changeCredential("openai", "fixture-old-key");
      const vault = readFileSync(current.options.paths.vault);
      const readyStatuses: ReturnType<RuntimeSupervisor["credentials"]>[] = [];
      current.options.onStatus.mockImplementation((status) => {
        if (status.state === "ready")
          readyStatuses.push(current.runtime.credentials());
      });
      fixture.quiesce.mockResolvedValueOnce(
        Response.json({ detail: { code: "runtime_busy" } }, { status: 409 }),
      );
      const result = await current.runtime.changeCredential(
        "openai",
        action === "set" ? "fixture-replacement-key" : undefined,
      );
      const expected = {
        provider: "openai",
        configured: true,
        error: "runtime_busy",
        restartRequired: false,
      };
      expect(result).toMatchObject(expected);
      expect(
        readyStatuses.at(-1)?.find((entry) => entry.provider === "openai"),
      ).toMatchObject(expected);
      expect(readFileSync(current.options.paths.vault)).toEqual(vault);
      expect(JSON.stringify(current.runtime.credentials())).not.toContain(
        "fixture-old-key",
      );
      expect(JSON.stringify(current.runtime.credentials())).not.toContain(
        "fixture-replacement-key",
      );
      result.error = "caller-mutated-status";
      expect(
        current.runtime
          .credentials()
          .find((entry) => entry.provider === "openai"),
      ).toMatchObject(expected);

      await current.runtime.changeCredential("gemini", "fixture-other-key");
      expect(
        current.runtime
          .credentials()
          .find((entry) => entry.provider === "openai"),
      ).toMatchObject(expected);
      fixture.quiesce.mockImplementationOnce(async () => {
        expect(
          current.runtime
            .credentials()
            .find((entry) => entry.provider === "openai")?.error,
        ).toBeUndefined();
        return Response.json({ schema_version: 1, state: "quiesced" });
      });
      await current.runtime.changeCredential("openai");
      expect(
        current.runtime
          .credentials()
          .find((entry) => entry.provider === "openai"),
      ).toMatchObject({
        configured: false,
        restartRequired: false,
      });
      expect(
        current.runtime
          .credentials()
          .find((entry) => entry.provider === "openai")?.error,
      ).toBeUndefined();
    },
  );

  it("applies several credential changes with one backend restart", async () => {
    const current = create();
    await current.runtime.start();
    await current.runtime.changeCredential("gemini", "fixture-old-gemini");
    const before = fixture.launches.filter(
      (child) => child.name === "fastapi",
    ).length;
    const statuses = await current.runtime.changeCredentials([
      { provider: "openai", value: "fixture-openai" },
      { provider: "elevenlabs", value: "fixture-elevenlabs" },
      { provider: "gemini" },
    ]);
    const launches = fixture.launches.filter(
      (child) => child.name === "fastapi",
    );
    expect(launches).toHaveLength(before + 1);
    expect(launches.at(-1)?.env).toMatchObject({
      OPENAI_API_KEY: "fixture-openai",
      ELEVENLABS_API_KEY: "fixture-elevenlabs",
    });
    expect(launches.at(-1)?.env.GEMINI_API_KEY).toBeUndefined();
    expect(
      Object.fromEntries(
        statuses.map((status) => [status.provider, status.configured]),
      ),
    ).toMatchObject({ openai: true, elevenlabs: true, gemini: false });
    expect(JSON.stringify(statuses)).not.toContain("fixture-openai");
  });

  it("records a failed batch against every provider in it and keeps the vault unchanged", async () => {
    const current = create();
    await current.runtime.start();
    await current.runtime.changeCredential("gemini", "fixture-old-gemini");
    fixture.quiesce.mockRejectedValueOnce(new Error("busy"));
    const statuses = await current.runtime.changeCredentials([
      { provider: "openai", value: "fixture-openai" },
      { provider: "gemini" },
    ]);
    const byProvider = Object.fromEntries(
      statuses.map((status) => [status.provider, status]),
    );
    expect(byProvider.openai).toMatchObject({ configured: false });
    expect(byProvider.gemini).toMatchObject({ configured: true });
    expect(byProvider.openai?.error).toBeTruthy();
    expect(byProvider.gemini?.error).toBeTruthy();
    expect(byProvider.elevenlabs?.error).toBeUndefined();
  });

  it("retains a saved credential after restart failure and clears its failure when Retry consumes it", async () => {
    const current = create();
    await current.runtime.start();
    fixture.ready.mockResolvedValueOnce(Response.json({}));
    const result = await current.runtime.changeCredential(
      "openai",
      "fixture-saved-key",
    );
    expect(result).toMatchObject({
      configured: true,
      restartRequired: true,
      error: "backend_readiness_mismatch",
    });
    expect(
      current.runtime
        .credentials()
        .find((entry) => entry.provider === "openai"),
    ).toEqual(result);
    await current.runtime.start();
    expect(current.runtime.status().state).toBe("ready");
    const restored = current.runtime
      .credentials()
      .find((entry) => entry.provider === "openai");
    expect(restored).toMatchObject({
      configured: true,
      restartRequired: false,
    });
    expect(restored?.error).toBeUndefined();
    expect(
      fixture.launches.filter((child) => child.name === "fastapi").at(-1)?.env
        .OPENAI_API_KEY,
    ).toBe("fixture-saved-key");
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
    expect(
      current.options.onStatus.mock.calls.some(
        ([status]) => status.state === "ready",
      ),
    ).toBe(false);
    expect(fixture.owners.every((children) => children.size === 0)).toBe(true);
  });

  it("stops before launching services when a current-revision profile has a stale schema", async () => {
    fixture.command.mockImplementation(async (executable, args) =>
      executable === "pg_dump" && args[0] === "--schema-only"
        ? "CREATE TABLE public.fixture (id integer, stale text);\n"
        : JSON.stringify(fixture.state),
    );
    const current = create();
    await current.runtime.start();
    expect(current.runtime.status()).toEqual({
      state: "error",
      code: "database_schema_mismatch",
    });
    expect(fixture.launches.map((child) => child.name)).toEqual(["postgres"]);
    // Repeatable seeds never run against a schema they may not fit.
    expect(
      fixture.command.mock.calls.some(([, args]) => args[1] === "bootstrap"),
    ).toBe(false);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
    expect(fixture.owners.every((children) => children.size === 0)).toBe(true);
    expect(
      existsSync(path.join(current.options.paths.pgData, "PG_VERSION")),
    ).toBe(true);
  });

  it.each([
    [
      "a current-revision profile before seeding",
      fixture.state.alembic_head,
      ["provision", "inspect", "--schema-only", "bootstrap"],
    ],
    [
      "a fresh profile after bootstrap",
      null,
      ["provision", "inspect", "bootstrap", "--schema-only"],
    ],
  ])(
    "verifies %s and before launching services",
    async (_name, head, expected) => {
      fixture.command.mockImplementation(async (executable, args) => {
        if (executable === "pg_dump" && args[0] === "--schema-only")
          return fixture.schema;
        return JSON.stringify(
          args[1] === "bootstrap"
            ? fixture.state
            : { ...fixture.state, alembic_head: head },
        );
      });
      const current = create();
      await current.runtime.start();
      expect(current.runtime.status().state).toBe("ready");
      const operations = fixture.command.mock.calls.map(([executable, args]) =>
        executable === "pg_dump" ? args[0] : args[1],
      );
      expect(operations).toEqual(expected);
      expect(
        fixture.command.mock.calls.find(
          ([executable]) => executable === "pg_dump",
        )?.[2],
      ).toMatchObject({ PGPORT: "41236" });
    },
  );

  it("reports a terminal content startup failure without waiting for the readiness deadline", async () => {
    vi.mocked(fetch).mockResolvedValue(
      Response.json(
        { detail: { code: "content_startup_failed" } },
        { status: 503 },
      ),
    );
    const current = create();
    await current.runtime.start();
    expect(current.runtime.status()).toEqual({
      state: "error",
      code: "content_startup_failed",
    });
    expect(vi.mocked(fetch)).toHaveBeenCalledOnce();
    expect(fixture.owners.every((children) => children.size === 0)).toBe(true);
  });

  it("keeps polling while the backend reports ordinary startup progress", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(
        Response.json({ detail: "runtime_starting" }, { status: 503 }),
      )
      .mockResolvedValueOnce(new Response("not json", { status: 503 }));
    const current = create();
    await current.runtime.start();
    expect(current.runtime.status().state).toBe("ready");
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(3);
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

  it("supplies built assets and exact model inventory only to the owned HTTP child", async () => {
    const current = create();
    seedSpeechPack(current.options);
    await current.runtime.start();
    const backend = fixture.launches.find((child) => child.name === "fastapi")!;
    expect(backend.args.slice(-2)).toEqual(["--port", "41234"]);
    expect(backend.env.ANIMAMA_PUBLIC_ORIGIN).toBe("http://127.0.0.1:41234");
    expect(backend.env.ANIMAMA_WEB_ROOT).toBe(
      path.join(current.options.runtimeRoot, "web"),
    );
    expect(backend.env.ANIMAMA_DESKTOP_RENDERER_CAPABILITY).toBe(
      current.runtime.rendererCapability,
    );
    expect(backend.env.ANIMAMA_DESKTOP_CONTROL_TOKEN).not.toBe(
      current.runtime.rendererCapability,
    );
    expect(backend.env.ANIMAMA_INTERNAL_GATEWAY_TOKEN).toBeUndefined();
    // The backend echoes this in /_desktop/health; a hard-coded API version
    // there blocked startup of any app version other than 0.1.0.
    expect(backend.env.ANIMAMA_DESKTOP_APP_VERSION).toBe(
      current.options.appVersion,
    );
    const mount = JSON.parse(backend.env.ANIMAMA_PARAKEET_MODEL_MOUNT_JSON!);
    expect(mount.files).toEqual([
      {
        path: "config.json",
        size_bytes: 2,
        sha256: createHash("sha256").update("{}").digest("hex"),
        media_type: "application/json",
      },
    ]);
    for (const worker of fixture.launches.filter(
      (child) => child.name !== "fastapi",
    )) {
      expect(worker.env.ANIMAMA_DESKTOP_CONTROL_TOKEN).toBeUndefined();
      expect(worker.env.ANIMAMA_DESKTOP_RENDERER_CAPABILITY).toBeUndefined();
      expect(worker.env.ANIMAMA_PARAKEET_MODEL_MOUNT_JSON).toBeUndefined();
    }
  });

  it("mounts the GPU encoder beside offline speech only for the owned HTTP child", async () => {
    const current = create();
    seedSpeechPack(current.options, ["parakeet-stt", "parakeet-stt-webgpu"]);
    await current.runtime.start();
    const backend = fixture.launches.find((child) => child.name === "fastapi")!;
    const base = JSON.parse(backend.env.ANIMAMA_PARAKEET_MODEL_MOUNT_JSON!);
    const gpu = JSON.parse(
      backend.env.ANIMAMA_PARAKEET_WEBGPU_MODEL_MOUNT_JSON!,
    );
    expect(gpu.root).toContain(
      path.join(current.options.paths.packs, "parakeet-stt-webgpu"),
    );
    expect(gpu.root).not.toBe(base.root);
    expect(gpu.version).toBe(backend.env.ANIMAMA_PARAKEET_WEBGPU_ASSET_VERSION);
    for (const worker of fixture.launches.filter(
      (child) => child.name !== "fastapi",
    ))
      expect(
        worker.env.ANIMAMA_PARAKEET_WEBGPU_MODEL_MOUNT_JSON,
      ).toBeUndefined();
  });

  it("never mounts the GPU encoder without offline speech", async () => {
    const current = create();
    seedSpeechPack(current.options, ["parakeet-stt-webgpu"]);
    await current.runtime.start();
    const backend = fixture.launches.find((child) => child.name === "fastapi")!;
    expect(
      backend.env.ANIMAMA_PARAKEET_WEBGPU_MODEL_MOUNT_JSON,
    ).toBeUndefined();
    expect(backend.env.ANIMAMA_PARAKEET_MODEL_MOUNT_JSON).toBeUndefined();
  });

  it("passes no companion-safety override to any packaged child", async () => {
    // Packaged builds must run with the safe defaults (spec R8); a shell
    // variable on the owner's machine must not relax them.
    const names = [
      "ANIMAMA_COMPANION_SAFETY_ENABLED",
      "ANIMAMA_AI_NOTICE_ENABLED",
      "ANIMAMA_AI_NOTICE_REMINDER_HOURS",
      "ANIMAMA_CRISIS_DETECTION_ENABLED",
      "ANIMAMA_CRISIS_RESOURCES_PATH",
    ];
    for (const name of names) vi.stubEnv(name, "false");
    try {
      const current = create();
      await current.runtime.start();
      expect(fixture.launches.length).toBeGreaterThan(0);
      for (const child of fixture.launches) {
        expect(
          Object.keys(child.env).filter((key) =>
            /^ANIMAMA_(COMPANION_SAFETY|AI_NOTICE|CRISIS)/u.test(key),
          ),
        ).toEqual([]);
      }
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("cannot expose ready after cleanup exits during the readiness request", async () => {
    fixture.ready.mockImplementationOnce(async () => {
      const backend = fixture.launches.find(
        (child) => child.name === "fastapi",
      )!;
      fixture.launches
        .find((child) => child.name === "avatar-cleanup")!
        .finish();
      return Response.json({
        ...fixture.health,
        local_http_schema_version: 1,
        process_id: backend.child.pid,
        process_start_token: backend.token,
      });
    });
    const current = create();
    await current.runtime.start();
    expect(current.runtime.status().state).toBe("error");
    expect(
      current.options.onStatus.mock.calls.some(
        ([status]) => status.state === "ready",
      ),
    ).toBe(false);
    expect(fixture.owners.every((children) => children.size === 0)).toBe(true);
  });

  it.each([
    { process_id: 1 },
    { process_start_token: "foreign-process" },
    { local_http_schema_version: 0 },
    { build_id: "old-build" },
  ])(
    "never promotes a foreign or incompatible readiness response: %j",
    async (change) => {
      fixture.ready.mockImplementationOnce(async () => {
        const child = fixture.launches
          .filter((item) => item.name === "fastapi")
          .at(-1)!;
        return Response.json({
          ...fixture.health,
          local_http_schema_version: 1,
          process_id: child.child.pid,
          process_start_token: child.token,
          ...change,
        });
      });
      const current = create();
      await current.runtime.start();
      expect(current.runtime.status()).toEqual({
        state: "error",
        code: "backend_readiness_mismatch",
      });
      expect(
        current.options.onStatus.mock.calls.some(
          ([status]) => status.state === "ready",
        ),
      ).toBe(false);
      expect(fixture.owners.every((children) => children.size === 0)).toBe(
        true,
      );
    },
  );

  it.each(["pack", "update", "credential"])(
    "a busy quiesce preserves the old %s configuration and restarts it",
    async (action) => {
      const current = create();
      const packRoot = seedSpeechPack(current.options);
      await current.runtime.start();
      const pointer = readFileSync(
        path.join(current.options.paths.packs, "active.json"),
        "utf8",
      );
      const vault = readFileSync(current.options.paths.vault);
      allowRemoval();
      fixture.quiesce.mockResolvedValueOnce(
        Response.json({ detail: { code: "runtime_busy" } }, { status: 409 }),
      );
      if (action === "pack")
        await expect(
          current.runtime.featurePacks().remove("parakeet-stt"),
        ).rejects.toThrow("runtime_busy");
      else if (action === "update")
        await expect(current.runtime.stopForUpdate(update)).rejects.toThrow(
          "runtime_busy",
        );
      else
        expect(
          await current.runtime.changeCredential("openai", "new-key"),
        ).toMatchObject({ configured: false, error: "runtime_busy" });
      expect(current.runtime.status()).toEqual({
        state: "ready",
        origin: "http://127.0.0.1:41234",
      });
      expect(
        readFileSync(
          path.join(current.options.paths.packs, "active.json"),
          "utf8",
        ),
      ).toBe(pointer);
      expect(readFileSync(current.options.paths.vault)).toEqual(vault);
      expect(existsSync(packRoot)).toBe(true);
      expect(fixture.postgresStarts).toHaveBeenCalledOnce();
      const backend = fixture.launches
        .filter((child) => child.name === "fastapi")
        .at(-1)!;
      expect(backend.env.ANIMAMA_PARAKEET_STT_ENABLED).toBe("1");
      expect(backend.env.OPENAI_API_KEY).toBeUndefined();
      expect(
        vi
          .mocked(fetch)
          .mock.calls.some(([input]) => String(input).includes(":resume")),
      ).toBe(false);
    },
  );
});
