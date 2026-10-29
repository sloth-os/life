// Microphone recording for voice mode: MediaRecorder captures whatever the browser encodes
// (Opus in WebM, AAC in MP4…), then the audio is decoded and resampled to 16 kHz mono 16-bit
// WAV, the one format every audio model accepts.
import { VOICE_MAX_SECONDS } from "../../shared/schemas.ts";

export const canRecord = (): boolean =>
  typeof window !== "undefined" && typeof MediaRecorder !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia) && window.isSecureContext;

export interface Recording {
  /** Stop and get the WAV (base64, without a data: prefix). */
  stop(): Promise<{ base64: string; seconds: number }>;
  cancel(): void;
}

const SAMPLE_RATE = 16_000;

function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const ascii = (offset: number, text: string) => [...text].forEach((ch, i) => view.setUint8(offset + i, ch.charCodeAt(0)));
  ascii(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return buffer;
}

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** Decode what MediaRecorder captured and resample it to 16 kHz mono. */
async function toWav(blob: Blob): Promise<{ base64: string; seconds: number }> {
  const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const context = new AudioCtx();
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer());
    const frames = Math.max(1, Math.ceil(decoded.duration * SAMPLE_RATE));
    const offline = new OfflineAudioContext(1, frames, SAMPLE_RATE);
    const source = offline.createBufferSource();
    source.buffer = decoded;
    source.connect(offline.destination);
    source.start();
    const rendered = await offline.startRendering();
    return { base64: toBase64(encodeWav(rendered.getChannelData(0), SAMPLE_RATE)), seconds: decoded.duration };
  } finally {
    void context.close();
  }
}

/**
 * Start recording. `onLevel` gets the input level (0–1) about 20 times a second, for a meter;
 * recording stops by itself after the voice limit.
 */
export async function startRecording(onLevel?: (level: number) => void, onAutoStop?: () => void): Promise<Recording> {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
  const recorder = new MediaRecorder(stream);
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size) chunks.push(event.data);
  };
  const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const meterContext = onLevel ? new AudioCtx() : null;
  let meterTimer: ReturnType<typeof setInterval> | undefined;
  if (meterContext && onLevel) {
    const analyser = meterContext.createAnalyser();
    analyser.fftSize = 512;
    meterContext.createMediaStreamSource(stream).connect(analyser);
    const data = new Uint8Array(analyser.fftSize);
    meterTimer = setInterval(() => {
      analyser.getByteTimeDomainData(data);
      let peak = 0;
      for (const v of data) peak = Math.max(peak, Math.abs(v - 128) / 128);
      onLevel(peak);
    }, 50);
  }
  const autoStop = setTimeout(() => onAutoStop?.(), VOICE_MAX_SECONDS * 1000);
  const release = () => {
    clearTimeout(autoStop);
    clearInterval(meterTimer);
    void meterContext?.close();
    stream.getTracks().forEach((t) => t.stop());
  };
  recorder.start(250);
  return {
    stop: () =>
      new Promise((resolve, reject) => {
        recorder.onstop = () => {
          release();
          toWav(new Blob(chunks, { type: recorder.mimeType })).then(resolve, reject);
        };
        recorder.stop();
      }),
    cancel: () => {
      recorder.onstop = null;
      if (recorder.state !== "inactive") recorder.stop();
      release();
    },
  };
}
