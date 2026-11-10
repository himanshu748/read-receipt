import type { HelperPhase, PauseReason, ViewerState } from '@rr/protocol';
import type { HostToWebview, WebviewToHost } from './messages.js';
import { pauseReasonMessage } from './pauseCopy.js';

export const PRIVACY_LINE =
  'Video stays on this computer. Nothing is recorded.';

export const REPLAY_CARD_TEXT = 'REPLAY — camera off';

export interface ReviewUiHandles {
  root: HTMLElement;
  postMessage: (msg: WebviewToHost) => void;
  dispose: () => void;
}

const WAVEFORM_POINTS = 48;

function setHidden(el: Element | null, hidden: boolean): void {
  if (!el) return;
  if (hidden) el.setAttribute('hidden', '');
  else el.removeAttribute('hidden');
}

function ensureShell(root: HTMLElement): void {
  if (root.dataset['rrMounted'] === '1') return;
  root.dataset['rrMounted'] = '1';
  root.innerHTML = `
    <header class="rr-header">
      <h1 class="rr-title">Read Receipt</h1>
      <p class="rr-privacy">${PRIVACY_LINE}</p>
    </header>

    <section class="rr-preview" aria-label="Camera preview">
      <img id="rr-frame" class="rr-frame" alt="Live camera preview" hidden />
      <div id="rr-replay" class="rr-replay-card" role="status">${REPLAY_CARD_TEXT}</div>
      <div id="rr-cal" class="rr-cal" hidden>
        <svg viewBox="0 0 36 36" class="rr-cal-ring" aria-hidden="true">
          <circle class="rr-cal-bg" cx="18" cy="18" r="15.5" />
          <circle id="rr-cal-fg" class="rr-cal-fg" cx="18" cy="18" r="15.5" />
        </svg>
        <span id="rr-cal-label" class="rr-cal-label">Calibrating…</span>
      </div>
    </section>

    <section class="rr-status" aria-label="Viewer status">
      <div class="rr-eyes">
        <span id="rr-eyes-light" class="rr-eyes-light" data-on="false" aria-hidden="true"></span>
        <div class="rr-eyes-text">
          <span id="rr-eyes-label" class="rr-eyes-label">Eyes off</span>
          <span id="rr-pause" class="rr-pause"></span>
        </div>
      </div>
      <div class="rr-pulse" aria-label="Pulse liveness">
        <span id="rr-bpm" class="rr-bpm">— bpm</span>
        <canvas id="rr-wave" class="rr-wave" width="120" height="28" aria-hidden="true"></canvas>
      </div>
      <p id="rr-phase" class="rr-phase">idle</p>
      <p id="rr-error" class="rr-error" hidden></p>
    </section>

    <section class="rr-actions" aria-label="Controls">
      <button type="button" id="rr-start" class="rr-btn">Start</button>
      <button type="button" id="rr-stop" class="rr-btn">Stop</button>
      <button type="button" id="rr-recal" class="rr-btn">Recalibrate</button>
    </section>

    <section class="rr-unread" aria-label="Unread hunks">
      <h2 class="rr-unread-title">Unread</h2>
      <p id="rr-summary" class="rr-summary">0 / 0 read</p>
      <ul id="rr-unread-list" class="rr-unread-list"></ul>
    </section>
  `;
}

function drawWaveform(canvas: HTMLCanvasElement, values: number[]): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const css = getComputedStyle(canvas);
  const stroke =
    css.getPropertyValue('--vscode-charts-blue').trim() ||
    css.getPropertyValue('--vscode-focusBorder').trim() ||
    '#3794ff';
  const dim =
    css.getPropertyValue('--vscode-disabledForeground').trim() || '#888';

  ctx.strokeStyle = dim;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, h / 2);
  ctx.lineTo(w, h / 2);
  ctx.stroke();

  if (values.length < 2) return;

  const slice = values.slice(-WAVEFORM_POINTS);
  let min = Infinity;
  let max = -Infinity;
  for (const v of slice) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const range = max - min || 1;

  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  slice.forEach((v, i) => {
    const x = (i / Math.max(slice.length - 1, 1)) * (w - 1);
    const y = h - 2 - ((v - min) / range) * (h - 4);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  });
  ctx.stroke();
}

function applyState(root: HTMLElement, state: ViewerState): void {
  const light = root.querySelector('#rr-eyes-light');
  const label = root.querySelector('#rr-eyes-label');
  const pause = root.querySelector('#rr-pause');
  const bpm = root.querySelector('#rr-bpm');

  if (light instanceof HTMLElement) {
    light.dataset['on'] = state.eyesOn ? 'true' : 'false';
  }
  if (label) {
    label.textContent = state.eyesOn ? 'Eyes on' : 'Eyes off';
  }
  if (pause) {
    pause.textContent = state.eyesOn
      ? ''
      : pauseReasonMessage(state.pauseReasons);
  }
  if (bpm) {
    bpm.textContent =
      state.pulseBpm === null ? '— bpm' : `${Math.round(state.pulseBpm)} bpm`;
  }

  // Replay source never shows a live camera feed in the panel.
  if (state.source === 'replay') {
    showReplayCard(root);
  }
}

function applyPhase(
  root: HTMLElement,
  phase: HelperPhase,
  calibrationProgress?: number,
  message?: string,
): void {
  const phaseEl = root.querySelector('#rr-phase');
  if (phaseEl) {
    phaseEl.textContent = message && message.length > 0 ? `${phase} — ${message}` : phase;
  }

  const cal = root.querySelector('#rr-cal');
  const fg = root.querySelector('#rr-cal-fg');
  const calLabel = root.querySelector('#rr-cal-label');
  const calibrating = phase === 'calibrating';
  setHidden(cal, !calibrating);

  if (calibrating && fg instanceof Element && 'style' in fg) {
    const progress =
      calibrationProgress === undefined
        ? 0
        : Math.min(1, Math.max(0, calibrationProgress));
    const circumference = 2 * Math.PI * 15.5;
    const style = (fg as HTMLElement).style;
    style.strokeDasharray = `${circumference}`;
    style.strokeDashoffset = `${circumference * (1 - progress)}`;
    if (calLabel) {
      calLabel.textContent = `Calibrating… ${Math.round(progress * 100)}%`;
    }
  }
}

function showReplayCard(root: HTMLElement): void {
  const img = root.querySelector('#rr-frame');
  const card = root.querySelector('#rr-replay');
  if (img instanceof HTMLImageElement) {
    img.removeAttribute('src');
    setHidden(img, true);
  }
  setHidden(card, false);
}

function applyFrame(root: HTMLElement, base64: string): void {
  const img = root.querySelector('#rr-frame');
  const card = root.querySelector('#rr-replay');
  if (!(img instanceof HTMLImageElement)) return;
  img.src = `data:image/jpeg;base64,${base64}`;
  setHidden(img, false);
  setHidden(card, true);
}

function applyReceipts(
  root: HTMLElement,
  summary: {
    read: number;
    partial: number;
    unseen: number;
    total: number;
  },
  unread: Array<{
    id: string;
    file: string;
    line: number;
    status: string;
    progress: number;
  }>,
  postMessage: (msg: WebviewToHost) => void,
): void {
  const summaryEl = root.querySelector('#rr-summary');
  if (summaryEl) {
    summaryEl.textContent = `${summary.read} / ${summary.total} read · ${unread.length} unread`;
  }
  const list = root.querySelector('#rr-unread-list');
  if (!(list instanceof HTMLElement)) return;
  list.replaceChildren();
  for (const item of unread) {
    const li = document.createElement('li');
    li.className = 'rr-unread-item';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'rr-unread-btn';
    btn.dataset['id'] = item.id;
    const pct = Math.round(Math.min(1, Math.max(0, item.progress)) * 100);
    btn.textContent = `${item.file}:${item.line} · ${item.status} · ${pct}%`;
    btn.addEventListener('click', () => {
      postMessage({ type: 'reveal', id: item.id });
    });
    li.appendChild(btn);
    list.appendChild(li);
  }
}

function applyError(
  root: HTMLElement,
  reason: PauseReason,
  message: string,
): void {
  const err = root.querySelector('#rr-error');
  if (!(err instanceof HTMLElement)) return;
  const copy = pauseReasonMessage([reason]);
  err.textContent = message.length > 0 ? `${copy} (${message})` : copy;
  setHidden(err, false);
}

/** Apply one host→webview message to the mounted UI. */
export function applyHostMessage(
  root: HTMLElement,
  msg: HostToWebview,
  postMessage: (msg: WebviewToHost) => void,
): void {
  ensureShell(root);
  switch (msg.type) {
    case 'state':
      applyState(root, msg.state);
      break;
    case 'phase':
      applyPhase(root, msg.phase, msg.calibrationProgress, msg.message);
      break;
    case 'frame':
      applyFrame(root, msg.base64);
      break;
    case 'clearFrame':
      showReplayCard(root);
      break;
    case 'pulseTrace': {
      const canvas = root.querySelector('#rr-wave');
      if (canvas instanceof HTMLCanvasElement) {
        drawWaveform(canvas, msg.values);
      }
      break;
    }
    case 'receipts':
      applyReceipts(root, msg.summary, msg.unread, postMessage);
      break;
    case 'error':
      applyError(root, msg.reason, msg.message);
      break;
    default: {
      const _exhaustive: never = msg;
      void _exhaustive;
    }
  }
}

/** Mount the review panel UI under `root` and wire control buttons. */
export function mountReviewUi(
  root: HTMLElement,
  postMessage: (msg: WebviewToHost) => void,
): ReviewUiHandles {
  ensureShell(root);
  showReplayCard(root);

  const onStart = (): void => {
    postMessage({ type: 'start' });
  };
  const onStop = (): void => {
    postMessage({ type: 'stop' });
  };
  const onRecal = (): void => {
    postMessage({ type: 'recalibrate' });
  };

  root.querySelector('#rr-start')?.addEventListener('click', onStart);
  root.querySelector('#rr-stop')?.addEventListener('click', onStop);
  root.querySelector('#rr-recal')?.addEventListener('click', onRecal);

  postMessage({ type: 'ready' });

  return {
    root,
    postMessage,
    dispose: () => {
      root.querySelector('#rr-start')?.removeEventListener('click', onStart);
      root.querySelector('#rr-stop')?.removeEventListener('click', onStop);
      root.querySelector('#rr-recal')?.removeEventListener('click', onRecal);
      root.replaceChildren();
      delete root.dataset['rrMounted'];
    },
  };
}
