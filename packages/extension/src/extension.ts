import * as vscode from 'vscode';
import { execFile } from 'node:child_process';
import { unlink } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { loadConfig, readDiff, ReceiptStore } from '@rr/core';
import type { HunkId } from '@rr/protocol';
import { HelperClient, type HelperClientOptions } from './helperClient.js';
import { createReviewPanel } from './panel/createReviewPanel.js';
import type { HelperConnection, ReceiptsView, ReviewPanelApi } from './contracts.js';
import { ReceiptTracker, type VisibleEditor } from './tracker.js';

const execute = promisify(execFile);
let runtime: ReviewRuntime | undefined;

/** Read-only diagnostics for extension-host integration tests. */
export interface ReadReceiptApi {
  readonly summary: ReceiptsView['summary'];
  readonly unread: ReceiptsView['unread'];
  readonly helperConnected: boolean;
  readonly panelVisible: boolean;
  readonly statusText: string;
  refresh(): Promise<void>;
  flush(): Promise<void>;
}

export async function activate(context: vscode.ExtensionContext): Promise<ReadReceiptApi | undefined> {
  const output = vscode.window.createOutputChannel('Read Receipt');
  context.subscriptions.push(output);
  const report = (error: unknown): void => {
    const message = error instanceof Error ? error.message : 'Operation failed';
    output.appendLine(message);
    void vscode.window.showErrorMessage(`Read Receipt: ${message}`);
  };
  const current = (): ReviewRuntime => {
    if (!runtime) throw new Error('Open a trusted local Git folder to start reviewing.');
    return runtime;
  };
  const command = (id: string, handler: () => Promise<unknown> | unknown): void => {
    context.subscriptions.push(vscode.commands.registerCommand(id, async () => {
      try { return await handler(); } catch (error) { report(error); return undefined; }
    }));
  };
  command('readReceipt.openPanel', () => current().show());
  command('readReceipt.nextUnread', () => current().nextUnread());
  command('readReceipt.recalibrate', async () => {
    await current().show(); current().helper?.send({ type: 'recalibrate' });
  });
  command('readReceipt.setApiKey', async () => {
    const value = await vscode.window.showInputBox({ password: true, ignoreFocusOut: true,
      prompt: 'Presage API key (SecretStorage only; live mode is not implemented yet)' });
    if (value === undefined) return;
    if (value.trim()) await context.secrets.store('smartspectra.apiKey', value.trim());
    else await context.secrets.delete('smartspectra.apiKey');
  });
  command('readReceipt.setHelperToken', async () => {
    const value = await vscode.window.showInputBox({ password: true, ignoreFocusOut: true,
      prompt: 'Existing localhost helper token (stored only in SecretStorage)' });
    if (value === undefined) return;
    if (!/^[a-f\d]{32,}$/i.test(value.trim())) throw new Error('Use at least 32 hexadecimal characters for the helper token.');
    await context.secrets.store('readReceipt.attachToken', value.trim());
    await runtime?.reconnect();
  });
  command('readReceipt.reconnectHelper', () => current().reconnect());
  command('readReceipt.installHooks', () => current().installHooks());
  command('readReceipt.resetReceipts', async () => {
    const answer = await vscode.window.showWarningMessage('Reset local Read Receipt timings for this repository?', { modal: true }, 'Reset');
    if (answer === 'Reset') await current().reset();
  });
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder || folder.uri.scheme !== 'file' || !vscode.workspace.isTrusted) return undefined;
  let repoRoot: string;
  try {
    const { stdout } = await execute('git', ['rev-parse', '--show-toplevel'], { cwd: folder.uri.fsPath });
    repoRoot = stdout.trim();
  } catch { return undefined; }
  runtime = await ReviewRuntime.create(context, repoRoot, report);
  context.subscriptions.push(runtime);
  return runtime;
}

export async function deactivate(): Promise<void> { await runtime?.close(); runtime = undefined; }

class ReviewRuntime implements ReadReceiptApi, ReceiptsView, vscode.Disposable {
  helper: HelperClient | undefined;
  private panel: ReviewPanelApi | undefined;
  private connecting: Promise<void> | undefined;
  private reconnecting: Promise<void> | undefined;
  private tracker: ReceiptTracker;
  private refreshQueue: Promise<void> = Promise.resolve();
  private signature = '';
  private closed = false;
  private pendingFlush = false;
  private subscriptions: vscode.Disposable[] = [];
  private helperSubscriptions: vscode.Disposable[] = [];
  private readonly change = new vscode.EventEmitter<void>();
  readonly onDidChange = this.change.event;
  private readonly status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 90);
  private readonly decorations: Record<'unseen' | 'partial' | 'read', vscode.TextEditorDecorationType>;
  private tickTimer: ReturnType<typeof setInterval>;
  private refreshTimer: ReturnType<typeof setInterval>;
  private flushTimer: ReturnType<typeof setInterval>;
  private refreshDelay: ReturnType<typeof setTimeout> | undefined;

  private constructor(private readonly context: vscode.ExtensionContext, readonly repoRoot: string,
    private store: ReceiptStore, private readonly report: (error: unknown) => void) {
    this.tracker = new ReceiptTracker(store, loadConfig(repoRoot));
    const decoration = (name: string) => vscode.window.createTextEditorDecorationType({
      gutterIconPath: vscode.Uri.joinPath(context.extensionUri, 'media', `${name}.svg`),
      gutterIconSize: 'contain', rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
    });
    this.decorations = { unseen: decoration('unseen'), partial: decoration('partial'), read: decoration('read') };
    this.status.command = 'readReceipt.openPanel'; this.status.name = 'Read Receipt'; this.status.show();
    const scheduleRefresh = (): void => {
      if (this.refreshDelay) clearTimeout(this.refreshDelay);
      this.refreshDelay = setTimeout(() => { void this.refresh().catch(this.report); }, 150);
    };
    const repaint = (): void => { this.tracker.resetClock(); this.render(); };
    const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(repoRoot, '**/*'));
    const changedFile = (uri: vscode.Uri): void => {
      if (!relative(repoRoot, uri.fsPath).split(sep).includes('.git')) scheduleRefresh();
    };
    this.subscriptions.push(watcher, watcher.onDidChange(changedFile), watcher.onDidCreate(changedFile),
      watcher.onDidDelete(changedFile), vscode.workspace.onDidSaveTextDocument(scheduleRefresh),
      vscode.workspace.onDidChangeTextDocument(repaint), vscode.window.onDidChangeVisibleTextEditors(repaint),
      vscode.window.onDidChangeTextEditorVisibleRanges(repaint), vscode.window.onDidChangeWindowState(repaint),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('readReceipt')) void this.reconnect().catch(this.report);
      }));
    this.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider('read-receipt-removed', {
      provideTextDocumentContent: (uri) => this.tracker.hunks.find((hunk) => hunk.id === uri.query)?.removed.join('\n') ?? '',
    }));
    this.tickTimer = setInterval(() => this.tick(), 250);
    // Polling also catches staging/index changes hidden by filesystem excludes.
    this.refreshTimer = setInterval(() => { void this.refresh().catch(this.report); }, 2000);
    this.flushTimer = setInterval(() => { if (this.pendingFlush) void this.flush().catch(this.report); }, 1000);
  }

  static async create(context: vscode.ExtensionContext, root: string, report: (error: unknown) => void) {
    const result = new ReviewRuntime(context, root, await ReceiptStore.open(root), report);
    try { await result.refresh(); return result; }
    catch (error) { await result.close(); throw error; }
  }
  get summary() { return this.tracker.summary; }
  get unread() { return this.tracker.unread; }
  get helperConnected() { return this.helper?.connected ?? false; }
  get panelVisible() { return this.panel?.visible ?? false; }
  get statusText() { return this.status.text; }

  refresh(): Promise<void> {
    const next = this.refreshQueue.catch(() => {}).then(async () => {
      if (this.closed) return;
      const hunks = await readDiff(this.repoRoot, 'worktree');
      if (this.closed) return;
      const config = loadConfig(this.repoRoot);
      const signature = JSON.stringify([hunks, config]);
      if (signature !== this.signature) {
        this.signature = signature; this.tracker.setHunks(hunks, config); this.render();
      }
    });
    this.refreshQueue = next; return next;
  }

  private tick(): void {
    if (this.closed) return;
    const editors: VisibleEditor[] = vscode.window.visibleTextEditors
      .filter((editor) => editor.document.uri.scheme === 'file' || editor.document.uri.scheme === 'read-receipt-removed')
      .map((editor) => ({ file: editor.document.uri.scheme === 'read-receipt-removed'
          ? this.tracker.hunks.find((hunk) => hunk.id === editor.document.uri.query)?.file ?? ''
          : relative(this.repoRoot, editor.document.uri.fsPath).split(sep).join('/'),
        ...(editor.document.uri.scheme === 'read-receipt-removed' ? { hunkId: editor.document.uri.query } : {}),
        dirty: editor.document.isDirty, ranges: editor.visibleRanges.map((range) => ({
          start: range.start.line + 1, end: range.end.line + 1,
        })),
      }));
    if (this.tracker.tick({ nowMs: Date.now(), focused: vscode.window.state.focused,
      panelVisible: this.panelVisible, viewer: this.helper?.state ?? null, editors })) {
      this.pendingFlush = true; this.render();
    }
  }

  private render(): void {
    const { read, total } = this.summary;
    const source = this.helper?.state?.source ?? this.settings().get<string>('helper.mode', 'replay');
    this.status.text = `$(check-all) ${read}/${total} read · ${source === 'replay' ? 'REPLAY' : 'LIVE'}`;
    this.status.tooltip = 'Read Receipt: local eyes-on receipts. Click to review. Replay uses synthetic signals.';
    for (const editor of vscode.window.visibleTextEditors) {
      const removedView = editor.document.uri.scheme === 'read-receipt-removed';
      const file = removedView ? this.tracker.hunks.find((hunk) => hunk.id === editor.document.uri.query)?.file :
        relative(this.repoRoot, editor.document.uri.fsPath).split(sep).join('/');
      const buckets: Record<'unseen' | 'partial' | 'read', vscode.DecorationOptions[]> = { unseen: [], partial: [], read: [] };
      for (const item of this.tracker.items.filter((item) => item.file === file && (!removedView || item.id === editor.document.uri.query))) {
        const line = removedView ? 0 : Math.max(0, Math.min(editor.document.lineCount - 1, item.line - 1));
        const status = editor.document.isDirty ? 'unseen' : item.status;
        buckets[status].push({ range: new vscode.Range(line, 0, line, 0),
          hoverMessage: editor.document.isDirty ? 'Read Receipt: save to track.' :
            `${item.elapsedSeconds.toFixed(1)} s of ${item.requiredSeconds.toFixed(1)} s eyes-on · ${Math.round(item.coverage * 100)}% of lines on screen while you were looking` });
      }
      for (const name of ['unseen', 'partial', 'read'] as const) editor.setDecorations(this.decorations[name], buckets[name]);
    }
    this.change.fire();
  }
  private settings() { return vscode.workspace.getConfiguration('readReceipt', vscode.Uri.file(this.repoRoot)); }

  private async connect(): Promise<void> {
    if (this.closed) return;
    if (this.helper?.connected) return;
    if (this.connecting) return this.connecting;
    this.connecting = (async () => {
      this.panel?.dispose();
      for (const disposable of this.helperSubscriptions) disposable.dispose();
      this.helperSubscriptions = [];
      await this.helper?.shutdown();
      const config = this.settings();
      const mode = config.get<'live' | 'replay'>('helper.mode', 'replay');
      if (mode !== 'replay') throw new Error('Live camera mode is not implemented. Choose replay mode to review.');
      const replaySetting = config.get<string>('helper.replayFile', '');
      const replayFile = replaySetting ? (isAbsolute(replaySetting) ? replaySetting : resolve(this.repoRoot, replaySetting)) :
        this.context.asAbsolutePath('runtime/replay/review-session.json');
      const opts: HelperClientOptions = { nodePath: config.get<string>('nodePath', 'node'),
        helperPath: this.context.asAbsolutePath('runtime/helper/main.js'), mode, replayFile, loop: false };
      if (config.get<boolean>('helper.attach', false)) {
        const token = await this.context.secrets.get('readReceipt.attachToken');
        if (!token) throw new Error('Set the existing helper token with Read Receipt: Set Helper Token first.');
        opts.attach = { port: config.get<number>('helper.attachPort', 0), token };
      }
      const helper = new HelperClient(opts); this.helper = helper;
      this.helperSubscriptions.push(helper.onError((event) => {
        this.tracker.resetClock(); this.status.tooltip = `Read Receipt: ${event.reason}; open the panel to retry.`;
      }), helper.onState((state) => { if (!state.eyesOn) this.tracker.resetClock(); }),
      helper.onPhase((phase) => { if (phase.phase !== 'running') this.tracker.resetClock(); }));
      await helper.connect();
      if (this.closed) { await helper.shutdown(); return; }
      const bridge: HelperConnection = {
        get state() { return helper.state; }, get phase() { return helper.phase; },
        onState: helper.onState, onPhase: helper.onPhase, onPreviewFrame: helper.onPreviewFrame,
        onPulseTrace: helper.onPulseTrace, onError: helper.onError,
        send: (message) => {
          if (this.closed) return;
          if (message.type === 'start' && !helper.connected) void this.reconnect().then(() => this.show()).catch(this.report);
          else helper.send(message);
        },
      };
      this.panel = createReviewPanel(this.context, bridge, this);
      this.helperSubscriptions.push(this.panel.onDidChangeVisibility(() => this.tracker.resetClock()));
    })();
    try { await this.connecting; } finally { this.connecting = undefined; }
  }
  async show(): Promise<void> {
    // With no text editor, ViewColumn.Beside can occupy the first group. Opening
    // a file there would hide the panel immediately and correctly pause tracking.
    if (!vscode.window.visibleTextEditors.length && this.unread[0]) await this.reveal(this.unread[0].id);
    await this.connect(); this.panel?.show();
  }
  async reconnect(): Promise<void> {
    if (this.reconnecting) return this.reconnecting;
    this.reconnecting = (async () => {
      await this.connecting?.catch(() => {});
      if (this.closed) return;
      const visible = this.panelVisible;
      this.panel?.dispose(); this.panel = undefined;
      await this.helper?.shutdown(); this.helper = undefined;
      this.tracker.resetClock(); if (visible) await this.show(); this.render();
    })();
    try { await this.reconnecting; } finally { this.reconnecting = undefined; }
  }
  async reveal(id: HunkId): Promise<void> {
    const item = this.tracker.items.find((item) => item.id === id);
    if (!item) return;
    const path = resolve(this.repoRoot, item.file);
    if (relative(this.repoRoot, path).startsWith(`..${sep}`)) return;
    const uri = item.hunk.kind === 'delete' ? vscode.Uri.from({ scheme: 'read-receipt-removed',
      path: `/${item.file} (removed)`, query: item.id }) : vscode.Uri.file(path);
    const editor = await vscode.window.showTextDocument(uri, { viewColumn: vscode.ViewColumn.One });
    const line = item.hunk.kind === 'delete' ? 0 : Math.min(editor.document.lineCount - 1, Math.max(0, item.line - 1));
    editor.selection = new vscode.Selection(line, 0, line, 0);
    const last = Math.min(editor.document.lineCount - 1, item.hunk.kind === 'delete'
      ? item.hunk.removed.length - 1 : item.hunk.range.end - 1);
    editor.revealRange(new vscode.Range(line, 0, Math.max(line, last), 0), vscode.TextEditorRevealType.InCenter);
  }
  async nextUnread(): Promise<void> {
    await this.refresh();
    const editor = vscode.window.activeTextEditor;
    const file = editor ? relative(this.repoRoot, editor.document.uri.fsPath).split(sep).join('/') : '';
    const next = this.unread.find((item) => item.file === file && item.line > (editor?.selection.active.line ?? -1) + 1) ?? this.unread[0];
    if (next) await this.reveal(next.id);
    else void vscode.window.showInformationMessage('Read Receipt: all current hunks have receipts.');
  }
  async installHooks(): Promise<void> {
    const { stdout } = await execute(this.settings().get<string>('nodePath', 'node'),
      [this.context.asAbsolutePath('runtime/hooks/cli.js'), 'install'], { cwd: this.repoRoot });
    void vscode.window.showInformationMessage(stdout.trim() || 'Read Receipt Git hooks installed.');
  }
  async reset(): Promise<void> {
    await this.flush();
    await unlink(this.store.path).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error; });
    this.store = await ReceiptStore.open(this.repoRoot);
    this.tracker = new ReceiptTracker(this.store, loadConfig(this.repoRoot));
    this.signature = ''; await this.refresh(); await this.tracker.flush();
  }
  async flush(): Promise<void> {
    this.pendingFlush = false;
    try { await this.tracker.flush(); } catch (error) { this.pendingFlush = true; throw error; }
  }
  dispose(): void { void this.close().catch(this.report); }
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.tickTimer); clearInterval(this.refreshTimer); clearInterval(this.flushTimer);
    if (this.refreshDelay) clearTimeout(this.refreshDelay);
    this.panel?.dispose();
    for (const disposable of [...this.subscriptions, ...this.helperSubscriptions]) disposable.dispose();
    for (const decoration of Object.values(this.decorations)) decoration.dispose();
    this.status.dispose(); this.change.dispose();
    await this.helper?.shutdown(); await this.refreshQueue.catch(() => {}); await this.flush();
  }
}
