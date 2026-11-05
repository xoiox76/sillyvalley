import fs from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Engine } from './engine.ts';
import { FxSource } from './fx.ts';
import { createApi, createArtifactHandler } from './http.ts';
import { createAnthropicProvider } from './providers/anthropic.ts';
import { createCompatibleProvider, createRouter } from './providers/compatible.ts';
import { Settings } from './settings.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = process.env.SILLYVAILLEY_DATA ?? path.join(ROOT, 'data');
const PORT = Number(process.env.PORT ?? 4600);
const ARTIFACT_PORT = PORT + 1;
/** Zum Ausprobieren des Büros: SILLYVAILLEY_BAUPUNKTE=unendlich. Die Oberfläche zeigt den Schalter. */
const UNLIMITED_BUILD = process.env.SILLYVAILLEY_BAUPUNKTE === 'unendlich';
const PRODUCTION = process.env.NODE_ENV === 'production';

const settings = new Settings(DATA);
const provider = createRouter(createAnthropicProvider(process.env.SILLYVAILLEY_AGENT_BIN), createCompatibleProvider((id) => settings.resolve(id)), (id) => id.includes(':'));
const engine = new Engine(DATA, provider, new FxSource(DATA), ARTIFACT_PORT, UNLIMITED_BUILD);
engine.settings = settings;
await engine.init();
const api = createApi(engine);

const STATIC_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.svg': 'image/svg+xml',
};

function serveStatic(pathname: string, res: import('node:http').ServerResponse): void {
  const dist = path.join(ROOT, 'dist');
  const target = path.resolve(dist, `.${pathname === '/' ? '/index.html' : pathname}`);
  const file = target.startsWith(dist) && fs.existsSync(target) && fs.statSync(target).isFile() ? target : path.join(dist, 'index.html');
  res.writeHead(200, { 'Content-Type': STATIC_TYPES[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}

let vite: import('vite').ViteDevServer | null = null;
if (!PRODUCTION) {
  const { createServer: createVite } = await import('vite');
  vite = await createVite({ configFile: path.join(ROOT, 'vite.config.ts'), root: path.join(ROOT, 'client'), server: { middlewareMode: true }, appType: 'spa' });
}

const server = createServer(async (req, res) => {
  if (await api(req, res)) return;
  if (vite) vite.middlewares(req, res);
  else serveStatic(new URL(req.url ?? '/', 'http://localhost').pathname, res);
});

createServer(createArtifactHandler(engine, PORT)).listen(ARTIFACT_PORT, '127.0.0.1');

server.listen(PORT, '127.0.0.1', () => {
  const info = engine.system().provider;
  console.log(`Silly Vailley läuft auf http://localhost:${PORT}`);
  console.log(info.available ? `Agenten: ${info.label} (${info.account}, CLI ${info.version})` : `Agenten nicht verfügbar: ${info.error}`);
  if (info.testDouble) console.log('ACHTUNG: Test-Attrappe aktiv. Es laufen keine echten Agenten.');
  if (UNLIMITED_BUILD) console.log('Baupunkte: unendlich (Schalter SILLYVAILLEY_BAUPUNKTE).');
});

const shutdown = () => {
  engine.shutdown();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
