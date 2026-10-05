import type { Client } from "@animama/runtime-contracts/sdk";
import { optionalModelResourceUrl } from "@/lib/resource-urls";
import type { PyModelAssetState } from "@animama/runtime-contracts/api-types";
import { getModelAssetV1ModelAssetsAssetIdGet } from "@animama/runtime-contracts/sdk";

export const POCKET_VOICE_ENCODER_ASSET_ID = "pocket-tts-voice-cloning-encoder";
/** Only the verified backend content route is given to an encoding worker. */
export const POCKET_VOICE_ENCODER_CONTENT_URL = optionalModelResourceUrl(
  "pocket-tts-voice-cloning",
  "mimi_encoder.onnx",
  `/v1/model-assets/${POCKET_VOICE_ENCODER_ASSET_ID}/content`,
);

export type PocketVoiceEncoderOptions = {
  signal?: AbortSignal;
  onState?: (asset: PyModelAssetState) => void;
};

/** Missing optional bytes require a separate, explicit Download action. */
export class PocketVoiceEncoderDownloadRequired extends Error {
  readonly asset: PyModelAssetState;

  constructor(asset: PyModelAssetState) {
    super(
      asset.status === "failed"
        ? FAILURE_MESSAGES[asset.reason ?? "asset_download_failed"]
        : "Download voice cloning before encoding a voice sample.",
    );
    this.name = "PocketVoiceEncoderDownloadRequired";
    this.asset = asset;
  }
}

const FAILURE_MESSAGES: Record<
  NonNullable<PyModelAssetState["reason"]>,
  string
> = {
  asset_download_failed:
    "Voice cloning could not download. Check your connection and retry.",
  asset_host_not_allowed:
    "Voice cloning downloads are unavailable in this build.",
  asset_size_invalid:
    "The voice cloning download had the wrong size and was discarded. Retry the download.",
  asset_hash_invalid:
    "The voice cloning download did not match the verified model and was discarded. Retry the download.",
  asset_store_failed:
    "Voice cloning could not be stored. Check the installation's data directory and retry.",
  asset_insufficient_space: "Not enough free space to download voice cloning.",
};

/** A caller owns only this wait, never the backend's shared installation. */
function waitForPoll(signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(
        signal?.reason ?? new DOMException("Cloning cancelled.", "AbortError"),
      );
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, 1000);
    signal?.addEventListener("abort", abort, { once: true });
  });
}

/**
 * Recheck the owning service even when a worker holds an encoder session.
 * The existing model-asset mutation owns explicit Download actions and query
 * invalidation. Each caller only joins that install; abort never removes it.
 */
export async function ensurePocketVoiceCloningEncoder(
  apiClient: Client,
  { signal, onState }: PocketVoiceEncoderOptions = {},
): Promise<string> {
  const options = {
    path: { asset_id: POCKET_VOICE_ENCODER_ASSET_ID },
    signal,
    throwOnError: true,
  } as const;
  const report = (asset: PyModelAssetState) => {
    signal?.throwIfAborted();
    if (asset.id !== POCKET_VOICE_ENCODER_ASSET_ID)
      throw new Error(
        "The voice cloning model could not be identified. Reopen and retry.",
      );
    onState?.(asset);
    return asset;
  };
  signal?.throwIfAborted();
  let asset = report(
    (
      await getModelAssetV1ModelAssetsAssetIdGet({
        ...options,
        client: apiClient,
      })
    ).data,
  );
  if (asset.status !== "installed" && asset.status !== "downloading") {
    throw new PocketVoiceEncoderDownloadRequired(asset);
  }
  while (asset.status === "downloading") {
    await waitForPoll(signal);
    asset = report(
      (
        await getModelAssetV1ModelAssetsAssetIdGet({
          ...options,
          client: apiClient,
        })
      ).data,
    );
  }
  if (asset.status === "failed")
    throw new Error(FAILURE_MESSAGES[asset.reason ?? "asset_download_failed"]);
  if (asset.status !== "installed")
    throw new Error(
      "The voice cloning download was cancelled or interrupted. Retry the download.",
    );
  return POCKET_VOICE_ENCODER_CONTENT_URL;
}
