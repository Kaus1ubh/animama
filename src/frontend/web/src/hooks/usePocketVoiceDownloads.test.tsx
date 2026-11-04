import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { usePocketVoiceDownloads } from "./usePocketVoiceDownloads";

const fixture = vi.hoisted(() => ({
  mutate: vi.fn(),
  capabilities: {} as Record<string, unknown>,
}));

vi.mock("@/query/hooks/useModelAssets", async (importOriginal) => ({
  // The real operator-managed check reads the mocked runtime capabilities.
  ...(await importOriginal<typeof import("@/query/hooks/useModelAssets")>()),
  useModelAssets: () => ({
    data: {
      assets: [
        { id: "pocket-voice-anna", status: "not_installed" },
        { id: "pocket-voice-clara", status: "installed" },
      ],
    },
    retryAssetIds: new Set(),
  }),
}));
vi.mock("@/query/hooks/useRuntimeCapabilities", () => ({
  useRuntimeCapabilities: () => ({ data: fixture.capabilities }),
}));
vi.mock("@/query/mutations/useModelAssetActions", () => ({
  useModelAssetAction: () => ({
    mutate: fixture.mutate,
    isPending: false,
    busy: false,
    blockedReason: null,
  }),
}));

/** The hook's result after one render. */
function downloads() {
  let result!: ReturnType<typeof usePocketVoiceDownloads>;
  function Probe() {
    result = usePocketVoiceDownloads({ enabled: true });
    return null;
  }
  renderToStaticMarkup(<Probe />);
  return result;
}

describe("Pocket voice downloads", () => {
  beforeEach(() => {
    fixture.mutate.mockReset();
  });

  it("installs and removes voices where the owner administers models", () => {
    fixture.capabilities = { local_filesystem_administration: true };
    const result = downloads();
    expect(result.operatorManaged).toBe(false);
    result.install("pocket-voice-anna");
    result.remove("pocket-voice-clara");
    expect(fixture.mutate.mock.calls.map(([request]) => request)).toEqual([
      { action: "install", assetId: "pocket-voice-anna" },
      { action: "remove", assetId: "pocket-voice-clara" },
    ]);
  });

  it.each([{ local_filesystem_administration: false }, {}])(
    "never requests a change for operator-provided voices: %s",
    (capabilities) => {
      fixture.capabilities = capabilities;
      const result = downloads();
      expect(result.operatorManaged).toBe(true);
      result.install("pocket-voice-anna");
      result.remove("pocket-voice-clara");
      expect(fixture.mutate).not.toHaveBeenCalled();
      // Provisioned voices still report their state.
      expect(result.availability("clara")?.status).toBe("installed");
      expect(result.availability("anna")?.status).toBe("not_installed");
    },
  );
});
