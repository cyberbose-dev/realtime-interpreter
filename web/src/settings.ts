// Settings live in sessionStorage: kept while the tab is open, gone when it is closed.
import { DEFAULT_CONTEXT, findLanguage, type VoiceGender } from '../../shared/languages.ts';

export type AudioSource = 'mix' | 'mic' | 'system';

export interface Settings {
  /** Your language. */
  langA: string;
  /** The other party's language. */
  langB: string;
  /** BtoA: listen to langB and read langA (default). */
  direction: 'BtoA' | 'AtoB';
  source: AudioSource;
  /** Microphone (or virtual loopback device such as BlackHole); empty = system default. */
  micDeviceId: string;
  draft: boolean;
  showOriginal: boolean;
  fontSize: 's' | 'm' | 'l' | 'xl';
  voiceGender: VoiceGender;
  context: string;
}

export const isMobile =
  /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ||
  (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1); // iPadOS

/** Only Chromium (Chrome, Edge) returns audio from screen/tab sharing; Safari and Firefox never do. */
const isChromium = !!(navigator as { userAgentData?: { brands?: { brand: string }[] } }).userAgentData?.brands?.some((b) =>
  /Chromium/.test(b.brand),
);

export const canCaptureSystemAudio =
  !isMobile && isChromium && typeof navigator.mediaDevices?.getDisplayMedia === 'function';

const KEY = 'settings';

const defaults: Settings = {
  langA: 'ja-JP',
  langB: 'en-US',
  direction: 'BtoA',
  source: canCaptureSystemAudio ? 'mix' : 'mic',
  micDeviceId: '',
  draft: true,
  showOriginal: false,
  fontSize: 'm',
  voiceGender: 'female',
  context: DEFAULT_CONTEXT,
};

function load(): Settings {
  try {
    const saved = JSON.parse(sessionStorage.getItem(KEY) ?? '{}') as Partial<Settings>;
    const s = { ...defaults, ...saved };
    if (!canCaptureSystemAudio) s.source = 'mic';
    if (!findLanguage(s.langA) || !findLanguage(s.langB) || s.langA === s.langB) {
      s.langA = defaults.langA;
      s.langB = defaults.langB;
    }
    return s;
  } catch {
    return { ...defaults };
  }
}

export const settings: Settings = load();
export const defaultSettings: Readonly<Settings> = defaults;

type Listener = (changed: (keyof Settings)[]) => void;
const listeners: Listener[] = [];
export const onSettingsChange = (fn: Listener) => listeners.push(fn);

export function updateSettings(patch: Partial<Settings>): void {
  const changed = (Object.keys(patch) as (keyof Settings)[]).filter((k) => patch[k] !== settings[k]);
  if (changed.length === 0) return;
  Object.assign(settings, patch);
  try {
    sessionStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* in-memory only */
  }
  listeners.forEach((fn) => fn(changed));
}

export const sourceLang = () => (settings.direction === 'BtoA' ? settings.langB : settings.langA);
export const targetLang = () => (settings.direction === 'BtoA' ? settings.langA : settings.langB);
