// Reads a translation aloud: Amazon Polly when it has a voice for the language and gender,
// otherwise the browser's speechSynthesis.
import { findLanguage, type VoiceGender } from '../../shared/languages.ts';
import { post } from './api.ts';

let ctx: AudioContext | undefined;
let current: AudioBufferSourceNode | undefined;
let seq = 0;

export interface SpeakHooks {
  onStart: () => void;
  onEnd: () => void;
}

/** 'ok', 'other-gender' (read with the other gender's voice), or 'unsupported'. */
export type SpeakResult = 'ok' | 'other-gender' | 'unsupported';

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

export async function speak(text: string, langCode: string, gender: VoiceGender, hooks: SpeakHooks): Promise<SpeakResult> {
  stopSpeaking();
  const my = seq;
  const polly = findLanguage(langCode)?.polly;
  const other: VoiceGender = gender === 'female' ? 'male' : 'female';

  if (polly?.[gender] && (await pollySpeak(text, langCode, gender, hooks, my))) return 'ok';
  if (my !== seq) return 'ok';
  // No Polly voice of this gender: a matching browser voice beats the other gender.
  const browserVoice = pickBrowserVoice(langCode, gender);
  if (browserVoice.exact) return browserSpeak(text, langCode, browserVoice.voice, hooks) ? 'ok' : 'unsupported';
  if (polly?.[other] && (await pollySpeak(text, langCode, other, hooks, my))) return 'other-gender';
  if (my !== seq) return 'ok';
  return browserSpeak(text, langCode, browserVoice.voice, hooks) ? 'ok' : 'unsupported';
}

async function pollySpeak(text: string, language: string, gender: VoiceGender, hooks: SpeakHooks, my: number): Promise<boolean> {
  try {
    const res = await post<{ audio?: string }>('speak', { text, language, gender }, { timeoutMs: 15_000 });
    if (my !== seq) return true;
    if (!res.audio) return false;
    await playMp3(res.audio, hooks, my);
    return true;
  } catch {
    return false;
  }
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

// speechSynthesis does not expose gender; guess from well-known voice names of macOS, Windows, Android and Chrome.
const MALE = /\b(male|man)\b|男|otoya|hattori|ichiro|keita|daichi|zhiwei|yunjhe|yunxi|yunyang|pattara|niwat|kangkang|li-mu|injoon|hyunsu|daniel|alex|fred|aaron|arthur|thomas|rishi|jorge|diego|luca|reed|eddy|ralph|guy|david|mark|george|ravi|hemant/i;
const FEMALE = /\bfemale\b|女|kyoko|haruka|ayumi|nanami|meijia|mei-jia|sinji|tingting|yating|hanhan|kanya|premwadee|yuna|heami|samantha|karen|moira|tessa|zira|susan|hazel|aria|jenny|linda|amelie|anna|alice|paulina|monica|luciana|kalpana|swara/i;

function pickBrowserVoice(langCode: string, gender: VoiceGender): { voice?: SpeechSynthesisVoice; exact: boolean } {
  if (!('speechSynthesis' in window)) return { exact: false };
  const base = langCode.split('-')[0];
  const voices = speechSynthesis.getVoices();
  const byLang = [
    ...voices.filter((v) => v.lang.replace('_', '-') === langCode),
    ...voices.filter((v) => v.lang.replace('_', '-') !== langCode && v.lang.toLowerCase().startsWith(base)),
  ];
  const re = gender === 'male' ? MALE : FEMALE;
  const exact = byLang.find((v) => re.test(v.name));
  return { voice: exact ?? byLang[0], exact: !!exact };
}

function browserSpeak(text: string, langCode: string, voice: SpeechSynthesisVoice | undefined, hooks: SpeakHooks): boolean {
  if (!('speechSynthesis' in window)) return false;
  // Some browsers load voices lazily and return an empty list at first; let them try with the lang tag alone.
  if (!voice && speechSynthesis.getVoices().length > 0) return false;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = langCode;
  if (voice) u.voice = voice;
  u.onstart = hooks.onStart;
  u.onend = u.onerror = hooks.onEnd;
  speechSynthesis.speak(u);
  return true;
}
