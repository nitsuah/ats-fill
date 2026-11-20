import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { createPreviewServer } from '../scripts/preview/server.mjs';

function rawGet(port, target) {
  return new Promise((resolve, reject) => {
    const sock = net.connect(port, '127.0.0.1', () => {
      sock.write(`GET ${target} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n`);
    });
    let data = '';
    sock.on('data', (d) => (data += d));
    sock.on('end', () => resolve(data));
    sock.on('error', reject);
  });
}

async function withServer(fn) {
  const server = createPreviewServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    await fn(server.address().port);
  } finally {
    await new Promise((r) => server.close(r));
  }
}

test('serves files inside the project root', async () => {
  await withServer(async (port) => {
    const res = await rawGet(port, '/manifest.json');
    assert.match(res, /^HTTP\/1\.1 200/);
  });
});

test('rejects traversal outside the root', async () => {
  await withServer(async (port) => {
    for (const target of ['/..%2f..%2fetc/passwd', '/..%5c..%5cpackage.json', '/..%2fats-fill-sibling/x']) {
      const res = await rawGet(port, target);
      assert.match(res, /^HTTP\/1\.1 (403|404)/, target);
    }
  });
});

test('malformed percent-encoding returns 400 and the server keeps serving', async () => {
  await withServer(async (port) => {
    const bad = await rawGet(port, '/%E0%A4%A');
    assert.match(bad, /^HTTP\/1\.1 400/);
    const ok = await rawGet(port, '/manifest.json');
    assert.match(ok, /^HTTP\/1\.1 200/);
  });
});
