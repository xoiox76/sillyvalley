#!/usr/bin/env node
// NUR FÜR TESTS: spielt das Ereignisformat der Claude-CLI nach und schreibt eine echte Datei.
// Das Spiel kennzeichnet diesen Modus unübersehbar als Test-Attrappe. Er ersetzt keinen echten Lauf.
// Das Szenario steht im Prompt, z. B. "[szenario:limit]".

import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
if (args[0] === '--version') {
  console.log('0.0.0 (Attrappe)');
  process.exit(0);
}
const arg = (name) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};
const prompt = arg('-p') ?? '';
const scenario = prompt.match(/\[szenario:(\w+)\]/)?.[1] ?? 'ok';
const sessionId = arg('--session-id') ?? arg('--resume') ?? 'attrappe';
const model = arg('--model') ?? 'claude-haiku-5-5';
const emit = (obj) => process.stdout.write(`${JSON.stringify(obj)}\n`);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const USAGE = { input_tokens: 10, output_tokens: 100, cache_read_input_tokens: 200, cache_creation_input_tokens: 1000, cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 1000 } };

emit({ type: 'system', subtype: 'init', session_id: sessionId, model, tools: ['Read', 'Write'], mcp_servers: [], apiKeySource: 'none' });
emit({ type: 'stream_event', event: { type: 'message_start', message: { id: 'msg_1', usage: USAGE } }, api_message_id: 'msg_1' });

if (scenario === 'stoppzuspaet') {
  // Stellt das Rennen nach: Das Stopp-Signal kommt, aber der Lauf wird trotzdem noch regulär fertig.
  process.on('SIGTERM', () => {});
  await wait(250);
}
if (scenario === 'haengt') {
  // Wartet, bis es gestoppt wird. Das Skript braucht dafür einen offenen Timer.
  emit({ type: 'stream_event', event: { type: 'content_block_start', content_block: { type: 'tool_use', name: 'Write' } } });
  await wait(60000);
  process.exit(0);
}
if (scenario === 'absturz') {
  process.stderr.write('Attrappe: simulierter Absturz\n');
  process.exit(3);
}

const schemaArg = arg('--json-schema');
const tools = (arg('--tools') ?? '').split(',');
const target = prompt.match(/ergebnisse\/[\w-]+/)?.[0];
// Wie die echte CLI: Ohne Schreibwerkzeug entsteht keine Datei.
if (target && scenario !== 'ohnedatei' && tools.includes('Write')) {
  emit({ type: 'stream_event', event: { type: 'content_block_start', content_block: { type: 'tool_use', name: 'Write' } } });
  emit({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: `{"file_path":"${process.cwd()}/${target}/ergebnis.md"` } } });
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, 'ergebnis.md'), '# Ergebnis der Attrappe\n');
  emit({ type: 'assistant', message: { id: 'msg_1', usage: USAGE, content: [{ type: 'tool_use', id: 't1', name: 'Write', input: { file_path: `${process.cwd()}/${target}/ergebnis.md` } }] } });
  emit({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } });
}
await wait(20);

// Wie die echte CLI: total_cost_usd und modelUsage summieren über die Session, usage gilt pro Lauf.
const single = (10 * 0.1 + 100 * 0.5 + 200 * 0.01 + 1000 * 0.2) / 1e6;
const counter = `.attrappe-${sessionId}`;
const earlier = fs.existsSync(counter) ? Number(fs.readFileSync(counter, 'utf8')) : 0;
const cost = earlier + single;
fs.writeFileSync(counter, String(cost));
const times = Math.round(cost / single);
const modelUsage = { [model]: { inputTokens: 10 * times, outputTokens: 100 * times, costUSD: cost } };
const parsedSchema = schemaArg ? JSON.parse(schemaArg) : null;
if (parsedSchema?.properties.beitrag) {
  // Beitrag zu einer Besprechung. "uneinig" lässt die Moderation nicht zustimmen, "beitragkaputt" ist unbrauchbar.
  const moderates = Boolean(parsedSchema.properties.einig);
  const turn = {
    kurz: moderates ? 'Fasst zusammen' : 'Sagt etwas',
    beitrag: `Beitrag zur Sitzung ${sessionId.slice(0, 4)}.`,
    ...(moderates ? { einig: scenario !== 'uneinig', vorschlag: scenario === 'uneinig' ? '' : 'Wir bauen zuerst die Helferliste.', naechste_schritte: [{ aufgabe: 'Helferliste bauen', rolle: 'Entwicklung' }], offene_punkte: ['Wer testet?'] } : {}),
  };
  emit({ type: 'result', subtype: 'success', is_error: false, result: JSON.stringify(turn), structured_output: scenario === 'beitragkaputt' ? null : turn, num_turns: 1, duration_ms: 30, total_cost_usd: cost, modelUsage, usage: USAGE, permission_denials: [] });
  process.exit(0);
}
if (parsedSchema?.properties.ziel) {
  // Planning des Scrum Masters. "planningkaputt" ist unbrauchbar.
  const ids = parsedSchema.properties.zettel.items.enum;
  const plan = { ziel: 'Das Wichtigste zuerst.', begruendung: 'Passt ins Budget.', zettel: ids.slice(0, 2) };
  emit({ type: 'result', subtype: 'success', is_error: false, result: JSON.stringify(plan), structured_output: scenario === 'planningkaputt' ? null : plan, num_turns: 1, duration_ms: 30, total_cost_usd: cost, modelUsage, usage: USAGE, permission_denials: [] });
  process.exit(0);
}
if (parsedSchema?.properties.auftraege) {
  // Planung eines Managers. Das Schema nennt die erlaubten Namen; "managerzoe" ignoriert das wie ein ungehorsames Modell,
  // "managerteuer" überzieht das Budget, "managerfertig" schlägt nichts mehr vor, "managerkaputt" ist unbrauchbar.
  const names = parsedSchema.properties.auftraege.items.properties.arbeit.enum;
  const other = names.length > 1 ? names[1] : '';
  const proposals = scenario === 'managerfertig' ? [] : [
    { titel: 'Kleiner Auftrag', hinweise: 'Kurz halten.', kriterien: ['Eine Datei liegt vor'], planung: '', arbeit: scenario === 'managerzoe' ? 'Zoe' : names[0], pruefung: '', limit_eur: scenario === 'managerteuer' ? 5 : 0.05, begruendung: 'Schnell erledigt.' },
    { titel: 'Großer Auftrag', hinweise: '', kriterien: ['Zwei Dateien liegen vor', 'Beide sind lesbar'], planung: '', arbeit: names[0], pruefung: other, limit_eur: scenario === 'managerteuer' ? 5 : 0.5, begruendung: 'Braucht Prüfung.' },
  ];
  // "managervertrag" schlägt eine Einstellung vor, "managervertragkaputt" eine mit unbekannter Rolle.
  const hires = scenario === 'managervertrag' ? [{ name: 'Sam', rolle: 'Text und Marke', modell: 'Haiku 5.5', faehigkeiten: ['Texte'], begruendung: 'Niemand im Team schreibt.' }]
    : scenario === 'managervertragkaputt' ? [{ name: 'Sam', rolle: 'Zauberei', modell: 'Haiku 5.5', faehigkeiten: [], begruendung: '' }] : [];
  const plan = { zusammenfassung: `Planung der Attrappe, Runde für ${sessionId.slice(0, 4)}.`, fertig: scenario === 'managerfertig', offen: '', auftraege: proposals, einstellungen: hires };
  emit({ type: 'result', subtype: 'success', is_error: false, result: JSON.stringify(plan), structured_output: scenario === 'managerkaputt' ? null : plan, num_turns: 1, duration_ms: 30, total_cost_usd: cost, modelUsage, usage: USAGE, permission_denials: [] });
  process.exit(0);
}
if (schemaArg) {
  // Urteil einer Prüfstufe. "urteileinmalnein" fällt beim ersten Mal durch, "urteilnein" immer, "urteilkaputt" ist unbrauchbar.
  const size = JSON.parse(schemaArg).properties.kriterien.minItems;
  const seen = `.attrappe-urteil-${sessionId}`;
  const round = fs.existsSync(seen) ? Number(fs.readFileSync(seen, 'utf8')) + 1 : 1;
  fs.writeFileSync(seen, String(round));
  const passed = !(scenario === 'urteilnein' || (scenario === 'urteileinmalnein' && round === 1));
  const verdict = {
    bestanden: passed,
    kriterien: Array.from({ length: size }, () => ({ erfuellt: passed, begruendung: passed ? 'Passt.' : 'Fehlt noch.' })),
    maengel: passed ? [] : ['Das Kriterium fehlt noch.'],
    zusammenfassung: passed ? 'Alles erfüllt.' : 'Es fehlt etwas.',
  };
  emit({ type: 'result', subtype: 'success', is_error: false, result: JSON.stringify(verdict), structured_output: scenario === 'urteilkaputt' ? null : verdict, num_turns: 2, duration_ms: 30, total_cost_usd: cost, modelUsage, usage: USAGE, permission_denials: [] });
  process.exit(0);
}
if (scenario === 'limit') {
  emit({ type: 'result', subtype: 'error_max_budget_usd', is_error: true, errors: ['Reached maximum budget'], num_turns: 1, duration_ms: 30, total_cost_usd: cost, modelUsage, usage: USAGE, permission_denials: [] });
  process.exit(1);
}
// Zum Ansehen im Spiel: Eine Antwort mit {warte} dauert, damit die Figuren zum Treffpunkt laufen können.
if (prompt.includes('bittet dich um Hilfe') && prompt.includes('{warte}')) await wait(30000);
// "weitergeben" gibt den Auftrag ab, aber nur beim ersten Mal. [zu:Name] nennt wohin.
if (scenario === 'weitergeben' && !prompt.includes('hat dir diesen Auftrag gegeben') && !prompt.includes('nicht weitergeben')) {
  const to = prompt.match(/\[zu:([^\]]+)\]/)?.[1] ?? 'Alex';
  const text = `Das passt nicht zu mir.\n<<<WEITERGEBEN\nAN: ${to}\nGRUND: Das kann die Person besser.\nWEITERGEBEN>>>`;
  emit({ type: 'result', subtype: 'success', is_error: false, result: text, num_turns: 1, duration_ms: 30, total_cost_usd: cost, modelUsage, usage: USAGE, permission_denials: [] });
  process.exit(0);
}
// "hilfe" fragt einen Kollegen. Wen, steht in [an:Name] im Prompt.
if (scenario === 'hilfe') {
  const to = prompt.match(/\[an:([^\]]+)\]/)?.[1] ?? 'Alex';
  const text = `Ich komme allein nicht weiter.\n<<<HILFE\nAN: ${to}\nFRAGE: Was weisst du dazu? ${prompt.includes('{warte}') ? '{warte}' : ''}\nHILFE>>>`;
  emit({ type: 'result', subtype: 'success', is_error: false, result: text, num_turns: 1, duration_ms: 30, total_cost_usd: cost, modelUsage, usage: USAGE, permission_denials: [] });
  process.exit(0);
}
// "zettel" schlägt Aufgaben für die Tafel vor.
if (scenario === 'zettel') {
  const text = 'Hier sind meine Vorschläge.\n<<<ZETTEL\nTITEL: Ist-Stand prüfen\nROLLE: tester\nHINWEIS: Erst die Doku lesen.\nKRITERIUM: Tabelle mit Belegen\nKRITERIUM: Keine Aussage ohne Beleg\nZETTEL>>>\n<<<ZETTEL\nTITEL: Kosten rechnen\nROLLE: Planung\nZETTEL>>>\n<<<ZETTEL\nROLLE: ohne Titel\nZETTEL>>>\nDas war es.';
  emit({ type: 'result', subtype: 'success', is_error: false, result: text, num_turns: 1, duration_ms: 30, total_cost_usd: cost, modelUsage, usage: USAGE, permission_denials: [] });
  process.exit(0);
}
// "befehl" beantragt einen Befehl. Der Befehl selbst steht in [befehl:...] im Prompt.
if (scenario === 'befehl') {
  const wanted = prompt.match(/\[befehl:([^\]]+)\]/)?.[1] ?? 'echo hallo';
  const text = `Ich möchte das prüfen.\n<<<BEFEHL\n${wanted}\nGRUND: Zum Prüfen.\nBEFEHL>>>`;
  emit({ type: 'result', subtype: 'success', is_error: false, result: text, num_turns: 1, duration_ms: 30, total_cost_usd: cost, modelUsage, usage: USAGE, permission_denials: [] });
  process.exit(0);
}
emit({ type: 'result', subtype: 'success', is_error: false, result: 'Die Attrappe ist fertig.', num_turns: 2, duration_ms: 30, total_cost_usd: cost, modelUsage, usage: USAGE, permission_denials: [] });
