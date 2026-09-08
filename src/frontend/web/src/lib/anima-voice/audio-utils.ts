"use client";

export const MAX_ELEVENLABS_CLONE_SECONDS = 120;
const MAX_ELEVENLABS_CLONE_SAMPLE_RATE = 24000;

export type PrepareElevenLabsCloneSourceAudioResult = {
  file: File;
  wasTruncated: boolean;
};

function stripFileExtension(fileName: string): string {
  const trimmed = fileName.trim();
  if (!trimmed) return "voice-sample";
  const lastDotIndex = trimmed.lastIndexOf(".");
  if (lastDotIndex <= 0) return trimmed;
  return trimmed.slice(0, lastDotIndex) || "voice-sample";
}

function clampAudioSample(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value <= -1) return -1;
  if (value >= 1) return 1;
  return value;
}

function audioBufferToMono(audioBuffer: AudioBuffer): Float32Array {
  const left = audioBuffer.getChannelData(0);
  if (audioBuffer.numberOfChannels <= 1) {
    return new Float32Array(left);
  }

  const right = audioBuffer.getChannelData(1);
  const mono = new Float32Array(left.length);
  for (let index = 0; index < left.length; index += 1) {
    mono[index] = (left[index]! + right[index]!) * 0.5;
  }
  return mono;
}

function resampleMonoAudio(
  monoData: Float32Array,
  sourceRate: number,
  targetRate: number,
): Float32Array {
  if (sourceRate === targetRate) {
    return monoData;
  }

  const ratio = sourceRate / targetRate;
  const outputLength = Math.max(1, Math.floor(monoData.length / ratio));
  const output = new Float32Array(outputLength);

  for (let index = 0; index < outputLength; index += 1) {
    const sourceIndex = index * ratio;
    const sourceFloor = Math.floor(sourceIndex);
    const sourceCeil = Math.min(sourceFloor + 1, monoData.length - 1);
    const t = sourceIndex - sourceFloor;
    output[index] =
      monoData[sourceFloor]! * (1 - t) + monoData[sourceCeil]! * t;
  }

  return output;
}

function encodeMonoPcm16Wav(
  samples: Float32Array,
  sampleRate: number,
): ArrayBuffer {
  const bytesPerSample = 2;
  const blockAlign = bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeAscii = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };

  writeAscii(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(8, "WAVE");
  writeAscii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeAscii(36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let index = 0; index < samples.length; index += 1) {
    const normalized = clampAudioSample(samples[index]!);
    const pcmValue =
      normalized < 0
        ? Math.round(normalized * 0x8000)
        : Math.round(normalized * 0x7fff);
    view.setInt16(offset, pcmValue, true);
    offset += bytesPerSample;
  }

  return buffer;
}

function getAudioContextCtor(): typeof AudioContext | null {
  if (typeof window === "undefined") return null;
  const runtimeWindow = window as Window &
    typeof globalThis & {
      AudioContext?: typeof AudioContext;
      webkitAudioContext?: typeof AudioContext;
    };
  return runtimeWindow.AudioContext ?? runtimeWindow.webkitAudioContext ?? null;
}

export async function prepareElevenLabsCloneSourceAudio(
  file: File,
): Promise<PrepareElevenLabsCloneSourceAudioResult> {
  const AudioContextCtor = getAudioContextCtor();
  if (!AudioContextCtor) {
    throw new Error("Web Audio API is not supported in this browser.");
  }

  const audioContext = new AudioContextCtor({
    latencyHint: "interactive",
  });

  try {
    const arrayBuffer = await file.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(
      arrayBuffer.slice(0),
    );
    if (audioBuffer.duration <= MAX_ELEVENLABS_CLONE_SECONDS) {
      return {
        file,
        wasTruncated: false,
      };
    }

    const monoData = audioBufferToMono(audioBuffer);
    const maxSamples = Math.max(
      1,
      Math.floor(audioBuffer.sampleRate * MAX_ELEVENLABS_CLONE_SECONDS),
    );
    const trimmedSamples = monoData.slice(0, maxSamples);
    const outputSamples = resampleMonoAudio(
      trimmedSamples,
      audioBuffer.sampleRate,
      MAX_ELEVENLABS_CLONE_SAMPLE_RATE,
    );
    const trimmedFile = new File(
      [encodeMonoPcm16Wav(outputSamples, MAX_ELEVENLABS_CLONE_SAMPLE_RATE)],
      `${stripFileExtension(file.name)}-trimmed.wav`,
      {
        type: "audio/wav",
        lastModified: file.lastModified,
      },
    );

    return {
      file: trimmedFile,
      wasTruncated: true,
    };
  } finally {
    try {
      await audioContext.close();
    } catch {
      // noop
    }
  }
}
