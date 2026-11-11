const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { promisify } = require('node:util');
const { execFile } = require('node:child_process');
const vscode = require('vscode');
const exec = promisify(execFile);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

exports.run = async function () {
  const folder = vscode.workspace.workspaceFolders[0].uri.fsPath;
  const result = { editor: vscode.env.appName, checks: [] };
  const git = (...args) => exec('git', args, { cwd: folder });
  const until = async (predicate, description, timeout = 35_000) => {
    const deadline = Date.now() + timeout;
    while (!predicate()) {
      if (Date.now() > deadline) throw new Error(`Timed out: ${description}; focused=${vscode.window.state.focused}; panel=${api?.panelVisible}; connected=${api?.helperConnected}; status=${api?.statusText}`);
      await delay(100);
    }
  };
  let api;
  try {
    const extension = vscode.extensions.getExtension('read-receipt.read-receipt-vscode');
    assert.ok(extension, 'development extension discovered');
    api = await extension.activate();
    assert.ok(api, 'activated in trusted Git workspace');
    await api.refresh(); assert.equal(api.summary.total, 6);
    const ids = new Set(await vscode.commands.getCommands(true));
    for (const command of ['openPanel','nextUnread','recalibrate','setApiKey','installHooks','resetReceipts']) {
      assert.ok(ids.has(`readReceipt.${command}`), `command registered: ${command}`);
    }
    result.checks.push('extension activated; commands and six-hunk status initialized');
    await vscode.commands.executeCommand('readReceipt.installHooks');
    await assert.rejects(git('commit','--quiet','-m','Must block before review'), error => /unread staged changes/.test(error.stderr));
    result.checks.push('editor command installed hooks; actual unread commit blocked');
    await vscode.commands.executeCommand('readReceipt.openPanel');
    assert.equal(api.panelVisible, true); assert.equal(api.helperConnected, true);
    assert.match(api.statusText, /REPLAY/);
    result.checks.push('real review webview opened beside editor; helper connected and replay labelled');

    const safe = api.unread.filter(item => item.file !== 'auth.js');
    for (const item of safe) {
      const editor = await vscode.window.showTextDocument(vscode.Uri.file(path.join(folder,item.file)), { viewColumn:vscode.ViewColumn.One });
      const range = new vscode.Range(item.line-1,0,item.line-1,0);
      editor.selection = new vscode.Selection(range.start,range.start);
      editor.revealRange(range,vscode.TextEditorRevealType.InCenter);
      await until(() => !api.unread.some(unread => unread.id===item.id),`visible hunk ${item.file}:${item.line}`);
    }
    await api.flush();
    assert.equal(api.summary.read,5);
    await assert.rejects(git('commit','--quiet','-m','Must block offscreen auth'),error => /auth\.js:40/.test(error.stderr));
    result.checks.push('actual visible editor ranges earned five receipts; offscreen auth hunk still blocked Git');
    await vscode.commands.executeCommand('readReceipt.nextUnread');
    // A short viewport may need scrolling even after the jump command.
    const auth = vscode.window.activeTextEditor;
    assert.equal(path.basename(auth.document.uri.fsPath),'auth.js');
    for(let start=39;start<=57;start+=6){
      auth.revealRange(new vscode.Range(start,0,Math.min(start+5,57),0),vscode.TextEditorRevealType.InCenter);
      await delay(900);
    }
    await until(() => api.summary.read===6,'all lines in auth review block',15_000);
    await api.flush();
    assert.match(api.statusText,/6\/6 read/);
    await git('commit','--quiet','-m','Reviewed via editor replay');
    const {stdout:message}=await git('log','-1','--format=%B');
    assert.match(message,/Read-Receipt: 6\/6 hunks, .* eyes-on, replay viewer/);
    assert.doesNotMatch(message,/overridden|unverified|live viewer/);
    result.trailer=message.split('\n').find(line=>line.startsWith('Read-Receipt:'));
    result.checks.push('Next Unread revealed auth; six receipts allowed real Git commit with replay trailer');

    // The removed-text viewer is necessary to review a whole-file deletion.
    await fs.unlink(path.join(folder,'storage.js')); await git('add','storage.js'); await api.refresh();
    assert.equal(api.summary.unseen,1);
    await vscode.commands.executeCommand('readReceipt.nextUnread');
    await until(()=>vscode.window.activeTextEditor?.document.uri.scheme==='read-receipt-removed','removed-text document');
    const removed = vscode.window.activeTextEditor;
    assert.ok(removed.document.getText().includes('cacheTtlSeconds'));
    // Scroll each portion of the entire removed file; no hidden lines may earn coverage.
    for(let start=0;start<removed.document.lineCount;start+=10){
      removed.revealRange(new vscode.Range(start,0,Math.min(start+9,removed.document.lineCount-1),0),vscode.TextEditorRevealType.InCenter);
      await delay(900);
    }
    await until(()=>api.summary.read===1,'all removed lines reviewed',8000); await api.flush();
    await git('commit','--quiet','-m','Reviewed removed file in replay');
    result.checks.push('read-only removed-text viewer covered every deleted line and allowed deletion commit');
    result.ok=true;
  } catch(error) {
    result.ok=false; result.error=error.stack || String(error); throw error;
  } finally {
    await api?.flush();
    await fs.writeFile(process.env.RR_EDITOR_RESULT,JSON.stringify(result,null,2)+'\n');
  }
};
