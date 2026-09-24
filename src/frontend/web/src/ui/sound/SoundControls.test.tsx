import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SoundProvider } from "./SoundProvider";
import { AudioVolumePanel } from "./SoundControls";

describe("supported audio controls", () => {
  it("retains master, TTS and SFX controls without a Music transport or volume", () => {
    const html = renderToString(
      <SoundProvider>
        <AudioVolumePanel />
      </SoundProvider>,
    );
    expect(html).toContain("Mute all audio");
    expect(html).toContain(">TTS<");
    expect(html).toContain(">SFX<");
    expect(html).not.toMatch(/BGM|background music|Music/);
  });
});
