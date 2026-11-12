const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { promisify } = require('node:util');
const { execFile } = require('node:child_process');
const vscode = require('vscode');
const exec = promisify(execFile);
const delay = ms => new Promise(done => setTimeout(done, ms));

exports.run = async () => {
  const folder = vscode.workspace.workspaceFolders[0].uri.fsPath;
  const result = { mode: 'physical camera', editor: vscode.env.appName, sdk: '3.5.0',
    maxCameraSeconds: 90, checks: [], previewFrames: 0, everEyesOn: false };
  let api, monitor;
  const git = (...args) => exec('git', args, { cwd: folder });
  const progress = async step => fs.writeFile(process.env.RR_LIVE_PROGRESS, JSON.stringify({ step,
    phase: api?.helperPhase, previewFrames: api?.previewFrameCount, read: api?.summary.read,
    pauseReasons: api?.viewerState?.pauseReasons, error: api?.lastHelperError }));
  const until = async (predicate, description, seconds = 85) => {
    const deadline = Date.now() + seconds * 1000;
    while (!predicate()) {
      if (api.lastHelperError) throw new Error(api.lastHelperError.message);
      if (api.helperPhase === 'stopped') throw new Error('Live session stopped before ' + description);
      if (Date.now() > deadline) throw new Error('Timed out: ' + description);
      await delay(100);
    }
  };
  try {
    const extension = vscode.extensions.getExtension('read-receipt.read-receipt-vscode');
    api = await extension.activate(); assert.ok(api); await api.refresh();
    assert.equal(api.summary.total, 2);
    await vscode.commands.executeCommand('readReceipt.installHooks');
    await assert.rejects(git('commit', '-qm', 'Must block unread camera fixture'), error => /unread staged changes/.test(error.stderr));
    result.checks.push('normal extension installed hooks; actual Git commit blocked before live review');
    const keyEntry = vscode.commands.executeCommand('readReceipt.setApiKey');
    await progress('api-key-entry'); await keyEntry;
    const opening = vscode.commands.executeCommand('readReceipt.openPanel');
    await progress('camera-consent'); await opening;
    assert.ok(api.panelVisible && api.helperConnected, 'live helper and panel connected');
    await progress('physical-camera-running');
    monitor = setInterval(() => {
      result.previewFrames = api.previewFrameCount;
      result.everEyesOn ||= api.viewerState?.source === 'live' && api.viewerState?.eyesOn === true;
      void progress('physical-camera-running');
    }, 500);
    await until(() => api.viewerState?.source === 'live' && api.viewerState.eyesOn, 'calibrated live viewer');
    result.everEyesOn = true;
    result.checks.push('native SDK camera, calibrated face and pulse/pressure signals produced live eyes-on');
    await until(() => api.summary.read === 1, 'first visible code receipt', 20);
    await api.flush(); assert.ok(api.unread.some(item => item.file === 'second.js'));
    await assert.rejects(git('commit', '-qm', 'Must block offscreen camera fixture'), error => /second\.js/.test(error.stderr));
    result.checks.push('real editor viewport earned first receipt; offscreen file still blocked actual Git commit');
    await vscode.commands.executeCommand('readReceipt.nextUnread');
    assert.equal(path.basename(vscode.window.activeTextEditor.document.uri.fsPath), 'second.js');
    await until(() => api.summary.read === 2, 'second visible code receipt', 20);
    await api.flush(); await git('commit', '-qm', 'Disposable physical camera workflow test');
    const { stdout } = await git('log', '-1', '--format=%B');
    result.trailer = stdout.split('\n').find(line => line.startsWith('Read-Receipt:'));
    assert.match(result.trailer, /2\/2 hunks, .* eyes-on, live viewer/);
    assert.doesNotMatch(result.trailer, /overridden|unverified|replay viewer/);
    assert.ok(api.previewFrameCount > 0, 'in-memory live preview reached extension');
    result.previewFrames = api.previewFrameCount;
    result.checks.push('second live receipt allowed actual Git commit with live viewer trailer; preview received');
    result.ok = true;
  } catch (error) { result.ok = false; result.error = error.message; result.helperError = api?.lastHelperError; }
  finally {
    if (monitor) clearInterval(monitor);
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    await delay(300);
    result.stoppedEyesOn = api?.viewerState?.eyesOn !== true;
    await api?.flush();
    await fs.writeFile(process.env.RR_LIVE_RESULT, JSON.stringify(result, null, 2) + '\n');
  }
  if (!result.ok) throw new Error(result.error);
};
