// Captures the microphone and/or the PC's audio (screen/tab share) and emits 16 kHz PCM chunks.
import type { AudioSource } from './settings.ts';

export interface CaptureCallbacks {
  onChunk: (pcm: ArrayBuffer) => void;
  onLevel: (level: number) => void;
  /** The user stopped sharing the PC audio from the browser UI. */
  onSystemAudioEnded: () => void;
}

export class AudioCapture {
  private ctx?: AudioContext;
  private node?: AudioWorkletNode;
  private streams: MediaStream[] = [];

  constructor(private readonly cb: CaptureCallbacks) {}

  /** Returns the sources actually captured (PC audio may be declined or unavailable). */
  async start(source: AudioSource): Promise<{ mic: boolean; system: boolean }> {
    this.stop();
    // Ask for the screen/tab share first: it must run while the click's user activation is still valid.
    const systemTrack = source === 'mix' || source === 'system' ? await this.requestSystemAudio().catch(() => undefined) : undefined;
    const micStream =
      source === 'mic' || source === 'mix' || !systemTrack
        ? await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
          })
        : undefined;

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
    return { mic: !!micStream, system: !!systemTrack };
  }

  private async requestSystemAudio(): Promise<MediaStreamTrack | undefined> {
    // Chrome/Edge need video in the request; only the audio track is used.
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      // Chromium-only hints.
      ...({ systemAudio: 'include', selfBrowserSurface: 'exclude' } as object),
    } as DisplayMediaStreamOptions);
    stream.getVideoTracks().forEach((t) => t.stop());
    const track = stream.getAudioTracks()[0];
    if (!track) return undefined;
    track.addEventListener('ended', () => this.cb.onSystemAudioEnded());
    return track;
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
