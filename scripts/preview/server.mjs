/**
 * Preview harness — zero-dependency static server for the popup UI.
 *
 *   npm run preview            → http://localhost:4173/popup/popup.html?standalone=1
 *
 * Serves the repo root and injects the chrome shim + router into popup.html so
 * the real popup (HTML, CSS, JS, background handlers) runs as a normal web page
 * against fictional demo data. Use it for UI work; e2e tests still load the
 * real extension.
 */

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PORT = Number(process.env.PORT || 4173);
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};
const INJECT = [
  '<script type="module" src="/scripts/preview/shim.mjs"></script>',
  '<script type="module" src="/scripts/preview/router.mjs"></script>',
].join('\n  ');

http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  if (pathname === '/') {
    res.writeHead(302, { location: '/popup/popup.html?standalone=1' });
    return res.end();
  }
  const file = path.join(ROOT, decodeURIComponent(pathname));
  if (!file.startsWith(ROOT)) {
    res.writeHead(403);
    return res.end();
  }
  try {
    let body = await fs.readFile(file);
    if (pathname === '/popup/popup.html') {
      body = body.toString().replace('<script type="module" src="popup.js"></script>', `${INJECT}\n  <script type="module" src="popup.js"></script>`);
    }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('Not found');
  }
}).listen(PORT, () => {
  console.log(`ats-fill preview → http://localhost:${PORT}/popup/popup.html?standalone=1`);
});
