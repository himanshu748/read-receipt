import type {
  ClientToHelper,
  HelperPhase,
  HunkId,
  PauseReason,
  ReceiptStatus,
  ViewerState,
} from '@rr/protocol';

/**
 * Shared interfaces between Task C (extension host) and Task D (review panel).
 * Architect-owned — do not edit outside M0/integration reviews.
 */

export interface HelperConnection {
  readonly state: ViewerState | null;
  readonly phase: HelperPhase;
  onState: /* vscode.Event */ (listener: (s: ViewerState) => void) => {
    dispose(): void;
  };
  onPhase: (listener: (p: {
    phase: HelperPhase;
    calibrationProgress?: number;
    message?: string;
  }) => void) => { dispose(): void };
  onPreviewFrame: (listener: (jpeg: Uint8Array) => void) => { dispose(): void };
  onPulseTrace: (listener: (p: { t: number; values: number[] }) => void) => {
    dispose(): void;
  };
  onError: (listener: (e: {
    reason: PauseReason;
    message: string;
    retryable: boolean;
  }) => void) => { dispose(): void };
  send(msg: ClientToHelper): void;
}

export interface ReceiptsView {
  readonly summary: {
    read: number;
    partial: number;
    unseen: number;
    total: number;
  };
  readonly unread: Array<{
    id: HunkId;
    file: string;
    line: number;
    status: ReceiptStatus;
    progress: number;
  }>;
  onDidChange: (listener: () => void) => { dispose(): void };
  reveal(id: HunkId): Promise<void>;
}

export interface ReviewPanelApi {
  show(): void;
  dispose(): void;
  readonly visible: boolean;
  onDidChangeVisibility: (listener: (visible: boolean) => void) => {
    dispose(): void;
  };
}

/**
 * Task D implements this factory. Task C calls it after constructing
 * HelperConnection + ReceiptsView.
 */
export type CreateReviewPanel = (
  // vscode.ExtensionContext — typed loosely here so protocol stays vscode-free
  ctx: { extensionUri: { fsPath: string }; subscriptions: Array<{ dispose(): void }> },
  helper: HelperConnection,
  receipts: ReceiptsView,
) => ReviewPanelApi;
