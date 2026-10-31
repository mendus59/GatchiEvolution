// Gatchi server for self-hosting: serves the static game and the account API
// (server/api.js) on a JSON-file store. The hosted version runs the same API
// as a Supabase Edge Function instead (supabase/functions/api).
//
//   node server/server.js            (PORT, DATA_FILE env vars optional)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApi, MAX_BODY } from './api.js';
import { fileStore } from './store-file.js';

export { playMatch } from './api.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.resolve(ROOT, '../public');
const PORT = Number(process.env.PORT || 8080);
const store = fileStore(process.env.DATA_FILE || path.resolve(ROOT, '../data/db.json'));
const api = createApi(store);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
};

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(Object.assign(new Error('Payload too large'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function serveStatic(req, res, url) {
  let file = path.normalize(path.join(PUBLIC, decodeURIComponent(url.pathname)));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) { res.writeHead(404); return res.end('Not found'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}

export const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://local');
  try {
    if (!url.pathname.startsWith('/api/')) return serveStatic(req, res, url);
    const bodyText = req.method === 'GET' ? '' : await readBody(req);
    const { status, body } = await api.handle({
      method: req.method, path: url.pathname.slice(4), authorization: req.headers.authorization,
      ip: req.socket.remoteAddress, bodyText,
    });
    send(res, status, body);
  } catch (err) {
    if (!err.status) console.error(err);
    send(res, err.status || 500, { error: err.status ? err.message : 'Server error' });
  }
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  server.listen(PORT, () => console.log(`Gatchi running at http://localhost:${PORT}`));
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { store.flushNow(); process.exit(0); });
}
