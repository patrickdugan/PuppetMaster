import { createServer } from 'node:http';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';

export function startStaticServer(rootDir, port = 4173) {
  const server = createServer((req, res) => {
    const urlPath = req.url?.split('?')[0] || '/';
    const safePath = urlPath === '/' ? '/index.html' : urlPath;
    const filePath = path.join(rootDir, safePath);
    try {
      if (!filePath.startsWith(rootDir)) {
        res.writeHead(403);
        res.end('Forbidden');
        return;
      }
      const stat = statSync(filePath);
      if (!stat.isFile()) {
        res.writeHead(404);
        res.end('Not Found');
        return;
      }
      const data = readFileSync(filePath);
      res.writeHead(200);
      res.end(data);
    } catch (err) {
      res.writeHead(404);
      res.end('Not Found');
    }
  });
  return new Promise((resolve) => {
    server.listen(port, () => resolve(server));
  });
}
