/**
 * A stand-in `Avatar` for surface tests of the Avatar settings. It records
 * each load's settings and each live wind change, and answers any other
 * method with a no-op, so a surface's unrelated calls need no setup.
 *
 * Mock `@/lib/avatar` with `{ Avatar: FakeSettingsAvatar }` and
 * `@/query/hooks/useAvatarSettings` with `{ useAvatarLoadSettings:
 * fakeUseAvatarLoadSettings }`, inside the factory through a dynamic import.
 */

export type FakeSettingsAvatarRecord = {
  /** `load <spring> <material>` per load, then `wind <mode>` per live change. */
  events: string[];
  disposed: boolean;
  /** Resolve the pending load; the Avatar then has a scene. */
  finishLoad: () => void;
  /** Reject the pending load, as an undecodable file would. */
  failLoad: () => void;
};

export const fakeAvatars: FakeSettingsAvatarRecord[] = [];

/** What `useAvatarLoadSettings` reports; its ref is one object, as the hook's. */
export const fakeSettings = {
  current: {
    springMode: "automatic",
    springModeRef: { current: "automatic" },
    materialMode: "automatic" as string | null,
  },
};

/** The Avatar items surfaces asked settings for, in render order. */
export const fakeSettingsItemIds: (string | null)[] = [];

/** `useAvatarLoadSettings` for tests: records the item and reports `fakeSettings`. */
export function fakeUseAvatarLoadSettings(itemId: string | null) {
  fakeSettingsItemIds.push(itemId);
  return fakeSettings.current;
}

export function setFakeSettings(
  springMode: string,
  materialMode: string | null,
): void {
  const springModeRef = fakeSettings.current.springModeRef;
  springModeRef.current = springMode;
  fakeSettings.current = { springMode, springModeRef, materialMode };
}

export function resetFakeSettingsAvatars(): void {
  fakeAvatars.length = 0;
  fakeSettingsItemIds.length = 0;
  fakeSettings.current = {
    springMode: "automatic",
    springModeRef: { current: "automatic" },
    materialMode: "automatic",
  };
}

/** The load events (`load <spring> <material>`) of the `index`th Avatar a surface made. */
export function fakeAvatarLoads(index: number): string[] {
  return (fakeAvatars[index]?.events ?? []).filter((event) =>
    event.startsWith("load"),
  );
}

const PASS_THROUGH = new Set<PropertyKey>(["then", "toJSON", "$$typeof"]);

export class FakeSettingsAvatar {
  record: FakeSettingsAvatarRecord = {
    events: [],
    disposed: false,
    finishLoad: () => undefined,
    failLoad: () => undefined,
  };
  isDisposed = false;
  isReady = false;
  scene: object | null = null;
  vrm: object | null = null;
  facePartCorrections = null;

  constructor() {
    fakeAvatars.push(this.record);
    // Any method the surface calls that the settings tests do not need.
    return new Proxy(this, {
      get(target, property, receiver) {
        if (property in target || typeof property === "symbol")
          return Reflect.get(target, property, receiver);
        if (PASS_THROUGH.has(property)) return undefined;
        return () => undefined;
      },
    });
  }

  load(spec: { springMode?: string; materialMode?: string }): Promise<void> {
    this.record.events.push(`load ${spec.springMode} ${spec.materialMode}`);
    return new Promise<void>((resolve, reject) => {
      this.record.finishLoad = () => {
        this.isReady = !this.isDisposed;
        this.scene = this.isDisposed ? null : {};
        resolve();
      };
      this.record.failLoad = () => reject(new Error("avatar_load_failed"));
    });
  }

  setSpringMode(mode: string): void {
    this.record.events.push(`wind ${mode}`);
  }

  setFacePartCorrections(): Promise<void> {
    return Promise.resolve();
  }

  dispose(): void {
    this.isDisposed = true;
    this.isReady = false;
    this.record.disposed = true;
  }
}
