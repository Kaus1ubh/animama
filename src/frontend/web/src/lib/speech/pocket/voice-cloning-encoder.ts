import type { Client } from "@animama/runtime-contracts/sdk";
import { getI18n } from "react-i18next";
import { optionalModelResourceUrl } from "@/lib/resource-urls";
import type { PyModelAssetState } from "@animama/runtime-contracts/api-types";
import { getModelAssetV1ModelAssetsAssetIdGet } from "@animama/runtime-contracts/sdk";
import { PocketVoiceCloningError } from "./voice-cloning-error";

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
export class PocketVoiceEncoderDownloadRequired extends PocketVoiceCloningError {
  readonly asset: PyModelAssetState;

  constructor(asset: PyModelAssetState) {
    super(
      asset.status === "failed"
        ? encoderFailureText(asset.reason)
        : downloadRequiredText(),
    );
    this.name = "PocketVoiceEncoderDownloadRequired";
    this.asset = asset;
  }
}

function downloadRequiredText(): string {
  const t = getI18n().getFixedT(null, "voice");
  return t("pocket.encoder.downloadRequired");
}

/** Why the encoder download stopped, from its stable failure code. */
function encoderFailureText(reason: PyModelAssetState["reason"]): string {
  const t = getI18n().getFixedT(null, "voice");
  switch (reason) {
    case "asset_host_not_allowed":
      return t("pocket.encoder.failures.hostNotAllowed");
    case "asset_size_invalid":
      return t("pocket.encoder.failures.sizeInvalid");
    case "asset_hash_invalid":
      return t("pocket.encoder.failures.hashInvalid");
    case "asset_store_failed":
      return t("pocket.encoder.failures.storeFailed");
    case "asset_insufficient_space":
      return t("pocket.encoder.failures.insufficientSpace");
    default:
      return t("pocket.encoder.failures.downloadFailed");
  }
}

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
    if (asset.id !== POCKET_VOICE_ENCODER_ASSET_ID) {
      const t = getI18n().getFixedT(null, "voice");
      throw new PocketVoiceCloningError(t("pocket.encoder.unidentified"));
    }
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
    throw new PocketVoiceCloningError(encoderFailureText(asset.reason));
  if (asset.status !== "installed") {
    const t = getI18n().getFixedT(null, "voice");
    throw new PocketVoiceCloningError(t("pocket.encoder.interrupted"));
  }
  return POCKET_VOICE_ENCODER_CONTENT_URL;
}
