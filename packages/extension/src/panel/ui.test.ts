/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, beforeEach, vi } from 'vitest';
import type { HelperPhase, PauseReason, ViewerState } from '@rr/protocol';
import { PAUSE_REASON_COPY } from './pauseCopy.js';
import {
  applyHostMessage,
  mountReviewUi,
  PRIVACY_LINE,
  REPLAY_CARD_TEXT,
} from './ui.js';
import type { HostToWebview, WebviewToHost } from './messages.js';

const ALL_PHASES: HelperPhase[] = [
  'idle',
  'starting',
  'calibrating',
  'running',
  'stopped',
  'error',
];

const ALL_PAUSE_REASONS = Object.keys(PAUSE_REASON_COPY) as PauseReason[];

function baseState(over: Partial<ViewerState> = {}): ViewerState {
  return {
    seq: 1,
    t: 1000,
    source: 'live',
    live: false,
    eyesOpen: false,
    facingScreen: false,
    pulseBpm: null,
    quality: 'unusable',
    eyesOn: false,
    pauseReasons: ['no-face'],
    ...over,
  };
}

describe('review panel message → DOM', () => {
  let root: HTMLElement;
  let posted: WebviewToHost[];

  beforeEach(() => {
    document.body.innerHTML = '<div id="app"></div>';
    root = document.getElementById('app')!;
    posted = [];
    mountReviewUi(root, (msg) => {
      posted.push(msg);
    });
  });

  it('mounts privacy line, replay card, and controls; posts ready', () => {
    expect(root.textContent).toContain(PRIVACY_LINE);
    expect(root.querySelector('#rr-replay')?.textContent).toBe(REPLAY_CARD_TEXT);
    expect(root.querySelector('#rr-replay')?.hasAttribute('hidden')).toBe(false);
    expect(root.querySelector('#rr-frame')?.hasAttribute('hidden')).toBe(true);
    expect(root.querySelector('#rr-start')).toBeTruthy();
    expect(root.querySelector('#rr-stop')).toBeTruthy();
    expect(root.querySelector('#rr-recal')).toBeTruthy();
    expect(posted).toEqual([{ type: 'ready' }]);
  });

  it('Start / Stop / Recalibrate post the matching messages', () => {
    posted.length = 0;
    (root.querySelector('#rr-start') as HTMLButtonElement).click();
    (root.querySelector('#rr-stop') as HTMLButtonElement).click();
    (root.querySelector('#rr-recal') as HTMLButtonElement).click();
    expect(posted).toEqual([
      { type: 'start' },
      { type: 'stop' },
      { type: 'recalibrate' },
    ]);
  });

  for (const phase of ALL_PHASES) {
    it(`renders phase "${phase}"`, () => {
      const msg: HostToWebview =
        phase === 'calibrating'
          ? { type: 'phase', phase, calibrationProgress: 0.4 }
          : { type: 'phase', phase };
      applyHostMessage(root, msg, () => undefined);
      expect(root.querySelector('#rr-phase')?.textContent ?? '').toContain(phase);
      if (phase === 'calibrating') {
        expect(root.querySelector('#rr-cal')?.hasAttribute('hidden')).toBe(false);
        expect(root.querySelector('#rr-cal-label')?.textContent).toContain('40%');
      } else {
        expect(root.querySelector('#rr-cal')?.hasAttribute('hidden')).toBe(true);
      }
    });
  }

  for (const reason of ALL_PAUSE_REASONS) {
    it(`shows pause copy for "${reason}"`, () => {
      applyHostMessage(
        root,
        {
          type: 'state',
          state: baseState({
            eyesOn: false,
            pauseReasons: [reason],
            pulseBpm: reason === 'no-pulse-yet' ? null : 72,
          }),
        },
        () => undefined,
      );
      expect(root.querySelector('#rr-eyes-light')?.getAttribute('data-on')).toBe(
        'false',
      );
      expect(root.querySelector('#rr-pause')?.textContent).toBe(
        PAUSE_REASON_COPY[reason],
      );
    });
  }

  it('eyes-on clears pause text and lights the indicator', () => {
    applyHostMessage(
      root,
      {
        type: 'state',
        state: baseState({
          eyesOn: true,
          live: true,
          eyesOpen: true,
          facingScreen: true,
          quality: 'good',
          pauseReasons: [],
          pulseBpm: 68,
        }),
      },
      () => undefined,
    );
    expect(root.querySelector('#rr-eyes-light')?.getAttribute('data-on')).toBe(
      'true',
    );
    expect(root.querySelector('#rr-eyes-label')?.textContent).toBe('Eyes on');
    expect(root.querySelector('#rr-pause')?.textContent).toBe('');
    expect(root.querySelector('#rr-bpm')?.textContent).toBe('68 bpm');
  });

  it('shows JPEG preview and hides the replay card on frame', () => {
    // 1x1 JPEG
    const base64 =
      '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGfAP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAQUCf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQMBAT8Bf//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQIBAT8Bf//Z';
    applyHostMessage(root, { type: 'frame', base64 }, () => undefined);
    const img = root.querySelector('#rr-frame') as HTMLImageElement;
    expect(img.hasAttribute('hidden')).toBe(false);
    expect(img.src).toContain('data:image/jpeg;base64,');
    expect(root.querySelector('#rr-replay')?.hasAttribute('hidden')).toBe(true);
  });

  it('replay source forces the REPLAY card even after a frame', () => {
    applyHostMessage(
      root,
      { type: 'frame', base64: 'abc' },
      () => undefined,
    );
    applyHostMessage(
      root,
      {
        type: 'state',
        state: baseState({ source: 'replay', eyesOn: false, pauseReasons: ['not-started'] }),
      },
      () => undefined,
    );
    expect(root.querySelector('#rr-replay')?.hasAttribute('hidden')).toBe(false);
    expect(root.querySelector('#rr-frame')?.hasAttribute('hidden')).toBe(true);
  });

  it('clearFrame restores the REPLAY card', () => {
    applyHostMessage(root, { type: 'frame', base64: 'abc' }, () => undefined);
    applyHostMessage(root, { type: 'clearFrame' }, () => undefined);
    expect(root.querySelector('#rr-replay')?.hasAttribute('hidden')).toBe(false);
  });

  it('draws a pulse waveform without throwing', () => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    const stroke = vi.fn();
    const clearRect = vi.fn();
    const beginPath = vi.fn();
    const moveTo = vi.fn();
    const lineTo = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      function (this: HTMLCanvasElement, type: string) {
        if (type !== '2d') return getContext.call(this, type as '2d');
        return {
          clearRect,
          beginPath,
          moveTo,
          lineTo,
          stroke,
          strokeStyle: '',
          lineWidth: 1,
        } as unknown as CanvasRenderingContext2D;
      },
    );
    applyHostMessage(
      root,
      { type: 'pulseTrace', t: 1, values: [0.1, 0.4, 0.2, 0.8, 0.3] },
      () => undefined,
    );
    expect(clearRect).toHaveBeenCalled();
    expect(stroke).toHaveBeenCalled();
  });

  it('renders unread list and posts reveal on click', () => {
    posted.length = 0;
    applyHostMessage(
      root,
      {
        type: 'receipts',
        summary: { read: 1, partial: 1, unseen: 1, total: 3 },
        unread: [
          {
            id: 'abc123',
            file: 'src/auth.js',
            line: 12,
            status: 'partial',
            progress: 0.5,
          },
        ],
      },
      (msg) => {
        posted.push(msg);
      },
    );
    expect(root.querySelector('#rr-summary')?.textContent).toContain('1 / 3 read');
    const btn = root.querySelector('.rr-unread-btn') as HTMLButtonElement;
    expect(btn.textContent).toContain('src/auth.js:12');
    btn.click();
    expect(posted).toEqual([{ type: 'reveal', id: 'abc123' }]);
  });

  it('surfaces error copy for credits-exhausted', () => {
    applyHostMessage(
      root,
      {
        type: 'error',
        reason: 'credits-exhausted',
        message: 'kCreditExhausted',
        retryable: false,
      },
      () => undefined,
    );
    const err = root.querySelector('#rr-error');
    expect(err?.hasAttribute('hidden')).toBe(false);
    expect(err?.textContent).toContain(PAUSE_REASON_COPY['credits-exhausted']);
  });
});
