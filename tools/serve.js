// 本機靜態伺服器（測試用）：node tools/serve.js 8765
// 只聽 127.0.0.1，只提供倉庫內的檔案，以「.」開頭的資料夾（.git 等）一律不提供
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const port = Number(process.argv[2]) || 8765;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.csv': 'text/csv; charset=utf-8',
};

http.createServer(async (req, res) => {
  let path;
  try { path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch { res.writeHead(400).end(); return; }
  if (path.endsWith('/')) path += 'index.html';
  const file = resolve(join(root, normalize(path)));
  const inside = file.startsWith(root + sep);
  const hidden = file.slice(root.length).split(sep).some((s) => s.startsWith('.'));
  if (!inside || hidden) { res.writeHead(404).end(); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('找不到檔案');
  }
}).listen(port, '127.0.0.1', () => console.log(`http://localhost:${port}/`));
