export type VoiceGender = 'female' | 'male';

export interface PollyVoice {
  voiceId: string;
  /** Defaults to neural. */
  engine?: 'neural' | 'standard';
}

export interface Language {
  code: string;
  /** Japanese name shown in the UI. */
  ja: string;
  /** Name in the language itself. */
  label: string;
  /** English name used in prompts. */
  name: string;
  /**
   * Amazon Polly voices (checked in ap-northeast-1). A missing gender is read by the browser's
   * speechSynthesis when it has such a voice, otherwise by the other Polly voice.
   */
  polly?: { female?: PollyVoice; male?: PollyVoice; languageCode?: string };
}

/** Languages offered in the UI. `code` is the Amazon Transcribe streaming language code. */
export const LANGUAGES: Language[] = [
  { code: 'en-US', ja: '英語（米国）', label: 'English (US)', name: 'American English', polly: { female: { voiceId: 'Joanna' }, male: { voiceId: 'Matthew' } } },
  { code: 'ja-JP', ja: '日本語', label: '日本語', name: 'Japanese', polly: { female: { voiceId: 'Kazuha' }, male: { voiceId: 'Takumi' } } },
  { code: 'en-GB', ja: '英語（英国）', label: 'English (UK)', name: 'British English', polly: { female: { voiceId: 'Amy' }, male: { voiceId: 'Brian' } } },
  { code: 'en-AU', ja: '英語（豪州）', label: 'English (AU)', name: 'Australian English', polly: { female: { voiceId: 'Olivia' }, male: { voiceId: 'Russell', engine: 'standard' } } },
  { code: 'ko-KR', ja: '韓国語', label: '한국어', name: 'Korean', polly: { female: { voiceId: 'Seoyeon' } } },
  { code: 'zh-CN', ja: '中国語（簡体字）', label: '中文（简体）', name: 'Simplified Chinese', polly: { female: { voiceId: 'Zhiyu' }, languageCode: 'cmn-CN' } },
  { code: 'zh-TW', ja: '中国語（繁体字）', label: '中文（繁體）', name: 'Traditional Chinese (Taiwan)' },
  { code: 'fr-FR', ja: 'フランス語', label: 'Français', name: 'French', polly: { female: { voiceId: 'Lea' }, male: { voiceId: 'Remi' } } },
  { code: 'de-DE', ja: 'ドイツ語', label: 'Deutsch', name: 'German', polly: { female: { voiceId: 'Vicki' }, male: { voiceId: 'Daniel' } } },
  { code: 'es-US', ja: 'スペイン語（米国）', label: 'Español (US)', name: 'US Spanish', polly: { female: { voiceId: 'Lupe' }, male: { voiceId: 'Pedro' } } },
  { code: 'es-ES', ja: 'スペイン語（スペイン）', label: 'Español (ES)', name: 'Spanish', polly: { female: { voiceId: 'Lucia' }, male: { voiceId: 'Sergio' } } },
  { code: 'it-IT', ja: 'イタリア語', label: 'Italiano', name: 'Italian', polly: { female: { voiceId: 'Bianca' }, male: { voiceId: 'Adriano' } } },
  { code: 'pt-BR', ja: 'ポルトガル語（ブラジル）', label: 'Português (BR)', name: 'Brazilian Portuguese', polly: { female: { voiceId: 'Camila' }, male: { voiceId: 'Thiago' } } },
  { code: 'hi-IN', ja: 'ヒンディー語', label: 'हिन्दी', name: 'Hindi', polly: { female: { voiceId: 'Kajal' } } },
  { code: 'th-TH', ja: 'タイ語', label: 'ไทย', name: 'Thai' },
];

export const findLanguage = (code: string): Language | undefined => LANGUAGES.find((l) => l.code === code);

export const DEFAULT_CONTEXT =
  'あなたは AWS のイベント（AWS Summit や re:Invent など）の参加者のために通訳しています。' +
  'AWS のサービス名、技術用語、ビジネス用語は無理に翻訳せず、英字またはカタカナで表記してください。' +
  '原文に忠実に、簡潔に翻訳してください。';

/** Limits shared by the client and the API. */
export const LIMITS = { text: 2000, context: 2000, history: 10, speak: 1500 } as const;
