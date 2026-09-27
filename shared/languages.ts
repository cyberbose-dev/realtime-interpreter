/** Languages offered in the UI. `code` is the Amazon Transcribe streaming language code. */
export interface Language {
  code: string;
  label: string;
  /** English name used in prompts. */
  name: string;
  /** Amazon Polly neural voice, or undefined when Polly has none (the browser's speechSynthesis is used). */
  polly?: { voiceId: string; languageCode?: string };
}

export const LANGUAGES: Language[] = [
  { code: 'en-US', label: 'English (US)', name: 'American English', polly: { voiceId: 'Joanna' } },
  { code: 'ja-JP', label: '日本語', name: 'Japanese', polly: { voiceId: 'Kazuha' } },
  { code: 'en-GB', label: 'English (UK)', name: 'British English', polly: { voiceId: 'Amy' } },
  { code: 'en-AU', label: 'English (AU)', name: 'Australian English', polly: { voiceId: 'Olivia' } },
  { code: 'ko-KR', label: '한국어', name: 'Korean', polly: { voiceId: 'Seoyeon' } },
  { code: 'zh-CN', label: '中文（简体）', name: 'Simplified Chinese', polly: { voiceId: 'Zhiyu', languageCode: 'cmn-CN' } },
  { code: 'zh-TW', label: '中文（繁體）', name: 'Traditional Chinese (Taiwan)' },
  { code: 'fr-FR', label: 'Français', name: 'French', polly: { voiceId: 'Lea' } },
  { code: 'de-DE', label: 'Deutsch', name: 'German', polly: { voiceId: 'Vicki' } },
  { code: 'es-US', label: 'Español (US)', name: 'US Spanish', polly: { voiceId: 'Lupe' } },
  { code: 'es-ES', label: 'Español (ES)', name: 'Spanish', polly: { voiceId: 'Lucia' } },
  { code: 'it-IT', label: 'Italiano', name: 'Italian', polly: { voiceId: 'Bianca' } },
  { code: 'pt-BR', label: 'Português (BR)', name: 'Brazilian Portuguese', polly: { voiceId: 'Camila' } },
  { code: 'hi-IN', label: 'हिन्दी', name: 'Hindi', polly: { voiceId: 'Kajal' } },
  { code: 'th-TH', label: 'ไทย', name: 'Thai' },
];

export const findLanguage = (code: string): Language | undefined => LANGUAGES.find((l) => l.code === code);

export const DEFAULT_CONTEXT =
  'あなたは AWS のイベント（AWS Summit や re:Invent など）の参加者のために通訳しています。' +
  'AWS のサービス名、技術用語、ビジネス用語は無理に翻訳せず、英字またはカタカナで表記してください。' +
  '原文に忠実に、簡潔に翻訳してください。';

/** Limits shared by the client and the API. */
export const LIMITS = { text: 2000, context: 2000, history: 10, speak: 1500 } as const;
