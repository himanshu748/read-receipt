import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createConnection } from 'node:net';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseArgs } from './main.js';

describe('owned helper process lifecycle', () => {
  it('rejects invalid parent process identifiers', () => {
    expect(() => parseArgs(['--mode', 'replay', '--replay', 'fixture.json', '--token', 'ab', '--parent-pid', '-1']))
      .toThrow('positive integer');
  });

  it('closes its listener after the owning editor process exits', async () => {
    const launcher = `
      const {spawn}=require('node:child_process');
      const [helper,fixture,token]=process.argv.slice(1);
      const child=spawn(process.execPath,[helper,'--mode','replay','--replay',fixture,'--token',token,'--parent-pid',String(process.pid)]);
      let buffer='';child.stdout.on('data',chunk=>{buffer+=chunk;if(buffer.includes('\\n')){
        const line=JSON.parse(buffer.split('\\n')[0]);console.log(JSON.stringify({pid:child.pid,port:line.port}));
        child.stdout.removeAllListeners('data');
      }});
      setInterval(()=>{},1000);
    `;
    const parent = spawn(process.execPath, ['-e', launcher, resolve('packages/helper/dist/main.js'),
      resolve('fixtures/replay/demo-session.json'), randomBytes(32).toString('hex')], { stdio: ['ignore', 'pipe', 'ignore'] });
    let pid: number | undefined;
    try {
      const details = await new Promise<{ pid: number; port: number }>((done, fail) => {
        const timer = setTimeout(() => fail(new Error('Owned helper did not start')), 2500);
        let buffer = '';
        parent.stdout.on('data', chunk => { buffer += String(chunk); if (buffer.includes('\n')) {
          clearTimeout(timer); done(JSON.parse(buffer.split('\n')[0]!) as { pid: number; port: number });
        } });
        parent.once('error', fail);
      });
      pid = details.pid;
      const listening = () => new Promise<boolean>((done) => {
        const socket = createConnection({ host: '127.0.0.1', port: details.port });
        socket.once('connect', () => { socket.destroy(); done(true); });
        socket.once('error', () => { socket.destroy(); done(false); });
      });
      expect(await listening()).toBe(true);
      const exited = new Promise<void>((done) => parent.once('exit', () => done()));
      parent.kill('SIGTERM'); await exited;
      const deadline = Date.now() + 2500;
      while (await listening()) {
        if (Date.now() > deadline) throw new Error('Orphaned helper kept its listener open');
        await new Promise(done => setTimeout(done, 100));
      }
      expect(await listening()).toBe(false);
    } finally {
      parent.kill('SIGTERM');
      if (pid) { try { process.kill(pid, 'SIGTERM'); } catch { /* already exited */ } }
    }
  });
});
