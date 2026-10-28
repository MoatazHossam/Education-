// A static file server for the player: serves marketing/product-showcase (the recordings and the
// video project) on 127.0.0.1, because module scripts do not load from file:// URLs.
import { createReadStream, statSync } from 'node:fs';
import http from 'node:http';
import { URL } from 'node:url';
import { extname, join, normalize, resolve } from 'node:path';

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.ttf': 'font/ttf', '.woff2': 'font/woff2' };

export function serve(dir) {
  const root = resolve(dir);
  const server = http.createServer((req, res) => {
    const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
    const file = join(root, path);
    if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
    try {
      if (!statSync(file).isFile()) throw new Error('not a file');
      res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'max-age=3600' });
      createReadStream(file).pipe(res);
    } catch {
      res.writeHead(404).end();
    }
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` })));
}
