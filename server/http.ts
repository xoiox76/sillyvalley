import { SettingsError } from './settings.ts';
// HTTP-API. Nur lokal erreichbar und gegen fremde Seiten abgesichert: Ein von einem Agenten
// erzeugter Prototyp läuft im selben Browser, darf aber keine bezahlten Läufe auslösen.

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import type { Engine } from './engine.ts';
import { GameError } from './engine.ts';

// Über die Spiel-API ausgelieferte Dateien sind nur zum Lesen und Herunterladen da: Dort läuft kein Code.
const INERT_CSP = "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:";

// Ergebnisse von Agenten sind fremder Inhalt und laufen auf einem eigenen Ursprung (eigener Port).
// So funktionieren Skripte und localStorage eines Prototyps, ohne dass er die Spiel-API erreicht.
// Ins Netz kommt er ebenfalls nicht: connect-src sperrt jede Verbindung.
const artifactCsp = (gamePort: number) =>
  [
    "default-src 'none'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    "media-src 'self' data:",
    "connect-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
    `frame-ancestors http://localhost:${gamePort} http://127.0.0.1:${gamePort}`,
  ].join('; ');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/plain; charset=utf-8',
  '.json': 'text/plain; charset=utf-8',
  '.css': 'text/plain; charset=utf-8',
  '.js': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
};

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

const isLocalHost = (req: IncomingMessage) => LOCAL_HOSTS.has((req.headers.host ?? '').replace(/:\d+$/, ''));

function isAllowedRequest(req: IncomingMessage): boolean {
  if (!isLocalHost(req)) return false;
  const origin = req.headers.origin;
  if (origin) {
    try {
      if (new URL(origin).host !== req.headers.host) return false;
    } catch {
      return false;
    }
  }
  return true;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<any> {
  if (!(req.headers['content-type'] ?? '').includes('application/json')) {
    throw new GameError('Anfragen müssen als JSON gesendet werden.', 415);
  }
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 1_000_000) throw new GameError('Die Anfrage ist zu groß.', 413);
  }
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    throw new GameError('Die Anfrage enthält kein gültiges JSON.');
  }
}

function serveFile(res: ServerResponse, file: string | null, download: boolean): void {
  if (!file || !fs.statSync(file).isFile()) throw new GameError('Diese Datei gibt es nicht.', 404);
  const ext = path.extname(file).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME[ext] ?? 'application/octet-stream',
    'Content-Security-Policy': INERT_CSP,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
    'Content-Disposition': `${download || !MIME[ext] ? 'attachment' : 'inline'}; filename="${encodeURIComponent(path.basename(file))}"`,
  });
  fs.createReadStream(file).pipe(res);
}

/** Eigener Ursprung für Ergebnisse. Pfad: /<firma>/<datei im Arbeitsbereich>. Liefert nur aus, ändert nie etwas. */
export function createArtifactHandler(engine: Engine, gamePort: number) {
  return (req: IncomingMessage, res: ServerResponse): void => {
    const fail = (status: number, text: string) => {
      res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(text);
    };
    try {
      if (!isLocalHost(req)) return fail(403, 'Nur lokale Anfragen sind erlaubt.');
      if (req.method !== 'GET' && req.method !== 'HEAD') return fail(405, 'Nur Lesen ist erlaubt.');
      const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
      const [companyId, ...rest] = pathname.split('/').filter(Boolean).map(decodeURIComponent);
      if (!companyId || !rest.length || !engine.hasCompany(companyId)) return fail(404, 'Diese Datei gibt es nicht.');
      const file = engine.resolvePath(companyId, rest.join('/'));
      if (!file || !fs.statSync(file).isFile()) return fail(404, 'Diese Datei gibt es nicht.');
      const ext = path.extname(file).toLowerCase();
      res.writeHead(200, {
        'Content-Type': MIME[ext] ?? 'application/octet-stream',
        'Content-Security-Policy': artifactCsp(gamePort),
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store',
      });
      fs.createReadStream(file).pipe(res);
    } catch {
      if (!res.headersSent) fail(404, 'Diese Datei gibt es nicht.');
      else res.end();
    }
  };
}

export function createApi(engine: Engine) {
  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (!url.pathname.startsWith('/api/')) return false;
    try {
      if (!isAllowedRequest(req)) throw new GameError('Nur lokale Anfragen sind erlaubt.', 403);
      await route(engine, req, res, url);
    } catch (err) {
      const known = err instanceof GameError;
      if (!known) console.error(err);
      if (!res.headersSent) sendJson(res, known ? err.status : 500, { error: known ? err.message : 'Interner Fehler. Details stehen im Server-Log.' });
      else res.end();
    }
    return true;
  };
}

async function route(engine: Engine, req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const method = req.method ?? 'GET';
  const parts = url.pathname.split('/').filter(Boolean).slice(1).map(decodeURIComponent);

  if (parts[0] === 'system') {
    return sendJson(res, 200, method === 'POST' ? await engine.refreshSystem() : engine.system());
  }
  if (parts[0] === 'settings' && parts[1] === 'connections' && engine.settings) {
    const settings = engine.settings;
    try {
      if (parts.length === 2 && method === 'POST') await settings.addConnection(await readJson(req));
      else if (parts.length === 3 && method === 'DELETE') {
        engine.assertModelFree(`${parts[2]}:`);
        settings.removeConnection(parts[2]);
      } else if (parts.length === 4 && parts[3] === 'models' && method === 'POST') settings.addModel(parts[2], await readJson(req));
      else if (parts.length === 5 && parts[3] === 'models' && method === 'DELETE') {
        engine.assertModelFree(`${parts[2]}:${parts[4]}`);
        settings.removeModel(parts[2], parts[4]);
      } else throw new GameError('Unbekannter Pfad.', 404);
    } catch (err) {
      if (err instanceof SettingsError) throw new GameError(err.message);
      throw err;
    }
    engine.settingsChanged();
    return sendJson(res, 200, { ok: true });
  }
  if (parts[0] !== 'companies') throw new GameError('Unbekannter Pfad.', 404);

  if (parts.length === 1) {
    if (method === 'GET') return sendJson(res, 200, engine.summaries());
    if (method === 'POST') return sendJson(res, 201, engine.createCompany(await readJson(req)));
  }
  const id = parts[1];
  const section = parts[2];

  if (parts.length === 2) {
    if (method === 'GET') return sendJson(res, 200, engine.snapshot(id));
    if (method === 'PATCH') {
      const body = await readJson(req);
      if (typeof body.budgetEur === 'number') engine.setBudget(id, body.budgetEur);
      if (body.locationId) engine.moveCompany(id, body.locationId);
      return sendJson(res, 200, engine.snapshot(id));
    }
  }

  if (section === 'stream' && method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    const send = (snapshot: unknown) => res.write(`data: ${JSON.stringify(snapshot)}\n\n`);
    send(engine.snapshot(id));
    const off = engine.subscribe(id, send);
    const heartbeat = setInterval(() => res.write(': ok\n\n'), 20000);
    req.on('close', () => {
      clearInterval(heartbeat);
      off();
    });
    return;
  }

  if (section === 'agents') {
    if (parts.length === 3 && method === 'POST') return sendJson(res, 201, await engine.hire(id, await readJson(req)));
    if (parts.length === 4 && method === 'PATCH') {
      engine.updateJob(id, parts[3], await readJson(req));
      return sendJson(res, 200, {});
    }
    if (parts.length === 5 && parts[4] === 'fire' && method === 'POST') {
      engine.fireAgent(id, parts[3]);
      return sendJson(res, 200, {});
    }
    if (parts.length === 5 && parts[4] === 'skills' && method === 'POST') {
      engine.addAgentSkill(id, parts[3], await readJson(req));
      return sendJson(res, 200, {});
    }
    if (parts.length === 5 && parts[4] === 'chat' && method === 'POST') {
      const body = await readJson(req);
      await engine.chat(id, parts[3], body.text, { expectNotes: body.expectNotes === true });
      return sendJson(res, 202, {});
    }
  }

  if (section === 'orders') {
    if (parts.length === 3 && method === 'POST') return sendJson(res, 201, await engine.startOrder(id, await readJson(req)));
    if (parts.length === 5 && parts[4] === 'stop' && method === 'POST') {
      await readJson(req);
      engine.stopOrder(id, parts[3]);
      return sendJson(res, 202, {});
    }
    if (parts.length === 5 && parts[4] === 'revise' && method === 'POST') {
      await engine.revise(id, parts[3], await readJson(req));
      return sendJson(res, 202, {});
    }
    if (parts.length === 5 && parts[4] === 'decide' && method === 'POST') {
      engine.decide(id, parts[3], await readJson(req));
      return sendJson(res, 200, {});
    }
  }

  if (section === 'meetings') {
    if (parts.length === 3 && method === 'POST') return sendJson(res, 201, await engine.startMeeting(id, await readJson(req)));
    if (parts.length === 5 && method === 'POST') {
      const body = await readJson(req);
      if (parts[4] === 'stop') engine.stopMeeting(id, parts[3]);
      else if (parts[4] === 'resume') await engine.resumeMeeting(id, parts[3], body);
      else if (parts[4] === 'decide') engine.decideMeeting(id, parts[3], body);
      else throw new GameError('Unbekannter Pfad.', 404);
      return sendJson(res, 202, {});
    }
  }

  if (section === 'commands' && parts.length === 5 && method === 'POST') {
    const body = await readJson(req);
    if (parts[4] === 'decide') await engine.decideCommand(id, parts[3], body);
    else if (parts[4] === 'stop') engine.stopCommand(id, parts[3]);
    else throw new GameError('Unbekannter Pfad.', 404);
    return sendJson(res, 202, {});
  }

  if (section === 'project-agents') {
    if (parts.length === 3 && method === 'GET') return sendJson(res, 200, engine.projectAgents(id));
    if (parts.length === 3 && method === 'POST') return sendJson(res, 201, await engine.adoptProjectAgent(id, await readJson(req)));
  }

  if (section === 'sprints') {
    if (parts.length === 3 && method === 'POST') return sendJson(res, 201, await engine.planSprint(id, await readJson(req)));
    const action = parts[4];
    if (parts.length === 5 && method === 'POST') {
      if (action === 'start') engine.startSprint(id, parts[3], await readJson(req));
      else if (action === 'discard') engine.discardSprint(id, parts[3]);
      else if (action === 'end') engine.endSprint(id, parts[3]);
      else if (action === 'retro') await engine.startRetro(id, parts[3]);
      else if (action === 'close') engine.closeSprint(id, parts[3]);
      else return sendJson(res, 404, { error: 'Unbekannt' });
      return sendJson(res, 200, { ok: true });
    }
    if (parts.length === 6 && action === 'notes' && method === 'DELETE') {
      engine.unsprintNote(id, parts[3], parts[5]);
      return sendJson(res, 200, { ok: true });
    }
  }
  if (section === 'board' && parts.length === 3 && method === 'POST') return sendJson(res, 201, engine.createNote(id, await readJson(req)));
  if (section === 'board' && parts.length === 4 && method === 'PATCH') {
    engine.updateNote(id, parts[3], await readJson(req));
    return sendJson(res, 200, { ok: true });
  }
  if (section === 'board' && parts.length === 5 && (parts[4] === 'later' || parts[4] === 'back') && method === 'POST') {
    if (parts[4] === 'later') engine.laterNote(id, parts[3]);
    else engine.backToBoard(id, parts[3]);
    return sendJson(res, 200, { ok: true });
  }
  if (section === 'board' && parts.length === 5 && parts[4] === 'drop' && method === 'POST') {
    engine.dropNote(id, parts[3]);
    return sendJson(res, 200, {});
  }

  if (section === 'ceo' && parts.length === 3 && method === 'PATCH') {
    engine.updateCeo(id, await readJson(req));
    return sendJson(res, 200, {});
  }

  if (section === 'roles') {
    if (parts.length === 3 && method === 'POST') return sendJson(res, 201, engine.createRole(id, await readJson(req)));
    if (parts.length === 4 && method === 'PATCH') {
      engine.updateRole(id, parts[3], await readJson(req));
      return sendJson(res, 200, {});
    }
    if (parts.length === 4 && method === 'DELETE') {
      engine.deleteRole(id, parts[3]);
      return sendJson(res, 200, {});
    }
  }

  if (section === 'teams') {
    if (parts.length === 3 && method === 'POST') return sendJson(res, 201, engine.createTeam(id, await readJson(req)));
    if (parts.length === 4 && method === 'PATCH') {
      engine.updateTeam(id, parts[3], await readJson(req));
      return sendJson(res, 200, {});
    }
    if (parts.length === 4 && method === 'DELETE') {
      engine.deleteTeam(id, parts[3]);
      return sendJson(res, 200, {});
    }
  }

  if (section === 'building' && parts.length === 4 && parts[3] === 'shaft' && method === 'POST') {
    engine.addShaft(id, await readJson(req));
    return sendJson(res, 200, {});
  }
  if (section === 'building' && parts.length === 3 && method === 'POST') {
    engine.expandBuilding(id, await readJson(req));
    return sendJson(res, 200, {});
  }

  if (section === 'town' && parts.length === 4 && method === 'POST') {
    engine.townAction(id, parts[3], await readJson(req));
    return sendJson(res, 200, {});
  }

  if (section === 'departments') {
    if (parts.length === 3 && method === 'POST') return sendJson(res, 201, engine.createDepartment(id, await readJson(req)));
    if (parts.length === 4 && method === 'PATCH') {
      engine.updateDepartment(id, parts[3], await readJson(req));
      return sendJson(res, 200, {});
    }
    if (parts.length === 4 && method === 'DELETE') {
      engine.dissolveDepartment(id, parts[3]);
      return sendJson(res, 200, {});
    }
  }

  if (section === 'mandates') {
    if (parts.length === 3 && method === 'POST') return sendJson(res, 201, await engine.startMandate(id, await readJson(req)));
    if (parts.length === 5 && method === 'POST') {
      await readJson(req);
      if (parts[4] === 'plan') await engine.planMandate(id, parts[3]);
      else if (parts[4] === 'close') engine.closeMandate(id, parts[3]);
      else throw new GameError('Unbekannter Pfad.', 404);
      return sendJson(res, 202, {});
    }
    if (parts.length === 6 && parts[4] === 'proposals' && method === 'POST') {
      await engine.decideProposal(id, parts[3], parts[5], await readJson(req));
      return sendJson(res, 202, {});
    }
    if (parts.length === 6 && parts[4] === 'contracts' && method === 'GET') {
      const { contract, text } = engine.contractOf(id, parts[3], parts[5]);
      return sendJson(res, 200, { contract, text });
    }
    if (parts.length === 6 && parts[4] === 'contracts' && method === 'POST') {
      return sendJson(res, 202, { agent: await engine.signContract(id, parts[3], parts[5], await readJson(req)) });
    }
  }

  if (section === 'runs' && parts.length === 5) {
    if (parts[4] === 'stop' && method === 'POST') {
      await readJson(req);
      engine.stopRun(id, parts[3]);
      return sendJson(res, 202, {});
    }
    if (parts[4] === 'log' && method === 'GET') {
      engine.snapshot(id);
      if (!/^r[0-9a-f]{8}$/.test(parts[3])) throw new GameError('Diesen Lauf gibt es nicht.', 404);
      const file = engine.rawLogOf(id, parts[3]);
      if (!fs.existsSync(file)) throw new GameError('Für diesen Lauf gibt es kein Protokoll.', 404);
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
      fs.createReadStream(file).pipe(res);
      return;
    }
  }

  if (section === 'items') {
    if (parts.length === 3 && method === 'POST') return sendJson(res, 201, engine.placeItem(id, await readJson(req)));
    if (parts.length === 4 && method === 'PATCH') {
      engine.moveItem(id, parts[3], await readJson(req));
      return sendJson(res, 200, {});
    }
    if (parts.length === 4 && method === 'DELETE') {
      engine.deleteItem(id, parts[3]);
      return sendJson(res, 200, {});
    }
    if (parts.length === 5 && parts[4] === 'store' && method === 'POST') {
      engine.storeItem(id, parts[3]);
      return sendJson(res, 200, {});
    }
  }

  if (section === 'files' && method === 'GET') return sendJson(res, 200, engine.files(id));
  if (section === 'file' && method === 'GET') {
    return serveFile(res, engine.resolvePath(id, url.searchParams.get('path') ?? ''), url.searchParams.has('download'));
  }
  if (section === 'reveal' && method === 'POST') {
    const file = engine.resolvePath(id, (await readJson(req)).path ?? '');
    if (!file) throw new GameError('Diese Datei gibt es nicht.', 404);
    if (process.platform === 'darwin') execFile('open', ['-R', file], () => {});
    return sendJson(res, 200, {});
  }

  throw new GameError('Unbekannter Pfad.', 404);
}
