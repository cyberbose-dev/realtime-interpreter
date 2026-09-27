// Reads a translation aloud: Amazon Polly when it has a voice for the language, otherwise the browser's speechSynthesis.
import { findLanguage } from '../../shared/languages.ts';
import { post } from './api.ts';

let ctx: AudioContext | undefined;
let current: AudioBufferSourceNode | undefined;
let seq = 0;

export interface SpeakHooks {
  onStart: () => void;
  onEnd: () => void;
}

/** Must be called from a user gesture (iOS only allows audio that was unlocked by one). */
export function unlockAudio() {
  ctx ??= new AudioContext();
  if (ctx.state === 'suspended') void ctx.resume();
}

export function stopSpeaking() {
  seq++;
  try {
    current?.stop();
  } catch {
    /* already stopped */
  }
  current = undefined;
  if ('speechSynthesis' in window) speechSynthesis.cancel();
}

/** Returns false when neither Polly nor the browser can speak the language. */
export async function speak(text: string, langCode: string, hooks: SpeakHooks): Promise<boolean> {
  stopSpeaking();
  const my = seq;
  const lang = findLanguage(langCode);
  if (lang?.polly) {
    try {
      const res = await post<{ audio?: string; fallback?: boolean }>('speak', { text, language: langCode }, { timeoutMs: 15_000 });
      if (my !== seq) return true;
      if (res.audio) {
        await playMp3(res.audio, hooks, my);
        return true;
      }
    } catch {
      if (my !== seq) return true;
      /* fall back to the browser */
    }
  }
  return browserSpeak(text, langCode, hooks);
}

async function playMp3(b64: string, hooks: SpeakHooks, my: number) {
  unlockAudio();
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const buffer = await ctx!.decodeAudioData(bytes.buffer);
  if (my !== seq) return;
  const src = ctx!.createBufferSource();
  src.buffer = buffer;
  src.connect(ctx!.destination);
  src.onended = () => {
    if (current === src) current = undefined;
    hooks.onEnd();
  };
  current = src;
  hooks.onStart();
  src.start();
}

function browserSpeak(text: string, langCode: string, hooks: SpeakHooks): boolean {
  if (!('speechSynthesis' in window)) return false;
  const voices = speechSynthesis.getVoices();
  const base = langCode.split('-')[0];
  const voice =
    voices.find((v) => v.lang.replace('_', '-') === langCode) ?? voices.find((v) => v.lang.toLowerCase().startsWith(base));
  // Some browsers load voices lazily and return an empty list at first; let them try with the lang tag alone.
  if (!voice && voices.length > 0) return false;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = langCode;
  if (voice) u.voice = voice;
  u.onstart = hooks.onStart;
  u.onend = u.onerror = hooks.onEnd;
  speechSynthesis.speak(u);
  return true;
}
