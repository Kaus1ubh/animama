export type RuntimeRemountRecovery = {
  preserveText: string;
  removeOptimisticRun: boolean;
  retryAutomatically: false;
  requiresExplicitRemount: true;
};

/** Recovery is inert until the user explicitly accepts a new runtime revision. */
export function runtimeRemountRecovery(text: string): RuntimeRemountRecovery {
  return {
    preserveText: text,
    removeOptimisticRun: true,
    retryAutomatically: false,
    requiresExplicitRemount: true,
  };
}
