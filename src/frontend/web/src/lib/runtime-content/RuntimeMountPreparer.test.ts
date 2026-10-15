import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import type { PyAnimaRuntime } from "@/lib/content/catalogTypes";
import { RuntimeMountPreparer } from "./RuntimeMountPreparer";
import { VerifiedByteLoader } from "./VerifiedByteLoader";
import { RuntimeJsonBundleLoader } from "./RuntimeJsonBundleLoader";
import { adaptRuntimeSnapshot } from "./runtimeSnapshotAdapter";
import { AnimaRuntimeCatalog } from "./AnimaRuntimeCatalog";
import { preparedRuntimeResourceUrls } from "./runtimeContentDelivery";
import { resolveMountedPocketVoice } from "./mountedPocketVoice";

function runtime(payloads: Uint8Array[]): PyAnimaRuntime {
  const members = payloads.map((payload, index) => ({
    file_ref: `file-${index}`,
    item_id: `item-${index}`,
    role: "primary",
    filename: `${index}.bin`,
    media_type: "application/octet-stream",
    size_bytes: payload.byteLength,
    sha256: createHash("sha256").update(payload).digest("hex"),
    url: `/files/${index}`,
  }));
  return {
    catalog_version: 2,
    loadout_revision: 1,
    effective_revision: "tr2-test",
    lease_expires_at: new Date(Date.now() + 60_000).toISOString(),
    can_chat: true,
    content_descriptor: {
      schema_version: 1,
      revision: "rcd1-test",
      total_bytes: members.reduce(
        (total, member) => total + member.size_bytes,
        0,
      ),
      roots: members.map((member, index) => ({
        root_id: `root-${index}`,
        slot_key: index === 0 ? "avatar" : `gesture:${index}`,
        item_id: member.item_id,
        kind: index === 0 ? "avatar" : "gesture",
        revision_sha256: "a".repeat(64),
        entry_ids: [member.item_id],
        member_refs: [member.file_ref],
      })),
      entries: [],
      members,
      diagnostics: [],
    },
    avatar: {
      runtime_root_id: "root-0",
      avatar_id: "avatar",
      revision: "a".repeat(64),
      source: {
        type: "catalog_item",
        item_id: "item-0",
        source: "local",
        revision: "a".repeat(64),
      },
      files: [
        {
          ...members[0]!,
          ordinal: 1,
        },
      ],
    },
    gestures: payloads.slice(1).map((_, index) => ({
      runtime_root_id: `root-${index + 1}`,
      binding_id: `gesture-${index}`,
      content_type: "gesture",
      source: {
        type: "catalog_item",
        item_id: `item-${index + 1}`,
        source: "local",
        revision: "a".repeat(64),
      },
      name: "Gesture",
      implementation: { kind: "vrma" },
      files: [{ ...members[index + 1]!, ordinal: 1 }],
    })),
    poses: [],
    reactions: [],
    idle: { default_pool: [], cells: {}, gestures: [] },
    appearances: [],
    particle_effects:
      members.length > 1
        ? [
            {
              runtime_id: "sparkle",
              runtime_root_ids: ["root-1"],
              content_type: "particle_effect",
              source: {
                type: "catalog_item",
                item_id: "item-1",
                source: "local",
                revision: "a".repeat(64),
              },
              name: "Sparkle",
              logical_resource_urls: { "1.bin": "/files/1" },
              files: [{ ...members[1]!, ordinal: 1 }],
            },
          ]
        : [],
    avatar_effects: [],
    scene_effects: [],
    sound_effects: [],
    warnings: [],
  } as PyAnimaRuntime;
}

function voiceFixture() {
  const payloads = ["avatar", "catalog", "original sample"].map((text) =>
    new TextEncoder().encode(text),
  );
  const typed = runtime(payloads);
  typed.gestures = [];
  typed.particle_effects = [];
  const catalog = typed.content_descriptor.members![1]!;
  catalog.role = "pocket_voice_catalog";
  const sample = typed.content_descriptor.members![2]!;
  sample.role = "source_sample";
  sample.filename = "original.wav";
  typed.content_descriptor.roots = [
    typed.content_descriptor.roots![0]!,
    {
      ...typed.content_descriptor.roots![1]!,
      slot_key: "voice",
      kind: "voice",
      member_refs: [catalog.file_ref, sample.file_ref],
    },
  ];
  typed.voice = {
    runtime_root_id: "root-1",
    binding_id: "voice-binding",
    source: typed.avatar!.source,
    name: "My voice",
    codec: "pocket-tts-catalog-v1",
    voices: ["neutral"],
    files: [{ ...catalog, ordinal: 0 }],
  };
  const fetcher = vi.fn(
    async (url: string | URL | Request) =>
      new Response(payloads[Number(String(url).split("/").at(-1))]),
  );
  return { typed, payloads, sample, catalog, fetcher };
}

describe("RuntimeMountPreparer", () => {
  it("prepares only the selected voice catalog with the avatar, and owns its URL until disposal", async () => {
    const { typed, sample, catalog, fetcher } = voiceFixture();
    const revoke = vi.fn();
    let urlId = 0;
    const session = new RuntimeMountPreparer({
      loader: new VerifiedByteLoader({ fetcher }),
      createObjectURL: () => `blob:verified-${++urlId}`,
      revokeObjectURL: revoke,
    }).start(typed);
    const mount = await session.essentialReady;
    expect(mount.data.voice?.files?.[0]?.url).toMatch(/^blob:verified-/);
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      "/files/0",
      "/files/1",
    ]);
    expect(mount.files.has(sample.file_ref)).toBe(false);
    const voiceUrl = mount.data.voice!.files![0]!.url;
    const selected = resolveMountedPocketVoice(typed, mount);
    expect(selected?.catalogUrl).toBe(voiceUrl);
    expect(selected?.assertActive).not.toThrow();
    expect(mount.data.avatar).not.toHaveProperty([
      "logical_resource_urls",
      catalog.filename,
    ]);
    await session.dispose();
    expect(revoke).toHaveBeenCalledWith(voiceUrl);
    expect(selected?.assertActive).toThrow("selected PocketTTS voice");
  });

  it("gives each new mount its own catalog identity while preserving legacy bin catalogs", async () => {
    const { typed, fetcher } = voiceFixture();
    typed.voice!.codec = null;
    typed.voice!.files![0]!.role = "audio";
    let urlId = 0;
    const preparer = new RuntimeMountPreparer({
      loader: new VerifiedByteLoader({ fetcher }),
      createObjectURL: () => `blob:mount-${++urlId}`,
      revokeObjectURL: vi.fn(),
    });
    const first = await preparer.prepare(typed);
    const firstVoice = resolveMountedPocketVoice(typed, first)!;
    first.dispose();
    const second = await preparer.prepare(typed);
    const secondVoice = resolveMountedPocketVoice(typed, second)!;
    expect(firstVoice.catalogUrl).not.toBe(secondVoice.catalogUrl);
    expect(firstVoice.assertActive).toThrow();
    expect(secondVoice.assertActive).not.toThrow();
    second.dispose();
  });

  it("keeps a failed equipped catalog unavailable instead of exposing an issued URL or default voice", async () => {
    const { typed, catalog, fetcher } = voiceFixture();
    catalog.sha256 = "0".repeat(64);
    const mount = await new RuntimeMountPreparer({
      loader: new VerifiedByteLoader({ fetcher }),
      createObjectURL: () => "blob:verified-avatar",
      revokeObjectURL: vi.fn(),
    }).prepare(typed);
    expect(mount.data.voice).toBeNull();
    expect(mount.data.avatar).not.toBeNull();
    const selected = resolveMountedPocketVoice(typed, mount);
    expect(selected?.catalogUrl).toBeNull();
    expect(selected?.assertActive).toThrow("selected PocketTTS voice");
    mount.dispose();
  });

  it("distinguishes a broken voice binding from a removed binding or a pending runtime", () => {
    const typed = runtime([new Uint8Array([1])]);
    expect(resolveMountedPocketVoice(typed, null)).toBeNull();
    expect(resolveMountedPocketVoice(null, null)?.assertActive).toThrow(
      "loading",
    );
    typed.content_descriptor.diagnostics = [
      {
        code: "content_unavailable",
        root_id: "missing-voice",
        slot_key: "voice",
        message: "Voice is unavailable",
      },
    ];
    expect(resolveMountedPocketVoice(typed, null)?.assertActive).toThrow(
      "selected PocketTTS voice",
    );
  });

  function bundledFixture() {
    const texts = [
      "avatar",
      '{\r\n "name": "é🙂" }\n',
      '{"tracks": []}',
      "vrma",
    ];
    const payloads = texts.map((text) => new TextEncoder().encode(text));
    const typed = runtime(payloads);
    for (const index of [1, 2]) {
      const member = typed.content_descriptor.members![index]!;
      member.role = "sequence";
      member.media_type = "application/json";
    }
    typed.json_bundle = {
      version: 1,
      url: "/v1/animas/anima/runtime/revisions/tr2-test/json-bundle",
      file_refs: ["file-1", "file-2"],
      total_bytes: payloads[1]!.length + payloads[2]!.length,
    };
    const envelope = {
      version: 1,
      revision: "tr2-test",
      members: [
        { file_ref: "file-1", text: texts[1] },
        { file_ref: "file-2", text: texts[2] },
      ],
    };
    const fetcher = vi.fn(
      async (url: string | URL | Request) =>
        new Response(payloads[Number(String(url).split("/").at(-1))]),
    );
    const bundleFetch = vi.fn<typeof fetch>(async () =>
      Response.json(envelope),
    );
    const revoke = vi.fn();
    const options = {
      loader: new VerifiedByteLoader({ fetcher }),
      jsonBundleLoader: new RuntimeJsonBundleLoader(bundleFetch),
      createObjectURL: () => `blob:${Math.random()}`,
      revokeObjectURL: revoke,
    };
    return {
      typed,
      envelope,
      texts,
      payloads,
      fetcher,
      bundleFetch,
      revoke,
      options,
    };
  }

  it("holds the JSON bundle until the first frame, without holding binary workers or changing the avatar", async () => {
    const f = bundledFixture();
    let release!: (response: Response) => void;
    f.bundleFetch.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const session = new RuntimeMountPreparer(f.options).start(f.typed);
    const mount = await session.essentialReady;
    const avatar = mount.data.avatar;
    expect(f.bundleFetch).not.toHaveBeenCalled();
    expect(f.fetcher).toHaveBeenCalledTimes(1);
    session.startOptional();
    await vi.waitFor(() =>
      expect(session.getRootReadiness("root-3")).toBe("ready"),
    );
    expect(session.getRootReadiness("root-1")).toBe("pending");
    release(Response.json(f.envelope));
    await session.settled;
    expect(f.bundleFetch).toHaveBeenCalledTimes(1);
    expect(f.fetcher.mock.calls.map(([url]) => url)).toEqual([
      "/files/0",
      "/files/3",
    ]);
    expect(mount.files.size).toBe(4);
    expect(await mount.files.get("file-1")!.blob.text()).toBe(f.texts[1]);
    expect(mount.data.avatar).toBe(avatar);
    expect(mount.progress.completedMembers).toBe(4);
    await session.dispose();
    expect(f.revoke).toHaveBeenCalledTimes(4);
  });

  it.each(["digest", "member-error"])(
    "isolates a bundled %s failure to affected roots",
    async (failure) => {
      const f = bundledFixture();
      if (failure === "digest")
        f.envelope.members[0]!.text = f.texts[1]!.replace("name", "xxxx");
      else
        f.envelope.members[0] = {
          file_ref: "file-1",
          error: "runtime_file_changed_remount_required",
        } as never;
      const mount = await new RuntimeMountPreparer(f.options).prepare(f.typed);
      expect(mount.files.has("file-1")).toBe(false);
      expect(mount.files.has("file-2")).toBe(true);
      expect(mount.data.gestures?.map((g) => g.binding_id)).toEqual([
        "gesture-1",
        "gesture-2",
      ]);
      expect(mount.playbackStatus).toBe("degraded");
      expect(f.fetcher).toHaveBeenCalledTimes(2);
      mount.dispose();
    },
  );

  it.each([
    "duplicate",
    "unknown",
    "missing",
    "revision",
    "oversize",
    "invalid-json",
    "both",
  ])("admits no bundled files from a %s envelope", async (failure) => {
    const f = bundledFixture();
    if (failure === "duplicate") f.envelope.members[1]!.file_ref = "file-1";
    if (failure === "unknown") f.envelope.members[1]!.file_ref = "other";
    if (failure === "missing") f.envelope.members.pop();
    if (failure === "revision") f.envelope.revision = "other";
    if (failure === "both")
      Object.assign(f.envelope.members[0]!, { error: "bad" });
    if (failure === "oversize")
      f.bundleFetch.mockResolvedValue(
        new Response("{}", {
          headers: { "Content-Length": String(16 * 1024 * 1024 + 1) },
        }),
      );
    if (failure === "invalid-json")
      f.bundleFetch.mockResolvedValue(new Response("{"));
    const mount = await new RuntimeMountPreparer(f.options).prepare(f.typed);
    expect([...mount.files.keys()].sort()).toEqual(["file-0", "file-3"]);
    expect(f.fetcher).toHaveBeenCalledTimes(2);
    mount.dispose();
  });

  it.each([404, 503, 403, 409])(
    "only falls back for endpoint unavailability, HTTP %s",
    async (status) => {
      const f = bundledFixture();
      f.bundleFetch.mockResolvedValue(new Response(null, { status }));
      const mount = await new RuntimeMountPreparer(f.options).prepare(f.typed);
      expect(f.bundleFetch).toHaveBeenCalledTimes(1);
      expect(f.fetcher).toHaveBeenCalledTimes(
        status === 404 || status === 503 ? 4 : 2,
      );
      expect(mount.progress.completedMembers).toBe(4);
      mount.dispose();
    },
  );

  it("uses only reserved individual members when the full bundle cannot fit", async () => {
    const f = bundledFixture();
    const mount = await new RuntimeMountPreparer({
      ...f.options,
      maxTotalBytes: f.payloads[0]!.length + f.payloads[1]!.length,
    }).prepare(f.typed);
    expect(f.bundleFetch).not.toHaveBeenCalled();
    expect(f.fetcher.mock.calls.map(([url]) => url)).toEqual([
      "/files/0",
      "/files/1",
    ]);
    expect(mount.progress.completedMembers).toBe(4);
    mount.dispose();
  });

  it("cancels an oversized decoded stream before admitting bundle members", async () => {
    const f = bundledFixture();
    const cancelled = vi.fn();
    f.bundleFetch.mockResolvedValue(
      new Response(
        new ReadableStream({
          pull(controller) {
            controller.enqueue(new Uint8Array(1024 * 1024));
          },
          cancel: cancelled,
        }),
      ),
    );
    const mount = await new RuntimeMountPreparer(f.options).prepare(f.typed);
    expect(cancelled).toHaveBeenCalledOnce();
    expect(mount.files.has("file-1")).toBe(false);
    expect(f.fetcher).toHaveBeenCalledTimes(2);
    mount.dispose();
  });

  it.each(["origin", "oversize-member", "total", "duplicate-ref"])(
    "rejects an invalid %s advertisement before fetching",
    async (failure) => {
      const f = bundledFixture();
      if (failure === "origin")
        f.typed.json_bundle!.url =
          "https://example.invalid/runtime/revisions/tr2-test/json-bundle";
      if (failure === "oversize-member")
        f.typed.content_descriptor.members![1]!.size_bytes = 256 * 1024 + 1;
      if (failure === "total") f.typed.json_bundle!.total_bytes += 1;
      if (failure === "duplicate-ref")
        f.typed.json_bundle!.file_refs.push("file-1");
      const mount = await new RuntimeMountPreparer(f.options).prepare(f.typed);
      expect(f.bundleFetch).not.toHaveBeenCalled();
      expect(mount.files.has("file-1")).toBe(false);
      mount.dispose();
    },
  );

  it("falls back once after a network error and isolates Blob allocation failures", async () => {
    const f = bundledFixture();
    f.bundleFetch.mockRejectedValue(new TypeError("Network unavailable"));
    const fallback = await new RuntimeMountPreparer(f.options).prepare(f.typed);
    expect(fallback.files.size).toBe(4);
    expect(f.bundleFetch).toHaveBeenCalledOnce();
    fallback.dispose();
    f.bundleFetch.mockResolvedValue(Response.json(f.envelope));
    const mount = await new RuntimeMountPreparer({
      ...f.options,
      createObjectURL: (blob) => {
        if (blob.size === f.payloads[1]!.length)
          throw new Error("Allocation unavailable");
        return `blob:${blob.size}`;
      },
    }).prepare(f.typed);
    expect(mount.files.has("file-1")).toBe(false);
    expect(mount.files.has("file-2")).toBe(true);
    expect(mount.progress.completedMembers).toBe(4);
    mount.dispose();
  });

  it("aborts a held bundle on disposal without fallback or late admission", async () => {
    const f = bundledFixture();
    f.bundleFetch.mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init!.signal!.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        }),
    );
    const session = new RuntimeMountPreparer(f.options).start(f.typed);
    const mount = await session.essentialReady;
    session.startOptional();
    await vi.waitFor(() => expect(f.bundleFetch).toHaveBeenCalledTimes(1));
    await session.dispose();
    await expect(session.settled).rejects.toMatchObject({ name: "AbortError" });
    expect(mount.files.has("file-1")).toBe(false);
    expect(f.revoke).toHaveBeenCalledTimes(mount.files.size);
    expect(
      f.fetcher.mock.calls.every(
        ([url]) => url === "/files/0" || url === "/files/3",
      ),
    ).toBe(true);
  });

  it("publishes the model first and admits optional roots into the same catalog only after release", async () => {
    const payloads = ["avatar", "gesture"].map((text) =>
      new TextEncoder().encode(text),
    );
    const typed = runtime(payloads);
    // Descriptor order is not priority; the model can be the last listed file.
    typed.content_descriptor!.members!.reverse();
    const issued = JSON.stringify(typed);
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      const index = Number(String(url).split("/").at(-1));
      if (index === 1) await held;
      return new Response(payloads[index]);
    });
    const session = new RuntimeMountPreparer({
      loader: new VerifiedByteLoader({ fetcher }),
      createObjectURL: (blob) => `blob:${blob.size}`,
      revokeObjectURL: vi.fn(),
    }).start(typed);
    const mount = await session.essentialReady;
    const avatar = mount.data.avatar;
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual(["/files/0"]);
    expect(avatar?.files?.[0]?.url).toBe("blob:6");
    expect(mount.data.gestures).toEqual([]);
    expect(mount.data.particle_effects).toEqual([]);
    expect(session.getRootReadiness("root-1")).toBe("pending");
    let snapshot = adaptRuntimeSnapshot(mount.data);
    const modelEntry = snapshot.avatar_model;
    const catalog = new AnimaRuntimeCatalog(snapshot, {
      preparation: {
        issued: adaptRuntimeSnapshot(typed),
        getRootReadiness: session.getRootReadiness,
        isPreparing: () => mount.playbackStatus === "preparing",
      },
    });
    const update = vi.fn(() => {
      snapshot = adaptRuntimeSnapshot(mount.data, snapshot);
      catalog.admitPrepared(snapshot);
    });
    const unsubscribe = session.subscribe(update);
    try {
      session.startOptional();
      session.startOptional();
      await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
      expect(mount.playbackStatus).toBe("preparing");
      expect(catalog.getGesture("gesture-0")).toBeNull();
      expect(catalog.diagnostics).toContainEqual(
        expect.objectContaining({ code: "runtime_resource_pending" }),
      );
      release();
      expect(await session.settled).toBe(mount);
      expect(mount.data.avatar).toBe(avatar);
      expect(snapshot.avatar_model).toBe(modelEntry);
      expect(catalog.getGesture("gesture-0")).not.toBeNull();
      expect(session.getRootReadiness("root-1")).toBe("ready");
      expect(mount.playbackStatus).toBe("ready");
      expect(JSON.stringify(typed)).toBe(issued);
      expect(mount.data.content_descriptor?.members?.[0]?.url).toBe("/files/1");
    } finally {
      release();
      unsubscribe();
      catalog.dispose();
      await session.dispose();
    }
  });

  it("verifies the complete model closure once and refuses partially prepared shared roots", async () => {
    const payloads = ["model", "texture", "gesture", "effect"].map((text) =>
      new TextEncoder().encode(text),
    );
    const typed = runtime(payloads);
    const roots = typed.content_descriptor!.roots!;
    roots[0]!.member_refs!.push("file-1");
    roots[2]!.member_refs!.push("file-3");
    roots[3]!.member_refs!.push("file-3");
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      const index = Number(String(url).split("/").at(-1));
      if (index === 3) await held;
      return new Response(payloads[index]);
    });
    const session = new RuntimeMountPreparer({
      loader: new VerifiedByteLoader({ fetcher }),
      createObjectURL: () => "blob:verified",
      revokeObjectURL: vi.fn(),
      concurrency: 2,
    }).start(typed);
    const mount = await session.essentialReady;
    expect(fetcher.mock.calls.map(([url]) => url).sort()).toEqual([
      "/files/0",
      "/files/1",
    ]);
    expect(mount.files.has("file-1")).toBe(true);
    // The decoder must receive the dependency mapping, not just fetch its bytes.
    expect(
      preparedRuntimeResourceUrls(
        adaptRuntimeSnapshot(mount.data).avatar_model,
      )?.["1.bin"],
    ).toBe("blob:verified");
    session.startOptional();
    try {
      await vi.waitFor(() => expect(mount.files.has("file-2")).toBe(true));
      expect(session.getRootReadiness("root-2")).toBe("pending");
      expect(
        mount.data.gestures?.map((gesture) => gesture.binding_id),
      ).not.toContain("gesture-1");
      release();
      await session.settled;
      expect(session.getRootReadiness("root-2")).toBe("ready");
      expect(fetcher).toHaveBeenCalledTimes(4);
    } finally {
      release();
      await session.dispose();
    }
  });

  it("does not let a held optional response occupy every worker", async () => {
    const payloads = ["model", "held", "free", "also free"].map((text) =>
      new TextEncoder().encode(text),
    );
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      const index = Number(String(url).split("/").at(-1));
      if (index === 1) await held;
      return new Response(payloads[index]);
    });
    const session = new RuntimeMountPreparer({
      loader: new VerifiedByteLoader({ fetcher }),
      createObjectURL: () => "blob:verified",
      revokeObjectURL: vi.fn(),
      concurrency: 2,
    }).start(runtime(payloads));
    await session.essentialReady;
    session.startOptional();
    try {
      await vi.waitFor(() =>
        expect(session.getRootReadiness("root-3")).toBe("ready"),
      );
      expect(session.getRootReadiness("root-1")).toBe("pending");
    } finally {
      release();
      await session.settled;
      await session.dispose();
    }
  });

  it("cancels a session still waiting for its first visible frame", async () => {
    const payloads = ["avatar", "gesture"].map((text) =>
      new TextEncoder().encode(text),
    );
    const revoke = vi.fn();
    const fetcher = vi.fn(async () => new Response(payloads[0]));
    const session = new RuntimeMountPreparer({
      loader: new VerifiedByteLoader({ fetcher }),
      createObjectURL: () => "blob:model",
      revokeObjectURL: revoke,
    }).start(runtime(payloads));
    const mount = await session.essentialReady;
    await session.dispose();
    await expect(session.settled).rejects.toMatchObject({ name: "AbortError" });
    session.startOptional();
    mount.dispose();
    await session.dispose();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:model");
  });

  it.each(["absent", "failed"])(
    "settles optional content without waiting for an %s avatar to render",
    async (model) => {
      const payloads = ["avatar", "gesture"].map((text) =>
        new TextEncoder().encode(text),
      );
      const typed = runtime(payloads);
      if (model === "absent") typed.avatar = null;
      const session = new RuntimeMountPreparer({
        loader: new VerifiedByteLoader({
          fetcher: vi.fn(async (url) =>
            String(url).endsWith("/0")
              ? new Response(null, { status: 503 })
              : new Response(payloads[1]),
          ),
        }),
        createObjectURL: () => "blob:gesture",
        revokeObjectURL: vi.fn(),
      }).start(typed);
      const mount = await session.settled;
      expect(mount.data.avatar).toBeNull();
      expect(mount.data.gestures).toHaveLength(1);
      expect(mount.playbackStatus).toBe("degraded");
      await session.dispose();
    },
  );

  it("reserves the shared byte budget for the model before degrading oversized optional work", async () => {
    const payloads = ["avatar", "gesture"].map((text) =>
      new TextEncoder().encode(text),
    );
    const fetcher = vi.fn(async () => new Response(payloads[0]));
    const session = new RuntimeMountPreparer({
      loader: new VerifiedByteLoader({ fetcher }),
      maxTotalBytes: 8,
      createObjectURL: () => "blob:essential",
      revokeObjectURL: vi.fn(),
    }).start(runtime(payloads));
    const mount = await session.essentialReady;
    expect(mount.data.avatar?.files?.[0]?.url).toBe("blob:essential");
    session.startOptional();
    expect(await session.settled).toBe(mount);
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(
      "/files/0",
      expect.any(Object),
    );
    expect(mount.diagnostics).toContainEqual(
      expect.objectContaining({ code: "runtime_memory_budget" }),
    );
    expect(mount.playbackStatus).toBe("degraded");
    expect(mount.data.gestures).toEqual([]);
    expect(mount.progress.completedMembers).toBe(2);
    await session.dispose();
  });

  it("prepares each member once with bounded concurrency and revokes on dispose", async () => {
    const payloads = [
      new TextEncoder().encode("avatar"),
      new TextEncoder().encode("gesture"),
    ];
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      const index = Number(String(url).split("/").at(-1));
      return new Response(payloads[index]);
    });
    const revoke = vi.fn();
    const preparer = new RuntimeMountPreparer({
      loader: new VerifiedByteLoader({
        fetcher,
      }),
      concurrency: 2,
      createObjectURL: (blob) => `blob:${blob.size}`,
      revokeObjectURL: revoke,
    });

    const mount = await preparer.prepare(runtime(payloads));

    expect(mount.playbackStatus).toBe("ready");
    expect(mount.progress).toEqual({
      completedMembers: 2,
      totalMembers: 2,
      loadedBytes: 13,
      totalBytes: 13,
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(mount.data.avatar?.files?.[0]?.url).toBe("blob:6");
    expect(
      mount.data.particle_effects?.[0]?.logical_resource_urls?.["1.bin"],
    ).toBe("blob:7");
    mount.dispose();
    mount.dispose();
    expect(revoke).toHaveBeenCalledTimes(2);
  });

  it("does not fetch descriptor members that the projected runtime never executes", async () => {
    const payloads = [
      new TextEncoder().encode("avatar"),
      new TextEncoder().encode("gesture"),
    ];
    const runtimeValue = runtime(payloads);
    const descriptorBytes = new TextEncoder().encode('{"kind":"gesture"}');
    const descriptorMember = {
      file_ref: "file-descriptor",
      item_id: "item-1",
      role: "descriptor",
      filename: "gesture.json",
      media_type: "application/json",
      size_bytes: descriptorBytes.byteLength,
      sha256: createHash("sha256").update(descriptorBytes).digest("hex"),
      url: "/files/descriptor",
    };
    const contentDescriptor = runtimeValue.content_descriptor;
    const gestureRoot = contentDescriptor?.roots?.[1];
    if (!contentDescriptor?.members || !gestureRoot?.member_refs) {
      throw new Error("Runtime fixture must contain a Gesture descriptor.");
    }
    contentDescriptor.members.push(descriptorMember);
    gestureRoot.member_refs.push(descriptorMember.file_ref);
    contentDescriptor.total_bytes += descriptorBytes.byteLength;
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      const index = Number(String(url).split("/").at(-1));
      return new Response(payloads[index]);
    });

    const mount = await new RuntimeMountPreparer({
      loader: new VerifiedByteLoader({
        fetcher,
      }),
      createObjectURL: (blob) => `blob:${blob.size}`,
      revokeObjectURL: vi.fn(),
    }).prepare(runtimeValue);

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(mount.progress).toEqual({
      completedMembers: 2,
      totalMembers: 2,
      loadedBytes: 13,
      totalBytes: 13,
    });
    expect(mount.playbackStatus).toBe("ready");
  });

  it("omits only the root whose member fails verification", async () => {
    const payloads = [
      new TextEncoder().encode("avatar"),
      new TextEncoder().encode("gesture"),
    ];
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      const index = Number(String(url).split("/").at(-1));
      return new Response(
        index === 1 ? new TextEncoder().encode("changed") : payloads[index],
      );
    });
    const runtimeValue = runtime(payloads);
    runtimeValue.poses = [
      {
        binding_id: "dependent-pose",
        content_type: "gesture",
        runtime_root_id: "root-1",
        source: {
          type: "catalog_item",
          item_id: "dependent-pose",
          source: "included",
          revision: "a".repeat(64),
        },
        name: "Dependent pose",
        implementation: { kind: "anima_clip" },
        files: [],
      },
    ];
    const mount = await new RuntimeMountPreparer({
      loader: new VerifiedByteLoader({
        fetcher,
      }),
      createObjectURL: () => "blob:prepared",
      revokeObjectURL: vi.fn(),
    }).prepare(runtimeValue);

    expect(mount.playbackStatus).toBe("degraded");
    expect(mount.data.avatar).not.toBeNull();
    expect(mount.data.gestures).toEqual([]);
    expect(mount.data.poses).toEqual([]);
    expect(mount.progress).toEqual({
      completedMembers: 2,
      totalMembers: 2,
      loadedBytes: 6,
      totalBytes: 13,
    });
    expect(mount.diagnostics[0]?.rootId).toBe("root-1");
  });

  it("omits only the idle Gesture whose root fails, keeping the rest of the pool", async () => {
    const payloads = ["avatar", "breathe", "sway"].map((text) =>
      new TextEncoder().encode(text),
    );
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      const index = Number(String(url).split("/").at(-1));
      return new Response(
        index === 1 ? new TextEncoder().encode("changed") : payloads[index],
      );
    });
    const runtimeValue = runtime(payloads);
    runtimeValue.idle = {
      default_pool: ["item-1", "item-2"],
      cells: {},
      gestures: runtimeValue.gestures!.map((value) => ({
        ...value,
        content_type: "gesture" as const,
        binding_id: `idle:${value.source.item_id}`,
        idle_playback: { eligible: true },
      })),
    };
    runtimeValue.gestures = [];
    const mount = await new RuntimeMountPreparer({
      loader: new VerifiedByteLoader({ fetcher }),
      createObjectURL: () => "blob:prepared",
      revokeObjectURL: vi.fn(),
    }).prepare(runtimeValue);

    expect(mount.playbackStatus).toBe("degraded");
    expect(
      mount.data.idle?.gestures?.map((value) => value.source.item_id),
    ).toEqual(["item-2"]);
    // Pool membership is unchanged; the adapter skips Gestures that did not mount.
    expect(mount.data.idle?.default_pool).toEqual(["item-1", "item-2"]);
  });

  it("waits for cancelled workers and revokes every object URL they created", async () => {
    const payloads = [
      new TextEncoder().encode("avatar"),
      new TextEncoder().encode("gesture"),
    ];
    const controller = new AbortController();
    const revoke = vi.fn();
    const fetcher = vi.fn(async (url: string | URL | Request) => {
      const index = Number(String(url).split("/").at(-1));
      if (index === 1) await new Promise((resolve) => setTimeout(resolve, 5));
      return new Response(payloads[index]);
    });
    const preparer = new RuntimeMountPreparer({
      loader: new VerifiedByteLoader({
        fetcher,
      }),
      concurrency: 2,
      createObjectURL: () => {
        controller.abort();
        return "blob:created-before-abort";
      },
      revokeObjectURL: revoke,
    });

    await expect(
      preparer.prepare(runtime(payloads), { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(revoke).toHaveBeenCalledTimes(1);
  });
});
