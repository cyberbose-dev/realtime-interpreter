// Turns transcript results into segments and drives the draft (Nova) / final (Haiku) translations.
import { LIMITS } from '../../shared/languages.ts';
import { post, withRetry } from './api.ts';
import { settings } from './settings.ts';
import type { TranscriptResult } from './transcribe.ts';

export interface Segment {
  id: string;
  from: string;
  to: string;
  source: string;
  translation: string;
  /** partial: still being spoken, pending: waiting for the final translation, final, error */
  state: 'partial' | 'pending' | 'final' | 'error';
  revised: boolean;
  /** Spoken by you (your language -> theirs) rather than by the other party. */
  mine: boolean;
}

interface DraftResponse {
  translation: string;
}
interface FinalResponse {
  translation: string;
  revisions: { id: string; translation: string }[];
}

const DRAFT_INTERVAL_MS = 700;

export class Session {
  readonly segments: Segment[] = [];
  private byResultId = new Map<string, Segment>();
  private counter = 0;
  private finalQueue: Segment[] = [];
  private processing = false;
  private draftBusy = false;
  private draftTimer?: ReturnType<typeof setTimeout>;
  private lastDraftAt = 0;
  private draftTarget?: Segment;

  constructor(private readonly onChange: (seg: Segment, reason: 'add' | 'update' | 'revise') => void) {}

  handleResult(r: TranscriptResult, from: string, to: string, mine: boolean) {
    let seg = this.byResultId.get(r.resultId);
    if (!seg) {
      seg = { id: `s${++this.counter}`, from, to, source: '', translation: '', state: 'partial', revised: false, mine };
      this.segments.push(seg);
      this.byResultId.set(r.resultId, seg);
      this.onChange(seg, 'add');
    }
    if (seg.state !== 'partial') return; // already finalized (duplicate delivery)
    seg.source = r.text;
    if (r.partial) {
      this.onChange(seg, 'update');
      this.requestDraft(seg);
    } else {
      this.finalize(seg);
    }
  }

  /** The connection dropped: partial results of it will never be finalized, so finalize them now. */
  flushPartials() {
    for (const seg of this.byResultId.values()) if (seg.state === 'partial') this.finalize(seg);
    this.byResultId.clear();
  }

  retry(seg: Segment) {
    if (seg.state !== 'error') return;
    seg.state = 'pending';
    this.onChange(seg, 'update');
    this.finalQueue.push(seg);
    void this.processFinals();
  }

  clear() {
    this.segments.length = 0;
    this.byResultId.clear();
    this.finalQueue.length = 0;
  }

  private finalize(seg: Segment) {
    seg.state = 'pending';
    this.onChange(seg, 'update');
    this.finalQueue.push(seg);
    void this.processFinals();
  }

  // ---------- drafts: latest partial only, at most one request in flight ----------
  private requestDraft(seg: Segment) {
    if (!settings.draft || seg.source.trim().length < 2) return;
    this.draftTarget = seg;
    if (this.draftBusy || this.draftTimer) return;
    const wait = Math.max(0, this.lastDraftAt + DRAFT_INTERVAL_MS - Date.now());
    this.draftTimer = setTimeout(() => {
      this.draftTimer = undefined;
      void this.runDraft();
    }, wait);
  }

  private async runDraft() {
    const seg = this.draftTarget;
    this.draftTarget = undefined;
    if (!seg || seg.state === 'final' || !navigator.onLine) return;
    const text = seg.source;
    this.draftBusy = true;
    this.lastDraftAt = Date.now();
    try {
      const res = await post<DraftResponse>(
        'translate',
        { mode: 'draft', from: seg.from, to: seg.to, text, context: settings.context, history: this.history(seg, 3), ...this.genders(seg) },
        { timeoutMs: 8000 },
      );
      // A late draft must not overwrite the final translation.
      if ((seg.state === 'partial' || seg.state === 'pending') && res.translation) {
        seg.translation = res.translation;
        this.onChange(seg, 'update');
      }
    } catch {
      /* drafts are best effort */
    } finally {
      this.draftBusy = false;
      const next = this.draftTarget as Segment | undefined;
      if (next && next.state === 'partial') {
        this.draftTarget = undefined;
        this.requestDraft(next);
      }
    }
  }

  // ---------- finals: strictly in order so each one sees the previous translations ----------
  private async processFinals() {
    if (this.processing) return;
    this.processing = true;
    try {
      while (this.finalQueue.length > 0) {
        const seg = this.finalQueue.shift()!;
        if (!this.segments.includes(seg)) continue; // cleared
        try {
          const res = await withRetry(() =>
            post<FinalResponse>('translate', {
              mode: 'final',
              from: seg.from,
              to: seg.to,
              text: seg.source,
              context: settings.context,
              history: this.history(seg, LIMITS.history),
              ...this.genders(seg),
            }),
          );
          seg.translation = res.translation || seg.translation;
          seg.state = 'final';
          this.onChange(seg, 'update');
          for (const r of res.revisions) {
            const target = this.segments.find((s) => s.id === r.id);
            if (target && target.state === 'final' && r.translation) {
              target.translation = r.translation;
              target.revised = true;
              this.onChange(target, 'revise');
            }
          }
        } catch {
          seg.state = 'error';
          this.onChange(seg, 'update');
        }
      }
    } finally {
      this.processing = false;
    }
  }

  private genders(seg: Segment) {
    return seg.mine
      ? { speakerGender: settings.myGender, listenerGender: settings.otherGender }
      : { speakerGender: settings.otherGender, listenerGender: settings.myGender };
  }

  /** Previous finalized segments of the same language pair. */
  private history(seg: Segment, n: number) {
    const idx = this.segments.indexOf(seg);
    return this.segments
      .slice(0, idx)
      .filter((s) => s.state === 'final' && s.from === seg.from && s.to === seg.to)
      .slice(-n)
      .map((s) => ({ id: s.id, source: s.source.slice(0, LIMITS.text), translation: s.translation.slice(0, LIMITS.text) }));
  }
}
