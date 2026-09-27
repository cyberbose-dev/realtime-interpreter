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

/**
 * Languages offered in the UI: every language that Amazon Transcribe streams in ap-northeast-1 (Tokyo),
 * per the "Supported languages" table (checked 2026-09). `code` is the Transcribe language code.
 * Polly voices were checked in ap-northeast-1; neural voices are preferred over standard ones.
 */
export const LANGUAGES: Language[] = [
  { code: 'ja-JP', ja: '日本語', label: '日本語', name: 'Japanese', polly: { female: { voiceId: 'Kazuha' }, male: { voiceId: 'Takumi' } } },
  { code: 'en-US', ja: '英語（米国）', label: 'English (US)', name: 'American English', polly: { female: { voiceId: 'Joanna' }, male: { voiceId: 'Matthew' } } },
  { code: 'en-GB', ja: '英語（英国）', label: 'English (UK)', name: 'British English', polly: { female: { voiceId: 'Amy' }, male: { voiceId: 'Brian' } } },
  { code: 'en-AU', ja: '英語（豪州）', label: 'English (AU)', name: 'Australian English', polly: { female: { voiceId: 'Olivia' }, male: { voiceId: 'Russell', engine: 'standard' } } },
  { code: 'en-IN', ja: '英語（インド）', label: 'English (India)', name: 'Indian English', polly: { female: { voiceId: 'Kajal' } } },
  { code: 'en-IE', ja: '英語（アイルランド）', label: 'English (Ireland)', name: 'Irish English', polly: { female: { voiceId: 'Niamh' } } },
  { code: 'en-NZ', ja: '英語（ニュージーランド）', label: 'English (NZ)', name: 'New Zealand English', polly: { female: { voiceId: 'Aria' } } },
  { code: 'en-ZA', ja: '英語（南アフリカ）', label: 'English (South Africa)', name: 'South African English', polly: { female: { voiceId: 'Ayanda' } } },
  { code: 'en-AB', ja: '英語（スコットランド）', label: 'English (Scotland)', name: 'Scottish English', polly: { female: { voiceId: 'Amy' }, male: { voiceId: 'Brian' } } },
  { code: 'en-WL', ja: '英語（ウェールズ）', label: 'English (Wales)', name: 'Welsh English', polly: { female: { voiceId: 'Amy' }, male: { voiceId: 'Geraint', engine: 'standard' } } },
  { code: 'af-ZA', ja: 'アフリカーンス語', label: 'Afrikaans', name: 'Afrikaans' },
  { code: 'ar-SA', ja: 'アラビア語（現代標準）', label: 'العربية الفصحى', name: 'Modern Standard Arabic', polly: { female: { voiceId: 'Hala' }, male: { voiceId: 'Zayd' }, languageCode: 'arb' } },
  { code: 'ar-AE', ja: 'アラビア語（湾岸）', label: 'العربية (الخليج)', name: 'Gulf Arabic', polly: { female: { voiceId: 'Hala' }, male: { voiceId: 'Zayd' } } },
  { code: 'it-IT', ja: 'イタリア語', label: 'Italiano', name: 'Italian', polly: { female: { voiceId: 'Bianca' }, male: { voiceId: 'Adriano' } } },
  { code: 'id-ID', ja: 'インドネシア語', label: 'Bahasa Indonesia', name: 'Indonesian' },
  { code: 'uk-UA', ja: 'ウクライナ語', label: 'Українська', name: 'Ukrainian' },
  { code: 'nl-NL', ja: 'オランダ語', label: 'Nederlands', name: 'Dutch', polly: { female: { voiceId: 'Laura' }, male: { voiceId: 'Ruben', engine: 'standard' } } },
  { code: 'ca-ES', ja: 'カタルーニャ語', label: 'Català', name: 'Catalan', polly: { female: { voiceId: 'Arlet' } } },
  { code: 'gl-ES', ja: 'ガリシア語', label: 'Galego', name: 'Galician' },
  { code: 'ko-KR', ja: '韓国語', label: '한국어', name: 'Korean', polly: { female: { voiceId: 'Seoyeon' } } },
  { code: 'zh-HK', ja: '広東語', label: '廣東話', name: 'Cantonese', polly: { female: { voiceId: 'Hiujin' } } },
  { code: 'el-GR', ja: 'ギリシャ語', label: 'Ελληνικά', name: 'Greek' },
  { code: 'hr-HR', ja: 'クロアチア語', label: 'Hrvatski', name: 'Croatian' },
  { code: 'sv-SE', ja: 'スウェーデン語', label: 'Svenska', name: 'Swedish', polly: { female: { voiceId: 'Elin' } } },
  { code: 'zu-ZA', ja: 'ズールー語', label: 'isiZulu', name: 'Zulu' },
  { code: 'es-ES', ja: 'スペイン語（スペイン）', label: 'Español (España)', name: 'Spanish (Spain)', polly: { female: { voiceId: 'Lucia' }, male: { voiceId: 'Sergio' } } },
  { code: 'es-US', ja: 'スペイン語（米国）', label: 'Español (EE. UU.)', name: 'US Spanish', polly: { female: { voiceId: 'Lupe' }, male: { voiceId: 'Pedro' } } },
  { code: 'sk-SK', ja: 'スロバキア語', label: 'Slovenčina', name: 'Slovak' },
  { code: 'sr-RS', ja: 'セルビア語', label: 'Српски', name: 'Serbian' },
  { code: 'so-SO', ja: 'ソマリ語', label: 'Soomaali', name: 'Somali' },
  { code: 'th-TH', ja: 'タイ語', label: 'ไทย', name: 'Thai' },
  { code: 'tl-PH', ja: 'タガログ語', label: 'Tagalog', name: 'Tagalog (Filipino)' },
  { code: 'cs-CZ', ja: 'チェコ語', label: 'Čeština', name: 'Czech', polly: { female: { voiceId: 'Jitka' } } },
  { code: 'zh-CN', ja: '中国語（簡体字）', label: '中文（简体）', name: 'Simplified Chinese', polly: { female: { voiceId: 'Zhiyu' }, languageCode: 'cmn-CN' } },
  { code: 'zh-TW', ja: '中国語（繁体字）', label: '中文（繁體）', name: 'Traditional Chinese (Taiwan)' },
  { code: 'da-DK', ja: 'デンマーク語', label: 'Dansk', name: 'Danish', polly: { female: { voiceId: 'Sofie' }, male: { voiceId: 'Mads', engine: 'standard' } } },
  { code: 'de-DE', ja: 'ドイツ語', label: 'Deutsch', name: 'German', polly: { female: { voiceId: 'Vicki' }, male: { voiceId: 'Daniel' } } },
  { code: 'de-CH', ja: 'ドイツ語（スイス）', label: 'Deutsch (Schweiz)', name: 'Swiss German', polly: { female: { voiceId: 'Sabrina' } } },
  { code: 'no-NO', ja: 'ノルウェー語', label: 'Norsk', name: 'Norwegian (Bokmål)', polly: { female: { voiceId: 'Ida' } } },
  { code: 'eu-ES', ja: 'バスク語', label: 'Euskara', name: 'Basque' },
  { code: 'hi-IN', ja: 'ヒンディー語', label: 'हिन्दी', name: 'Hindi', polly: { female: { voiceId: 'Kajal' }, languageCode: 'hi-IN' } },
  { code: 'fi-FI', ja: 'フィンランド語', label: 'Suomi', name: 'Finnish', polly: { female: { voiceId: 'Suvi' } } },
  { code: 'fr-FR', ja: 'フランス語', label: 'Français', name: 'French', polly: { female: { voiceId: 'Lea' }, male: { voiceId: 'Remi' } } },
  { code: 'fr-CA', ja: 'フランス語（カナダ）', label: 'Français (Canada)', name: 'Canadian French', polly: { female: { voiceId: 'Gabrielle' }, male: { voiceId: 'Liam' } } },
  { code: 'he-IL', ja: 'ヘブライ語', label: 'עברית', name: 'Hebrew' },
  { code: 'vi-VN', ja: 'ベトナム語', label: 'Tiếng Việt', name: 'Vietnamese' },
  { code: 'fa-IR', ja: 'ペルシア語', label: 'فارسی', name: 'Persian (Farsi)' },
  { code: 'pl-PL', ja: 'ポーランド語', label: 'Polski', name: 'Polish', polly: { female: { voiceId: 'Ola' }, male: { voiceId: 'Jan', engine: 'standard' } } },
  { code: 'pt-BR', ja: 'ポルトガル語（ブラジル）', label: 'Português (Brasil)', name: 'Brazilian Portuguese', polly: { female: { voiceId: 'Camila' }, male: { voiceId: 'Thiago' } } },
  { code: 'pt-PT', ja: 'ポルトガル語（ポルトガル）', label: 'Português (Portugal)', name: 'European Portuguese', polly: { female: { voiceId: 'Ines' }, male: { voiceId: 'Cristiano', engine: 'standard' } } },
  { code: 'ms-MY', ja: 'マレー語', label: 'Bahasa Melayu', name: 'Malay' },
  { code: 'lv-LV', ja: 'ラトビア語', label: 'Latviešu', name: 'Latvian' },
  { code: 'ro-RO', ja: 'ルーマニア語', label: 'Română', name: 'Romanian', polly: { female: { voiceId: 'Carmen', engine: 'standard' } } },
  { code: 'ru-RU', ja: 'ロシア語', label: 'Русский', name: 'Russian', polly: { female: { voiceId: 'Tatyana', engine: 'standard' }, male: { voiceId: 'Maxim', engine: 'standard' } } },
];

export const findLanguage = (code: string): Language | undefined => LANGUAGES.find((l) => l.code === code);

export const DEFAULT_CONTEXT =
  'あなたは AWS のイベント（AWS Summit や re:Invent など）の参加者のために通訳しています。' +
  'AWS のサービス名、技術用語、ビジネス用語は無理に翻訳せず、英字またはカタカナで表記してください。' +
  '原文に忠実に、簡潔に翻訳してください。';

/** Limits shared by the client and the API. */
export const LIMITS = { text: 2000, context: 2000, history: 10, speak: 1500 } as const;
