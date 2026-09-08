import { getRuntimeCapabilitiesV1RuntimeCapabilitiesGet } from "@animama/runtime-contracts/sdk";

/** Recheck the server before starting optional work; IPC flags are not authority. */
export async function fetchRuntimeCapabilities(signal?: AbortSignal) {
  const { data } = await getRuntimeCapabilitiesV1RuntimeCapabilitiesGet({
    signal,
    throwOnError: true,
  });
  return data;
}
