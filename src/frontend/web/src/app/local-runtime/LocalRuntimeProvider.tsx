"use client";

import {
  completeRuntimeOnboardingV1RuntimeOnboardingCompletePost,
  ensureRuntimeBootstrapV1RuntimeBootstrapEnsurePost,
  getRuntimeContextV1RuntimeContextGet,
  type PyRuntimeContext,
  createClient,
  type Client,
} from "@animama/runtime-contracts/sdk";
import { useRuntimeAdmission } from "../runtime/RuntimeAdmissionProvider";

export type LocalRuntimeState =
  | { status: "loading" }
  | { status: "recoverable-error"; message: string }
  | {
      status: "ready";
      principalId: string;
      firstRunComplete: boolean;
      displayName: string | null;
    };

/**
 * First-run input: a required private name, the owner's 18+ confirmation and,
 * optionally, the model chosen in setup (it becomes the Chat default and
 * starter Animas still on their original model follow it).
 */
export type LocalOnboardingInput = {
  displayName: string;
  adultConfirmed: boolean;
  chatModelProviderId?: string | null;
};

type LocalRuntimeContextValue = {
  state: LocalRuntimeState;
  retry: () => void;
  completeOnboarding: (input: LocalOnboardingInput) => Promise<void>;
};

export type LocalRuntimeApi = {
  ensureBootstrap: () => Promise<PyRuntimeContext>;
  getContext: () => Promise<PyRuntimeContext>;
  completeOnboarding: (
    input: LocalOnboardingInput,
  ) => Promise<PyRuntimeContext>;
};

function readyState(context: PyRuntimeContext): LocalRuntimeState {
  if (context.bootstrap_status !== "ready") {
    throw new Error(
      context.failed_steps.length
        ? `Local runtime repair is required (${context.failed_steps.join(", ")}).`
        : "Local runtime repair is required.",
    );
  }
  return {
    status: "ready",
    principalId: context.principal_id,
    firstRunComplete: context.first_run_complete,
    displayName: context.display_name,
  };
}

export function createLocalRuntimeApi(client: Client): LocalRuntimeApi {
  return {
    ensureBootstrap: async () =>
      (
        await ensureRuntimeBootstrapV1RuntimeBootstrapEnsurePost({
          client,
          responseValidator: undefined,
          throwOnError: true,
        })
      ).data,
    getContext: async () =>
      (
        await getRuntimeContextV1RuntimeContextGet({
          client,
          responseValidator: undefined,
          throwOnError: true,
        })
      ).data,
    completeOnboarding: async ({
      displayName,
      adultConfirmed,
      chatModelProviderId,
    }) =>
      (
        await completeRuntimeOnboardingV1RuntimeOnboardingCompletePost({
          client,
          body: {
            display_name: displayName,
            adult_confirmed: adultConfirmed,
            // Omitted, the system default model stays in place.
            ...(chatModelProviderId
              ? { chat_model_provider_id: chatModelProviderId }
              : {}),
          },
          responseValidator: undefined,
          throwOnError: true,
        })
      ).data,
  };
}

const localRuntimeApi = createLocalRuntimeApi(
  createClient({
    baseUrl:
      typeof window === "undefined"
        ? "http://localhost"
        : window.location.origin,
    fetch: (input, init) => globalThis.fetch(input, init),
  }),
);

const pendingRuntimeContexts = new WeakMap<
  LocalRuntimeApi,
  Promise<LocalRuntimeState>
>();

/** Read startup's result; run the expensive ensure only for a reported repair. */
async function readLocalRuntimeContext(
  api: LocalRuntimeApi,
): Promise<LocalRuntimeState> {
  const context = await api.getContext();
  return readyState(
    context.bootstrap_status === "repair_required"
      ? await api.ensureBootstrap()
      : context,
  );
}

/** Share concurrent initialization without caching completed ownership/state. */
export function loadLocalRuntimeContext(
  api: LocalRuntimeApi = localRuntimeApi,
): Promise<LocalRuntimeState> {
  const active = pendingRuntimeContexts.get(api);
  if (active) return active;

  // Strict Mode repeats effect setup in development. Both consumers can use
  // this request, while their effect cleanup still ignores unmounted results.
  const pending = readLocalRuntimeContext(api).finally(() => {
    pendingRuntimeContexts.delete(api);
  });
  pendingRuntimeContexts.set(api, pending);
  return pending;
}

/** Complete the idempotent first-run transition with a name and 18+ confirmation. */
export async function completeLocalRuntimeOnboarding(
  input: LocalOnboardingInput,
  api: LocalRuntimeApi = localRuntimeApi,
): Promise<LocalRuntimeState> {
  return readyState(await api.completeOnboarding(input));
}

/** Local setup consumes the common admission boundary without owning the app shell. */
export function useLocalRuntime(): LocalRuntimeContextValue {
  const { admission, composition, controller } = useRuntimeAdmission();
  const state: LocalRuntimeState =
    composition.kind !== "local" || admission.status === "loading"
      ? { status: "loading" }
      : admission.status === "ready"
        ? {
            status: "ready",
            principalId: admission.session.owner.id,
            firstRunComplete: !admission.onboardingRequired,
            displayName: admission.session.owner.displayName ?? null,
          }
        : {
            status: "recoverable-error",
            message:
              admission.message ?? "Animama's local runtime is unavailable.",
          };
  return {
    state,
    retry: () => {
      void controller.refresh(true);
    },
    completeOnboarding: controller.completeOnboarding,
  };
}
