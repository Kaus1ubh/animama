import { useMutation, useQueryClient } from "@tanstack/react-query";
import { commitVoice, planVoice } from "@animama/runtime-contracts/sdk";
import type {
  PySingleSelectionIntent,
  PyVoiceContent,
} from "@animama/runtime-contracts/api-types";
import { useRuntimeOwnerId } from "@/app/runtime/RuntimeOwnerContext";
import { invalidateAnimaLoadoutAndRuntime } from "@/query/animaLoadoutInvalidation";

export type VoiceSelectionInput = {
  clone: PyVoiceContent | null;
  expectedRevision: number;
  idempotencyKey?: string;
};

/** The plan digest fences the entire resolved content closure before committing its binding. */
export async function selectVoiceClone(
  animaId: string,
  input: VoiceSelectionInput,
) {
  const intent: PySingleSelectionIntent = input.clone
    ? {
        operation: "set",
        source: {
          type: "catalog",
          catalog_item_id: input.clone.item_id,
          logical_key: input.clone.logical_key,
          source: input.clone.source,
        },
        config: {},
      }
    : { operation: "remove", config: {} };
  const options = {
    path: { anima_id: animaId },
    responseValidator: undefined,
    throwOnError: true as const,
  };
  const { data: plan } = await planVoice({
    ...options,
    body: { expected_revision: input.expectedRevision, intent },
  });
  return (
    await commitVoice({
      ...options,
      body: {
        expected_revision: input.expectedRevision,
        intent,
        plan_digest: plan.plan_digest,
        idempotency_key: input.idempotencyKey ?? crypto.randomUUID(),
      },
    })
  ).data;
}

/** Management-route selection; the next chat mount reads the invalidated runtime projection. */
export function useVoiceSelection(animaId: string | null) {
  const owner = useRuntimeOwnerId();
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: VoiceSelectionInput) => {
      if (!animaId || !owner)
        throw new Error("Choose an Anima before changing its voice.");
      return selectVoiceClone(animaId, input);
    },
    onSuccess: async () => {
      if (owner && animaId)
        await invalidateAnimaLoadoutAndRuntime(client, owner, animaId);
    },
  });
}
