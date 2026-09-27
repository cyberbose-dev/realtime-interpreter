// Renders segments into the original / translation panes.
import type { Segment } from './session.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

interface Row {
  src: HTMLElement;
  tgt: HTMLElement;
}

const LONG_PRESS_MS = 550;

export class View {
  private rows = new Map<string, Row>();
  private original = $('original');
  private translation = $('translation');

  constructor(private readonly handlers: {
      onPressStart: () => void;
      onLongPress: (seg: Segment, el: HTMLElement) => void;
      onRetry: (seg: Segment) => void;
    }) {
    // Long-press menus / text selection would get in the way of the long-press gesture.
    this.translation.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  clear() {
    this.rows.clear();
    this.original.replaceChildren();
    this.translation.replaceChildren();
  }

  render(seg: Segment, reason: 'add' | 'update' | 'revise') {
    const stickO = nearBottom(this.original);
    const stickT = nearBottom(this.translation);
    let row = this.rows.get(seg.id);
    if (!row) {
      row = { src: document.createElement('p'), tgt: document.createElement('p') };
      row.src.className = 'seg';
      row.tgt.className = 'seg';
      // Arabic, Hebrew and Persian are right-to-left: let each line pick its own direction.
      row.src.dir = 'auto';
      row.tgt.dir = 'auto';
      this.attachGestures(row.tgt, seg);
      this.original.append(row.src);
      this.translation.append(row.tgt);
      this.rows.set(seg.id, row);
    }
    row.src.textContent = seg.source;
    row.src.dataset.state = seg.state;
    row.tgt.dataset.state = seg.state;
    row.tgt.classList.toggle('revised', seg.revised);
    if (seg.state === 'error') {
      row.tgt.textContent = seg.translation ? `${seg.translation}（翻訳に失敗しました。タップで再試行）` : '翻訳に失敗しました。タップで再試行';
    } else {
      row.tgt.textContent = seg.translation || '…';
    }
    if (reason === 'revise') {
      row.tgt.classList.remove('flash');
      void row.tgt.offsetWidth; // restart the animation
      row.tgt.classList.add('flash');
    }
    if (stickO) this.original.scrollTop = this.original.scrollHeight;
    if (stickT) this.translation.scrollTop = this.translation.scrollHeight;
  }

  private attachGestures(el: HTMLElement, seg: Segment) {
    let startX = 0;
    let startY = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cancel = () => {
      clearTimeout(timer);
      timer = undefined;
    };
    el.addEventListener('pointerdown', (e) => {
      if (seg.state !== 'final') return;
      this.handlers.onPressStart(); // unlocks audio output inside the user gesture (iOS)
      startX = e.clientX;
      startY = e.clientY;
      timer = setTimeout(() => {
        timer = undefined;
        this.handlers.onLongPress(seg, el);
      }, LONG_PRESS_MS);
    });
    el.addEventListener('pointermove', (e) => {
      if (timer && Math.hypot(e.clientX - startX, e.clientY - startY) > 12) cancel();
    });
    el.addEventListener('pointerup', cancel);
    el.addEventListener('pointercancel', cancel);
    el.addEventListener('pointerleave', cancel);
    el.addEventListener('click', () => {
      if (seg.state === 'error') this.handlers.onRetry(seg);
    });
  }
}

const nearBottom = (el: HTMLElement) => el.scrollHeight - el.scrollTop - el.clientHeight < 48;
