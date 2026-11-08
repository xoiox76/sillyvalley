// Heimwege in der Stadt. Die Tageszeit kommt vom Nutzungsguthaben: Wird es Nacht, geht jede Figur zur Haustür
// hinaus und läuft oder fährt zu ihrem Haus. Wird es wieder Tag, kommt sie auf demselben Weg zurück.
// Büro und Stadtansicht lesen denselben Stand, damit eine Figur nie an zwei Orten zugleich ist.

import { curbOf, commuteMode, drivable, homesOf, officeParking, walkable, type CommuteMode } from '../../shared/commute.ts';
import { floorOf, siteAt } from '../../shared/building.ts';
import { isNight, quotaClosedUntil, quotaUsed } from '../../shared/quota.ts';
import { parcelById, townPath, type Parcel, type TownTile } from '../../shared/town.ts';
import type { Agent, Company, Look, PlanStatus } from '../../shared/types.ts';
import { characterSprite } from './characters.ts';
import { Pen, lighten, rect, tri, type Ctx } from './pixel.ts';

/** Wo die Figur gerade ist. exiting und entering spielen im Büro, leaving und coming in der Stadt. */
export type Phase = 'work' | 'exiting' | 'leaving' | 'home' | 'coming' | 'entering';

interface Leg {
  kind: 'walk' | 'drive';
  points: TownTile[];
  /** Felder pro Sekunde. */
  speed: number;
}

interface Commuter {
  agentId: string;
  look: Look;
  mode: CommuteMode;
  office: Parcel;
  home: Parcel;
  /** Wo das Auto steht, wenn die Figur im Büro ist, und wo vor dem Haus. */
  workSpot: TownTile | null;
  homeSpot: TownTile | null;
  phase: Phase;
  since: number;
  legs: Leg[];
  leg: number;
  legStart: number;
}

const WALK_SPEED = 2.2;
const DRIVE_SPEED = 5;
/** Wer zur Tür geht, ist spätestens dann draußen. Für den Fall, dass gerade niemand ins Büro schaut. */
const EXIT_TIMEOUT = 8000;

let plan: PlanStatus | null = null;
let budgetUsed = 0;
let override: number | null = null;
const commuters = new Map<string, Commuter>();
let companyId = '';

export function setUsage(next: { plan?: PlanStatus | null; budgetUsed?: number; override?: number | null }): void {
  if (next.plan !== undefined) plan = next.plan;
  if (next.budgetUsed !== undefined) budgetUsed = next.budgetUsed;
  if (next.override !== undefined) override = next.override;
}

/** Feierabend für diese Person: Kontingent zu oder Nacht, weil das Guthaben fast aufgebraucht ist. Wer arbeitet, bleibt. */
export function offDuty(agent: Agent): boolean {
  if (agent.live.runId) return false;
  if (override !== null) return isNight(override);
  if (agent.providerId === 'anthropic' && quotaClosedUntil(plan, Date.now()) !== null) return true;
  const used = quotaUsed(plan);
  if (used !== null && agent.providerId === 'anthropic') return isNight(used);
  return isNight(budgetUsed);
}

/** Stellt die Pendler auf die aktuelle Firma ein. Wer schon unterwegs ist, bleibt unterwegs. */
export function sync(company: Company, now: number): void {
  if (company.id !== companyId) {
    commuters.clear();
    companyId = company.id;
  }
  const homes = homesOf(company);
  const staff = company.agents.filter((a) => a.hired && !a.firedAt);
  const known = new Set(staff.map((a) => a.id));
  for (const id of [...commuters.keys()]) if (!known.has(id)) commuters.delete(id);
  // Parkplätze vor jedem Büro der Reihe nach vergeben: an jedem Standort die Fahrer dieses Standorts.
  const spotsBySite = new Map<string, TownTile[]>();
  for (const agent of staff) {
    const home = parcelById(homes.get(agent.id) ?? '');
    const desk = company.placed.find((p) => p.id === agent.deskId);
    const office = parcelById(siteAt(company, desk ? floorOf(desk) : 0).siteId);
    if (!home || !office) continue;
    const mode = commuteMode(office.entry, home.entry);
    let workSpot: TownTile | null = null;
    if (mode === 'car') {
      const taken = spotsBySite.get(office.id) ?? [];
      workSpot = officeParking(office, taken.length + 1)[taken.length] ?? null;
      if (workSpot) spotsBySite.set(office.id, [...taken, workSpot]);
    }
    const existing = commuters.get(agent.id);
    if (existing && existing.home.id === home.id && existing.office.id === office.id) {
      existing.look = agent.look;
      continue;
    }
    // Neu im Blick: Ist schon Nacht, ist die Person bereits daheim. Kein Heimweg beim Öffnen.
    commuters.set(agent.id, {
      agentId: agent.id, look: agent.look, mode, office, home, workSpot, homeSpot: mode === 'car' ? curbOf(home.entry) : null,
      phase: offDuty(agent) ? 'home' : 'work', since: now, legs: [], leg: 0, legStart: now,
    });
  }
  // Tageszeit anwenden: Feierabend beginnt, oder der Morgen holt alle zurück.
  for (const agent of staff) {
    const c = commuters.get(agent.id);
    if (!c) continue;
    const off = offDuty(agent);
    if (off && c.phase === 'work') setPhase(c, 'exiting', now);
    if (off && c.phase === 'exiting' && now - c.since > EXIT_TIMEOUT) startTrip(c, 'leaving', now);
    if (!off && c.phase === 'home') startTrip(c, 'coming', now);
    advance(c, now);
  }
}

function setPhase(c: Commuter, phase: Phase, now: number): void {
  c.phase = phase;
  c.since = now;
}

/** Die Wegstücke eines Heimwegs, für den Rückweg umgedreht. */
function startTrip(c: Commuter, phase: 'leaving' | 'coming', now: number): void {
  const legs: Leg[] = [];
  const walkLeg = (from: TownTile, to: TownTile): Leg => ({ kind: 'walk', points: [from, ...townPath(from, to, (i, j) => !walkable(i, j), 20_000)], speed: WALK_SPEED });
  if (c.mode === 'car' && c.workSpot && c.homeSpot) {
    legs.push(walkLeg(c.office.entry, c.workSpot));
    legs.push({ kind: 'drive', points: [c.workSpot, ...townPath(c.workSpot, c.homeSpot, (i, j) => !drivable(i, j), 120_000)], speed: DRIVE_SPEED });
    legs.push(walkLeg(c.homeSpot, c.home.entry));
  } else {
    legs.push(walkLeg(c.office.entry, c.home.entry));
  }
  if (phase === 'coming') {
    legs.reverse();
    for (const leg of legs) leg.points = [...leg.points].reverse();
  }
  c.legs = legs.filter((leg) => leg.points.length > 0);
  c.leg = 0;
  c.legStart = now;
  setPhase(c, phase, now);
}

const legDuration = (leg: Leg) => (Math.max(0, leg.points.length - 1) / leg.speed) * 1000;

function advance(c: Commuter, now: number): void {
  if (c.phase !== 'leaving' && c.phase !== 'coming') return;
  while (c.leg < c.legs.length && now - c.legStart >= legDuration(c.legs[c.leg])) {
    c.legStart += legDuration(c.legs[c.leg]);
    c.leg++;
  }
  if (c.leg >= c.legs.length) setPhase(c, c.phase === 'leaving' ? 'home' : 'entering', now);
}

export function phaseOf(agentId: string): Phase {
  return commuters.get(agentId)?.phase ?? 'work';
}

/** Das Büro meldet: Die Figur ist zur Tür hinaus. */
export function exited(agentId: string, now: number): void {
  const c = commuters.get(agentId);
  if (c?.phase === 'exiting') startTrip(c, 'leaving', now);
}

/** Das Büro meldet: Die Figur ist wieder drin. */
export function entered(agentId: string, now: number): void {
  const c = commuters.get(agentId);
  if (c?.phase === 'entering') setPhase(c, 'work', now);
}

/** Hat diese Person keinen Heimweg (kein Haus, kein Büro in der Stadt), gilt der alte Feierabend: sie verschwindet an der Tür. */
export const commutes = (agentId: string) => commuters.has(agentId);

/* ---------- Zeichnen in der Stadt ---------- */

export interface TownSprite {
  /** Tiefe wie bei Stadtteilen: Summe aus i und j. */
  depth: number;
  draw: (ctx: Ctx, project: (i: number, j: number) => [number, number], time: number) => void;
}

const carColor = (look: Look) => look.top;

/**
 * Ein Auto in Stadtpixeln, in echten Maßen: ein Feld ist ein Meter, ein Meter Höhe sind etwa 19 Pixel.
 * Rund 4,2 m lang, 1,8 m breit, 1,45 m hoch. Räder, Karosserie, Fahrgastraum mit Scheiben, Lichter.
 */
function drawCar(ctx: Ctx, x: number, y: number, alongI: boolean, color: string, lights: boolean): void {
  const pen = new Pen(ctx, x, y);
  const L = 4.2;
  const W = 1.8;
  // In Längsrichtung a, quer b. Daraus werden je nach Richtung i und j.
  const box = (a: number, b: number, z: number, la: number, lb: number, h: number, c: ReturnType<typeof tri>) =>
    alongI ? pen.box(a - L / 2, b - W / 2, z, la, lb, h, c) : pen.box(b - W / 2, a - L / 2, z, lb, la, h, c);
  const body = tri(color, 0.18);
  const dark = tri('#14161c', 0.08);
  const glass = tri('#6a8aa0', 0.14);
  // Räder: vorn und hinten, je beide Seiten
  for (const a of [0.55, L - 1.25]) for (const b of [-0.02, W - 0.24]) box(a, b, 0, 0.7, 0.26, 12, dark);
  // Unterboden, Karosserie mit Stoßstangen
  box(0.05, 0.08, 4, L - 0.1, W - 0.16, 3, dark);
  box(0, 0, 6, L, W, 9, body);
  box(-0.05, 0.1, 5, 0.12, W - 0.2, 4, tri('#2a2e38', 0.1));
  box(L - 0.07, 0.1, 5, 0.12, W - 0.2, 4, tri('#2a2e38', 0.1));
  // Fahrgastraum: Scheiben ringsum, Dach in Wagenfarbe
  box(1.1, 0.12, 15, 2.2, W - 0.24, 10, glass);
  box(1.0, 0.1, 25, 2.4, W - 0.2, 2, tri(lighten(color, 0.08), 0.12));
  // Säulen zwischen den Scheiben
  for (const a of [1.1, 2.15, 3.2]) box(a, 0.12, 15, 0.1, W - 0.24, 10, body);
  // Lichter: vorn hell, hinten rot. Vorn liegt bei hohem a.
  const front = alongI ? pen.pt(L / 2, 0, 10) : pen.pt(0, L / 2, 10);
  const back = alongI ? pen.pt(-L / 2, 0, 10) : pen.pt(0, -L / 2, 10);
  void back;
  rect(ctx, front[0] - 4, front[1] - 1, 3, 2, lights ? '#fff6c8' : '#e8e4d0');
  rect(ctx, front[0] + 2, front[1] - 4, 3, 2, lights ? '#fff6c8' : '#e8e4d0');
}

function pointAt(leg: Leg, t: number): { i: number; j: number; di: number; dj: number } {
  const pos = Math.min(leg.points.length - 1, t * leg.speed);
  const k = Math.floor(pos);
  const a = leg.points[k];
  const b = leg.points[Math.min(leg.points.length - 1, k + 1)];
  const f = pos - k;
  return { i: a.i + (b.i - a.i) * f + 0.5, j: a.j + (b.j - a.j) * f + 0.5, di: b.i - a.i, dj: b.j - a.j };
}

/** Alles, was in der Stadt zu den Heimwegen gehört: geparkte Autos, fahrende Autos, Fußgänger. */
export function townSprites(now: number): TownSprite[] {
  const out: TownSprite[] = [];
  for (const c of commuters.values()) {
    const parked = (spot: TownTile | null) => {
      if (!spot) return;
      out.push({ depth: spot.i + spot.j + 1.5, draw: (ctx, project) => {
        // Das Auto steht am Straßenrand: mit der Seite am Gehweg, nicht auf ihm.
        const [x, y] = project(spot.i + 0.5, spot.j + 1.1);
        drawCar(ctx, x, y, true, carColor(c.look), false);
      } });
    };
    const moving = c.phase === 'leaving' || c.phase === 'coming';
    const leg = moving ? c.legs[c.leg] : null;
    const driving = leg?.kind === 'drive';
    if (c.mode === 'car') {
      // Das Auto steht vor dem Büro, solange die Fahrt nicht begonnen hat oder schon vorbei ist, sonst vor dem Haus.
      const atWork = c.phase === 'work' || c.phase === 'exiting' || c.phase === 'entering' || (c.phase === 'leaving' && c.leg === 0) || (c.phase === 'coming' && c.leg > 1);
      const atHome = c.phase === 'home' || (c.phase === 'leaving' && c.leg > 1) || (c.phase === 'coming' && c.leg === 0);
      if (atWork) parked(c.workSpot);
      if (atHome) parked(c.homeSpot);
    }
    if (!leg) continue;
    const p = pointAt(leg, (now - c.legStart) / 1000);
    if (driving) {
      out.push({ depth: p.i + p.j + 1, draw: (ctx, project) => {
        const [x, y] = project(p.i, p.j);
        drawCar(ctx, x, y, p.di !== 0 || p.dj === 0, carColor(c.look), true);
      } });
    } else {
      out.push({ depth: p.i + p.j, draw: (ctx, project, time) => {
        const [x, y] = project(p.i, p.j);
        const view = p.di < 0 || p.dj < 0 ? 'back' : 'front';
        const flip = Math.abs(p.di) > Math.abs(p.dj) ? p.di > 0 : p.dj < 0;
        const sprite = characterSprite(c.look, 'walk', Math.floor(time / 110) % 24, view, true);
        rect(ctx, Math.round(x) - 5, Math.round(y) - 1, 10, 2, 'rgba(10,16,28,.3)');
        ctx.save();
        if (flip) {
          ctx.translate(Math.round(x) * 2, 0);
          ctx.scale(-1, 1);
        }
        ctx.drawImage(sprite.canvas, Math.round(x) - sprite.ax, Math.round(y) - sprite.ay);
        ctx.restore();
      } });
    }
  }
  return out.sort((a, b) => a.depth - b.depth);
}
