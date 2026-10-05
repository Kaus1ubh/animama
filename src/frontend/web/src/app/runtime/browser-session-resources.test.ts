import { describe, expect, it, vi } from "vitest";
import { SessionRequestScope } from "./session-requests";
import { installBrowserSessionResources } from "./browser-session-resources";

function fixture() {
  const scope = new SessionRequestScope("session", {
    baseUrl: "https://app.example.test",
    fetch: vi.fn(),
  });
  const terminate = vi.fn();
  const close = vi.fn(async () => {});
  const pause = vi.fn();
  const revoke = vi.fn();
  const stop = vi.fn();
  let microphone!: (stream: MediaStream) => void;
  const pipClose = vi.fn();
  let pipResolve!: (window: Window) => void;
  const target = {
    URL: {
      createObjectURL: vi.fn(() => "blob:fixture"),
      revokeObjectURL: revoke,
    },
    Worker: class {
      terminate = terminate;
    },
    AudioContext: class {
      close = close;
    },
    Audio: class {
      pause = pause;
      removeAttribute = vi.fn();
      load = vi.fn();
    },
    navigator: {
      mediaDevices: {
        getUserMedia: vi.fn(
          () =>
            new Promise<MediaStream>((resolve) => {
              microphone = resolve;
            }),
        ),
      },
    },
    document: { pictureInPictureElement: null },
    documentPictureInPicture: {
      requestWindow: vi.fn(
        () =>
          new Promise<Window>((resolve) => {
            pipResolve = resolve;
          }),
      ),
    },
  } as unknown as Window & typeof globalThis;
  installBrowserSessionResources(target, () => scope);
  return {
    target,
    scope,
    terminate,
    close,
    pause,
    revoke,
    stop,
    pipClose,
    finishPiP: () => pipResolve({ close: pipClose } as unknown as Window),
    finishMicrophone: () =>
      microphone({ getTracks: () => [{ stop }] } as unknown as MediaStream),
  };
}

describe("browser session resource ownership", () => {
  it("ends workers, audio graphs, playback and object URLs with the session", () => {
    const { target, scope, terminate, close, pause, revoke } = fixture();
    new target.Worker("/worker.js");
    new target.AudioContext();
    new target.Audio("blob:fixture");
    target.URL.createObjectURL(new Blob(["private"]));
    scope.end();
    expect(terminate).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    expect(pause).toHaveBeenCalledOnce();
    expect(revoke).toHaveBeenCalledWith("blob:fixture");
  });

  it("stops microphone permission results that arrive after sign-out", async () => {
    const { target, scope, stop, finishMicrophone } = fixture();
    const pending = target.navigator.mediaDevices.getUserMedia({ audio: true });
    scope.end();
    finishMicrophone();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(stop).toHaveBeenCalledOnce();
  });

  it("closes document PiP permission results that arrive after sign-out", async () => {
    const { target, scope, pipClose, finishPiP } = fixture();
    const pip = (
      target as unknown as {
        documentPictureInPicture: { requestWindow(): Promise<Window> };
      }
    ).documentPictureInPicture;
    const pending = pip.requestWindow();
    scope.end();
    finishPiP();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(pipClose).toHaveBeenCalledOnce();
  });

  it("refuses new private resources after the session ended", () => {
    const { target, scope } = fixture();
    scope.end();
    expect(() => new target.Worker("/worker.js")).toThrow("admission");
    expect(() => target.URL.createObjectURL(new Blob())).toThrow("admission");
  });

  it("unregisters URLs and workers disposed by their feature before sign-out", () => {
    const { target, scope, terminate, revoke } = fixture();
    const worker = new target.Worker("/worker.js");
    const url = target.URL.createObjectURL(new Blob());
    worker.terminate();
    target.URL.revokeObjectURL(url);
    scope.end();
    expect(terminate).toHaveBeenCalledOnce();
    expect(revoke).toHaveBeenCalledOnce();
  });
});
