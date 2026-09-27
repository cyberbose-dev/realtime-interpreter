import { DEFAULT_CONTEXT, findLanguage, LANGUAGES } from '../../shared/languages.ts';
import { onLoginRequired, post, withRetry } from './api.ts';
import { AudioCapture, type CaptureResult, listMicrophones } from './audio.ts';
import { handleCallback, isLoggedIn, login, logout } from './auth.ts';
import { getConfig, loadConfig } from './config.ts';
import { Session } from './session.ts';
import {
  canCaptureSystemAudio,
  isMobile,
  onSettingsChange,
  settings,
  sourceLang,
  targetLang,
  updateSettings,
  type Settings,
} from './settings.ts';
import { speak, stopSpeaking, unlockAudio } from './speak.ts';
import { type StreamStatus, TranscribeStream } from './transcribe.ts';
import { View } from './ui.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const label = (code: string) => findLanguage(code)?.ja ?? code;

let running = false;
let lastResultAt = 0;
let idleTimer: ReturnType<typeof setInterval> | undefined;
/** Transcribe bills for silence too: stop when nothing has been recognized for this long. */
const IDLE_STOP_MS = 10 * 60_000;
let wakeLock: WakeLockSentinel | undefined;

function notice(text: string, timeoutMs = 6000) {
  const el = $('notice');
  el.textContent = text;
  if (timeoutMs) setTimeout(() => el.textContent === text && (el.textContent = ''), timeoutMs);
}

// ---------- pipeline: audio -> Transcribe -> session -> view ----------
const view = new View({
  onPressStart: unlockAudio,
  onLongPress: (seg, el) => {
    el.classList.add('speaking');
    capture.setMuted(true);
    const done = () => {
      el.classList.remove('speaking');
      capture.setMuted(false);
    };
    // Read it in the voice of whoever said it.
    const gender = seg.mine ? settings.myGender : settings.otherGender;
    void speak(seg.translation, seg.to, gender, { onStart: () => {}, onEnd: done }).then((result) => {
      if (result === 'unsupported') {
        done();
        notice(`${label(seg.to)}の読み上げにはこのブラウザが対応していません`);
      } else if (result === 'other-gender') {
        notice(`${label(seg.to)}には${gender === 'male' ? '男性' : '女性'}の音声がないため、${gender === 'male' ? '女性' : '男性'}の音声で読み上げます`);
      }
    });
  },
  onRetry: (seg) => session.retry(seg),
});

const session = new Session((seg, reason) => view.render(seg, reason));

const STATUS_TEXT: Record<StreamStatus, string> = {
  idle: '待機中',
  connecting: '接続中…',
  live: '文字起こし中',
  reconnecting: '再接続中…',
  offline: 'オフライン（復帰を待っています）',
  error: 'エラー',
};

const stream = new TranscribeStream({
  getUrl: async (language) => (await withRetry(() => post<{ url: string }>('transcribe-url', { language }), 3)).url,
  onResult: (r) => {
    lastResultAt = Date.now();
    session.handleResult(r, sourceLang(), targetLang(), settings.direction === 'AtoB');
  },
  onStatus: (s, detail) => {
    const el = $('status');
    el.dataset.state = s;
    $('status-text').textContent = STATUS_TEXT[s];
    if (s === 'error') {
      notice(`文字起こしを開始できません: ${detail ?? ''}`, 0);
      void stop();
    }
  },
  onConnectionLost: () => session.flushPartials(),
});

const capture = new AudioCapture({
  onChunk: (pcm) => stream.send(pcm),
  onLevel: (level) => ($('meter-bar').style.transform = `scaleX(${Math.min(1, level * 6)})`),
  onSystemAudioEnded: () => {
    if (!running) return;
    notice('PC の音声の共有が終了しました。マイクのみで続けます。');
    void restartCapture('mic');
  },
});

async function start() {
  if (running) return;
  unlockAudio();
  // Prime speechSynthesis inside this click so later long-press playback is allowed on iOS.
  if ('speechSynthesis' in window) speechSynthesis.speak(new SpeechSynthesisUtterance(''));
  running = true;
  renderStart();
  try {
    reportCapture(await capture.start(settings.source, settings.micDeviceId));
  } catch (e) {
    running = false;
    renderStart();
    notice(`マイクを使用できません: ${(e as Error).message}`, 0);
    return;
  }
  stream.start(sourceLang());
  lastResultAt = Date.now();
  idleTimer = setInterval(() => {
    // Only time spent streaming is billed; don't count offline or reconnecting periods.
    if ($('status').dataset.state !== 'live') lastResultAt = Date.now();
    else if (Date.now() - lastResultAt > IDLE_STOP_MS) {
      void stop();
      notice('10 分間音声を認識しなかったため、課金を抑えるために停止しました。再開するには「開始」を押してください。', 0);
    }
  }, 30_000);
  wakeLock = await navigator.wakeLock?.request('screen').catch(() => undefined);
}

async function stop() {
  if (!running) return;
  running = false;
  clearInterval(idleTimer);
  renderStart();
  stream.stop();
  capture.stop();
  stopSpeaking();
  $('meter-bar').style.transform = 'scaleX(0)';
  await wakeLock?.release().catch(() => {});
  wakeLock = undefined;
}

function reportCapture(got: CaptureResult) {
  if (got.systemProblem === 'no-audio') {
    notice(
      '共有した画面から音声を取得できなかったため、マイクのみで文字起こしします。PC の音声を使うには、共有ダイアログで「タブ」を選んで「タブの音声も共有」を、「ウィンドウ」を選ぶ場合は「システムの音声を含めて共有する」をオンにしてください。',
      20_000,
    );
  } else if (got.systemProblem === 'cancelled') {
    notice('画面共有がキャンセルされたため、マイクのみで文字起こしします。', 10_000);
  }
}

async function restartCapture(source: Settings['source']) {
  try {
    reportCapture(await capture.start(source, settings.micDeviceId));
  } catch (e) {
    notice(`音声入力を切り替えられません: ${(e as Error).message}`, 0);
    void stop();
  }
}

function renderStart() {
  const btn = $('start');
  btn.textContent = running ? '停止' : '開始';
  btn.classList.toggle('stop', running);
}

// Re-acquire the wake lock when the tab becomes visible again.
document.addEventListener('visibilitychange', async () => {
  if (running && document.visibilityState === 'visible' && !wakeLock) {
    wakeLock = await navigator.wakeLock?.request('screen').catch(() => undefined);
  }
});

// ---------- header / settings ----------
function renderSettings() {
  $('dir-from').textContent = label(sourceLang());
  $('dir-to').textContent = label(targetLang());
  document.body.dataset.fontSize = settings.fontSize;
  $('panes').classList.toggle('split', settings.showOriginal);
  $('toggle-original').setAttribute('aria-pressed', String(settings.showOriginal));
  $('dir-label-BtoA').textContent = `${label(settings.langB)} → ${label(settings.langA)}`;
  $('dir-label-AtoB').textContent = `${label(settings.langA)} → ${label(settings.langB)}`;
}

async function fillMicrophones() {
  const sel = $<HTMLFormElement>('settings-form').elements.namedItem('micDeviceId') as HTMLSelectElement;
  const mics = await listMicrophones();
  sel.replaceChildren(new Option('既定のマイク', ''));
  mics.forEach((m, i) => sel.add(new Option(m.label || `マイク ${i + 1}（開始後に名前が表示されます）`, m.deviceId)));
  sel.value = mics.some((m) => m.deviceId === settings.micDeviceId) ? settings.micDeviceId : '';
}

function fillForm() {
  const form = $<HTMLFormElement>('settings-form');
  for (const name of ['langA', 'langB'] as const) {
    const sel = form.elements.namedItem(name) as HTMLSelectElement;
    if (sel.options.length === 0) {
      for (const l of LANGUAGES) sel.add(new Option(l.ja === l.label ? l.ja : `${l.ja} / ${l.label}`, l.code));
    }
    sel.value = settings[name];
  }
  (form.elements.namedItem('source') as HTMLSelectElement).value = settings.source;
  (form.elements.namedItem('fontSize') as HTMLSelectElement).value = settings.fontSize;
  (form.elements.namedItem('myGender') as HTMLSelectElement).value = settings.myGender;
  (form.elements.namedItem('otherGender') as HTMLSelectElement).value = settings.otherGender;
  (form.elements.namedItem('draft') as HTMLInputElement).checked = settings.draft;
  (form.elements.namedItem('context') as HTMLTextAreaElement).value = settings.context;
  for (const r of form.querySelectorAll<HTMLInputElement>('input[name=direction]')) r.checked = r.value === settings.direction;
  $('source-field').hidden = !canCaptureSystemAudio;
  $('system-audio-unsupported').hidden = canCaptureSystemAudio || isMobile;
  void fillMicrophones();
}

function wireSettings() {
  const dialog = $<HTMLDialogElement>('settings');
  const form = $<HTMLFormElement>('settings-form');
  $('open-settings').addEventListener('click', () => {
    fillForm();
    dialog.showModal();
  });
  form.addEventListener('change', (e) => {
    const t = e.target as HTMLInputElement;
    switch (t.name) {
      case 'langA':
      case 'langB': {
        const other = t.name === 'langA' ? 'langB' : 'langA';
        const patch: Partial<Settings> = { [t.name]: t.value };
        if (settings[other] === t.value) patch[other] = settings[t.name]; // same language on both sides: swap
        updateSettings(patch);
        fillForm();
        break;
      }
      case 'direction':
        updateSettings({ direction: t.value as Settings['direction'] });
        break;
      case 'micDeviceId':
        updateSettings({ micDeviceId: t.value });
        break;
      case 'source':
        updateSettings({ source: t.value as Settings['source'] });
        break;
      case 'fontSize':
        updateSettings({ fontSize: t.value as Settings['fontSize'] });
        break;
      case 'myGender':
        updateSettings({ myGender: t.value as Settings['myGender'] });
        break;
      case 'otherGender':
        updateSettings({ otherGender: t.value as Settings['otherGender'] });
        break;
      case 'draft':
        updateSettings({ draft: t.checked });
        break;
    }
  });
  form.addEventListener('input', (e) => {
    const t = e.target as HTMLTextAreaElement;
    if (t.name === 'context') updateSettings({ context: t.value.trim() || DEFAULT_CONTEXT });
  });
  $('reset-context').addEventListener('click', () => {
    updateSettings({ context: DEFAULT_CONTEXT });
    fillForm();
  });
  $('clear').addEventListener('click', () => {
    session.clear();
    view.clear();
    dialog.close();
  });
  $('logout').addEventListener('click', async () => {
    await stop();
    await logout();
  });
  // Close when the backdrop is clicked.
  dialog.addEventListener('click', (e) => e.target === dialog && dialog.close());

  $('direction').addEventListener('click', () => updateSettings({ direction: settings.direction === 'BtoA' ? 'AtoB' : 'BtoA' }));
  $('toggle-original').addEventListener('click', () => updateSettings({ showOriginal: !settings.showOriginal }));
  $('start').addEventListener('click', () => void (running ? stop() : start()));

  onSettingsChange((changed) => {
    renderSettings();
    if (!running) return;
    if (changed.some((k) => k === 'langA' || k === 'langB' || k === 'direction')) stream.setLanguage(sourceLang());
    if (changed.includes('source') || changed.includes('micDeviceId')) void restartCapture(settings.source);
  });
}

// ---------- boot ----------
async function boot() {
  await loadConfig();
  try {
    await handleCallback();
  } catch (e) {
    console.error(e);
  }
  if (!isLoggedIn()) {
    $('login').hidden = false;
    $('login-btn').textContent = getConfig().selfSignUp ? 'ログイン / 新規登録' : 'ログイン';
    $('login-note').hidden = !!getConfig().selfSignUp;
    $('login-btn').addEventListener('click', () => void login());
    return;
  }
  $('app').hidden = false;
  if ('speechSynthesis' in window) speechSynthesis.getVoices(); // start loading voices
  renderSettings();
  wireSettings();
  renderStart();
  if (getConfig().dev) {
    // Local dev server only: feed transcript results without a microphone.
    Object.assign(window, {
      __devFeed: (resultId: string, text: string, partial: boolean) =>
        session.handleResult({ resultId, text, partial }, sourceLang(), targetLang(), settings.direction === 'AtoB'),
    });
  }
}

let relogin = false;
onLoginRequired(() => {
  if (relogin) return;
  relogin = true;
  void stop();
  notice('ログインの有効期限が切れました。ログイン画面に移動します。', 0);
  setTimeout(() => void login(), 2000);
});

boot().catch((e) => {
  document.body.textContent = `起動に失敗しました: ${(e as Error).message}`;
});
