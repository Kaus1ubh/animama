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
    Audio: class extends EventTarget {
      pause = pause;
      play = vi.fn(async () => {});
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
    finishMicrophone: (
      stream = { getTracks: () => [{ stop }] } as unknown as MediaStream,
    ) => microphone(stream),
  };
}

describe("browser session resource ownership", () => {
  it("releases completed audio registrations and reacquires ownership when paused audio resumes", async () => {
    const { target, scope, pause } = fixture();
    const original = scope.register.bind(scope);
    const releases: ReturnType<typeof vi.fn>[] = [];
    const register = vi
      .spyOn(scope, "register")
      .mockImplementation((dispose) => {
        const release = vi.fn(original(dispose));
        releases.push(release);
        return release;
      });
    for (let index = 0; index < 20; index++) {
      const audio = new target.Audio();
      audio.dispatchEvent(new Event(index % 2 ? "ended" : "error"));
    }
    expect(releases.every((release) => release.mock.calls.length === 1)).toBe(
      true,
    );
    const active = new target.Audio();
    active.pause();
    expect(releases.at(-1)).toHaveBeenCalledOnce();
    await active.play();
    expect(register).toHaveBeenCalledTimes(22);
    await scope.end();
    expect(pause).toHaveBeenCalledTimes(2);
  });

  it("releases microphone ownership after all tracks stop or end", async () => {
    const { target, scope, finishMicrophone } = fixture();
    const tracks = [0, 1].map(() => {
      const track = new EventTarget() as EventTarget & {
        readyState: string;
        stop: () => void;
      };
      track.readyState = "live";
      track.stop = vi.fn(() => {
        track.readyState = "ended";
      });
      return track;
    });
    const stops = tracks.map((track) => track.stop);
    const pending = target.navigator.mediaDevices.getUserMedia({ audio: true });
    finishMicrophone({ getTracks: () => tracks } as unknown as MediaStream);
    await pending;
    tracks[0].stop();
    tracks[1].readyState = "ended";
    tracks[1].dispatchEvent(new Event("ended"));
    await scope.end();
    expect(stops[0]).toHaveBeenCalledOnce();
    expect(stops[1]).not.toHaveBeenCalled();
  });

  it("returns repeated microphone acquisitions to baseline but still stops a live final stream on revoke", async () => {
    const { target, scope, finishMicrophone } = fixture();
    const stops = [];
    for (let index = 0; index < 21; index++) {
      const track = new EventTarget() as EventTarget & {
        readyState: string;
        stop: () => void;
      };
      track.readyState = "live";
      const stop = vi.fn(() => {
        track.readyState = "ended";
      });
      track.stop = stop;
      stops.push(stop);
      const pending = target.navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      finishMicrophone({ getTracks: () => [track] } as unknown as MediaStream);
      await pending;
      if (index < 20) {
        if (index % 2) track.stop();
        else {
          track.readyState = "ended";
          track.dispatchEvent(new Event("ended"));
        }
      }
    }
    await scope.end();
    stops.forEach((stop, index) =>
      expect(stop).toHaveBeenCalledTimes(index === 20 || index % 2 ? 1 : 0),
    );
  });

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
