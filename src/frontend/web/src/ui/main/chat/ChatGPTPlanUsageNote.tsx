import { useTranslation } from "react-i18next";
import type { PyModelProviderCatalogItem } from "@animama/runtime-contracts/api-types";

import { CHATGPT_PLAN_PROVIDER_TYPE } from "@/lib/chat/model-catalog";
import { ManageUsageLink } from "@/ui/settings/models/ChatGPTPlanCard";

/**
 * "Using ChatGPT plan" with **Manage usage**, above the composer while the
 * chat's model is a ChatGPT plan model (spec #919 R3.7), in chat and Quick
 * Chat alike. Nothing for any other model.
 */
export function ChatGPTPlanUsageNote({
  model,
}: {
  model: Pick<PyModelProviderCatalogItem, "model_provider"> | null | undefined;
}) {
  const { t } = useTranslation("chat");
  if (model?.model_provider !== CHATGPT_PLAN_PROVIDER_TYPE) return null;
  return (
    <p className="text-muted-foreground mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 px-1 text-xs">
      <span>{t("composer.chatgptPlan.using")}</span>
      <ManageUsageLink className="text-xs" />
    </p>
  );
}
