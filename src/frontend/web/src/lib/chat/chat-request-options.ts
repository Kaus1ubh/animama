import type {
  PyAnimaDispatchOptions,
  PyModelProviderCatalogItem,
  WebSearchCapability,
} from "@animama/runtime-contracts/api-types";

import { effectiveReasoningEffort } from "./model-catalog";
import { selectableNativeTools } from "./model-provider-native-tools";

/**
 * The Chat features (native tools) the owner turned on for one Anima's model
 * in this window. It is not saved: another Anima or model, and a relaunch,
 * start from the defaults.
 */
export type ChatFeatureChoice = {
  animaId: string;
  modelProviderId: string;
  nativeTools: string[];
};

/**
 * The reasoning effort and native tools a chat turn sends for the Anima's
 * model row. The effort is the Anima's saved effort (or the row's default);
 * the tools are the owner's choice for this Anima and row, else every
 * available tool, web search included. `null` until the row is known.
 */
export function chatRequestOptions({
  animaId,
  item,
  savedEffort,
  webSearch,
  featureChoice,
}: {
  animaId: string;
  item: PyModelProviderCatalogItem | null | undefined;
  savedEffort: string | null | undefined;
  webSearch: WebSearchCapability | null | undefined;
  featureChoice: ChatFeatureChoice | null | undefined;
}): PyAnimaDispatchOptions | null {
  if (!item) return null;
  const available = selectableNativeTools(item, webSearch);
  const chosen =
    featureChoice?.animaId === animaId &&
    featureChoice.modelProviderId === item.id
      ? featureChoice.nativeTools
      : null;
  const nativeTools = chosen
    ? available.filter((tool) => chosen.includes(tool))
    : available;
  const effort = effectiveReasoningEffort(item, savedEffort);
  const options: PyAnimaDispatchOptions = {
    ...(effort ? { reasoning_effort: effort } : {}),
    ...(nativeTools.length ? { native_tools: nativeTools } : {}),
  };
  return Object.keys(options).length ? options : null;
}
