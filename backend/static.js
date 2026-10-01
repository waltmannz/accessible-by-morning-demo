import http from 'node:http';
import path from 'node:path';
import { readFile, stat } from 'node:fs/promises';

export const MIME = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.svg':'image/svg+xml','.md':'text/markdown; charset=utf-8','.txt':'text/plain; charset=utf-8','.patch':'text/plain; charset=utf-8'};
export async function serveFile(res, root, relative) {
  let clean;
  try { clean = decodeURIComponent(relative); } catch { res.writeHead(400); res.end('Invalid path'); return; }
  const target = path.resolve(root, '.' + path.sep + clean.replace(/^[/\\]+/, ''));
  if (target !== path.resolve(root) && !target.startsWith(path.resolve(root) + path.sep)) { res.writeHead(403); res.end('Forbidden'); return; }
  try {
    const file = (await stat(target)).isDirectory() ? path.join(target, 'index.html') : target;
    const data = await readFile(file);
    res.writeHead(200, {'content-type': MIME[path.extname(file)] || 'application/octet-stream','cache-control':'no-store'}); res.end(data);
  } catch { res.writeHead(404); res.end('Not found'); }
}
export async function startStatic(root) {
  const server = http.createServer((req,res) => serveFile(res,root,new URL(req.url,'http://localhost').pathname));
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  return {url:`http://127.0.0.1:${server.address().port}`,close:() => new Promise(resolve => server.close(resolve))};
}
