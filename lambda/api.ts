import { Sha256 } from '@aws-crypto/sha256-js';
import { BedrockRuntimeClient, ConverseCommand, type Message } from '@aws-sdk/client-bedrock-runtime';
import { Engine, OutputFormat, PollyClient, SynthesizeSpeechCommand, type VoiceId } from '@aws-sdk/client-polly';
import { SignatureV4 } from '@smithy/signature-v4';
import type { APIGatewayProxyEventV2WithJWTAuthorizer, APIGatewayProxyResultV2 } from 'aws-lambda';
import { DEFAULT_CONTEXT, findLanguage, LIMITS, type Language } from '../shared/languages.ts';

const region = process.env.AWS_REGION!;
const bedrock = new BedrockRuntimeClient({ region });
const polly = new PollyClient({ region });

class BadRequest extends Error {}

const json = (statusCode: number, body: unknown): APIGatewayProxyResultV2 => ({
  statusCode,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  body: JSON.stringify(body),
});

export const handler = async (event: APIGatewayProxyEventV2WithJWTAuthorizer): Promise<APIGatewayProxyResultV2> => {
  const op = event.pathParameters?.op;
  try {
    const raw = event.isBase64Encoded ? Buffer.from(event.body ?? '', 'base64').toString() : (event.body ?? '{}');
    if (raw.length > 64_000) throw new BadRequest('body too large');
    const body = JSON.parse(raw) as Record<string, unknown>;
    switch (op) {
      case 'transcribe-url':
        return json(200, await transcribeUrl(body));
      case 'translate':
        return json(200, await translate(body));
      case 'speak':
        return json(200, await speak(body));
      default:
        return json(404, { error: 'not found' });
    }
  } catch (e) {
    if (e instanceof BadRequest || e instanceof SyntaxError) return json(400, { error: e.message });
    // Log the error type only; transcripts are never logged.
    const err = e as { name?: string; message?: string; $metadata?: { httpStatusCode?: number } };
    console.error(JSON.stringify({ op, error: err.name, message: err.message?.slice(0, 200) }));
    const status = err.name === 'ThrottlingException' ? 429 : 502;
    return json(status, { error: err.name ?? 'upstream error' });
  }
};

// ---------- validation ----------
function str(v: unknown, field: string, max: number, required = true): string {
  if (v === undefined || v === null || v === '') {
    if (required) throw new BadRequest(`${field} is required`);
    return '';
  }
  if (typeof v !== 'string') throw new BadRequest(`${field} must be a string`);
  if (v.length > max) throw new BadRequest(`${field} is too long`);
  return v;
}

function lang(v: unknown, field: string): Language {
  const l = findLanguage(str(v, field, 10));
  if (!l) throw new BadRequest(`unsupported ${field}`);
  return l;
}

interface HistoryItem {
  id: string;
  source: string;
  translation: string;
}

function history(v: unknown): HistoryItem[] {
  if (v === undefined) return [];
  if (!Array.isArray(v)) throw new BadRequest('history must be an array');
  return v.slice(-LIMITS.history).map((h, i) => ({
    id: str(h?.id, `history[${i}].id`, 40),
    source: str(h?.source, `history[${i}].source`, LIMITS.text),
    translation: str(h?.translation, `history[${i}].translation`, LIMITS.text * 2, false),
  }));
}

// ---------- Transcribe: presigned WebSocket URL ----------
async function transcribeUrl(body: Record<string, unknown>) {
  const language = lang(body.language, 'language');
  const signer = new SignatureV4({
    service: 'transcribe',
    region,
    sha256: Sha256,
    // The Lambda role's credentials (resolved by the SDK's default provider chain).
    credentials: await bedrock.config.credentials(),
  });
  const host = `transcribestreaming.${region}.amazonaws.com:8443`;
  const signed = await signer.presign(
    {
      method: 'GET',
      protocol: 'wss:',
      hostname: host,
      path: '/stream-transcription-websocket',
      headers: { host },
      query: {
        'language-code': language.code,
        'media-encoding': 'pcm',
        'sample-rate': '16000',
        'enable-partial-results-stabilization': 'true',
        'partial-results-stability': 'medium',
      },
    },
    // Used right after issuance; a short lifetime keeps a leaked URL from opening more streams.
    { expiresIn: 30 },
  );
  const qs = Object.entries(signed.query ?? {})
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
  return { url: `wss://${host}${signed.path}?${qs}` };
}

// ---------- Bedrock: translation ----------
async function translate(body: Record<string, unknown>) {
  const mode = body.mode === 'final' ? 'final' : 'draft';
  const from = lang(body.from, 'from');
  const to = lang(body.to, 'to');
  const text = str(body.text, 'text', LIMITS.text);
  const context = str(body.context, 'context', LIMITS.context, false) || DEFAULT_CONTEXT;
  const hist = history(body.history);
  const genders = genderNote(body.speakerGender, body.listenerGender, to);
  return mode === 'draft' ? draft(from, to, text, context + genders, hist) : final(from, to, text, context + genders, hist);
}

/** Tells the model the speaker's and listener's genders for languages whose wording depends on them. */
function genderNote(speaker: unknown, listener: unknown, to: Language): string {
  const g = (v: unknown) => (v === 'female' ? 'a woman' : v === 'male' ? 'a man' : undefined);
  const parts = [g(speaker) && `The speaker is ${g(speaker)}.`, g(listener) && `The listener is ${g(listener)}.`].filter(Boolean);
  if (parts.length === 0) return '';
  return (
    `\n${parts.join(' ')} Where ${to.name} marks gender (first-person forms, adjective or participle agreement, ` +
    `polite particles and similar), use forms that match the speaker when they refer to the speaker and the listener ` +
    `when they refer to the listener (e.g. in French "je suis fatiguée" agrees with a female speaker, while ` +
    `"merci d'être venue" agrees with a female listener). Do not add gender where the language does not mark it.`
  );
}

const esc = (s: string) => s.replace(/</g, '＜').replace(/>/g, '＞');

/** Fast provisional translation of an unfinished transcript (Nova 2 Lite). */
async function draft(from: Language, to: Language, text: string, context: string, hist: HistoryItem[]) {
  const system =
    `You are a simultaneous interpreter translating ${from.name} into ${to.name}.\n` +
    `Context from the user: ${context}\n` +
    `The text in <current> is an unfinished live speech transcript. Translate only <current>, ` +
    `faithfully and concisely. <previous> is earlier speech for reference only. ` +
    `Output the ${to.name} translation only, with no notes or quotes.`;
  const prev = hist.slice(-3).map((h) => esc(h.source)).join('\n');
  const res = await bedrock.send(
    new ConverseCommand({
      modelId: process.env.DRAFT_MODEL_ID,
      system: [{ text: system }],
      messages: [{ role: 'user', content: [{ text: `<previous>\n${prev}\n</previous>\n<current>\n${esc(text)}\n</current>` }] }],
      inferenceConfig: { maxTokens: 400, temperature: 0 },
    }),
  );
  const out = res.output?.message?.content?.find((c) => c.text)?.text ?? '';
  return { translation: out.trim() };
}

/** Final translation with the last sentences as context, allowed to revise earlier translations (Claude Haiku 4.5). */
async function final(from: Language, to: Language, text: string, context: string, hist: HistoryItem[]) {
  const system =
    `You are a professional simultaneous interpreter translating ${from.name} into ${to.name}.\n` +
    `Context and instructions from the user:\n${context}\n\n` +
    `Rules:\n` +
    `- Translate the sentence in <current> into ${to.name}, faithfully to the original and concisely. Do not add explanations.\n` +
    `- <history> holds up to ${LIMITS.history} previous transcript segments with their current translations. ` +
    `Use them to resolve pronouns, terminology and sentences that the speech recognizer split across segments.\n` +
    `- Review every earlier translation in <history> against the new sentence and the user's context. ` +
    `If one is clearly wrong or inconsistent, return a corrected translation for that id in "revisions". Typical cases: ` +
    `a technical or product term translated as an everyday word (e.g. an S3 "bucket" rendered as a household bucket), ` +
    `a mistranslated term, a wrong subject, or a sentence the recognizer split across segments. ` +
    `Revise only when it is meaningfully better; otherwise return an empty list.\n` +
    `- Keep terminology consistent across the whole conversation, including your revisions.\n` +
    `- Always answer by calling the submit_translation tool.`;
  const historyXml = hist
    .map((h) => `<segment id="${esc(h.id)}">\n<source>${esc(h.source)}</source>\n<translation>${esc(h.translation)}</translation>\n</segment>`)
    .join('\n');
  const messages: Message[] = [
    { role: 'user', content: [{ text: `<history>\n${historyXml}\n</history>\n<current>\n${esc(text)}\n</current>` }] },
  ];
  const res = await bedrock.send(
    new ConverseCommand({
      modelId: process.env.FINAL_MODEL_ID,
      system: [{ text: system }],
      messages,
      inferenceConfig: { maxTokens: 2000, temperature: 0 },
      toolConfig: {
        tools: [
          {
            toolSpec: {
              name: 'submit_translation',
              description: 'Submit the translation of <current> and any revisions of earlier segments.',
              inputSchema: {
                json: {
                  type: 'object',
                  properties: {
                    translation: { type: 'string', description: `Translation of <current> in ${to.name}` },
                    revisions: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          id: { type: 'string', description: 'id of the earlier segment' },
                          translation: { type: 'string', description: 'Corrected full translation of that segment' },
                        },
                        required: ['id', 'translation'],
                      },
                    },
                  },
                  required: ['translation', 'revisions'],
                },
              },
            },
          },
        ],
        toolChoice: { tool: { name: 'submit_translation' } },
      },
    }),
  );
  const input = res.output?.message?.content?.find((c) => c.toolUse)?.toolUse?.input as
    | { translation?: unknown; revisions?: unknown }
    | undefined;
  const ids = new Set(hist.map((h) => h.id));
  const revisions = (Array.isArray(input?.revisions) ? input.revisions : [])
    .filter((r): r is { id: string; translation: string } => typeof r?.id === 'string' && typeof r?.translation === 'string')
    .filter((r) => ids.has(r.id) && r.translation.trim() !== hist.find((h) => h.id === r.id)?.translation.trim());
  return { translation: typeof input?.translation === 'string' ? input.translation.trim() : '', revisions };
}

// ---------- Polly ----------
async function speak(body: Record<string, unknown>) {
  const language = lang(body.language, 'language');
  const text = str(body.text, 'text', LIMITS.speak);
  const gender = body.gender === 'male' ? 'male' : 'female';
  const voice = language.polly?.[gender];
  if (!voice) return { fallback: true };
  const res = await polly.send(
    new SynthesizeSpeechCommand({
      Text: text,
      VoiceId: voice.voiceId as VoiceId,
      LanguageCode: language.polly?.languageCode as never,
      Engine: voice.engine === 'standard' ? Engine.STANDARD : Engine.NEURAL,
      OutputFormat: OutputFormat.MP3,
    }),
  );
  const bytes = await res.AudioStream!.transformToByteArray();
  return { audio: Buffer.from(bytes).toString('base64'), contentType: 'audio/mpeg' };
}
