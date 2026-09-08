/// <reference lib="webworker" />

import { sha256 } from "@noble/hashes/sha2.js";

type HashRequest = {
  file: File;
  chunkSize: number;
};

type HashWorkerResponse =
  | { type: "progress"; loaded: number; total: number }
  | { type: "complete"; sha256: string }
  | { type: "error"; message: string };

const scope = self as DedicatedWorkerGlobalScope;

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join(
    "",
  );
}

scope.addEventListener("message", (event: MessageEvent<HashRequest>) => {
  void hashFile(event.data);
});

/**
 * Hash one structured-cloned File in bounded slices so the UI thread and
 * browser heap never need a second complete-file allocation.
 */
async function hashFile({ file, chunkSize }: HashRequest): Promise<void> {
  try {
    const hash = sha256.create();
    let loaded = 0;
    while (loaded < file.size) {
      const end = Math.min(file.size, loaded + chunkSize);
      hash.update(new Uint8Array(await file.slice(loaded, end).arrayBuffer()));
      loaded = end;
      scope.postMessage({
        type: "progress",
        loaded,
        total: file.size,
      } satisfies HashWorkerResponse);
    }
    scope.postMessage({
      type: "complete",
      sha256: bytesToHex(hash.digest()),
    } satisfies HashWorkerResponse);
  } catch (error) {
    scope.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : "File hashing failed.",
    } satisfies HashWorkerResponse);
  }
}

export {};
