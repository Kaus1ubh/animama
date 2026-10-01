import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PyModelAssetState } from "@animama/runtime-contracts/api-types";

const api = vi.hoisted(() => ({
  get: vi.fn(),
  install: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("@animama/runtime-contracts/sdk", () => ({
  getModelAssetV1ModelAssetsAssetIdGet: api.get,
  installModelAssetV1ModelAssetsAssetIdInstallPost: api.install,
  removeModelAssetV1ModelAssetsAssetIdDelete: api.remove,
}));

import { createPocketTTS } from "./createPocketTTS";
import {
  ensurePocketVoiceCloningEncoder,
  POCKET_VOICE_ENCODER_CONTENT_URL,
} from "./voice-cloning-encoder";

const encoder: PyModelAssetState = {
  id: "pocket-tts-voice-cloning-encoder",
  status: "not_installed",
  size_bytes: 39_768_446,
  required_free_bytes: 39_768_446,
  media_type: "application/octet-stream",
  license_ref: "pocket-tts-voice-cloning",
  files_total: 1,
  files_verified: 0,
};

describe("Pocket cloning encoder prerequisite", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    api.get.mockReset();
    api.install.mockReset();
    api.remove.mockReset();
    api.get.mockResolvedValue({ data: encoder });
  });
  afterEach(() => vi.useRealTimers());

  it("refuses to encode until the optional encoder has been explicitly installed", async () => {
    const core = createPocketTTS();
    core.init = vi.fn(async () => undefined);
    core._sendWorkerMessage = vi.fn(async () => ({ voiceName: "custom" }));

    await expect(
      core.encodeVoiceFromFloat32(new Float32Array([0.1, 0.2])),
    ).rejects.toThrow("Download voice cloning");
    expect(core._sendWorkerMessage).not.toHaveBeenCalled();
    expect(api.install).not.toHaveBeenCalled();
  });

  it("joins an explicitly requested download until it is verified", async () => {
    const states: string[] = [];
    api.get
      .mockResolvedValueOnce({ data: { ...encoder, status: "downloading" } })
      .mockResolvedValueOnce({
        data: { ...encoder, status: "installed", content_url: "/untrusted" },
      });
    const ready = ensurePocketVoiceCloningEncoder({
      onState: (asset) => states.push(asset.status),
    });
    await vi.advanceTimersByTimeAsync(1000);
    await expect(ready).resolves.toBe(POCKET_VOICE_ENCODER_CONTENT_URL);
    expect(states).toEqual(["downloading", "installed"]);
    expect(api.install).not.toHaveBeenCalled();
  });

  it("detaches one cancelled waiter without cancelling another caller's shared install", async () => {
    api.get.mockResolvedValue({ data: { ...encoder, status: "downloading" } });
    const cancelled = new AbortController();
    const first = ensurePocketVoiceCloningEncoder({ signal: cancelled.signal });
    const second = ensurePocketVoiceCloningEncoder();
    const aborted = expect(first).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(0);
    cancelled.abort();
    await aborted;
    api.get.mockResolvedValue({ data: { ...encoder, status: "installed" } });
    await vi.advanceTimersByTimeAsync(1000);
    await expect(second).resolves.toBe(POCKET_VOICE_ENCODER_CONTENT_URL);
    expect(api.remove).not.toHaveBeenCalled();
    expect(api.install).not.toHaveBeenCalled();
  });

  it("rechecks after removal even when the same core previously encoded a voice", async () => {
    api.get.mockResolvedValueOnce({
      data: { ...encoder, status: "installed" },
    });
    const core = createPocketTTS();
    core.init = vi.fn(async () => undefined);
    core._sendWorkerMessage = vi.fn(async () => ({ voiceName: "custom" }));
    await core.encodeVoiceFromFloat32(new Float32Array([0.1]));
    await expect(
      core.encodeVoiceFromFloat32(new Float32Array([0.2])),
    ).rejects.toThrow("Download voice cloning");
    expect(core._sendWorkerMessage).toHaveBeenCalledOnce();
    // An explicit download elsewhere restores availability without restarting
    // the core or changing its already loaded generation/encoder sessions.
    api.get.mockResolvedValueOnce({
      data: { ...encoder, status: "installed" },
    });
    await core.encodeVoiceFromFloat32(new Float32Array([0.3]));
    expect(core._sendWorkerMessage).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["failed", "asset_hash_invalid", "did not match"],
    ["failed", "asset_insufficient_space", "free space"],
    ["not_installed", null, "cancelled"],
  ])("does not encode after %s / %s", async (status, reason, message) => {
    api.get
      .mockResolvedValueOnce({ data: { ...encoder, status: "downloading" } })
      .mockResolvedValueOnce({ data: { ...encoder, status, reason } });
    const ready = ensurePocketVoiceCloningEncoder();
    const rejected = expect(ready).rejects.toThrow(message!);
    await vi.advanceTimersByTimeAsync(1000);
    await rejected;
  });

  it("does no work for an already cancelled operation", async () => {
    const abort = new AbortController();
    abort.abort();
    await expect(
      ensurePocketVoiceCloningEncoder({ signal: abort.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(api.get).not.toHaveBeenCalled();
    expect(api.install).not.toHaveBeenCalled();
  });
});
