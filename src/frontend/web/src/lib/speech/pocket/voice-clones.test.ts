import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PyVoiceContent } from "@animama/runtime-contracts/api-types";

const mocks = vi.hoisted(() => ({ encode: vi.fn(), stream: vi.fn() }));
vi.mock("./catalog-builder", () => ({
  buildPocketVoiceCatalogFile: mocks.encode,
}));
vi.mock("@animama/runtime-contracts/sdk", () => ({
  streamContentFileV1ContentFilesFileRefGet: mocks.stream,
}));

import {
  loadVoiceCloneSample,
  MAX_VOICE_CLONE_FILE_BYTES,
  prepareVoiceClone,
} from "./voice-clones";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.encode.mockResolvedValue(
    new File(["encoded-neutral"], "encoded.bin", {
      type: "application/octet-stream",
    }),
  );
});

describe("durable Pocket voice preparation", () => {
  it.each([
    [" Story.voice.WAV", "Story.voice"],
    [".mp3", "Voice clone"],
    ["  .ogg", "Voice clone"],
    [`${"v".repeat(130)}.wav`, "v".repeat(120)],
  ])(
    "uses a bounded filename-derived name for a blank name: %s",
    async (filename, expected) => {
      const prepared = await prepareVoiceClone({
        name: "  ",
        file: new File(["recording"], filename),
      });
      expect(prepared.descriptor.name).toBe(expected);
      expect(mocks.encode).toHaveBeenCalledWith(
        expect.objectContaining({ animaName: expected }),
      );
    },
  );

  it("retains the complete original and encodes one neutral catalog with a stable retry identity", async () => {
    const original = new File(["original recording bytes"], "Narrator.WAV", {
      type: "audio/wav",
    });
    const prepared = await prepareVoiceClone({
      name: " Narrator ",
      file: original,
      operationId: "save-op",
    });
    expect(mocks.encode).toHaveBeenCalledExactlyOnceWith({
      animaName: "Narrator",
      sources: [{ voiceName: "neutral", file: original }],
    });
    expect(prepared.operationId).toBe("save-op");
    expect(prepared.entryName).toMatch(/^narrator-[a-f0-9-]{36}$/);
    expect(prepared.descriptor).toMatchObject({
      schema_version: 1,
      content_type: "voice",
      content_id: expect.stringMatching(/^local:voice:[a-f0-9-]{36}$/),
      name: "Narrator",
      codec: "pocket-tts-catalog-v1",
      voices: ["neutral"],
      provenance: { encoder: "pocket-tts", format_version: 1 },
      files: [
        { path: "original.wav", role: "source_sample" },
        { path: "voice.bin", role: "pocket_voice_catalog" },
      ],
    });
    expect(await prepared.files[0].text()).toBe(await original.text());
    expect(await prepared.files[1].text()).toBe("encoded-neutral");
  });

  it.each(["sample.wav", "sample.mp3", "sample.ogg"])(
    "accepts %s source bytes",
    async (name) => {
      await expect(
        prepareVoiceClone({ name: "Voice", file: new File(["audio"], name) }),
      ).resolves.toBeDefined();
    },
  );

  it.each([
    ["empty.wav", 0],
    ["large.wav", MAX_VOICE_CLONE_FILE_BYTES + 1],
    ["unsupported.flac", 5],
  ])("rejects %s before encoding", async (name, size) => {
    const file = new File(["audio"], String(name));
    Object.defineProperty(file, "size", { value: size });
    await expect(prepareVoiceClone({ name: "Voice", file })).rejects.toThrow();
    expect(mocks.encode).not.toHaveBeenCalled();
  });

  it("rejects an oversized encoded catalog before a save can be prepared", async () => {
    const catalog = new File(["encoded"], "voice.bin");
    Object.defineProperty(catalog, "size", {
      value: MAX_VOICE_CLONE_FILE_BYTES + 1,
    });
    mocks.encode.mockResolvedValueOnce(catalog);
    await expect(
      prepareVoiceClone({
        name: "Voice",
        file: new File(["audio"], "sample.wav"),
      }),
    ).rejects.toThrow("25 MiB");
  });

  it("fetches only the registered original with credentials and cancellation", async () => {
    const blob = new Blob(["sample"], { type: "audio/wav" });
    const signal = new AbortController().signal;
    mocks.stream.mockResolvedValue({ data: blob });
    const clone = {
      codec: "pocket-tts-catalog-v1",
      files: [
        {
          file_ref: "original-ref",
          role: "source_sample",
          size_bytes: blob.size,
        },
      ],
    } as PyVoiceContent;
    expect(await loadVoiceCloneSample(clone, signal)).toBe(blob);
    expect(mocks.stream).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        path: { file_ref: "original-ref" },
        signal,
        parseAs: "blob",
        credentials: "same-origin",
        redirect: "error",
      }),
    );
  });
});
