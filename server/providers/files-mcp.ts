// Die Dateiwerkzeuge für Agenten mit eigenem Abo, als MCP-Server über stdin und stdout.
// Der Agent bekommt keine Shell. Jeder Pfad läuft durch dieselbe Prüfung wie bei den Anbietern mit API-Schlüssel.
// Aufruf: node files-mcp.ts <Arbeitsbereich> <nurlesen|schreiben> <Schema-Datei oder -> <Ergebnis-Datei oder ->

import fs from 'node:fs';
import readline from 'node:readline';
import { Denied, Workspace } from './workspace-tools.ts';

const [root, mode, schemaFile, resultFile] = process.argv.slice(2);
const readOnly = mode === 'nurlesen';
const space = new Workspace(root, [], readOnly);
const PATH = { type: 'string', description: 'Pfad relativ zum Arbeitsbereich' };

const tools: { name: string; description: string; inputSchema: object }[] = [
  { name: 'read_file', description: 'Liest eine Textdatei.', inputSchema: { type: 'object', properties: { path: PATH }, required: ['path'] } },
  { name: 'list_files', description: 'Listet Dateien, optional unter einem Ordner.', inputSchema: { type: 'object', properties: { path: PATH } } },
  { name: 'search_files', description: 'Sucht einen Text in Dateien.', inputSchema: { type: 'object', properties: { query: { type: 'string' }, path: PATH }, required: ['query'] } },
];
if (!readOnly) {
  tools.push(
    { name: 'write_file', description: 'Schreibt eine Datei neu.', inputSchema: { type: 'object', properties: { path: PATH, content: { type: 'string' } }, required: ['path', 'content'] } },
    { name: 'edit_file', description: 'Ersetzt in einer Datei einen Text, der genau einmal vorkommt.', inputSchema: { type: 'object', properties: { path: PATH, old: { type: 'string' }, new: { type: 'string' } }, required: ['path', 'old', 'new'] } },
  );
}
if (schemaFile !== '-') tools.push({ name: 'antwort_abgeben', description: 'Gibt die fertige Antwort in der verlangten Form ab.', inputSchema: JSON.parse(fs.readFileSync(schemaFile, 'utf8')) });

const send = (message: object) => process.stdout.write(`${JSON.stringify(message)}\n`);
const text = (id: unknown, value: string, isError = false) => send({ jsonrpc: '2.0', id, result: { isError, content: [{ type: 'text', text: value }] } });

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const message = JSON.parse(line);
  if (message.method === 'initialize') return send({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: message.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'dateien', version: '1' } } });
  if (message.method === 'tools/list') return send({ jsonrpc: '2.0', id: message.id, result: { tools } });
  if (message.method === 'tools/call') {
    const { name, arguments: args } = message.params;
    if (name === 'antwort_abgeben' && resultFile !== '-') {
      fs.writeFileSync(resultFile, JSON.stringify(args));
      return text(message.id, 'Angekommen.');
    }
    try {
      return text(message.id, space.run(name, args ?? {}));
    } catch (err) {
      return text(message.id, `${err instanceof Denied ? 'Verboten' : 'Fehler'}: ${(err as Error).message}`, true);
    }
  }
  if (message.id !== undefined) send({ jsonrpc: '2.0', id: message.id, result: {} });
});
