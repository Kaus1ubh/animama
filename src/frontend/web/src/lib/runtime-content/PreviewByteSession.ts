import type { PyContentPreview } from "@/lib/content/catalogTypes";
import { VerifiedByteLoader } from "./VerifiedByteLoader";

export type PreparedPreviewFile = {
  fileRef: string;
  role: string;
  mediaType: string;
  sizeBytes: number;
  sha256: string;
  blob: Blob;
  objectUrl: string;
};

type PreviewByteSessionOptions = {
  fetcher?: typeof fetch;
  signal?: AbortSignal;
  maxTotalBytes?: number;
  concurrency?: number;
  createObjectURL?: (blob: Blob) => string;
  revokeObjectURL?: (url: string) => void;
};

/** Own exact Local preview bytes and object URLs only for one preview lifetime. */
export class PreviewByteSession {
  readonly previewId: string;
  readonly revision: string;
  readonly files: ReadonlyMap<string, PreparedPreviewFile>;

  private readonly revokeObjectURL: (url: string) => void;
  private disposed = false;

  private constructor(
    preview: PyContentPreview,
    files: Map<string, PreparedPreviewFile>,
    revokeObjectURL: (url: string) => void,
  ) {
    this.previewId = preview.preview_id;
    this.revision = preview.revision_sha256;
    this.files = files;
    this.revokeObjectURL = revokeObjectURL;
  }

  static async prepare(
    preview: PyContentPreview,
    options: PreviewByteSessionOptions = {},
  ): Promise<PreviewByteSession> {
    const maxTotalBytes = options.maxTotalBytes ?? 256 * 1024 * 1024;
    const expectedTotal = preview.files.reduce(
      (total, file) => total + file.size_bytes,
      0,
    );
    if (expectedTotal > maxTotalBytes) {
      throw new Error("Preview exceeds the in-memory byte limit.");
    }
    const createObjectURL = options.createObjectURL ?? URL.createObjectURL;
    const revokeObjectURL = options.revokeObjectURL ?? URL.revokeObjectURL;
    const loader = new VerifiedByteLoader({
      fetcher: options.fetcher,
    });
    const concurrency = Math.max(1, Math.min(8, options.concurrency ?? 4));
    const prepared = new Map<string, PreparedPreviewFile>();
    let cursor = 0;
    try {
      const worker = async () => {
        while (cursor < preview.files.length) {
          const index = cursor++;
          const file = preview.files[index]!;
          if (options.signal?.aborted) {
            throw new DOMException("Preview cancelled.", "AbortError");
          }
          const verified = await loader.load(file, options.signal);
          const objectUrl = createObjectURL(verified.blob);
          prepared.set(file.file_ref, {
            fileRef: file.file_ref,
            role: file.role,
            mediaType: file.media_type,
            sizeBytes: file.size_bytes,
            sha256: file.sha256,
            blob: verified.blob,
            objectUrl,
          });
        }
      };
      await Promise.all(
        Array.from(
          { length: Math.min(concurrency, preview.files.length) },
          worker,
        ),
      );
      return new PreviewByteSession(preview, prepared, revokeObjectURL);
    } catch (error) {
      for (const file of prepared.values()) revokeObjectURL(file.objectUrl);
      throw error;
    }
  }

  /** Revoke every browser URL; repeated disposal is intentionally harmless. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const file of this.files.values()) {
      this.revokeObjectURL(file.objectUrl);
    }
  }
}
