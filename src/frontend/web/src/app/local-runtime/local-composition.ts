import type { RuntimeAdmission } from "@animama/runtime-contracts";
import {
  createClient,
  getRuntimeCapabilitiesV1RuntimeCapabilitiesGet,
} from "@animama/runtime-contracts/sdk";
import type { AppComposition } from "../runtime/composition";
import { traceProductRequest } from "../runtime/product-request-tracing";
import {
  completeLocalRuntimeOnboarding,
  createLocalRuntimeApi,
  loadLocalRuntimeContext,
  type LocalRuntimeState,
} from "./LocalRuntimeProvider";

/** Installation startup and native policy live only in the local composition. */
export function createLocalComposition(
  baseUrl = window.location.origin,
): AppComposition {
  const transport = {
    baseUrl,
    fetch: (input: RequestInfo | URL, init?: RequestInit) =>
      globalThis.fetch(traceProductRequest(new Request(input, init))),
  };
  const client = createClient(transport);
  const api = createLocalRuntimeApi(client);
  async function admission(
    state: LocalRuntimeState,
    signal?: AbortSignal,
  ): Promise<RuntimeAdmission> {
    if (state.status !== "ready") return { status: "unavailable" };
    const { data: capabilities } =
      await getRuntimeCapabilitiesV1RuntimeCapabilitiesGet({
        client,
        signal,
        throwOnError: true,
      });
    return {
      status: "ready",
      session: {
        key: state.principalId,
        owner: {
          id: state.principalId,
          ...(state.displayName ? { displayName: state.displayName } : {}),
        },
      },
      capabilities,
      onboardingRequired: !state.firstRunComplete,
    };
  }
  const readAdmission = async (signal?: AbortSignal) =>
    admission(await loadLocalRuntimeContext(api), signal);
  return {
    kind: "local",
    transport,
    readAdmission,
    repair: readAdmission,
    completeOnboarding: async (input) =>
      admission(await completeLocalRuntimeOnboarding(input, api)),
  };
}
