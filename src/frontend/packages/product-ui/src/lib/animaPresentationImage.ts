import type { PyRuntimeImageReference } from "@animama/runtime-contracts/api-types";
function resolvePrivateRuntimeContentUrl(url: string, baseUrl: string): string {
  return new URL(url, `${baseUrl.replace(/\/+$/, "")}/`).href;
}

export type AnimaPresentationImageRequest = {
  url: string;
  requiresPrivateFetch: boolean;
};

/** Resolve every registered presentation image against the local gateway. */
export function resolveAnimaPresentationImageRequest(
  reference: PyRuntimeImageReference,
  gatewayOrigin: string,
): AnimaPresentationImageRequest {
  if (/^[a-zA-Z][a-zA-Z\d+.-]*:/.test(reference.url)) {
    return { url: reference.url, requiresPrivateFetch: true };
  }
  return {
    url: resolvePrivateRuntimeContentUrl(reference.url, gatewayOrigin),
    requiresPrivateFetch: true,
  };
}

type ObjectUrlApi = Pick<typeof URL, "createObjectURL" | "revokeObjectURL">;

/** Own one Blob URL with an idempotent cleanup function for React effects. */
export function createAnimaPresentationObjectUrl(
  blob: Blob,
  urlApi: ObjectUrlApi = URL,
): { url: string; release: () => void } {
  const url = urlApi.createObjectURL(blob);
  let released = false;
  return {
    url,
    release: () => {
      if (released) return;
      released = true;
      urlApi.revokeObjectURL(url);
    },
  };
}
