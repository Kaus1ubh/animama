import { useProductApiClient } from "@animama/product-ui";

import { useQuery } from "@tanstack/react-query";

import { getChatgptPlanV1ChatgptPlanGet } from "@animama/runtime-contracts/sdk";
import type { PyChatGptPlanStatus } from "@animama/runtime-contracts/api-types";
import { useRuntimeCacheKey } from "@/app/runtime/RuntimeOwnerContext";
import { useRuntimeCapabilities } from "@/query/hooks/useRuntimeCapabilities";
import { queryKeys } from "@/query/keys";

/** How often the status is read while the browser sign-in is pending. */
export const CHATGPT_PLAN_PENDING_POLL_MS = 1_000;

/** OpenAI's page where a person reviews their plan's usage and limits for each app. */
export const CHATGPT_MANAGE_USAGE_URL = "https://chatgpt.com/settings/usage";

/** Whether this runtime offers signing in with a ChatGPT plan (the local composition). */
export function useChatGPTPlanAvailable(): boolean {
  return useRuntimeCapabilities().data?.chatgpt_plan === true;
}

/**
 * The installation's ChatGPT plan session: whether sign-in is offered here,
 * the signed-in account and the person's choices. Never a token. While a
 * sign-in waits for the browser the status is read every second, so the card
 * moves on as soon as OpenAI sends the browser back.
 */
export function useChatGPTPlan() {
  const apiClient = useProductApiClient();
  const ownerId = useRuntimeCacheKey();
  const available = useChatGPTPlanAvailable();
  return useQuery<PyChatGptPlanStatus>({
    queryKey: queryKeys.modelConfiguration.chatgptPlan(ownerId ?? "__anon__"),
    enabled: available && Boolean(ownerId),
    refetchInterval: (query) =>
      query.state.data?.sign_in_pending ? CHATGPT_PLAN_PENDING_POLL_MS : false,
    queryFn: async () => {
      const { data } = await getChatgptPlanV1ChatgptPlanGet({
        client: apiClient,
        responseValidator: undefined,
        throwOnError: true,
      });
      return data;
    },
  });
}
