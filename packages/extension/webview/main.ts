import { applyHostMessage, mountReviewUi } from '../src/panel/ui.js';
import type { HostToWebview, WebviewToHost } from '../src/panel/messages.js';

declare function acquireVsCodeApi(): {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

const vscode = acquireVsCodeApi();

const root = document.getElementById('app');
if (!root) {
  throw new Error('Read Receipt webview: #app missing');
}

const postMessage = (msg: WebviewToHost): void => {
  vscode.postMessage(msg);
};

mountReviewUi(root, postMessage);

window.addEventListener('message', (event: MessageEvent<HostToWebview>) => {
  applyHostMessage(root, event.data, postMessage);
});
