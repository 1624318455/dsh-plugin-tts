// Mock voice-pack registry — a tiny static file server for local dev/testing.
// Serves whatever is in <dir> (manifest.json + pack files), so you can build a
// local voice-pack repo and point the plugin's 音色包 registry URL at it.
//   node tests/mock-registry.mjs <dir> [port]
// Also exports startMockRegistry(dir, port=0, delayMs=0) for use from tests.
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

export function startMockRegistry(dir, port = 0, delayMs = 0) {
  const root = path.resolve(dir);
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    let rel = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    if (!rel) rel = 'manifest.json';
    const file = path.join(root, rel);
    if (!file.startsWith(root) || !existsSync(file)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('not found');
      return;
    }
    const bytes = readFileSync(file);
    const type = file.endsWith('.json')
      ? 'application/json; charset=utf-8'
      : 'application/octet-stream';
    const send = () => {
      res.writeHead(200, {
        'Content-Type': type,
        'Content-Length': bytes.length,
        'Access-Control-Allow-Origin': '*'
      });
      res.end(bytes);
    };
    if (delayMs > 0) setTimeout(send, delayMs);
    else send();
  });
  return new Promise(resolve => {
    server.listen(port, '127.0.0.1', () =>
      resolve({ server, port: server.address().port, base: `http://127.0.0.1:${server.address().port}` }),
    );
  });
}

// CLI: serve a directory so you can test the plugin UI against a local repo.
if (process.argv[1] && process.argv[1].endsWith('mock-registry.mjs')) {
  const dir = process.argv[2] || process.cwd();
  const port = Number(process.argv[3] || 8899);
  const { base } = await startMockRegistry(dir, port);
  console.log(`mock registry serving ${dir}\n  manifest: ${base}/manifest.json`);
}
