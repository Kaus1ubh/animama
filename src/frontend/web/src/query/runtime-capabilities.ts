import type { Client } from "@animama/runtime-contracts/sdk";
import { getRuntimeCapabilitiesV1RuntimeCapabilitiesGet } from "@animama/runtime-contracts/sdk";

/** Recheck the server before starting optional work; IPC flags are not authority. */
export async function fetchRuntimeCapabilities(
  apiClient: Client,
  signal?: AbortSignal,
) {
  const { data } = await getRuntimeCapabilitiesV1RuntimeCapabilitiesGet({
    client: apiClient,
    signal,
    throwOnError: true,
  });
  return data;
}
