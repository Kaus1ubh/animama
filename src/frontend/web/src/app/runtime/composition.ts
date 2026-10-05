import type {
  ProductRuntimeComposition,
  RuntimeAdmission,
} from "@animama/runtime-contracts";
import type { LocalOnboardingInput } from "../local-runtime/LocalRuntimeProvider";
import type { SessionRequestScope } from "./session-requests";

/** Entrypoint-owned lifecycle hooks. Feature modules consume admission, never installation policy. */
export interface AppComposition extends ProductRuntimeComposition {
  readonly kind: "local" | "hosted";
  readonly subscribe?: (refresh: (invalidate?: boolean) => void) => () => void;
  readonly bindSession?: (scope: SessionRequestScope | null) => void;
  readonly completeOnboarding?: (
    input: LocalOnboardingInput,
  ) => Promise<RuntimeAdmission>;
}
