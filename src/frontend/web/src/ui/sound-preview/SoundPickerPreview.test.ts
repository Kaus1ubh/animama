import { afterEach, describe, expect, it, vi } from "vitest";
import { SoundPickerPreview } from "./SoundPickerPreview";
import { previewCatalogItem } from "@/lib/content/catalogApi";
import { fetchContentPreviewFile } from "@/lib/content/contentPreview";
vi.mock("@/lib/content/catalogApi", () => ({ previewCatalogItem: vi.fn() }));
vi.mock("@/lib/content/contentPreview", () => ({
  contentPreviewPrimaryFile: () => ({}),
  fetchContentPreviewFile: vi.fn(),
}));
afterEach(() => vi.unstubAllGlobals());
describe("picker preview lifecycle", () => {
  it("cancels a pending request without starting audio when its bytes arrive late", async () => {
    let resolve!: (value: Blob) => void;
    vi.mocked(previewCatalogItem).mockResolvedValue({} as never);
    vi.mocked(fetchContentPreviewFile).mockResolvedValue({
      ok: true,
      blob: () =>
        new Promise<Blob>((r) => {
          resolve = r;
        }),
    } as Response);
    const audio = vi.fn();
    vi.stubGlobal("Audio", audio);
    const preview = new SoundPickerPreview(vi.fn());
    const pending = preview.play("one");
    await vi.waitFor(() => expect(resolve).toBeDefined());
    preview.stop();
    resolve(new Blob());
    await pending;
    expect(audio).not.toHaveBeenCalled();
  });
  it("stops, rewinds and releases the previous sound before another audition", async () => {
    vi.mocked(previewCatalogItem).mockResolvedValue({} as never);
    vi.mocked(fetchContentPreviewFile).mockImplementation(
      async () => new Response(new Blob()),
    );
    const sounds: Array<{
      play: ReturnType<typeof vi.fn>;
      pause: ReturnType<typeof vi.fn>;
      currentTime: number;
    }> = [];
    vi.stubGlobal(
      "Audio",
      class {
        play = vi.fn().mockResolvedValue(undefined);
        pause = vi.fn();
        currentTime = 4;
        constructor() {
          sounds.push(this);
        }
      },
    );
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    const preview = new SoundPickerPreview(vi.fn());
    await preview.play("one");
    await preview.play("two");
    expect(sounds[0]?.pause).toHaveBeenCalledOnce();
    expect(sounds[0]?.currentTime).toBe(0);
    preview.stop();
    expect(sounds[1]?.pause).toHaveBeenCalledOnce();
    expect(revoke).toHaveBeenCalledTimes(2);
  });
});
