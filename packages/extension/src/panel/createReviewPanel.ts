import type { HelperPhase } from '@rr/protocol';
import * as vscode from 'vscode';
import type { CreateReviewPanel, ReviewPanelApi } from '../contracts.js';
import { createNonce, getReviewPanelHtml } from './html.js';
import { isWebviewToHost, type HostToWebview } from './messages.js';

const HIDE_STOP_MS = 2000;
const PREVIEW_MAX_FPS = 10;
const PANEL_TITLE = 'Read Receipt';

type Listener<T> = (value: T) => void;

function createEmitter<T>(): {
  event: (listener: Listener<T>) => { dispose(): void };
  fire: (value: T) => void;
  dispose: () => void;
} {
  const listeners = new Set<Listener<T>>();
  return {
    event: (listener) => {
      listeners.add(listener);
      return {
        dispose: () => {
          listeners.delete(listener);
        },
      };
    },
    fire: (value) => {
      for (const listener of [...listeners]) listener(value);
    },
    dispose: () => {
      listeners.clear();
    },
  };
}

function uint8ToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

function extensionUriOf(ctx: {
  extensionUri: { fsPath: string };
}): vscode.Uri {
  const u = ctx.extensionUri as vscode.Uri;
  if (typeof u.scheme === 'string' && typeof u.with === 'function') return u;
  return vscode.Uri.file(ctx.extensionUri.fsPath);
}

function phaseMessage(
  phase: HelperPhase,
  calibrationProgress?: number,
  message?: string,
): HostToWebview {
  if (calibrationProgress !== undefined && message !== undefined) {
    return { type: 'phase', phase, calibrationProgress, message };
  }
  if (calibrationProgress !== undefined) {
    return { type: 'phase', phase, calibrationProgress };
  }
  if (message !== undefined) {
    return { type: 'phase', phase, message };
  }
  return { type: 'phase', phase };
}

export const createReviewPanel: CreateReviewPanel = (ctx, helper, receipts) => {
  const visibility = createEmitter<boolean>();
  const disposables: Array<{ dispose(): void }> = [];
  let panel: vscode.WebviewPanel | undefined;
  let visible = false;
  let disposed = false;
  let hideTimer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  const extUri = extensionUriOf(ctx);

  const clearHideTimer = (): void => {
    if (hideTimer !== undefined) {
      clearTimeout(hideTimer);
      hideTimer = undefined;
    }
  };

  const post = (msg: HostToWebview): void => {
    if (!panel) return;
    void panel.webview.postMessage(msg);
  };

  const pushSnapshot = (): void => {
    post(phaseMessage(helper.phase));
    if (helper.state) {
      post({ type: 'state', state: helper.state });
    }
    post({
      type: 'receipts',
      summary: receipts.summary,
      unread: receipts.unread,
    });
  };

  const startHelper = (): void => {
    clearHideTimer();
    if (running) {
      helper.send({ type: 'preview', enabled: true, maxFps: PREVIEW_MAX_FPS });
      return;
    }
    running = true;
    helper.send({ type: 'start' });
    helper.send({ type: 'preview', enabled: true, maxFps: PREVIEW_MAX_FPS });
  };

  const stopHelper = (): void => {
    clearHideTimer();
    if (!running) return;
    running = false;
    helper.send({ type: 'stop' });
    post({ type: 'clearFrame' });
  };

  const scheduleStop = (): void => {
    clearHideTimer();
    hideTimer = setTimeout(() => {
      hideTimer = undefined;
      stopHelper();
    }, HIDE_STOP_MS);
  };

  const setVisible = (next: boolean): void => {
    if (visible === next) return;
    visible = next;
    visibility.fire(visible);
    if (visible) startHelper();
    else scheduleStop();
  };

  const attachHelperListeners = (): void => {
    disposables.push(
      helper.onState((state) => {
        post({ type: 'state', state });
      }),
      helper.onPhase((p) => {
        post(phaseMessage(p.phase, p.calibrationProgress, p.message));
      }),
      helper.onPreviewFrame((jpeg) => {
        post({ type: 'frame', base64: uint8ToBase64(jpeg) });
      }),
      helper.onPulseTrace((p) => {
        post({ type: 'pulseTrace', t: p.t, values: p.values });
      }),
      helper.onError((e) => {
        post({
          type: 'error',
          reason: e.reason,
          message: e.message,
          retryable: e.retryable,
        });
      }),
      receipts.onDidChange(() => {
        post({
          type: 'receipts',
          summary: receipts.summary,
          unread: receipts.unread,
        });
      }),
    );
  };

  const ensurePanel = (): vscode.WebviewPanel => {
    if (panel) return panel;

    const webviewPanel = vscode.window.createWebviewPanel(
      'readReceipt.reviewPanel',
      PANEL_TITLE,
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(extUri, 'webview')],
      },
    );
    panel = webviewPanel;

    const nonce = createNonce();
    const styleUri = webviewPanel.webview.asWebviewUri(
      vscode.Uri.joinPath(extUri, 'webview', 'style.css'),
    );
    const scriptUri = webviewPanel.webview.asWebviewUri(
      vscode.Uri.joinPath(extUri, 'webview', 'dist', 'main.js'),
    );
    webviewPanel.webview.html = getReviewPanelHtml({
      cspSource: webviewPanel.webview.cspSource,
      styleHref: styleUri.toString(),
      scriptHref: scriptUri.toString(),
      nonce,
    });

    disposables.push(
      webviewPanel.webview.onDidReceiveMessage((raw: unknown) => {
        if (!isWebviewToHost(raw)) return;
        switch (raw.type) {
          case 'ready':
            pushSnapshot();
            break;
          case 'start':
            startHelper();
            break;
          case 'stop':
            stopHelper();
            break;
          case 'recalibrate':
            helper.send({ type: 'recalibrate' });
            break;
          case 'reveal':
            void receipts.reveal(raw.id);
            break;
        }
      }),
      webviewPanel.onDidChangeViewState(() => {
        setVisible(webviewPanel.visible);
      }),
    );

    webviewPanel.onDidDispose(() => {
      panel = undefined;
      stopHelper();
      if (visible) {
        visible = false;
        visibility.fire(false);
      }
    });

    setVisible(webviewPanel.visible);
    return webviewPanel;
  };

  attachHelperListeners();

  const api: ReviewPanelApi = {
    show(): void {
      if (disposed) return;
      const p = ensurePanel();
      p.reveal(vscode.ViewColumn.Beside);
      setVisible(true);
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      clearHideTimer();
      stopHelper();
      for (const d of disposables) d.dispose();
      disposables.length = 0;
      visibility.dispose();
      panel?.dispose();
      panel = undefined;
      visible = false;
    },
    get visible() {
      return visible;
    },
    onDidChangeVisibility: visibility.event,
  };

  ctx.subscriptions.push(api);
  return api;
};
