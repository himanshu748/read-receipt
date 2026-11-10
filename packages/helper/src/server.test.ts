import { describe, expect, it, afterEach } from 'vitest';
import { createConnection } from 'node:net';
import WebSocket from 'ws';
import { isHelperToClient, type HelperToClient } from '@rr/protocol';
import { startHelperServer, type HelperServer } from './server.js';
import { ReplaySource } from './sources/replay.js';
import type { Recording } from '@rr/protocol';

const TOKEN = 'aabbccddeeff00112233445566778899';

function miniRecording(): Recording {
  return {
    format: 'read-receipt-recording',
    version: 1,
    createdAt: new Date().toISOString(),
    source: 'synthetic',
    sdkVersion: null,
    samples: [
      { t: 0, kind: 'validation', code: 0 },
      {
        t: 0,
        kind: 'features',
        faceFound: true,
        pitch: 0.12,
        yaw: 0,
        eyeOpenness: 0.08,
        blinking: false,
        talking: false,
      },
    ],
  };
}

describe('helper WebSocket server', () => {
  let server: HelperServer | null = null;

  afterEach(async () => {
    if (server) {
      await server.close();
      server = null;
    }
  });

  async function boot(): Promise<HelperServer> {
    const replay = new ReplaySource(miniRecording(), { speed: 100 });
    server = await startHelperServer({
      port: 0,
      token: TOKEN,
      source: 'replay',
      sdkVersion: null,
      replay,
    });
    return server;
  }

  it('accepts connections with the correct token and no Origin', async () => {
    const s = await boot();
    const hello = await new Promise<HelperToClient>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${s.port}/?token=${TOKEN}`);
      const timer = setTimeout(() => reject(new Error('timeout')), 2000);
      ws.on('message', (data) => {
        const msg = JSON.parse(String(data)) as unknown;
        if (isHelperToClient(msg) && msg.type === 'hello') {
          clearTimeout(timer);
          ws.close();
          resolve(msg);
        }
      });
      ws.on('error', reject);
    });
    expect(hello.type).toBe('hello');
    if (hello.type === 'hello') {
      expect(hello.source).toBe('replay');
      expect(hello.protocol).toBe(1);
    }
  });

  it('rejects a wrong token', async () => {
    const s = await boot();
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(
        `ws://127.0.0.1:${s.port}/?token=deadbeefdeadbeefdeadbeefdeadbeef`,
      );
      const timer = setTimeout(() => reject(new Error('timeout')), 2000);
      ws.on('open', () => {
        clearTimeout(timer);
        ws.close();
        reject(new Error('should not open'));
      });
      ws.on('unexpected-response', (_req, res) => {
        clearTimeout(timer);
        expect(res.statusCode).toBe(401);
        res.resume();
        resolve();
      });
      ws.on('error', () => {
        // Some platforms surface as error instead of unexpected-response.
        clearTimeout(timer);
        resolve();
      });
    });
  });

  it('rejects any Origin header (browser-like)', async () => {
    const s = await boot();
    // Use raw HTTP upgrade so we can set Origin; ws client may not.
    await new Promise<void>((resolve, reject) => {
      const sock = createConnection({ host: '127.0.0.1', port: s.port }, () => {
        sock.write(
          `GET /?token=${TOKEN} HTTP/1.1\r\n` +
            `Host: 127.0.0.1:${s.port}\r\n` +
            `Upgrade: websocket\r\n` +
            `Connection: Upgrade\r\n` +
            `Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n` +
            `Sec-WebSocket-Version: 13\r\n` +
            `Origin: http://evil.example\r\n` +
            `\r\n`,
        );
      });
      let buf = '';
      const timer = setTimeout(() => {
        sock.destroy();
        reject(new Error('timeout'));
      }, 2000);
      sock.on('data', (chunk) => {
        buf += String(chunk);
        if (buf.includes('\r\n')) {
          clearTimeout(timer);
          expect(buf.startsWith('HTTP/1.1 403')).toBe(true);
          sock.destroy();
          resolve();
        }
      });
      sock.on('error', reject);
    });
  });
});
