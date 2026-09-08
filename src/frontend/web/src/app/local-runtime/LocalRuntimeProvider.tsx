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

type LocalRuntimeContextValue = {
  state: LocalRuntimeState;
  retry: () => void;
  completeOnboarding: (displayName: string) => Promise<void>;
};

export type LocalRuntimeApi = {
  ensureBootstrap: () => Promise<PyRuntimeContext>;
  getContext: () => Promise<PyRuntimeContext>;
  completeOnboarding: (displayName: string) => Promise<PyRuntimeContext>;
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
  completeOnboarding: async (displayName) =>
    (
      await completeRuntimeOnboardingV1RuntimeOnboardingCompletePost({
        body: { display_name: displayName },
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

/** Complete the idempotent first-run transition with a required private name. */
export async function completeLocalRuntimeOnboarding(
  displayName: string,
  api: LocalRuntimeApi = localRuntimeApi,
): Promise<LocalRuntimeState> {
  return readyState(await api.completeOnboarding(displayName));
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
  const completeOnboarding = useCallback(async (displayName: string) => {
    setState(await completeLocalRuntimeOnboarding(displayName));
  }, []);
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
