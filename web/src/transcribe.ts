// Amazon Transcribe streaming over WebSocket, with automatic reconnection.
import { EventStreamCodec } from '@smithy/eventstream-codec';
import { fromUtf8, toUtf8 } from '@smithy/util-utf8';

const codec = new EventStreamCodec(toUtf8, fromUtf8);

export interface TranscriptResult {
  resultId: string;
  text: string;
  partial: boolean;
}

export type StreamStatus = 'idle' | 'connecting' | 'live' | 'reconnecting' | 'offline' | 'error';

export interface StreamOptions {
  getUrl: (language: string) => Promise<string>;
  onResult: (r: TranscriptResult) => void;
  onStatus: (s: StreamStatus, detail?: string) => void;
  /** Called when a connection ends; any partial result from it will never be finalized. */
  onConnectionLost: () => void;
}

/** Audio kept while disconnected and sent on reconnect (chunks are 100 ms). */
const MAX_BUFFERED_CHUNKS = 150;
/** Bytes of unsent audio that mean the socket is stuck (≈ 3 s at 32 kB/s). */
const STALL_BYTES = 96_000;

export class TranscribeStream {
  private ws?: WebSocket;
  private language = '';
  private running = false;
  private attempt = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private stallSince = 0;
  private backlog: ArrayBuffer[] = [];
  private generation = 0;

  constructor(private readonly opts: StreamOptions) {
    addEventListener('online', () => this.running && !this.isOpen() && this.reconnectNow());
    addEventListener('offline', () => {
      if (!this.running) return;
      this.opts.onStatus('offline');
      this.dropSocket(); // the socket is dead; reconnect when back online
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.running && !this.isOpen()) this.reconnectNow();
    });
  }

  start(language: string) {
    this.language = language;
    this.running = true;
    this.attempt = 0;
    this.backlog = [];
    this.connect();
  }

  /** Restarts the stream with another language (e.g. when the direction is switched). */
  setLanguage(language: string) {
    if (language === this.language) return;
    this.language = language;
    if (this.running) this.reconnectNow();
  }

  stop() {
    this.running = false;
    clearTimeout(this.timer);
    const ws = this.ws;
    this.ws = undefined;
    this.generation++;
    if (ws?.readyState === WebSocket.OPEN) {
      // An empty audio event asks Transcribe to finish; give it a moment to return the last results.
      ws.send(encodeAudio(new ArrayBuffer(0)));
      setTimeout(() => ws.close(1000), 1500);
    } else {
      ws?.close();
    }
    this.opts.onConnectionLost();
    this.opts.onStatus('idle');
  }

  send(pcm: ArrayBuffer) {
    if (!this.running) return;
    const ws = this.ws;
    if (ws && ws.readyState === WebSocket.OPEN) {
      if (ws.bufferedAmount > STALL_BYTES) {
        // Network changed (Wi-Fi <-> cellular) without the socket noticing: data piles up.
        this.stallSince ||= Date.now();
        if (Date.now() - this.stallSince > 3000) {
          this.stallSince = 0;
          this.reconnectNow();
        }
        this.keep(pcm);
        return;
      }
      this.stallSince = 0;
      ws.send(encodeAudio(pcm));
    } else {
      this.keep(pcm);
    }
  }

  private keep(pcm: ArrayBuffer) {
    this.backlog.push(pcm);
    if (this.backlog.length > MAX_BUFFERED_CHUNKS) this.backlog.shift();
  }

  private isOpen() {
    return this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING;
  }

  private dropSocket() {
    const ws = this.ws;
    this.ws = undefined;
    this.generation++;
    if (ws) {
      ws.onclose = ws.onerror = ws.onmessage = null;
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      this.opts.onConnectionLost();
    }
  }

  private reconnectNow() {
    clearTimeout(this.timer);
    this.dropSocket();
    this.attempt = 0;
    this.connect();
  }

  private scheduleReconnect(detail?: string) {
    if (!this.running) return;
    clearTimeout(this.timer);
    if (!navigator.onLine) {
      this.opts.onStatus('offline');
      return; // the 'online' listener reconnects
    }
    const delay = Math.min(10_000, 500 * 2 ** this.attempt) + Math.random() * 300;
    this.attempt++;
    this.opts.onStatus('reconnecting', detail);
    this.timer = setTimeout(() => this.connect(), delay);
  }

  private async connect() {
    if (!this.running) return;
    const gen = ++this.generation;
    this.opts.onStatus(this.attempt === 0 && !this.ws ? 'connecting' : 'reconnecting');
    let url: string;
    try {
      url = await this.opts.getUrl(this.language);
    } catch (e) {
      if (gen === this.generation) this.scheduleReconnect(String((e as Error).message ?? e));
      return;
    }
    if (gen !== this.generation || !this.running) return;

    const ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onopen = () => {
      if (gen !== this.generation) return;
      this.opts.onStatus('live');
      const pending = this.backlog;
      this.backlog = [];
      pending.forEach((p) => ws.send(encodeAudio(p)));
    };
    ws.onmessage = (ev) => {
      if (gen !== this.generation) return;
      this.attempt = 0;
      this.handleMessage(ev.data as ArrayBuffer);
    };
    ws.onerror = () => {
      /* onclose follows */
    };
    ws.onclose = (ev) => {
      if (gen !== this.generation) return;
      this.ws = undefined;
      this.opts.onConnectionLost();
      this.scheduleReconnect(ev.reason || undefined);
    };
  }

  private handleMessage(data: ArrayBuffer) {
    const msg = codec.decode(new Uint8Array(data));
    const type = msg.headers[':message-type']?.value;
    const body = JSON.parse(toUtf8(msg.body) || '{}');
    if (type === 'event' && msg.headers[':event-type']?.value === 'TranscriptEvent') {
      for (const r of body.Transcript?.Results ?? []) {
        const text: string = r.Alternatives?.[0]?.Transcript ?? '';
        if (text) this.opts.onResult({ resultId: r.ResultId, text, partial: !!r.IsPartial });
      }
    } else if (type === 'exception') {
      const name = String(msg.headers[':exception-type']?.value ?? 'Exception');
      // An expired presigned URL (slow network between issuing and connecting) is fixed by a fresh URL.
      if (name === 'BadRequestException' && !/expired/i.test(String(body.Message))) {
        // e.g. unsupported language in this region: retrying will not help.
        this.running = false;
        this.dropSocket();
        this.opts.onStatus('error', body.Message ?? name);
      }
      // Other exceptions (limits, timeouts) close the socket and trigger a reconnect.
    }
  }
}

function encodeAudio(pcm: ArrayBuffer): Uint8Array<ArrayBuffer> {
  return codec.encode({
    headers: {
      ':message-type': { type: 'string', value: 'event' },
      ':event-type': { type: 'string', value: 'AudioEvent' },
      ':content-type': { type: 'string', value: 'application/octet-stream' },
    },
    body: new Uint8Array(pcm),
  }) as Uint8Array<ArrayBuffer>;
}
