declare module "@/lib/speech/pocket/audio/volume.js" {
  export const POCKET_TTS_MAX_GAIN: number;
  export const POCKET_TTS_DEFAULT_GAIN: number;

  export function clampNormalizedPocketVolume(value: unknown): number;
  export function clampPocketGain(value: unknown): number;
  export function mapNormalizedVolumeToPocketGain(value: unknown): number;
}

declare module "@/lib/speech/pocket/index.js" {
  export const PocketTTSCore: {
    new (options?: Record<string, unknown>): any;
  };
  export const PCMPlayerWorklet: {
    new (...args: unknown[]): any;
  };
  export const EventEmitter: {
    new (...args: unknown[]): any;
  };
  export const CustomEvent: {
    new (...args: unknown[]): any;
  };
}

declare module "@/lib/speech/audio/PCMPlayerWorklet.js" {
  export class PCMPlayerWorklet {
    constructor(audioContext: AudioContext, options?: Record<string, unknown>);

    initPromise: Promise<void>;
    volume: number;

    addEventListener(type: string, listener: (event: any) => void): void;
    playAudio(data: Int16Array | Float32Array): void;
    notifyStreamEnded(): void;
    reset(): void;
  }
}
