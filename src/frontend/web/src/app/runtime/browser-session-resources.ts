import type { SessionRequestScope } from "./session-requests";

/** Capture browser resources at creation, including libraries that do not expose React cleanup. */
export function installBrowserSessionResources(
  target: Window & typeof globalThis,
  current: () => SessionRequestScope | null,
): void {
  const admitted = () => {
    const scope = current();
    if (!scope || scope.controller.signal.aborted)
      throw new DOMException(
        "Browser session admission is required",
        "AbortError",
      );
    return scope;
  };
  const objectUrls = new Map<string, () => void>();
  const createUrl = target.URL.createObjectURL.bind(target.URL);
  const revokeUrl = target.URL.revokeObjectURL.bind(target.URL);
  target.URL.createObjectURL = (blob) => {
    const scope = admitted();
    const url = createUrl(blob);
    objectUrls.set(
      url,
      scope.register(() => {
        revokeUrl(url);
        objectUrls.delete(url);
      }),
    );
    return url;
  };
  target.URL.revokeObjectURL = (url) => {
    objectUrls.get(url)?.();
    objectUrls.delete(url);
    revokeUrl(url);
  };
  if (target.Worker) {
    const Worker = target.Worker;
    target.Worker = new Proxy(Worker, {
      construct: (constructor, args) => {
        const scope = admitted();
        const worker = Reflect.construct(constructor, args) as Worker;
        const terminate = worker.terminate.bind(worker);
        const unregister = scope.register(terminate);
        worker.terminate = () => {
          unregister();
          terminate();
        };
        return worker;
      },
    });
  }
  if (target.AudioContext) {
    const AudioContext = target.AudioContext;
    target.AudioContext = new Proxy(AudioContext, {
      construct: (constructor, args) => {
        const scope = admitted();
        const context = Reflect.construct(constructor, args) as AudioContext;
        const close = context.close.bind(context);
        const unregister = scope.register(() => {
          void close().catch(() => {});
        });
        context.close = () => {
          unregister();
          return close();
        };
        return context;
      },
    });
  }
  if (target.Audio) {
    const Audio = target.Audio;
    target.Audio = new Proxy(Audio, {
      construct: (constructor, args) => {
        const scope = admitted();
        const audio = Reflect.construct(constructor, args) as HTMLAudioElement;
        scope.register(() => {
          audio.pause();
          audio.removeAttribute("src");
          audio.load();
        });
        return audio;
      },
    });
  }
  const devices = target.navigator.mediaDevices;
  if (devices?.getUserMedia) {
    const getUserMedia = devices.getUserMedia.bind(devices);
    devices.getUserMedia = async (constraints) => {
      const scope = admitted();
      const stream = await getUserMedia(constraints);
      const stop = () => stream.getTracks().forEach((track) => track.stop());
      scope.register(stop);
      if (scope.controller.signal.aborted)
        throw new DOMException("This browser session has ended", "AbortError");
      return stream;
    };
  }
  const pip = (
    target as Window & {
      documentPictureInPicture?: {
        requestWindow(options?: {
          width?: number;
          height?: number;
        }): Promise<Window>;
      };
    }
  ).documentPictureInPicture;
  if (pip) {
    const requestWindow = pip.requestWindow.bind(pip);
    pip.requestWindow = async (options) => {
      const scope = admitted();
      const window = await requestWindow(options);
      const unregister = scope.register(() => window.close());
      window.addEventListener?.("pagehide", unregister, { once: true });
      if (scope.controller.signal.aborted)
        throw new DOMException("This browser session has ended", "AbortError");
      return window;
    };
  }
  const video = target.HTMLVideoElement?.prototype;
  if (video?.requestPictureInPicture) {
    const requestPictureInPicture = video.requestPictureInPicture;
    video.requestPictureInPicture = async function () {
      const scope = admitted();
      const result = await requestPictureInPicture.call(this);
      scope.register(() => {
        if (target.document.pictureInPictureElement)
          void target.document.exitPictureInPicture().catch(() => {});
      });
      if (scope.controller.signal.aborted)
        throw new DOMException("This browser session has ended", "AbortError");
      return result;
    };
  }
}
