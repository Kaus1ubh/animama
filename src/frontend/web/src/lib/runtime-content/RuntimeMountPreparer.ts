import type { PyAnimaRuntime } from "@/lib/content/catalogTypes";
import {
  VerifiedByteError,
  VerifiedByteLoader,
  type VerifiedByteMember,
  type VerifiedByte,
} from "./VerifiedByteLoader";
import {
  RuntimeJsonBundleLoader,
  RuntimeJsonBundleUnavailable,
} from "./RuntimeJsonBundleLoader";

export type RuntimePlaybackStatus = "preparing" | "ready" | "degraded";
export type RuntimeRootReadiness = "pending" | "ready" | "failed";

/** One owner/revision, one byte budget, and one disposal boundary for both stages. */
export interface RuntimePreparationSession {
  essentialReady: Promise<PreparedRuntimeMount>;
  settled: Promise<PreparedRuntimeMount>;
  startOptional(): void;
  getRootReadiness(rootId: string): RuntimeRootReadiness;
  subscribe(listener: () => void): () => void;
  dispose(): Promise<void>;
}

export type RuntimePreparationProgress = {
  completedMembers: number;
  totalMembers: number;
  loadedBytes: number;
  totalBytes: number;
};

export type RuntimeContentMountDiagnostic = {
  code: string;
  message: string;
  rootId?: string;
  memberRef?: string;
};

type RuntimeDescriptorMember = VerifiedByteMember & {
  item_id: string;
  role: string;
  filename: string;
};

type RuntimeDescriptorRoot = {
  root_id: string;
  member_refs: string[];
};

type RuntimeDescriptorDiagnostic = {
  root_id: string;
  code: string;
  message: string;
};

type RuntimeWithDescriptor = PyAnimaRuntime & {
  can_chat?: boolean;
  content_descriptor: {
    total_bytes: number;
    members: RuntimeDescriptorMember[];
    roots: RuntimeDescriptorRoot[];
    diagnostics: RuntimeDescriptorDiagnostic[];
  };
};

export type PreparedRuntimeFile = {
  member: RuntimeDescriptorMember;
  blob: Blob;
  objectUrl: string;
};

type PreparedRuntimeMountOptions = {
  revokeObjectURL: (url: string) => void;
  onDispose?: () => void;
};

type MountSnapshot = {
  data: PyAnimaRuntime;
  playbackStatus: RuntimePlaybackStatus;
  progress: RuntimePreparationProgress;
  diagnostics: readonly RuntimeContentMountDiagnostic[];
};

/** Own all ephemeral resources associated with one exact runtime revision. */
export class PreparedRuntimeMount {
  readonly files: ReadonlyMap<string, PreparedRuntimeFile>;
  private snapshot: MountSnapshot;

  private readonly revokeObjectURL: (url: string) => void;
  private readonly onDispose?: () => void;
  private readonly decodedDisposers = new Set<() => void>();
  private disposed = false;

  constructor(
    data: PyAnimaRuntime,
    files: Map<string, PreparedRuntimeFile>,
    playbackStatus: RuntimePlaybackStatus,
    progress: RuntimePreparationProgress,
    diagnostics: RuntimeContentMountDiagnostic[],
    options: PreparedRuntimeMountOptions,
  ) {
    this.files = files;
    this.snapshot = { data, playbackStatus, progress, diagnostics };
    this.revokeObjectURL = options.revokeObjectURL;
    this.onDispose = options.onDispose;
  }

  get data() {
    return this.snapshot.data;
  }
  get playbackStatus() {
    return this.snapshot.playbackStatus;
  }
  get progress() {
    return this.snapshot.progress;
  }
  get diagnostics() {
    return this.snapshot.diagnostics;
  }
  get isDisposed() {
    return this.disposed;
  }

  /** Preparation alone may publish newly verified roots; ownership never changes. */
  publish(snapshot: MountSnapshot): void {
    if (!this.disposed) this.snapshot = snapshot;
  }

  /** Let a consumer attach a decoded GPU/audio resource to this mount owner. */
  ownDecodedResource(dispose: () => void): void {
    if (this.disposed) {
      dispose();
      return;
    }
    this.decodedDisposers.add(dispose);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.onDispose?.();
    for (const dispose of this.decodedDisposers) dispose();
    this.decodedDisposers.clear();
    for (const file of this.files.values()) {
      this.revokeObjectURL(file.objectUrl);
    }
  }
}

type RuntimeMountPreparerOptions = {
  loader?: VerifiedByteLoader;
  jsonBundleLoader?: RuntimeJsonBundleLoader;
  concurrency?: number;
  maxTotalBytes?: number;
  createObjectURL?: (blob: Blob) => string;
  revokeObjectURL?: (url: string) => void;
};

type PrepareOptions = {
  signal?: AbortSignal;
  onProgress?: (progress: RuntimePreparationProgress) => void;
};

function cloneRuntime(runtime: RuntimeWithDescriptor): RuntimeWithDescriptor {
  return typeof structuredClone === "function"
    ? structuredClone(runtime)
    : (JSON.parse(JSON.stringify(runtime)) as RuntimeWithDescriptor);
}

function rootIds(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  const node = value as {
    runtime_root_id?: unknown;
    runtime_root_ids?: unknown;
  };
  const ids = Array.isArray(node.runtime_root_ids)
    ? node.runtime_root_ids.filter((id): id is string => typeof id === "string")
    : [];
  if (typeof node.runtime_root_id === "string") ids.push(node.runtime_root_id);
  return [...new Set(ids)];
}

/** Collect only files referenced by the executable runtime projection. */
function projectedFileRefs(runtime: unknown): Set<string> {
  const refs = new Set<string>();
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const child of value) visit(child);
      return;
    }
    if (!value || typeof value !== "object") return;
    const node = value as Record<string, unknown>;
    if (typeof node.file_ref === "string") refs.add(node.file_ref);
    for (const [key, child] of Object.entries(node)) {
      // The descriptor also contains descriptor/meta members that the browser
      // never executes. They remain pinned server-side but need no Blob mount.
      if (key !== "content_descriptor") visit(child);
    }
  };
  visit(runtime);
  return refs;
}

/** Project ready roots only. Cache rewritten nodes, never rewalk the large descriptor. */
function readyProjection(
  runtime: RuntimeWithDescriptor,
  readiness: ReadonlyMap<string, RuntimeRootReadiness>,
  files: ReadonlyMap<string, PreparedRuntimeFile>,
  filesByIssuedUrl: ReadonlyMap<string, PreparedRuntimeFile>,
  rewritten: WeakMap<object, unknown>,
  avatarRefs: ReadonlySet<string>,
): RuntimeWithDescriptor {
  const project = (value: unknown, shared = false): unknown => {
    if (!value || typeof value !== "object") return null;
    const ids = rootIds(value);
    const ready = (id: string) => readiness.get(id) === "ready";
    if (ids.length && !(shared ? ids.some(ready) : ids.every(ready)))
      return null;
    if (rewritten.has(value)) return rewritten.get(value);
    // Defend even against an incomplete root closure: no unverified URL may
    // fall through to the old authorized-files decoder path.
    if ([...projectedFileRefs(value)].some((ref) => !files.has(ref)))
      return null;
    const result = replacePreparedUrls(value, files, filesByIssuedUrl);
    if (value === runtime.avatar) {
      // glTF may reference a registered texture/buffer from the model root's
      // closure even when it is not repeated in the top-level model files.
      const model = result as Record<string, unknown>;
      model.logical_resource_urls = {
        ...Object.fromEntries(
          [...avatarRefs].map((ref) => {
            const file = files.get(ref)!;
            return [file.member.filename, file.objectUrl];
          }),
        ),
        ...((model.logical_resource_urls ?? {}) as Record<string, string>),
      };
    }
    rewritten.set(value, result);
    return result;
  };
  const next = { ...runtime };
  next.avatar = project(runtime.avatar) as typeof runtime.avatar;
  next.voice = project(runtime.voice) as typeof runtime.voice;
  next.idle_style = project(runtime.idle_style) as typeof runtime.idle_style;
  for (const key of [
    "gestures",
    "poses",
    "reactions",
    "appearances",
    "particle_effects",
    "avatar_effects",
    "scene_effects",
    "sound_effects",
  ] as const) {
    const shared = [
      "particle_effects",
      "avatar_effects",
      "scene_effects",
      "sound_effects",
    ].includes(key);
    (next as unknown as Record<string, unknown>)[key] = (runtime[key] ?? [])
      .map((value) => project(value, shared))
      .filter((value) => value !== null);
  }
  return next;
}

function replacePreparedUrls(
  value: unknown,
  files: ReadonlyMap<string, PreparedRuntimeFile>,
  filesByIssuedUrl: ReadonlyMap<string, PreparedRuntimeFile>,
): unknown {
  if (typeof value === "string") {
    return filesByIssuedUrl.get(value)?.objectUrl ?? value;
  }
  if (Array.isArray(value)) {
    return value.map((item) =>
      replacePreparedUrls(item, files, filesByIssuedUrl),
    );
  }
  if (!value || typeof value !== "object") return value;
  const node = value as Record<string, unknown>;
  const replaced = Object.fromEntries(
    Object.entries(node).map(([key, child]) => [
      key,
      replacePreparedUrls(child, files, filesByIssuedUrl),
    ]),
  );
  const fileRef = node.file_ref;
  if (typeof fileRef === "string") {
    const prepared = files.get(fileRef);
    if (prepared) replaced.url = prepared.objectUrl;
  }
  return replaced;
}

/** Observe rejections internally too: a caller may be waiting on just one stage. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  void promise.catch(() => undefined);
  return { promise, resolve, reject };
}

function checkAborted(signal: AbortSignal): void {
  if (signal.aborted)
    throw new DOMException("Runtime preparation cancelled.", "AbortError");
}

/** Prepare one descriptor into mount-scoped verified Blobs with bounded work. */
export class RuntimeMountPreparer {
  private readonly loader: VerifiedByteLoader;
  private readonly jsonBundleLoader: RuntimeJsonBundleLoader;
  private readonly concurrency: number;
  private readonly maxTotalBytes: number;
  private readonly createObjectURL: (blob: Blob) => string;
  private readonly revokeObjectURL: (url: string) => void;

  constructor(options: RuntimeMountPreparerOptions = {}) {
    this.loader = options.loader ?? new VerifiedByteLoader();
    this.jsonBundleLoader =
      options.jsonBundleLoader ?? new RuntimeJsonBundleLoader();
    this.concurrency = Math.max(1, Math.min(8, options.concurrency ?? 4));
    this.maxTotalBytes = options.maxTotalBytes ?? 512 * 1024 * 1024;
    this.createObjectURL = options.createObjectURL ?? URL.createObjectURL;
    this.revokeObjectURL = options.revokeObjectURL ?? URL.revokeObjectURL;
  }

  async prepare(
    runtime: PyAnimaRuntime,
    options: PrepareOptions = {},
  ): Promise<PreparedRuntimeMount> {
    const session = this.start(runtime, options);
    session.startOptional();
    return session.settled;
  }

  /** Start the model closure first; the canvas releases optional work after its first draw. */
  start(
    runtime: PyAnimaRuntime,
    options: PrepareOptions = {},
  ): RuntimePreparationSession {
    const typed = cloneRuntime(runtime as RuntimeWithDescriptor);
    const descriptor = typed.content_descriptor;
    if (
      !descriptor ||
      !Array.isArray(descriptor.members) ||
      !Array.isArray(descriptor.roots)
    ) {
      throw new Error(
        "The runtime response did not include a content descriptor.",
      );
    }
    const executableRefs = projectedFileRefs(typed);
    const avatarRootIds = new Set(rootIds(typed.avatar));
    const essentialRootIds = new Set([
      ...avatarRootIds,
      ...rootIds(typed.voice),
    ]);
    // Include the model's entire executable dependency closure, even when a
    // renderer dependency isn't directly mentioned by a top-level player lane.
    for (const root of descriptor.roots) {
      if (!avatarRootIds.has(root.root_id)) continue;
      for (const member of descriptor.members) {
        if (
          root.member_refs.includes(member.file_ref) &&
          member.role !== "descriptor" &&
          member.role !== "meta"
        ) {
          executableRefs.add(member.file_ref);
        }
      }
    }
    const members = [
      ...new Map(
        descriptor.members
          .filter((member) => executableRefs.has(member.file_ref))
          .map((member) => [member.file_ref, member]),
      ).values(),
    ];
    const memberRefs = new Set(members.map((member) => member.file_ref));
    if ([...executableRefs].some((ref) => !memberRefs.has(ref))) {
      throw new Error(
        "An executable runtime file is missing from its issued descriptor.",
      );
    }
    const rootRefs = new Map(
      descriptor.roots.map((root) => [
        root.root_id,
        (root.member_refs ?? []).filter((ref) => executableRefs.has(ref)),
      ]),
    );
    const avatarRefs = new Set(projectedFileRefs(typed.avatar));
    for (const id of avatarRootIds) {
      for (const ref of rootRefs.get(id) ?? []) avatarRefs.add(ref);
    }
    // Voice source samples are library assets. Only the projected embedding
    // catalog is needed to speak, and it must be ready before the first reply.
    const essentialRefs = new Set([
      ...avatarRefs,
      ...projectedFileRefs(typed.voice),
    ]);
    for (const id of essentialRootIds) {
      for (const ref of rootRefs.get(id) ?? []) essentialRefs.add(ref);
    }
    const totalBytes = members.reduce(
      (total, member) => total + member.size_bytes,
      0,
    );
    const prepared = new Map<string, PreparedRuntimeFile>();
    const failures = new Map<string, RuntimeContentMountDiagnostic>();
    const filesByIssuedUrl = new Map<string, PreparedRuntimeFile>();
    const readiness = new Map<string, RuntimeRootReadiness>();
    const rewritten = new WeakMap<object, unknown>();
    const listeners = new Set<() => void>();
    const controller = new AbortController();
    const essential = deferred<PreparedRuntimeMount>();
    const settled = deferred<PreparedRuntimeMount>();
    const optionalStart = deferred<void>();
    let optionalStarted = false;
    let completedMembers = 0;
    let loadedBytes = 0;
    const progress = (): RuntimePreparationProgress => ({
      completedMembers,
      totalMembers: members.length,
      loadedBytes,
      totalBytes,
    });
    const abort = () => {
      controller.abort();
      optionalStart.resolve();
    };
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();
    const mount = new PreparedRuntimeMount(
      typed,
      prepared,
      "preparing",
      progress(),
      [],
      {
        revokeObjectURL: this.revokeObjectURL,
        onDispose: abort,
      },
    );
    // Reserve one mount budget in priority order. Oversized optional content
    // must not evict a model that fits, and neither stage gets a fresh budget.
    let remainingBytes = this.maxTotalBytes;
    for (const member of [
      ...members.filter((item) => essentialRefs.has(item.file_ref)),
      ...members.filter((item) => !essentialRefs.has(item.file_ref)),
    ]) {
      if (member.size_bytes > remainingBytes) {
        failures.set(member.file_ref, {
          code: "runtime_memory_budget",
          message: "Runtime content exceeds the browser memory budget.",
          memberRef: member.file_ref,
        });
        completedMembers += 1;
      } else {
        remainingBytes -= member.size_bytes;
      }
    }

    let published = false;
    const publish = (done = false) => {
      let changed = !published;
      const diagnostics: RuntimeContentMountDiagnostic[] =
        descriptor.diagnostics.map((item) => ({
          code: item.code,
          message: item.message,
          rootId: item.root_id,
        }));
      for (const [id, refs] of rootRefs) {
        const failed = refs.find((ref) => failures.has(ref));
        const enabled = essentialRootIds.has(id) || optionalStarted;
        const next = failed
          ? "failed"
          : enabled && refs.every((ref) => prepared.has(ref))
            ? "ready"
            : "pending";
        changed ||= readiness.get(id) !== next;
        readiness.set(id, next);
        if (failed) diagnostics.push({ ...failures.get(failed)!, rootId: id });
      }
      const data = changed
        ? readyProjection(
            typed,
            readiness,
            prepared,
            filesByIssuedUrl,
            rewritten,
            avatarRefs,
          )
        : mount.data;
      published = true;
      mount.publish({
        data,
        progress: progress(),
        diagnostics,
        playbackStatus: !done
          ? "preparing"
          : diagnostics.length || !data.avatar
            ? "degraded"
            : "ready",
      });
      options.onProgress?.(mount.progress);
      for (const listener of listeners) listener();
    };

    const admit = (member: RuntimeDescriptorMember, blob: Blob) => {
      checkAborted(controller.signal);
      const file = { member, blob, objectUrl: this.createObjectURL(blob) };
      prepared.set(member.file_ref, file);
      filesByIssuedUrl.set(member.url, file);
      loadedBytes += member.size_bytes;
    };
    const fail = (member: RuntimeDescriptorMember, error: unknown) => {
      checkAborted(controller.signal);
      failures.set(member.file_ref, {
        code:
          error instanceof VerifiedByteError
            ? error.code
            : "preparation_failed",
        message:
          error instanceof Error
            ? error.message
            : "Runtime content could not be prepared.",
        memberRef: member.file_ref,
      });
    };
    const loadMember = async (member: RuntimeDescriptorMember) => {
      checkAborted(controller.signal);
      if (failures.has(member.file_ref)) return;
      try {
        const verified = await this.loader.load(member, controller.signal);
        admit(member, verified.blob);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError")
          throw error;
        fail(member, error);
      } finally {
        completedMembers += 1;
      }
    };
    const loadStage = async (
      stage: RuntimeDescriptorMember[],
      background: boolean,
    ) => {
      const bundle = background ? typed.json_bundle : null;
      const bundleRefs = new Set(bundle?.file_refs ?? []);
      const bundled = stage.filter((member) => bundleRefs.has(member.file_ref));
      // Fetch only if the whole advertised set belongs to this optional stage
      // and has already reserved space in this mount's single byte budget.
      const useBundle =
        bundle &&
        bundled.length >= 2 &&
        bundled.length === bundleRefs.size &&
        bundled.every(
          (member) =>
            !failures.has(member.file_ref) &&
            ["sequence", "manifest"].includes(member.role),
        );
      const jobs: (() => Promise<void>)[] = stage
        .filter((member) => !useBundle || !bundleRefs.has(member.file_ref))
        .map((member) => () => loadMember(member));
      if (useBundle)
        jobs.unshift(async () => {
          let results: Map<string, VerifiedByte | VerifiedByteError>;
          try {
            results = await this.jsonBundleLoader.load(
              bundle,
              bundled,
              typed.effective_revision,
              controller.signal,
            );
          } catch (error) {
            checkAborted(controller.signal);
            if (error instanceof RuntimeJsonBundleUnavailable) {
              // One fallback only, in this same bounded worker queue. The file
              // route rechecks the same lease/owner; nothing is trusted locally.
              jobs.push(...bundled.map((member) => () => loadMember(member)));
            } else {
              for (const member of bundled) {
                fail(member, error);
                completedMembers += 1;
              }
            }
            return;
          }
          for (const member of bundled) {
            try {
              const result = results.get(member.file_ref)!;
              if (result instanceof VerifiedByteError) fail(member, result);
              else admit(member, result.blob);
            } catch (error) {
              fail(member, error);
            } finally {
              completedMembers += 1;
            }
          }
        });
      let cursor = 0;
      const worker = async () => {
        while (cursor < jobs.length) {
          const job = jobs[cursor++]!;
          checkAborted(controller.signal);
          // Each worker yields between items; a slow optional response holds
          // only its own worker, not the rest of the catalog's preparation.
          if (background)
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
          await job();
          checkAborted(controller.signal);
          publish();
        }
      };
      const results = await Promise.allSettled(
        Array.from({ length: Math.min(this.concurrency, jobs.length) }, worker),
      );
      const rejected = results.find((result) => result.status === "rejected");
      if (rejected?.status === "rejected") throw rejected.reason;
    };
    const startOptional = () => optionalStart.resolve();
    const work = (async () => {
      checkAborted(controller.signal);
      publish();
      await loadStage(
        members.filter((member) => essentialRefs.has(member.file_ref)),
        false,
      );
      checkAborted(controller.signal);
      publish();
      essential.resolve(mount);
      // A missing/failed avatar cannot ever emit a first-frame signal.
      if (!mount.data.avatar) startOptional();
      await optionalStart.promise;
      checkAborted(controller.signal);
      optionalStarted = true;
      publish();
      await loadStage(
        members.filter((member) => !essentialRefs.has(member.file_ref)),
        true,
      );
      checkAborted(controller.signal);
      publish(true);
      settled.resolve(mount);
    })()
      .catch((error: unknown) => {
        mount.dispose();
        essential.reject(error);
        settled.reject(error);
      })
      .finally(() => options.signal?.removeEventListener("abort", abort));

    return {
      essentialReady: essential.promise,
      settled: settled.promise,
      startOptional,
      getRootReadiness: (rootId) => readiness.get(rootId) ?? "failed",
      subscribe: (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      dispose: async () => {
        abort();
        listeners.clear();
        await work;
        mount.dispose();
      },
    };
  }
}
