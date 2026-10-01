"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  completeRuntimeOnboardingV1RuntimeOnboardingCompletePost,
  ensureRuntimeBootstrapV1RuntimeBootstrapEnsurePost,
  getRuntimeContextV1RuntimeContextGet,
  type PyRuntimeContext,
} from "@animama/runtime-contracts/sdk";
import { RuntimeOwnerProvider } from "@web/app/runtime/RuntimeOwnerContext";

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

const LocalRuntimeContext = createContext<LocalRuntimeContextValue | null>(
  null,
);

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

const localRuntimeApi: LocalRuntimeApi = {
  ensureBootstrap: async () =>
    (
      await ensureRuntimeBootstrapV1RuntimeBootstrapEnsurePost({
        responseValidator: undefined,
        throwOnError: true,
      })
    ).data,
  getContext: async () =>
    (
      await getRuntimeContextV1RuntimeContextGet({
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

/** Select the credential-free main-window destination from backend state. */
export function localRuntimeHomePath(
  state: Extract<LocalRuntimeState, { status: "ready" }>,
): "/setup" | "/a" {
  return state.firstRunComplete ? "/a" : "/setup";
}

/** Require backend-owned installation readiness before feature routes mount. */
export function LocalRuntimeProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<LocalRuntimeState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setState({ status: "loading" });
    void loadLocalRuntimeContext().then(
      (next) => {
        if (active) setState(next);
      },
      () => {
        if (active) {
          setState({
            status: "recoverable-error",
            message:
              "Animama's local runtime is unavailable. Check that the local services are running, then try again.",
          });
        }
      },
    );
    return () => {
      active = false;
    };
  }, [attempt]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  const completeOnboarding = useCallback(
    async (input: LocalOnboardingInput) => {
      setState(await completeLocalRuntimeOnboarding(input));
    },
    [],
  );
  const value = useMemo<LocalRuntimeContextValue>(
    () => ({ state, retry, completeOnboarding }),
    [completeOnboarding, retry, state],
  );

  return (
    <LocalRuntimeContext.Provider value={value}>
      {state.status === "ready" ? (
        <RuntimeOwnerProvider ownerId={state.principalId}>
          {children}
        </RuntimeOwnerProvider>
      ) : (
        children
      )}
    </LocalRuntimeContext.Provider>
  );
}

export function useLocalRuntime(): LocalRuntimeContextValue {
  const value = useContext(LocalRuntimeContext);
  if (!value) {
    throw new Error("useLocalRuntime must be used within LocalRuntimeProvider");
  }
  return value;
}
