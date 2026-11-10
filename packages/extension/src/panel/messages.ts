import type {
  HelperPhase,
  HunkId,
  PauseReason,
  ReceiptStatus,
  ViewerState,
} from '@rr/protocol';

/**
 * Typed postMessage bridge between the extension host and the review panel webview.
 * D-internal — see PLAN.md §2.5.
 */

export type HostToWebview =
  | { type: 'state'; state: ViewerState }
  | {
      type: 'phase';
      phase: HelperPhase;
      calibrationProgress?: number;
      message?: string;
    }
  | { type: 'frame'; base64: string }
  | { type: 'pulseTrace'; t: number; values: number[] }
  | {
      type: 'receipts';
      summary: {
        read: number;
        partial: number;
        unseen: number;
        total: number;
      };
      unread: Array<{
        id: HunkId;
        file: string;
        line: number;
        status: ReceiptStatus;
        progress: number;
      }>;
    }
  | {
      type: 'error';
      reason: PauseReason;
      message: string;
      retryable: boolean;
    }
  | { type: 'clearFrame' };

export type WebviewToHost =
  | { type: 'start' }
  | { type: 'stop' }
  | { type: 'recalibrate' }
  | { type: 'reveal'; id: HunkId }
  | { type: 'ready' };

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

export function isWebviewToHost(x: unknown): x is WebviewToHost {
  if (!isRecord(x) || typeof x.type !== 'string') return false;
  switch (x.type) {
    case 'start':
    case 'stop':
    case 'recalibrate':
    case 'ready':
      return true;
    case 'reveal':
      return typeof x.id === 'string';
    default:
      return false;
  }
}
