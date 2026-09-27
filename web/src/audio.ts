// Captures the microphone and/or the PC's audio (screen/tab share) and emits 16 kHz PCM chunks.
import type { AudioSource } from './settings.ts';

export interface CaptureCallbacks {
  onChunk: (pcm: ArrayBuffer) => void;
  onLevel: (level: number) => void;
  /** The user stopped sharing the PC audio from the browser UI. */
  onSystemAudioEnded: () => void;
}

export interface CaptureResult {
  mic: boolean;
  system: boolean;
  /** Why PC audio could not be captured. */
  systemProblem?: 'cancelled' | 'no-audio';
}

interface SystemAudio {
  track?: MediaStreamTrack;
  problem?: CaptureResult['systemProblem'];
}

const MIC_CONSTRAINTS: MediaTrackConstraints = { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 };

async function openMic(deviceId: string): Promise<MediaStream> {
  if (deviceId) {
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: { ...MIC_CONSTRAINTS, deviceId: { exact: deviceId } } });
    } catch (e) {
      // The device was unplugged: fall back to the default one.
      if ((e as Error).name !== 'OverconstrainedError' && (e as Error).name !== 'NotFoundError') throw e;
    }
  }
  return navigator.mediaDevices.getUserMedia({ audio: MIC_CONSTRAINTS });
}

/** Audio input devices. Labels are empty until the microphone permission has been granted once. */
export async function listMicrophones(): Promise<MediaDeviceInfo[]> {
  const devices = await navigator.mediaDevices?.enumerateDevices().catch(() => []);
  return (devices ?? []).filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default' && d.deviceId !== 'communications');
}

export class AudioCapture {
  private ctx?: AudioContext;
  private node?: AudioWorkletNode;
  private streams: MediaStream[] = [];

  constructor(private readonly cb: CaptureCallbacks) {}

  /** Returns the sources actually captured (PC audio may be declined or unavailable). */
  async start(source: AudioSource, micDeviceId = ''): Promise<CaptureResult> {
    this.stop();
    // Ask for the screen/tab share first: it must run while the click's user activation is still valid.
    const share: SystemAudio =
      source === 'mix' || source === 'system' ? await this.requestSystemAudio().catch(() => ({ problem: 'cancelled' as const })) : {};
    const systemTrack = share.track;
    const micStream = source === 'mic' || source === 'mix' || !systemTrack ? await openMic(micDeviceId) : undefined;

    const ctx = new AudioContext({ latencyHint: 'interactive' });
    this.ctx = ctx;
    await ctx.audioWorklet.addModule('/audio-worklet.js');
    const node = new AudioWorkletNode(ctx, 'pcm-worklet', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
    node.port.onmessage = (e: MessageEvent<{ pcm: ArrayBuffer; level: number }>) => {
      this.cb.onChunk(e.data.pcm);
      this.cb.onLevel(e.data.level);
    };
    // The worklet has to be pulled by the destination to run; keep it silent.
    const sink = ctx.createGain();
    sink.gain.value = 0;
    node.connect(sink).connect(ctx.destination);
    this.node = node;

    if (systemTrack) this.connect(ctx, node, new MediaStream([systemTrack]));
    if (micStream) this.connect(ctx, node, micStream);
    if (ctx.state === 'suspended') await ctx.resume();
    return { mic: !!micStream, system: !!systemTrack, systemProblem: share.problem };
  }

  private async requestSystemAudio(): Promise<SystemAudio> {
    // Chrome/Edge need video in the request; only the audio track is used.
    const stream = await navigator.mediaDevices.getDisplayMedia({
      // Preselect the "Tab" pane: tab sharing is the one surface whose audio works on every OS.
      video: { displaySurface: 'browser' } as MediaTrackConstraints,
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      // Chromium-only hints.
      ...({ systemAudio: 'include', selfBrowserSurface: 'exclude', surfaceSwitching: 'include' } as object),
    } as DisplayMediaStreamOptions);
    stream.getVideoTracks().forEach((t) => t.stop());
    const track = stream.getAudioTracks()[0];
    if (!track) return { problem: 'no-audio' }; // a window, or a screen on an OS without system audio capture
    track.addEventListener('ended', () => this.cb.onSystemAudioEnded());
    return { track };
  }

  private connect(ctx: AudioContext, node: AudioWorkletNode, stream: MediaStream) {
    this.streams.push(stream);
    ctx.createMediaStreamSource(stream).connect(node); // multiple sources are summed at the input
  }

  /** Sends silence while our own speech playback is running so it is not transcribed. */
  setMuted(muted: boolean) {
    this.node?.port.postMessage({ muted });
  }

  stop() {
    this.streams.forEach((s) => s.getTracks().forEach((t) => t.stop()));
    this.streams = [];
    this.node?.disconnect();
    this.node = undefined;
    void this.ctx?.close();
    this.ctx = undefined;
  }
}
