import {
  readBoundedJsonResponse,
  readBoundedResponseBytes,
} from "./runtimeContentDelivery";
import type { PyRuntimeBundle } from "@/lib/content/catalogTypes";
import {
  VerifiedByteError,
  verifyRuntimeBytes,
  type VerifiedByte,
  type VerifiedByteMember,
} from "./VerifiedByteLoader";

export type RuntimeBundle = PyRuntimeBundle;

/** Only transport unavailability may fall back; integrity/auth failures cannot. */
export class RuntimeBundleUnavailable extends Error {}

const MAX_ENVELOPE_BYTES = 16 * 1024 * 1024;
const MAX_FRAME_HEADER_BYTES = 64 * 1024;
const FRAME_MAGIC = [0x41, 0x4d, 0x42, 0x31]; // "AMB1"
/** The image media types a binary bundle may carry. */
export const BINARY_BUNDLE_MEDIA_TYPES: ReadonlySet<string> = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
]);

/** Each format's member media types and limits, as the server selects them. */
const LIMITS = {
  json: {
    mediaTypes: new Set(["application/json"]),
    members: 256,
    memberBytes: 256 * 1024,
    totalBytes: 2 * 1024 * 1024,
  },
  binary: {
    mediaTypes: BINARY_BUNDLE_MEDIA_TYPES,
    members: 64,
    memberBytes: 512 * 1024,
    totalBytes: 4 * 1024 * 1024,
  },
} as const;

type BundleEntry = {
  file_ref: string;
  text?: string;
  size?: number;
  error?: string;
};

/**
 * Read one delivery bundle and verify each member against its own descriptor
 * size and digest. The whole envelope or frame is validated before any member is
 * admitted; a malformed one admits nothing.
 */
export class RuntimeBundleLoader {
  private readonly fetcher: typeof fetch;
  private readonly origin: string;
  constructor(
    fetcher: typeof fetch = globalThis.fetch.bind(globalThis),
    origin = typeof window === "undefined"
      ? "http://localhost"
      : window.location.origin,
  ) {
    this.fetcher = fetcher;
    this.origin = origin;
  }

  async load(
    bundle: RuntimeBundle,
    members: readonly VerifiedByteMember[],
    revision: string,
    signal: AbortSignal,
  ): Promise<Map<string, VerifiedByte | VerifiedByteError>> {
    const expected = new Map(
      members.map((member) => [member.file_ref, member]),
    );
    const limits = Object.hasOwn(LIMITS, bundle.format)
      ? LIMITS[bundle.format]
      : undefined;
    const url = new URL(bundle.url, this.origin);
    if (
      !limits ||
      !/^[0-9a-f]{64}$/.test(bundle.id) ||
      members.length < 2 ||
      members.length > limits.members ||
      bundle.file_refs.length !== expected.size ||
      new Set(bundle.file_refs).size !== expected.size ||
      bundle.file_refs.some((ref) => !expected.has(ref)) ||
      members.some(
        (member) =>
          !limits.mediaTypes.has(member.media_type) ||
          member.size_bytes <= 0 ||
          member.size_bytes > limits.memberBytes,
      ) ||
      bundle.total_bytes !==
        members.reduce((sum, member) => sum + member.size_bytes, 0) ||
      bundle.total_bytes > limits.totalBytes ||
      url.origin !== this.origin ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !url.pathname.endsWith(
        `/runtime/revisions/${encodeURIComponent(revision)}/bundles/${bundle.id}`,
      )
    )
      throw new Error("Invalid runtime bundle advertisement.");
    signal.throwIfAborted();
    let response: Response;
    try {
      response = await this.fetcher(url.href, {
        cache: "no-cache",
        credentials: "same-origin",
        redirect: "error",
        signal,
      });
    } catch (error) {
      signal.throwIfAborted();
      throw new RuntimeBundleUnavailable(
        "Runtime bundle transport unavailable.",
        { cause: error },
      );
    }
    if (!response.ok) {
      if (response.status === 404 || response.status >= 500) {
        throw new RuntimeBundleUnavailable(
          `Runtime bundle unavailable (HTTP ${response.status}).`,
        );
      }
      throw new Error(`Runtime bundle rejected (HTTP ${response.status}).`);
    }
    let read: Awaited<ReturnType<RuntimeBundleLoader["readEnvelope"]>>;
    try {
      read =
        bundle.format === "json"
          ? await this.readEnvelope(response, expected, revision)
          : await this.readFrame(response, bundle, expected, revision);
    } catch (error) {
      signal.throwIfAborted();
      // A connection lost while reading the body is a transport failure too; the
      // loader's own validation raises plain errors, which never fall back.
      if (error instanceof TypeError)
        throw new RuntimeBundleUnavailable(
          "Runtime bundle transport failed while reading.",
          { cause: error },
        );
      throw error;
    }
    const { entries, bytes } = read;
    signal.throwIfAborted();
    const result = new Map<string, VerifiedByte | VerifiedByteError>();
    for (const entry of entries) {
      signal.throwIfAborted();
      const member = expected.get(entry.file_ref)!;
      try {
        const raw = bytes.get(entry.file_ref);
        if (raw === undefined) {
          throw new VerifiedByteError(
            "request_failed",
            "Runtime bundle member is no longer available; remount to refresh content.",
          );
        }
        result.set(
          entry.file_ref,
          await verifyRuntimeBytes(member, raw, signal),
        );
      } catch (error) {
        signal.throwIfAborted();
        if (!(error instanceof VerifiedByteError)) throw error;
        result.set(entry.file_ref, error);
      }
    }
    return result;
  }

  /** Validate the complete member set before creating even one verified Blob. */
  private validEntries(
    value: unknown,
    expected: ReadonlyMap<string, VerifiedByteMember>,
    revision: string,
    payload: "text" | "size",
  ): BundleEntry[] {
    const data = value as {
      version?: unknown;
      revision?: unknown;
      members?: unknown;
    } | null;
    if (
      !data ||
      typeof data !== "object" ||
      data.version !== 1 ||
      data.revision !== revision ||
      !Array.isArray(data.members) ||
      data.members.length !== expected.size
    )
      throw new Error("Invalid runtime bundle envelope.");
    const seen = new Set<string>();
    return data.members.map((entry: unknown) => {
      if (!entry || typeof entry !== "object")
        throw new Error("Invalid runtime bundle member.");
      const member = entry as Record<string, unknown>;
      const delivered =
        payload === "text"
          ? typeof member.text === "string"
          : Number.isSafeInteger(member.size) && (member.size as number) >= 0;
      if (
        typeof member.file_ref !== "string" ||
        !expected.has(member.file_ref) ||
        seen.has(member.file_ref) ||
        !(
          (delivered && member.error === undefined) ||
          (typeof member.error === "string" && member[payload] === undefined)
        )
      )
        throw new Error("Invalid runtime bundle member set.");
      seen.add(member.file_ref);
      return member as BundleEntry;
    });
  }

  private async readEnvelope(
    response: Response,
    expected: ReadonlyMap<string, VerifiedByteMember>,
    revision: string,
  ) {
    const entries = this.validEntries(
      await readBoundedJsonResponse(response, MAX_ENVELOPE_BYTES),
      expected,
      revision,
      "text",
    );
    const bytes = new Map<string, Uint8Array<ArrayBuffer>>();
    for (const entry of entries)
      if (entry.text !== undefined)
        bytes.set(entry.file_ref, new TextEncoder().encode(entry.text));
    return { entries, bytes };
  }

  /** `AMB1`, a 4-byte big-endian header length, the JSON header, then the bytes. */
  private async readFrame(
    response: Response,
    bundle: RuntimeBundle,
    expected: ReadonlyMap<string, VerifiedByteMember>,
    revision: string,
  ) {
    const frame = await readBoundedResponseBytes(
      response,
      8 + MAX_FRAME_HEADER_BYTES + bundle.total_bytes,
      "Runtime bundle exceeds the byte limit",
    );
    if (
      frame.length < 8 ||
      FRAME_MAGIC.some((byte, index) => frame[index] !== byte)
    )
      throw new Error("Invalid runtime bundle frame.");
    const headerLength = new DataView(
      frame.buffer,
      frame.byteOffset,
      frame.byteLength,
    ).getUint32(4);
    if (
      headerLength > MAX_FRAME_HEADER_BYTES ||
      8 + headerLength > frame.length
    )
      throw new Error("Invalid runtime bundle frame.");
    let header: unknown;
    try {
      header = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(
          frame.subarray(8, 8 + headerLength),
        ),
      );
    } catch {
      throw new Error("Invalid runtime bundle frame header.");
    }
    const entries = this.validEntries(header, expected, revision, "size");
    // Each delivered member's size is its descriptor's, and the bytes that follow
    // are exactly theirs, in header order.
    let offset = 8 + headerLength;
    const bytes = new Map<string, Uint8Array<ArrayBuffer>>();
    for (const entry of entries) {
      if (entry.size === undefined) continue;
      if (
        entry.size !== expected.get(entry.file_ref)!.size_bytes ||
        offset + entry.size > frame.length
      )
        throw new Error("Invalid runtime bundle frame.");
      bytes.set(entry.file_ref, frame.slice(offset, offset + entry.size));
      offset += entry.size;
    }
    if (offset !== frame.length)
      throw new Error("Invalid runtime bundle frame.");
    return { entries, bytes };
  }
}
