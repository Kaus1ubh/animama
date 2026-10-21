import { readBoundedJsonResponse } from "./runtimeContentDelivery";
import type { PyRuntimeBundle } from "@/lib/content/catalogTypes";
import {
  VerifiedByteError,
  verifyRuntimeBytes,
  type VerifiedByte,
  type VerifiedByteMember,
} from "./VerifiedByteLoader";

/** A `json` delivery bundle; binary bundles are not read yet. */
export type RuntimeJsonBundle = PyRuntimeBundle;

/** Only transport unavailability may fall back; integrity/auth failures cannot. */
export class RuntimeJsonBundleUnavailable extends Error {}

const MAX_ENVELOPE_BYTES = 16 * 1024 * 1024;

/** Verify an entire envelope before admitting any of its independently hashed files. */
export class RuntimeJsonBundleLoader {
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
    bundle: RuntimeJsonBundle,
    members: readonly VerifiedByteMember[],
    revision: string,
    signal: AbortSignal,
  ): Promise<Map<string, VerifiedByte | VerifiedByteError>> {
    const expected = new Map(
      members.map((member) => [member.file_ref, member]),
    );
    const url = new URL(bundle.url, this.origin);
    if (
      bundle.format !== "json" ||
      !/^[0-9a-f]{64}$/.test(bundle.id) ||
      members.length < 2 ||
      members.length > 256 ||
      bundle.file_refs.length !== expected.size ||
      new Set(bundle.file_refs).size !== expected.size ||
      bundle.file_refs.some((ref) => !expected.has(ref)) ||
      members.some(
        (member) =>
          member.media_type !== "application/json" ||
          member.size_bytes <= 0 ||
          member.size_bytes > 256 * 1024,
      ) ||
      bundle.total_bytes !==
        members.reduce((sum, member) => sum + member.size_bytes, 0) ||
      bundle.total_bytes > 2 * 1024 * 1024 ||
      url.origin !== this.origin ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !url.pathname.endsWith(
        `/runtime/revisions/${encodeURIComponent(revision)}/bundles/${bundle.id}`,
      )
    )
      throw new Error("Invalid runtime JSON bundle advertisement.");
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
      throw new RuntimeJsonBundleUnavailable(
        "Runtime JSON bundle transport unavailable.",
        { cause: error },
      );
    }
    if (!response.ok) {
      if (response.status === 404 || response.status >= 500) {
        throw new RuntimeJsonBundleUnavailable(
          `Runtime JSON bundle unavailable (HTTP ${response.status}).`,
        );
      }
      throw new Error(
        `Runtime JSON bundle rejected (HTTP ${response.status}).`,
      );
    }
    const data = (await readBoundedJsonResponse(
      response,
      MAX_ENVELOPE_BYTES,
    )) as {
      version?: unknown;
      revision?: unknown;
      members?: unknown;
    } | null;
    signal.throwIfAborted();
    if (
      !data ||
      data.version !== 1 ||
      data.revision !== revision ||
      !Array.isArray(data.members) ||
      data.members.length !== expected.size
    ) {
      throw new Error("Invalid runtime JSON bundle envelope.");
    }
    const seen = new Set<string>();
    // Validate the complete member set before creating even one verified Blob.
    const entries = data.members.map((entry: unknown) => {
      if (!entry || typeof entry !== "object")
        throw new Error("Invalid runtime JSON bundle member.");
      const value = entry as Record<string, unknown>;
      if (
        typeof value.file_ref !== "string" ||
        !expected.has(value.file_ref) ||
        seen.has(value.file_ref) ||
        !(
          (typeof value.text === "string" && value.error === undefined) ||
          (typeof value.error === "string" && value.text === undefined)
        )
      ) {
        throw new Error("Invalid runtime JSON bundle member set.");
      }
      seen.add(value.file_ref);
      return value as { file_ref: string; text?: string; error?: string };
    });
    const result = new Map<string, VerifiedByte | VerifiedByteError>();
    for (const entry of entries) {
      signal.throwIfAborted();
      const member = expected.get(entry.file_ref)!;
      try {
        if (entry.text === undefined) {
          throw new VerifiedByteError(
            "request_failed",
            "Runtime JSON member is no longer available; remount to refresh content.",
          );
        }
        result.set(
          entry.file_ref,
          await verifyRuntimeBytes(
            member,
            new TextEncoder().encode(entry.text),
            signal,
          ),
        );
      } catch (error) {
        signal.throwIfAborted();
        if (!(error instanceof VerifiedByteError)) throw error;
        result.set(entry.file_ref, error);
      }
    }
    return result;
  }
}
