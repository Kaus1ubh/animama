import {
  PARAKEET_ASSET_ID,
  PARAKEET_WEBGPU_ASSET_ID,
} from "@/lib/speech/client-parakeet/assets";
import {
  SENSEVOICE_ASSET_ID,
  SENSEVOICE_WEBGPU_ASSET_ID,
} from "@/lib/speech/client-sensevoice/assets";

import type { OfflineSttEngine } from "./routing";

/** Each offline engine's model-asset sets: the CPU set and its GPU add-on. */
export const offlineSpeechAssetIds: Record<
  OfflineSttEngine,
  { base: string; gpu: string }
> = {
  parakeet: { base: PARAKEET_ASSET_ID, gpu: PARAKEET_WEBGPU_ASSET_ID },
  sensevoice: { base: SENSEVOICE_ASSET_ID, gpu: SENSEVOICE_WEBGPU_ASSET_ID },
};
