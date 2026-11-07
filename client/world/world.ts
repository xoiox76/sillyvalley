// Die lebende Spielwelt. Zeichnet ausschließlich, was der Server-Stand vorgibt:
// Wohin eine Figur geht und was sie tut, leitet sich aus ihrem echten Zustand ab.

import { DEFAULT_CEO, LOCATIONS, isProp, locationById, staffOf, wallColor } from '../../shared/catalog.ts';
import { withoutEszett, show } from '../ui/html.ts';
import { noteEdge, noteLook } from '../../shared/board.ts';
import { quotaClosedUntil } from '../../shared/quota.ts';
import { drawTownBehind, drawTownInFront } from './town.ts';
import { siteAt, siteBase, storeyOf, buildingAt, checkShaft, floorOf, isShaft, itemsOnFloor, roomOf, shaftLanding } from '../../shared/building.ts';
import { noteTaker, wallNotes, type BoardNote } from '../../shared/board.ts';
import {
  MEETING_SIZE, blockedEdges, blockedSet, checkDepartment, checkPlacement, findPath, footprint, inBounds, meetingDoor, occupiedTiles, seatOf, standingTile,
  type Rect, type Seat, type Tile,
  wallSides, isEdgeKind, onBackWall, rectWalls,
} from '../../shared/layout.ts';
import { LOUNGE_SPOTS, ZONE_COLORS, roomSeats, zoneTiles } from '../../shared/zones.ts';
import type { Agent, Company, Department, FloorStyle, FurnitureKind, HelpRequest, PropKind, LiveKind, Meeting, PlacedItem, PlanStatus, Rotation, Shaft, ZoneKind } from '../../shared/types.ts';
import { arcadeSprite, beanbagSprite, edgeSprite, boardSprite, stairSprite, type StairMode, ROOM_HEIGHT, drawLiftDoors, drawLiftFrame, liftShell, type LiftFace, chairBack, chairBase, ceoTable, deskTable, drawScreen, furnitureSprite, glassSegment, meetingFloor, meetingTable, propSprite, type Sprite } from './art.ts';
import { characterSprite, type Pose, type View } from './characters.ts';
import { Pen, fillPoly, layer, line, rect, type Ctx, type Layer } from './pixel.ts';
import { buildRoom, waterPattern, type Room, WALL_H } from './room.ts';

const MOBILE_STATES: LiveKind[] = ['idle', 'done', 'stopped', 'handoff', 'meeting'];
const WORKING: LiveKind[] = ['starting', 'thinking', 'answering', 'reading', 'writing', 'searching', 'waiting'];
const WALK_SPEED = 2.4;
/** Sichtbare Höhe in Pixeln, damit ein Klick auf den oberen Teil das Möbelstück trifft. */
const ITEM_HEIGHT: Record<FurnitureKind, number> = { board: 40, window: 50, glass: 50, arcade: 42, beanbag: 15, wall: 50, door: 50, table: 24, desk: 30, shelf: 42, coffee: 28, plant: 22, meeting: 36, ceoDesk: 30, stairs: 40, lift: 46, bed: 24, toybox: 18, 'desk-kid': 26, workbench: 28, boxes: 26, tires: 16, lockers: 42, sofa: 22 };

const CEO_KEYS: Record<string, Tile> = {
  ArrowUp: { i: 0, j: -1 }, w: { i: 0, j: -1 }, W: { i: 0, j: -1 },
  ArrowDown: { i: 0, j: 1 }, s: { i: 0, j: 1 }, S: { i: 0, j: 1 },
  ArrowLeft: { i: -1, j: 0 }, a: { i: -1, j: 0 }, A: { i: -1, j: 0 },
  ArrowRight: { i: 1, j: 0 }, d: { i: 1, j: 0 }, D: { i: 1, j: 0 },
};

const MAX_DEVICE_SCALE = 16;
const WHEEL_STEP = 40;
const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export interface WallEdge {
  i: number;
  j: number;
  rot: Rotation;
}

export type Ghost =
  | { kind: FurnitureKind; id?: string; i: number; j: number; rot: Rotation; run?: WallEdge[] }
  /** Ein Abteilungsbereich beim Abstecken. */
  | { kind: 'zone'; id?: string; i: number; j: number; w: number; d: number }
  /** Das Raum-Werkzeug: vier Wände rund um ein Rechteck. */
  | { kind: 'roomwalls'; id?: undefined; i: number; j: number; w: number; d: number }
  /** Ein Raum aus Wänden, der benannt werden soll. tiles: die Felder als "i,j". ok: ob er ein eigener Raum ist. */
  | { kind: 'room'; id?: undefined; i: number; j: number; tiles: string[]; ok: boolean };

/** Was eine freie Figur gerade zum Zeitvertreib tut. Nur Kulisse, nie ein Agentenzustand. */
type Pause =
  | { kind: 'handy'; until: number }
  | { kind: 'plausch'; until: number; partnerId: string; speaks: boolean };

/** Ein Gang zur Tafel: Zettel anhängen oder abholen. Das Bild ändert sich erst, wenn die Figur davorsteht. */
interface BoardTrip {
  stick: BoardNote[];
  take: string[];
  since: number;
  arrived: number | null;
}

interface Actor {
  id: string;
  i: number;
  j: number;
  path: Tile[];
  view: View;
  flip: boolean;
  pose: Pose;
  goal: string;
  nextWander: number;
  atShelf: boolean;
  pause: Pause | null;
  lastScreen: { x: number; y: number };
  floor: number;
  /** Unterwegs über Treppe oder Fahrstuhl: Wohin es nach dem Etagenwechsel geht. */
  transit: { floor: number; target: Tile; landing: Tile; lift: LiftTrip | null; crossing?: boolean } | null;
  /** In der geschlossenen Kabine ist die Figur nicht zu sehen. */
  hidden: boolean;
  /** Feierabend: Die Figur ist heimgegangen und nicht zu sehen. */
  home: boolean;
}

type LiftPhase = 'walk' | 'press' | 'wait' | 'arrive' | 'open' | 'enter' | 'close' | 'ride' | 'openThere' | 'exit';

interface LiftTrip {
  shaft: Shaft;
  phase: LiftPhase;
  at: number;
}

/** Eine Kabine je Schacht. Sie fährt immer nur eine Person, die anderen warten vor der Tür. */
interface LiftState {
  cabin: number;
  moving: { from: number; to: number; at: number; ms: number } | null;
  rider: string | null;
  queue: string[];
  /** Offen je Etage: 0 zu, 1 auf. */
  doors: Map<number, { open: number; target: number }>;
}

/** Wie hoch die Mitte des Laptops über dem Boden liegt. */
const LAPTOP_Z = 22;
const LIFT_PRESS_MS = 500;
const LIFT_FLOOR_MS = 900;
const LIFT_STEP_MS = 650;
const LIFT_DOOR_PER_S = 2.2;

type Bubble = { icon: IconName; color: string };
type IconName = 'gear' | 'dots' | 'book' | 'globe' | 'clock' | 'hand' | 'check' | 'warn' | 'doc';

const ICONS: Record<IconName, string[]> = {
  gear: ['...#.#...', '.#.###.#.', '..#####..', '###...###', '.##...##.', '###...###', '..#####..', '.#.###.#.', '...#.#...'],
  dots: ['.........', '.........', '.........', '.........', '##.##.##.', '##.##.##.', '.........', '.........', '.........'],
  book: ['.........', '.###.###.', '#...#...#', '#.#.#.#.#', '#...#...#', '#.#.#.#.#', '#...#...#', '.###.###.', '.........'],
  globe: ['..#####..', '.#..#..#.', '#...#...#', '#########', '#...#...#', '#########', '#...#...#', '.#..#..#.', '..#####..'],
  clock: ['#########', '.#.....#.', '..#...#..', '...#.#...', '....#....', '...#.#...', '..#.#.#..', '.#.###.#.', '#########'],
  hand: ['..#.#.#..', '..#.#.#.#', '#.#.#.#.#', '#.#####.#', '#.#######', '.########', '..#######', '...#####.', '...#####.'],
  check: ['.........', '.......##', '......###', '.....###.', '##..###..', '#####....', '.####....', '..##.....', '.........'],
  doc: ['.#####...', '.#...##..', '.#.....#.', '.#.###.#.', '.#.....#.', '.#.###.#.', '.#.....#.', '.#.....#.', '.#######.'],
  warn: ['....#....', '....#....', '...###...', '...###...', '...###...', '....#....', '.........', '....#....', '....#....'],
};

function bubbleFor(kind: LiveKind): Bubble | null {
  switch (kind) {
    case 'starting':
    case 'thinking':
    case 'writing':
      return { icon: 'gear', color: '#1b2c46' };
    case 'answering':
      return { icon: 'dots', color: '#1b2c46' };
    case 'reading':
      return { icon: 'book', color: '#3f7fd0' };
    case 'searching':
      return { icon: 'globe', color: '#2fa58f' };
    case 'waiting':
      return { icon: 'clock', color: '#b98618' };
    case 'handoff':
      return { icon: 'doc', color: '#17705c' };
    case 'review':
      return { icon: 'hand', color: '#e4792b' };
    case 'done':
      return { icon: 'check', color: '#23a26b' };
    case 'limit':
    case 'error':
      return { icon: 'warn', color: '#d13c35' };
    default:
      return null;
  }
}


const isSeated = (actor: Actor) => (actor.goal.startsWith('seat:') || actor.goal.startsWith('tagung:')) && !actor.path.length && actor.pose !== 'walk';

export interface WorldCallbacks {
  /** Am Ende des Zooms soll es weiter hinaus gehen: aus dem Büro in die Stadt. */
  onZoomedOut?(): void;
  onAgentClick(agentId: string): void;
  onTileHover(tile: Tile | null): void;
  onTileClick(tile: Tile): void;
  /** Eine Wand sitzt auf einer Kante, deshalb meldet die Oberfläche die Kante. */
  onEdgeHover(edge: WallEdge | null): void;
  onEdgeClick(edge: WallEdge): void;
  onItemClick(item: PlacedItem): void;
  onMeetingClick(meetingId: string): void;
  onDepartmentClick(departmentId: string): void;
  onBoardClick(): void;
  /** Du hast die Tür erreicht. */
  onDoor(): void;
  /** Tastatur gehört gerade einem Fenster oder Eingabefeld. */
  keyboardBlocked(): boolean;
  /** Du sitzt am Chefplatz oder bist aufgestanden. */
  onCeoSeated(seated: boolean): void;
  /** Klick auf den Laptop, während du davor sitzt. */
  onLaptop(): void;
  /** Rechtsklick: dreht die Vorschau oder ein stehendes Möbelstück. */
  onRotate(item: PlacedItem | null): void;
}

export class World {
  private readonly canvas: HTMLCanvasElement;
  private readonly screen: CanvasRenderingContext2D;
  private readonly labels: HTMLDivElement;
  private readonly container: HTMLElement;
  private readonly callbacks: WorldCallbacks;
  private readonly water: Layer = waterPattern();
  private readonly rooms = new Map<string, Room>();
  private shownNotes = new Map<string, BoardNote>();
  private lifts = new Map<string, LiftState>();
  private quota: PlanStatus | null = null;
  private notesPrimed = false;
  private readonly trips = new Map<string, BoardTrip>();
  private readonly onCeoKeyDown: (e: KeyboardEvent) => void;
  private readonly onCeoKeyUp: (e: KeyboardEvent) => void;
  private readonly labelEls = new Map<string, HTMLDivElement>();
  private readonly roomLabels = new Map<string, HTMLDivElement>();
  private readonly zoneLabels = new Map<string, HTMLDivElement>();
  /** Namensschilder benannter Räume. */
  private readonly roomZoneLabels = new Map<string, HTMLDivElement>();
  private readonly actors = new Map<string, Actor>();
  private company: Company | null = null;
  private room: Room | null = null;
  private scale = 2;
  private lowW = 0;
  private lowH = 0;
  private offX = 0;
  private offY = 0;
  /** Zoom in ganzen Gerätepixeln über der passenden Größe: So bleibt die Pixelgrafik scharf. */
  private zoomSteps = 0;
  private panX = 0;
  private panY = 0;
  private wheelSum = 0;
  private drag: { x: number; y: number; moved: boolean } | null = null;
  private dragged = false;
  private ghost: Ghost | null = null;
  private selected: string | null = null;
  private raf = 0;
  private lastTime = 0;
  /** Draußen in der Stadt muss das Büro nicht gezeichnet werden. */
  private active = true;
  private viewFloor = 0;
  /** Du selbst. Die Figur steht immer auf der Etage, die du gerade siehst. */
  private ceo = { i: 0, j: 0, path: [] as Tile[], view: 'front' as View, flip: false, walking: false, key: null as Tile | null, placed: false, sitAt: null as string | null, seated: false };
  private ceoLeaving = false;
  private ceoLabel: HTMLDivElement | null = null;
  private ceoSeatedShown = false;
  /** Die Etage, für die gerade gerechnet wird: die sichtbare oder die der Figur, die gerade dran ist. */
  private ctxFloor = 0;
  private blockedByFloor = new Map<number, Set<string>>();
  private edgesByFloor = new Map<number, Set<string>>();

  constructor(container: HTMLElement, callbacks: WorldCallbacks) {
    this.container = container;
    this.callbacks = callbacks;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'world-canvas';
    this.canvas.setAttribute('role', 'img');
    this.canvas.setAttribute('aria-label', show('Dein Büro'));
    this.screen = this.canvas.getContext('2d')!;
    this.labels = document.createElement('div');
    this.labels.className = 'world-labels';
    container.append(this.canvas, this.labels);
    new ResizeObserver(() => this.resize()).observe(container);
    this.canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    this.onCeoKeyDown = (e) => {
      const step = CEO_KEYS[e.key];
      if (!step || !this.active || this.callbacks.keyboardBlocked()) return;
      e.preventDefault();
      if (e.repeat) return;
      this.ceo.key = step;
      // Der erste Schritt steht sofort fest, damit auch ein kurzes Antippen zählt.
      this.ceoStep();
    };
    this.onCeoKeyUp = (e) => {
      if (CEO_KEYS[e.key]) this.ceo.key = null;
    };
    window.addEventListener('keydown', this.onCeoKeyDown);
    window.addEventListener('keyup', this.onCeoKeyUp);
    this.canvas.addEventListener('pointerdown', (e) => {
      if (e.button === 0) this.drag = { x: e.clientX, y: e.clientY, moved: false };
    });
    this.canvas.addEventListener('pointerup', () => {
      this.dragged = Boolean(this.drag?.moved);
      this.drag = null;
    });
    this.canvas.addEventListener('pointermove', (e) => this.onMove(e));
    this.canvas.addEventListener('pointerleave', () => this.callbacks.onTileHover(null));
    this.canvas.addEventListener('click', (e) => this.onClick(e));
    this.canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (this.ghost) {
        this.callbacks.onRotate(null);
        return;
      }
      const { x, y } = this.low(e);
      const item = this.itemAt(x, y);
      if (item) this.callbacks.onRotate(item);
    });
    this.resize();
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  destroy(): void {
    window.removeEventListener('keydown', this.onCeoKeyDown);
    window.removeEventListener('keyup', this.onCeoKeyUp);
    cancelAnimationFrame(this.raf);
    this.container.replaceChildren();
  }

  setActive(active: boolean): void {
    this.active = active;
  }

  /** Wie bei einem Bauspiel üblich: Gezogene Wände lassen sich herunterschalten, damit man in die Räume sieht. */
  private wallsLow = false;

  setWallsLow(low: boolean): void {
    this.wallsLow = low;
  }

  setGhost(ghost: Ghost | null): void {
    this.ghost = ghost;
  }

  setSelected(agentId: string | null): void {
    this.selected = agentId;
  }

  private get blocked(): Set<string> {
    return this.blockedByFloor.get(this.ctxFloor) ?? new Set();
  }

  private get edges(): Set<string> {
    return this.edgesByFloor.get(this.ctxFloor) ?? new Set();
  }

  /** Rechnet etwas für eine bestimmte Etage. */
  private onFloor<T>(floor: number, compute: () => T): T {
    const before = this.ctxFloor;
    this.ctxFloor = floor;
    const result = compute();
    this.ctxFloor = before;
    return result;
  }

  setFloor(floor: number): void {
    this.viewFloor = floor;
    this.ctxFloor = floor;
    this.useRoom();
    this.placeCeo();
  }

  /** Ein zufälliges freies Feld in einer Zone dieser Art auf einer Etage. */
  private freeTileIn(kind: ZoneKind, floor: number): Tile | null {
    const company = this.company;
    if (!company) return null;
    const zone = (company.zones ?? []).find((z) => z.kind === kind && floorOf(z) === floor);
    if (!zone) return null;
    const blocked = blockedSet(roomOf(company, floor), itemsOnFloor(company.placed, floor));
    const free = [...zoneTiles(company, zone)].filter((k) => !blocked.has(k));
    if (!free.length) return null;
    const [i, j] = free[Math.floor(Math.random() * free.length)].split(',').map(Number);
    return { i, j };
  }

  /** Du kommst durch die Tür oder, oben, über den Aufgang. Gibt es ein Chefbüro, beginnst du dort. */
  placeCeo(): void {
    const loc = roomOf(this.company!, this.viewFloor);
    const office = this.freeTileIn('ceo', this.viewFloor);
    this.ceo.i = (office ?? loc.door).i + 0.5;
    this.ceo.j = (office ?? loc.door).j + 0.5;
    this.ceo.path = [];
    this.ceo.key = null;
    this.ceo.placed = true;
    this.ceo.sitAt = null;
    this.ceo.seated = false;
  }

  private ceoTile(): Tile {
    return { i: Math.floor(this.ceo.i), j: Math.floor(this.ceo.j) };
  }

  /** Der nächste Schritt mit der Tastatur. Durch Möbel und Glaswände geht es nicht. */
  private ceoStep(): void {
    const step = this.ceo.key;
    if (!step || !this.company) return;
    this.ceo.sitAt = null;
    this.ceo.seated = false;
    const from = this.ceo.path[0] ?? this.ceoTile();
    const next = { i: from.i + step.i, j: from.j + step.j };
    const open = inBounds(this.location(), next) && !this.blocked.has(`${next.i},${next.j}`) && !this.edges.has(`${from.i},${from.j}>${next.i},${next.j}`);
    this.ceo.path = open ? [...this.ceo.path.slice(0, 1), next] : this.ceo.path.slice(0, 1);
    this.ceo.view = step.i < 0 || step.j < 0 ? 'back' : 'front';
    this.ceo.flip = Math.abs(step.i) > Math.abs(step.j) ? step.i > 0 : step.j < 0;
  }

  private walkCeo(target: Tile | null): void {
    if (!target) return;
    this.ceo.key = null;
    this.ceo.sitAt = null;
    this.ceo.seated = false;
    this.ceoLeaving = false;
    this.ceo.path = findPath(this.location(), this.blocked, this.ceoTile(), target, this.edges);
  }

  private moveCeo(dt: number): void {
    const { ceo } = this;
    let left = WALK_SPEED * 1.4 * dt;
    ceo.walking = false;
    while (left > 0 && ceo.path.length) {
      const next = ceo.path[0];
      const dx = next.i + 0.5 - ceo.i;
      const dy = next.j + 0.5 - ceo.j;
      const dist = Math.hypot(dx, dy);
      ceo.walking = true;
      if (dist > 0.01) {
        ceo.view = dx < -0.01 || dy < -0.01 ? 'back' : 'front';
        ceo.flip = Math.abs(dx) > Math.abs(dy) ? dx > 0 : dy < 0;
      }
      if (dist <= left) {
        ceo.i = next.i + 0.5;
        ceo.j = next.j + 0.5;
        ceo.path.shift();
        left -= dist;
        if (!ceo.path.length && ceo.key) this.ceoStep();
        if (!ceo.path.length && this.ceoLeaving) {
          this.ceoLeaving = false;
          this.callbacks.onDoor();
          return;
        }
      } else {
        ceo.i += (dx / dist) * left;
        ceo.j += (dy / dist) * left;
        left = 0;
      }
    }
    // Angekommen am Chefplatz: hinsetzen.
    if (!ceo.path.length && ceo.sitAt) {
      const desk = itemsOnFloor(this.company!.placed, this.viewFloor).find((p) => p.id === ceo.sitAt);
      if (!desk) {
        ceo.sitAt = null;
        ceo.seated = false;
      } else {
        const seat = seatOf(desk);
        const dx = seat.i - ceo.i;
        const dy = seat.j - ceo.j;
        const dist = Math.hypot(dx, dy);
        const reach = WALK_SPEED * 1.4 * dt;
        if (dist > reach) {
          ceo.i += (dx / dist) * reach;
          ceo.j += (dy / dist) * reach;
          ceo.walking = true;
        } else {
          ceo.i = seat.i;
          ceo.j = seat.j;
          ceo.seated = true;
          ceo.view = seat.facing === 'sw' || seat.facing === 'se' ? 'front' : 'back';
          ceo.flip = seat.facing === 'se' || seat.facing === 'ne';
        }
      }
    }
    if (ceo.seated !== this.ceoSeatedShown) {
      this.ceoSeatedShown = ceo.seated;
      this.callbacks.onCeoSeated(ceo.seated);
    }
    // Beim Zoomen darf die eigene Figur nicht aus dem Bild laufen.
    if (ceo.walking && this.room) {
      const [x, y] = this.room.pen.pt(ceo.i, ceo.j);
      const sx = x + this.offX;
      const sy = y + this.offY;
      const margin = 40;
      const pushX = sx < margin ? margin - sx : sx > this.lowW - margin ? this.lowW - margin - sx : 0;
      const pushY = sy < margin ? margin - sy : sy > this.lowH - margin / 2 ? this.lowH - margin / 2 - sy : 0;
      if (pushX || pushY) {
        this.panX += pushX;
        this.panY += pushY;
        this.applyPan();
      }
    }
  }

  private drawCeo(ctx: Ctx, pen: Pen, time: number, items: { depth: number; draw: () => void }[]): void {
    const { ceo } = this;
    const look = this.company!.ceo?.look ?? DEFAULT_CEO.look;
    items.push({
      depth: ceo.i + ceo.j,
      draw: () => {
        const [sx, sy] = pen.pt(ceo.i, ceo.j);
        if (!ceo.seated) rect(ctx, sx - 5, sy - 1, 10, 2, 'rgba(10,16,28,.28)');
        const frame = ceo.walking ? Math.floor(time / 110) : REDUCED_MOTION ? 0 : Math.floor(time / 520);
        const lift = ceo.seated ? 9 : 0;
        const sprite = characterSprite(look, ceo.seated ? 'type' : ceo.walking ? 'walk' : 'stand', frame % 24, ceo.view, !ceo.seated);
        ctx.save();
        if (ceo.flip) {
          ctx.translate(sx * 2, 0);
          ctx.scale(-1, 1);
        }
        ctx.drawImage(sprite.canvas, sx - sprite.ax, sy - lift - sprite.ay);
        ctx.restore();
        if (!this.ceoLabel) {
          this.ceoLabel = document.createElement('div');
          this.ceoLabel.className = 'agent-label ceo-label';
          this.ceoLabel.style.pointerEvents = 'none';
          this.ceoLabel.append(document.createElement('strong'));
          this.labels.append(this.ceoLabel);
        }
        const text = withoutEszett(this.company!.ceo?.name ?? DEFAULT_CEO.name);
        const strong = this.ceoLabel.firstElementChild as HTMLElement;
        if (strong.textContent !== text) strong.textContent = text;
        this.ceoLabel.style.transform = `translate(calc(${Math.round(sx * this.scale)}px - 50%), calc(${Math.round((sy - 33 - lift) * this.scale)}px - 100%))`;
      },
    });
  }

  private useRoom(): void {
    const loc = roomOf(this.company!, this.viewFloor);
    const floors = buildingAt(this.company!.town, siteAt(this.company!, this.viewFloor).siteId).floors;
    const key = `${loc.id}:${loc.w}x${loc.d}:${storeyOf(this.viewFloor)}/${floors}`;
    if (!this.rooms.has(key)) this.rooms.set(key, buildRoom(loc, storeyOf(this.viewFloor), true, floors));
    const next = this.rooms.get(key)!;
    const resized = this.room && (this.room.width !== next.width || this.room.height !== next.height);
    this.room = next;
    if (resized) this.resize();
  }

  setCompany(company: Company): void {
    const moved = this.company?.locationId !== company.locationId;
    this.company = company;
    if (moved) this.setFloorState(0);
    this.useRoom();
    if (moved || !this.ceo.placed) this.placeCeo();
    this.blockedByFloor.clear();
    this.edgesByFloor.clear();
    const floors = new Set([0, this.viewFloor, ...company.placed.map(floorOf)]);
    for (const floor of floors) {
      const items = itemsOnFloor(company.placed, floor);
      this.blockedByFloor.set(floor, blockedSet(roomOf(company, floor), items));
      this.edgesByFloor.set(floor, blockedEdges(items));
    }
    if (moved) {
      this.actors.clear();
      this.panX = 0;
      this.panY = 0;
      this.resize();
    }
    const known = new Set(staffOf(company).map((a) => a.id));
    for (const id of [...this.actors.keys()]) {
      if (!known.has(id)) {
        this.actors.delete(id);
        this.labelEls.get(id)?.remove();
        this.labelEls.delete(id);
      }
    }
    for (const agent of staffOf(company)) if (!this.actors.has(agent.id)) this.actors.set(agent.id, this.newActor(agent));
    this.syncNotes(company, moved);
  }

  /** Vergleicht die Tafel mit dem Stand: Neue Zettel bringt, wer sie geschrieben hat. Vergebene holt, wer daran arbeitet. */
  private syncNotes(company: Company, moved: boolean): void {
    const notes = wallNotes(company);
    if (!this.notesPrimed || moved) {
      this.notesPrimed = true;
      this.trips.clear();
      this.shownNotes = new Map(notes.map((n) => [n.id, n]));
      return;
    }
    const pending = new Set([...this.trips.values()].flatMap((t) => [...t.stick.map((n) => n.id), ...t.take]));
    const tripOf = (id: string) => {
      let trip = this.trips.get(id);
      if (!trip) {
        trip = { stick: [], take: [], since: performance.now(), arrived: null };
        this.trips.set(id, trip);
      }
      return trip;
    };
    for (const note of notes) {
      if (this.shownNotes.has(note.id) || pending.has(note.id)) continue;
      // Einen eigenen Zettel hängt niemand hin: Er ist sofort da.
      if (note.byAgentId && this.active && this.actors.has(note.byAgentId) && this.boardSpot()) tripOf(note.byAgentId).stick.push(note);
      else this.shownNotes.set(note.id, note);
    }
    const open = new Set(notes.map((n) => n.id));
    for (const id of [...this.shownNotes.keys()]) {
      if (open.has(id) || pending.has(id)) continue;
      const taker = noteTaker(company, id);
      if (taker && this.active && this.actors.has(taker) && this.boardSpot()) tripOf(taker).take.push(id);
      else this.shownNotes.delete(id);
    }
  }

  /** Das nächste freie Feld vor der Mitte der Tafel. */
  private boardSpot(): Tile | null {
    if (!this.room) return null;
    const loc = this.location();
    const b = this.room.board;
    const center = Math.floor((b.u + b.w / 2) / 16);
    for (let j = 0; j < loc.d; j++) {
      for (const di of [0, 1, -1, 2, -2, 3, -3]) {
        const t = { i: center + di, j };
        if (inBounds(loc, t) && !this.blocked.has(`${t.i},${t.j}`)) return t;
      }
    }
    return null;
  }

  private finishTrip(actor: Actor, trip: BoardTrip): void {
    for (const note of trip.stick) this.shownNotes.set(note.id, note);
    for (const id of trip.take) this.shownNotes.delete(id);
    this.trips.delete(actor.id);
    actor.goal = '';
  }

  private setFloorState(floor: number): void {
    this.viewFloor = floor;
    this.ctxFloor = floor;
  }

  private location() {
    return roomOf(this.company!, this.ctxFloor);
  }

  private deskOf(agent: Agent): PlacedItem | null {
    return this.company!.placed.find((p) => p.id === agent.deskId) ?? null;
  }

  /** Beim Laden einer laufenden Firma steht die Figur sofort dort, wo sie hingehört. Neu Eingestellte kommen durch die Tür. */
  private newActor(agent: Agent): Actor {
    const loc = this.onFloor(0, () => this.location());
    const desk = this.deskOf(agent);
    const fresh = Date.now() - agent.hiredAt < 4000;
    let i = loc.door.i + 0.5;
    let j = loc.door.j + 0.5;
    let floor = 0;
    // Wer neu ist, kommt in der Lobby an, wenn es eine gibt.
    const lobby = fresh ? this.freeTileIn('lobby', 0) : null;
    if (lobby) {
      i = lobby.i + 0.5;
      j = lobby.j + 0.5;
    }
    const inMeeting = fresh ? null : this.meetingSeat(agent);
    if (inMeeting) {
      i = inMeeting.i;
      j = inMeeting.j;
      floor = this.meetingFloor(agent);
    } else if (!fresh && desk && !MOBILE_STATES.includes(agent.live.kind)) {
      const seat = seatOf(desk);
      i = seat.i;
      j = seat.j;
      floor = floorOf(desk);
    } else if (!fresh && desk) {
      const seat = seatOf(desk);
      i = seat.tile.i + 0.5;
      j = seat.tile.j + 0.5;
      floor = floorOf(desk);
    }
    return { floor, transit: null, hidden: false, home: false, id: agent.id, i, j, path: [], view: 'front', flip: false, pose: 'stand', goal: '', nextWander: performance.now() + 2500 + Math.random() * 6000, atShelf: false, pause: null, lastScreen: { x: 0, y: 0 } };
  }

  private resize(): void {
    const rect = this.container.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const roomW = this.room?.width ?? 300;
    const roomH = this.room?.height ?? 240;
    // Skaliert in ganzen Gerätepixeln: So bleibt die Pixelgrafik auch bei Zwischengrößen scharf.
    const dpr = window.devicePixelRatio || 1;
    const fit = Math.min(rect.width / (roomW - 60), rect.height / (roomH - 10));
    const fitted = Math.max(1, Math.floor(fit * dpr));
    this.zoomSteps = Math.max(1 - fitted, Math.min(MAX_DEVICE_SCALE - fitted, this.zoomSteps));
    this.scale = (fitted + this.zoomSteps) / dpr;
    this.lowW = Math.ceil(rect.width / this.scale);
    this.lowH = Math.ceil(rect.height / this.scale);
    // Eine neue Grösse leert die Zeichenfläche. Darum nur wenn nötig, und danach sofort neu zeichnen.
    const changed = this.canvas.width !== this.lowW || this.canvas.height !== this.lowH;
    if (changed) {
      this.canvas.width = this.lowW;
      this.canvas.height = this.lowH;
      this.canvas.style.width = `${this.lowW * this.scale}px`;
      this.canvas.style.height = `${this.lowH * this.scale}px`;
      this.screen.imageSmoothingEnabled = false;
    }
    this.applyPan();
    if (changed && this.company && this.room && this.lowW) this.draw(this.lastTime, 0);
  }

  /** Verschiebt nur die Ansicht. Die Zeichenfläche bleibt, sonst flackert es beim Ziehen. */
  private applyPan(): void {
    const roomW = this.room?.width ?? 300;
    const roomH = this.room?.height ?? 240;
    // Das Büro bleibt immer teilweise im Bild, auch wenn man weit zieht.
    const limitX = Math.max(0, (roomW - this.lowW) / 2) + this.lowW * 0.35;
    const limitY = Math.max(0, (roomH - this.lowH) / 2) + this.lowH * 0.35;
    this.panX = Math.max(-limitX, Math.min(limitX, this.panX));
    this.panY = Math.max(-limitY, Math.min(limitY, this.panY));
    this.offX = Math.floor((this.lowW - roomW) / 2 + this.panX);
    this.offY = Math.floor((this.lowH - roomH) / 2 + this.panY);
  }

  /** Stufenweise zoomen. Der Punkt unter der Maus bleibt dabei, wo er ist. */
  zoomBy(steps: number, at?: { x: number; y: number }): void {
    if (steps < 0 && this.scale * (window.devicePixelRatio || 1) <= 1) {
      this.callbacks.onZoomedOut?.();
      return;
    }
    const box = this.container.getBoundingClientRect();
    const sx = at ? at.x - box.left : box.width / 2;
    const sy = at ? at.y - box.top : box.height / 2;
    const roomX = sx / this.scale - this.offX;
    const roomY = sy / this.scale - this.offY;
    this.zoomSteps += steps;
    this.resize();
    this.panX += sx / this.scale - roomX - this.offX;
    this.panY += sy / this.scale - roomY - this.offY;
    this.applyPan();
  }

  resetView(): void {
    this.zoomSteps = 0;
    this.panX = 0;
    this.panY = 0;
    this.resize();
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    this.wheelSum += e.deltaY;
    // Ein Trackpad meldet viele kleine Schritte, ein Mausrad wenige große.
    if (Math.abs(this.wheelSum) < WHEEL_STEP) return;
    const steps = this.wheelSum < 0 ? 1 : -1;
    this.wheelSum = 0;
    this.zoomBy(steps, { x: e.clientX, y: e.clientY });
  }

  private low(e: PointerEvent | MouseEvent): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) / this.scale, y: (e.clientY - r.top) / this.scale };
  }

  /** Die Wandkante, die der Maus am nächsten liegt. Nur innerhalb des Raums. */
  private edgeAt(x: number, y: number): WallEdge | null {
    if (!this.room) return null;
    const [ox, oy] = this.room.pen.pt(0, 0);
    const dx = x - this.offX - ox;
    const dy = y - this.offY - oy;
    const fi = (dx / 16 + dy / 8) / 2;
    const fj = (dy / 8 - dx / 16) / 2;
    const li = Math.round(fi);
    const lj = Math.round(fj);
    // Die Linie, die näher liegt, gewinnt. Liegt die Maus auf einer Linie längs i, ist es eine Kante rot 0.
    const edge: WallEdge = Math.abs(fj - lj) <= Math.abs(fi - li) ? { i: Math.floor(fi), j: lj, rot: 0 } : { i: li, j: Math.floor(fj), rot: 1 };
    const loc = this.location();
    const [a, b] = wallSides(edge);
    const inside = (t: Tile) => t.i >= 0 && t.j >= 0 && t.i < loc.w && t.j < loc.d;
    if (inside(a) && inside(b)) return edge;
    // Fenster gehen auch in die hinteren Außenwände.
    const kind = this.ghost?.kind ?? '';
    return onBackWall(loc, { kind: kind as FurnitureKind, ...edge }) ? edge : null;
  }

  /**
   * Eine Wand unter der Maus. Die Maus zeigt irgendwo auf den Körper der Wand, deshalb wird die Kante
   * für mehrere Höhen zurückgerechnet, vom Fuß bis fast oben.
   */
  private wallAt(x: number, y: number): PlacedItem | null {
    if (!this.room) return null;
    const placed = itemsOnFloor(this.company?.placed ?? [], this.viewFloor).filter((p) => isEdgeKind(p.kind));
    if (!placed.length) return null;
    const [ox, oy] = this.room.pen.pt(0, 0);
    const dx = x - this.offX - ox;
    for (const h of [0, 10, 20, 30, 40]) {
      const dy = y - this.offY - oy + h;
      const fi = (dx / 16 + dy / 8) / 2;
      const fj = (dy / 8 - dx / 16) / 2;
      const li = Math.round(fi);
      const lj = Math.round(fj);
      if (Math.abs(fj - lj) < 0.3) {
        const hit = placed.find((p) => p.rot === 0 && p.j === lj && p.i === Math.floor(fi));
        if (hit) return hit;
      }
      if (Math.abs(fi - li) < 0.3) {
        const hit = placed.find((p) => p.rot === 1 && p.i === li && p.j === Math.floor(fj));
        if (hit) return hit;
      }
    }
    return null;
  }

  private tileAt(x: number, y: number): Tile | null {
    if (!this.room) return null;
    const [ox, oy] = this.room.pen.pt(0, 0);
    const dx = x - this.offX - ox;
    const dy = y - this.offY - oy;
    const i = Math.floor((dx / 16 + dy / 8) / 2);
    const j = Math.floor((dy / 8 - dx / 16) / 2);
    const loc = this.location();
    return i >= 0 && j >= 0 && i < loc.w && j < loc.d ? { i, j } : null;
  }

  /** Das Möbelstück unter dem Zeiger. Ein Regal ist hoch: Getroffen wird das ganze Bild, nicht nur sein Bodenfeld. */
  private boardAt(x: number, y: number): boolean {
    if (!this.room || storeyOf(this.viewFloor) > 0) return false;
    const b = this.room.board;
    const [ox, oy] = this.room.pen.pt(0, 0);
    const u = x - this.offX - ox;
    if (u < b.u || u >= b.u + b.w) return false;
    const up = oy + this.offY + Math.floor(u / 2) - y;
    return up >= b.v && up < b.v + b.h;
  }

  /** Die Türen hängen an der Wand, deshalb zählt hier die Stelle im Bild, nicht das Feld. */
  private doorAt(x: number, y: number): boolean {
    if (!this.room || storeyOf(this.viewFloor) > 0) return false;
    const { pen } = this.room;
    return this.room.doors.some((door) => {
      const [ox, oy] = pen.pt(0, door.j);
      const u = door.face === 'J' ? x - this.offX - ox : this.offX + ox - x;
      if (u < door.u || u >= door.u + door.w) return false;
      const up = oy + this.offY + Math.floor(u / 2) - y;
      return up >= 0 && up < door.h;
    });
  }

  private itemAt(x: number, y: number): PlacedItem | null {
    // Von unten nach oben abgesucht: Was auf dem Bildschirm tiefer steht, steht weiter vorn und verdeckt den Rest.
    for (let z = 0; z <= 42; z += 4) {
      const tile = this.tileAt(x, y + z);
      if (!tile) continue;
      const item = itemsOnFloor(this.company?.placed ?? [], this.viewFloor).find((p) => {
        if (isEdgeKind(p.kind)) return false;
        const size = footprint(p.kind, p.rot);
        return z <= ITEM_HEIGHT[p.kind] && tile.i >= p.i && tile.j >= p.j && tile.i < p.i + size.w && tile.j < p.j + size.d;
      });
      if (item) return item;
    }
    return null;
  }

  /** Welche Figur an dieser Bildschirmstelle steht. Für das Ziehen eines Zettels. */
  agentAtPoint(clientX: number, clientY: number): string | null {
    const box = this.canvas.getBoundingClientRect();
    return this.actorAt((clientX - box.left) / this.scale, (clientY - box.top) / this.scale);
  }

  /** Beim Ziehen zeigt die Beschriftung, wer den Zettel bekäme. */
  setDropTarget(agentId: string | null): void {
    for (const [id, el] of this.labelEls) el.classList.toggle('agent-label-drop', id === agentId);
  }

  private actorAt(x: number, y: number): string | null {
    let best: { id: string; depth: number } | null = null;
    for (const actor of this.actors.values()) {
      if (actor.floor !== this.viewFloor) continue;
      const { x: sx, y: sy } = actor.lastScreen;
      if (x >= sx - 10 && x <= sx + 10 && y >= sy - 30 && y <= sy + 2) {
        const depth = actor.i + actor.j;
        if (!best || depth > best.depth) best = { id: actor.id, depth };
      }
    }
    return best?.id ?? null;
  }

  /** Der Laptop auf dem Chefplatz. Er reagiert erst, wenn du dort sitzt. */
  private laptopAt(x: number, y: number): boolean {
    const { ceo, room } = this;
    if (!ceo.seated || !ceo.sitAt || !room) return false;
    const item = this.company?.placed.find((p) => p.id === ceo.sitAt);
    if (!item) return false;
    const across = 1;
    const along = (item.rot < 2 ? 1.04 : 0.04) + 0.44;
    const i = item.i + (item.rot % 2 ? along : across);
    const j = item.j + (item.rot % 2 ? across : along);
    const sx = room.pen.ox + this.offX + (i - j) * 16;
    const sy = room.pen.oy + this.offY + (i + j) * 8 - LAPTOP_Z;
    return Math.abs(x - sx) <= 14 && Math.abs(y - sy) <= 11;
  }

  private onMove(e: PointerEvent): void {
    if (this.drag) {
      const dx = e.clientX - this.drag.x;
      const dy = e.clientY - this.drag.y;
      if (this.drag.moved || Math.hypot(dx, dy) > 4) {
        this.drag.moved = true;
        this.drag.x = e.clientX;
        this.drag.y = e.clientY;
        this.panX += dx / this.scale;
        this.panY += dy / this.scale;
        this.applyPan();
        this.canvas.style.cursor = 'grabbing';
        return;
      }
    }
    const { x, y } = this.low(e);
    if (this.ghost && isEdgeKind(this.ghost.kind)) this.callbacks.onEdgeHover(this.edgeAt(x, y));
    else this.callbacks.onTileHover(this.tileAt(x, y));
    this.canvas.style.cursor = this.ghost ? 'crosshair' : this.actorAt(x, y) || this.laptopAt(x, y) || this.doorAt(x, y) ? 'pointer' : 'default';
  }

  private onClick(e: MouseEvent): void {
    // Das Ende eines Ziehens ist kein Klick.
    if (this.dragged) {
      this.dragged = false;
      return;
    }
    const { x, y } = this.low(e);
    if (this.ghost) {
      if (isEdgeKind(this.ghost.kind)) {
        const edge = this.edgeAt(x, y);
        if (edge) this.callbacks.onEdgeClick(edge);
        return;
      }
      const tile = this.tileAt(x, y);
      if (tile) this.callbacks.onTileClick(tile);
      return;
    }
    if (this.laptopAt(x, y)) {
      this.callbacks.onLaptop();
      return;
    }
    const actor = this.actorAt(x, y);
    if (actor) {
      // Du gehst zu der Person hin.
      const other = this.actors.get(actor);
      if (other) this.walkCeo(this.besideActor(other));
      this.callbacks.onAgentClick(actor);
      return;
    }
    if (this.boardAt(x, y)) {
      this.callbacks.onBoardClick();
      return;
    }
    if (this.doorAt(x, y)) {
      // Erst hingehen, dann hinaus. Eine Figur mit zugestelltem Weg steht nicht fest: Die Tür gilt trotzdem.
      const loc = this.location();
      this.walkCeo(loc.door);
      this.ceoLeaving = true;
      if (!this.ceo.path.length) {
        this.ceoLeaving = false;
        this.callbacks.onDoor();
      }
      return;
    }
    // Eine Wand liegt dünn auf dem Boden. Ist die Maus nah genug dran, gewinnt sie gegen das Möbel daneben.
    const item = this.wallAt(x, y) ?? this.itemAt(x, y);
    if (item) {
      if (isEdgeKind(item.kind)) {
        // Eine Wand wird wie ein Möbelstück gewählt. Entfernen geht über die Taste Entf.
        this.callbacks.onItemClick(item);
        return;
      }
      if (item.kind === 'ceoDesk' && this.ceo.seated && this.ceo.sitAt === item.id) {
        this.callbacks.onLaptop();
        return;
      }
      if (item.kind === 'ceoDesk') {
        // Dein Platz: hingehen und hinsetzen.
        this.walkCeo(seatOf(item).tile);
        this.ceo.sitAt = item.id;
      } else {
        this.walkCeo(standingTile(this.location(), this.blocked, item));
      }
      this.callbacks.onItemClick(item);
      return;
    }
    const tile = this.tileAt(x, y);
    if (tile) {
      if (!this.blocked.has(`${tile.i},${tile.j}`)) this.walkCeo(tile);
      const zone = this.company?.departments.find((d) => tile.i >= d.i && tile.j >= d.j && tile.i < d.i + d.w && tile.j < d.j + d.d);
      if (zone) this.callbacks.onDepartmentClick(zone.id);
    }
  }

  /* ---------- Verhalten: echte Zustände werden zu Wegen und Haltungen ---------- */

  /** Liegt das Ziel auf einer anderen Etage, geht es zuerst zur Treppe. */
  private goTo(actor: Actor, target: Tile, floor = actor.floor): void {
    const from = { i: Math.floor(actor.i), j: Math.floor(actor.j) };
    this.onFloor(actor.floor, () => {
      const loc = this.location();
      // Der nächste Aufgang gewinnt.
      const landing = [...(loc.keep ?? [])].sort((a, b) => Math.hypot(a.i - from.i, a.j - from.j) - Math.hypot(b.i - from.i, b.j - from.j))[0];
      // In ein anderes Haus geht es zur Haustür hinaus und dort zur Tür herein.
      if (floor !== actor.floor && siteBase(floor) !== siteBase(actor.floor)) {
        actor.transit = { floor, target, landing: loc.door, lift: null, crossing: true };
        actor.path = findPath(loc, this.blocked, from, loc.door, this.edges);
        return;
      }
      if (floor !== actor.floor && landing) {
        const shaft = buildingAt(this.company!.town, this.company!.town.siteId).shafts.find((s) => s.kind === 'lift' && s.landing.i === landing.i && s.landing.j === landing.j);
        actor.transit = { floor, target, landing, lift: shaft ? { shaft, phase: 'walk', at: 0 } : null };
        actor.path = findPath(loc, this.blocked, from, landing, this.edges);
        return;
      }
      if (floor !== actor.floor) {
        actor.floor = floor;
        actor.i = target.i + 0.5;
        actor.j = target.j + 0.5;
        actor.path = [];
        actor.transit = null;
        return;
      }
      actor.transit = null;
      actor.path = findPath(loc, this.blocked, from, target, this.edges);
    });
  }

  private liftOf(shaft: Shaft): LiftState {
    const key = `${shaft.i},${shaft.j}`;
    let lift = this.lifts.get(key);
    if (!lift) {
      lift = { cabin: 0, moving: null, rider: null, queue: [], doors: new Map() };
      this.lifts.set(key, lift);
    }
    return lift;
  }

  private liftDoor(lift: LiftState, floor: number): { open: number; target: number } {
    let door = lift.doors.get(floor);
    if (!door) {
      door = { open: 0, target: 0 };
      lift.doors.set(floor, door);
    }
    return door;
  }

  private sendCabin(lift: LiftState, floor: number, now: number): void {
    lift.moving = floor === lift.cabin ? null : { from: lift.cabin, to: floor, at: now, ms: Math.abs(floor - lift.cabin) * LIFT_FLOOR_MS };
  }

  /** Türen und Kabine laufen weiter, egal welche Etage gerade zu sehen ist. */
  private updateLifts(now: number, dt: number): void {
    for (const lift of this.lifts.values()) {
      if (lift.moving && now - lift.moving.at >= lift.moving.ms) {
        lift.cabin = lift.moving.to;
        lift.moving = null;
      }
      for (const door of lift.doors.values()) {
        const step = LIFT_DOOR_PER_S * dt;
        door.open = door.open < door.target ? Math.min(door.target, door.open + step) : Math.max(door.target, door.open - step);
      }
      // Wer entlassen wurde oder das Büro verlassen hat, blockiert die Kabine nicht.
      const riding = (id: string) => Boolean(this.actors.get(id)?.transit?.lift);
      if (lift.rider && !riding(lift.rider)) lift.rider = null;
      lift.queue = lift.queue.filter(riding);
    }
  }

  private liftSide(shaft: Shaft): LiftFace | null {
    if (shaft.landing.j > shaft.j) return 'j';
    if (shaft.landing.i > shaft.i) return 'i';
    return null;
  }

  /** Blick zur Tür oder von ihr weg. */
  private faceLift(actor: Actor, shaft: Shaft, toDoor: boolean): void {
    const dx = (shaft.i - shaft.landing.i) * (toDoor ? 1 : -1);
    const dy = (shaft.j - shaft.landing.j) * (toDoor ? 1 : -1);
    actor.view = dx < 0 || dy < 0 ? 'back' : 'front';
    actor.flip = Math.abs(dx) > Math.abs(dy) ? dx > 0 : dy < 0;
  }

  private liftInner(shaft: Shaft): { i: number; j: number } {
    return { i: shaft.i + 0.5 + (shaft.landing.i - shaft.i) * 0.12, j: shaft.j + 0.5 + (shaft.landing.j - shaft.j) * 0.12 };
  }

  /** Hingehen ist schon passiert: Knopf, warten, Tür, hinein, Tür, fahren, Tür, hinaus. */
  private liftStep(actor: Actor, trip: LiftTrip, now: number): void {
    const transit = actor.transit!;
    const lift = this.liftOf(trip.shaft);
    const door = this.liftDoor(lift, actor.floor);
    const landing = { i: trip.shaft.landing.i + 0.5, j: trip.shaft.landing.j + 0.5 };
    const inner = this.liftInner(trip.shaft);
    const visibleDoor = this.liftSide(trip.shaft) !== null;
    const next = (phase: LiftPhase) => {
      trip.phase = phase;
      trip.at = now;
    };
    const along = (from: { i: number; j: number }, to: { i: number; j: number }, t: number) => {
      actor.i = from.i + (to.i - from.i) * t;
      actor.j = from.j + (to.j - from.j) * t;
    };
    const t = Math.min(1, (now - trip.at) / LIFT_STEP_MS);
    actor.pose = trip.phase === 'enter' || trip.phase === 'exit' ? 'walk' : 'stand';
    switch (trip.phase) {
      case 'press':
        if (now - trip.at >= LIFT_PRESS_MS) {
          lift.queue.push(actor.id);
          next('wait');
        }
        break;
      case 'wait':
        if (!lift.rider && lift.queue[0] === actor.id) {
          lift.queue.shift();
          lift.rider = actor.id;
          this.sendCabin(lift, actor.floor, now);
          next('arrive');
        }
        break;
      case 'arrive':
        if (!lift.moving) {
          door.target = 1;
          next('open');
        }
        break;
      case 'open':
        if (door.open >= 1) next('enter');
        break;
      case 'enter':
        this.faceLift(actor, trip.shaft, true);
        // Geht die Tür nach hinten, verschwindet die Figur hinter dem Schacht.
        if (!visibleDoor) actor.hidden = true;
        along(landing, inner, t);
        if (t >= 1) {
          door.target = 0;
          next('close');
        }
        break;
      case 'close':
        if (door.open <= 0) {
          actor.hidden = true;
          actor.floor = transit.floor;
          this.ctxFloor = actor.floor;
          this.sendCabin(lift, transit.floor, now);
          next('ride');
        }
        break;
      case 'ride':
        if (!lift.moving) {
          this.liftDoor(lift, actor.floor).target = 1;
          if (visibleDoor) actor.hidden = false;
          next('openThere');
        }
        break;
      case 'openThere':
        if (door.open >= 1) next('exit');
        break;
      case 'exit':
        this.faceLift(actor, trip.shaft, false);
        along(inner, landing, t);
        if (t >= 1) {
          door.target = 0;
          actor.hidden = false;
          lift.rider = null;
          actor.transit = null;
          actor.pose = 'stand';
          this.goTo(actor, transit.target, transit.floor);
        }
        break;
    }
  }

  /** Einen Schritt weitergehen. true, solange die Figur unterwegs ist. */
  private stepWalk(actor: Actor, dt: number): boolean {
    if (actor.path.length) {
      const next = actor.path[0];
      const tx = next.i + 0.5;
      const ty = next.j + 0.5;
      const dx = tx - actor.i;
      const dy = ty - actor.j;
      const dist = Math.hypot(dx, dy);
      const step = WALK_SPEED * dt;
      if (dist <= step) {
        actor.i = tx;
        actor.j = ty;
        actor.path.shift();
      } else {
        actor.i += (dx / dist) * step;
        actor.j += (dy / dist) * step;
      }
      // +j läuft nach unten links, +i nach unten rechts
      actor.view = dx < -0.01 || dy < -0.01 ? 'back' : 'front';
      actor.flip = Math.abs(dx) > Math.abs(dy) ? dx > 0 : dy < 0;
      actor.pose = 'walk';
      return true;
    }
    return false;

  }

  /** Am Aufgang oder an der Haustür angekommen: Die Figur wechselt die Etage und geht dort weiter. */
  private arriveTransit(actor: Actor, now: number): boolean {
    // An der Treppe angekommen: Die Figur wechselt die Etage und geht dort weiter.
    if (actor.transit) {
      if (actor.transit.lift) {
        actor.transit.lift.phase = 'press';
        actor.transit.lift.at = now;
        this.faceLift(actor, actor.transit.lift.shaft, true);
        actor.pose = 'stand';
        return true;
      }
      const { floor, target, crossing } = actor.transit;
      const landing = crossing ? roomOf(this.company!, floor).door : actor.transit.landing;
      actor.transit = null;
      actor.floor = floor;
      this.ctxFloor = floor;
      actor.i = landing.i + 0.5;
      actor.j = landing.j + 0.5;
      this.goTo(actor, target, floor);
      return true;
    }
    return false;
  }

  /** Das Kontingent ist leer: Wer nicht gerade arbeitet, geht heim. true, solange das so ist. */
  private goesHome(actor: Actor, agent: Agent, now: number, dt: number): boolean {
    const closed = agent.providerId === 'anthropic' && quotaClosedUntil(this.quota, Date.now()) !== null && !agent.live.runId;
    if (!closed) {
      if (actor.home) {
        // Wieder da: Die Figur kommt durch die Haustür und geht an ihren Platz.
        actor.home = false;
        actor.hidden = false;
        const door = roomOf(this.company!, siteBase(actor.floor)).door;
        actor.i = door.i + 0.5;
        actor.j = door.j + 0.5;
        actor.goal = '';
        actor.path = [];
      }
      return false;
    }
    if (actor.home) return true;
    if (actor.pause) this.endPause(actor);
    const ground = siteBase(actor.floor);
    this.setGoal(actor, 'heim', this.onFloor(ground, () => this.location().door), ground);
    if (this.stepWalk(actor, dt) || this.arriveTransit(actor, now)) return true;
    actor.home = true;
    actor.hidden = true;
    actor.pose = 'stand';
    return true;
  }

  setQuota(plan: PlanStatus | null | undefined): void {
    this.quota = plan ?? null;
  }

  private meetingFloor(agent: Agent): number {
    const help = this.helpOf(agent);
    if (help?.roomId) return floorOf(this.company!.placed.find((p) => p.id === help.roomId) ?? {});
    const meeting = this.company!.meetings?.find((m) => m.status === 'running' && m.participantIds.includes(agent.id));
    return floorOf(this.company!.placed.find((p) => p.id === meeting?.roomId) ?? {});
  }

  private setGoal(actor: Actor, goal: string, target: Tile | null, floor = actor.floor): void {
    if (actor.goal === goal) return;
    actor.goal = goal;
    if (target) this.goTo(actor, target, floor);
  }

  /** Der Platz im Besprechungsraum. Wer gerade an etwas anderem arbeitet, kommt erst danach dazu. */
  /** Wer gerade einem Kollegen hilft oder von ihm Hilfe bekommt. Das folgt dem echten Lauf. */
  private helpOf(agent: Agent): HelpRequest | null {
    return this.company!.helps?.find((h) => h.status === 'running' && (h.fromId === agent.id || h.toId === agent.id)) ?? null;
  }

  private meetingSeat(agent: Agent): Seat | null {
    const company = this.company!;
    const help = this.helpOf(agent);
    if (help?.roomId) {
      const helpRoom = company.placed.find((p) => p.id === help.roomId);
      if (helpRoom) return roomSeats(helpRoom)[help.fromId === agent.id ? 0 : 1] ?? null;
    }
    const meeting = company.meetings?.find((m) => m.status === 'running' && m.participantIds.includes(agent.id));
    if (!meeting) return null;
    if (company.runs.some((r) => r.agentId === agent.id && r.status === 'running' && !r.meetingId)) return null;
    const room = company.placed.find((p) => p.id === meeting.roomId);
    return room ? (roomSeats(room)[meeting.participantIds.indexOf(agent.id)] ?? null) : null;
  }

  private behave(actor: Actor, agent: Agent, now: number, dt: number): void {
    // Wer den Knopf gedrückt hat, fährt zu Ende. Ein neues Ziel gilt ab der Tür oben.
    if (actor.transit?.lift && actor.transit.lift.phase !== 'walk') {
      this.liftStep(actor, actor.transit.lift, now);
      return;
    }
    if (this.goesHome(actor, agent, now, dt)) return;
    const desk = this.deskOf(agent);
    const seat: Seat | null = desk ? seatOf(desk) : null;
    const deskFloor = desk ? floorOf(desk) : actor.floor;
    const kind = agent.live.kind;
    const working = WORKING.includes(kind);
    const stuck = kind === 'error' || kind === 'limit';

    // Ein echter Zugriff aufs Firmenwissen schickt die Figur ans Regal, falls eines steht. Sie bleibt dort,
    // bis der Agent zu schreiben oder zu antworten beginnt. Den Plan einer Kollegin liest sie am Platz.
    const shelves = this.company!.placed.filter((p) => p.kind === 'shelf');
    const shelf = shelves.find((p) => floorOf(p) === actor.floor) ?? shelves[0];
    const shelfFloor = shelf ? floorOf(shelf) : actor.floor;
    const shelfSpot = shelf ? this.onFloor(shelfFloor, () => standingTile(this.location(), this.blocked, shelf)) : null;
    if (kind === 'reading' && shelfSpot && agent.live.detail.includes('wissen/')) actor.atShelf = true;
    else if (kind !== 'thinking' && kind !== 'reading') actor.atShelf = false;

    const meetingSeat = this.meetingSeat(agent);
    const trip = this.trips.get(actor.id);
    const spot = trip ? this.onFloor(0, () => this.boardSpot()) : null;
    // Reicht die Zeit nicht oder ist kein Weg frei, stimmt die Tafel trotzdem: Der Stand geht vor dem Bild.
    if (trip && (!spot || meetingSeat || now - trip.since > 15000)) this.finishTrip(actor, trip);
    if (!meetingSeat && actor.goal.startsWith('tagung:')) {
      // Die Besprechung ist vorbei: Niemand bleibt im Raum sitzen.
      actor.goal = '';
      actor.nextWander = now + 800 + Math.random() * 2500;
    }

    if (this.trips.has(actor.id) && spot) {
      if (actor.pause) this.endPause(actor);
      actor.atShelf = false;
      this.setGoal(actor, `tafel:${spot.i},${spot.j}`, spot, 0);
    } else if (meetingSeat) {
      actor.atShelf = false;
      const roomFloor = this.meetingFloor(agent);
      this.setGoal(actor, `tagung:${roomFloor}:${meetingSeat.tile.i},${meetingSeat.tile.j}`, meetingSeat.tile, roomFloor);
    } else if (this.helpOf(agent)?.fromId === agent.id && !this.helpOf(agent)!.roomId) {
      // Ohne freien Besprechungsraum geht der Fragende zum Platz des Kollegen.
      const helper = this.company!.agents.find((a) => a.id === this.helpOf(agent)!.toId);
      const helperDesk = helper ? this.deskOf(helper) : null;
      const helperFloor = helperDesk ? floorOf(helperDesk) : actor.floor;
      const besideHelper = helperDesk ? this.onFloor(helperFloor, () => this.besideDesk(helperDesk)) : null;
      if (besideHelper) this.setGoal(actor, `fragen:${helperFloor}:${besideHelper.i},${besideHelper.j}`, besideHelper, helperFloor);
    } else if (kind === 'handoff') {
      // Die Datei hat die Zuständigkeit gewechselt. Die Figur bringt sie zum Platz der nächsten Stufe.
      const target = this.company!.agents.find((a) => a.id === agent.live.targetId);
      const targetDesk = target ? this.deskOf(target) : null;
      const targetFloor = targetDesk ? floorOf(targetDesk) : actor.floor;
      const handoffSpot = targetDesk ? this.onFloor(targetFloor, () => this.besideDesk(targetDesk)) : null;
      if (handoffSpot) this.setGoal(actor, `bringen:${targetFloor}:${handoffSpot.i},${handoffSpot.j}`, handoffSpot, targetFloor);
    } else if (actor.atShelf && shelfSpot) {
      this.setGoal(actor, `regal:${shelfFloor}:${shelfSpot.i},${shelfSpot.j}`, shelfSpot, shelfFloor);
    } else if ((working || stuck) && seat) {
      this.setGoal(actor, `seat:${deskFloor}:${seat.tile.i},${seat.tile.j}`, seat.tile, deskFloor);
    } else if ((kind === 'review' || kind === 'done') && seat) {
      this.setGoal(actor, `stand:${deskFloor}:${seat.tile.i},${seat.tile.j}`, seat.tile, deskFloor);
    } else if ((kind === 'idle' || kind === 'stopped') && seat && actor.floor !== deskFloor) {
      // Wer frei hat, verbringt die Zeit auf der Etage des eigenen Platzes.
      if (actor.pause) this.endPause(actor);
      this.setGoal(actor, `stand:${deskFloor}:${seat.tile.i},${seat.tile.j}`, seat.tile, deskFloor);
    } else if (kind === 'idle' || kind === 'stopped') {
      if (actor.pause && now > actor.pause.until) this.endPause(actor);
      if (!actor.pause && now > actor.nextWander) {
        actor.nextWander = now + 5000 + Math.random() * 9000;
        actor.goal = '';
        this.pickPastime(actor, now);
      }
    }
    // Sobald ein echter Lauf beginnt oder jemand gebraucht wird, ist die Pause vorbei.
    if (kind !== 'idle' && kind !== 'stopped' && actor.pause) this.endPause(actor);

    if (this.stepWalk(actor, dt)) return;
    if (this.arriveTransit(actor, now)) return;

    // Angekommen
    const atBoard = this.trips.get(actor.id);
    if (atBoard) {
      atBoard.arrived ??= now;
      actor.view = 'back';
      actor.flip = false;
      actor.pose = 'stand';
      if (now - atBoard.arrived > 1100) this.finishTrip(actor, atBoard);
      return;
    }
    if (meetingSeat) {
      actor.view = meetingSeat.facing === 'sw' || meetingSeat.facing === 'se' ? 'front' : 'back';
      actor.flip = meetingSeat.facing === 'se' || meetingSeat.facing === 'ne';
      actor.pose = kind === 'writing' || kind === 'answering' ? 'type' : working ? 'think' : 'sit';
      return;
    }
    const atSeat = seat && actor.goal.startsWith('seat:');
    if (atSeat) {
      const dx = seat.i - actor.i;
      const dy = seat.j - actor.j;
      const dist = Math.hypot(dx, dy);
      if (dist > 0.02) {
        const step = Math.min(dist, WALK_SPEED * dt);
        actor.i += (dx / dist) * step;
        actor.j += (dy / dist) * step;
        actor.pose = 'walk';
        return;
      }
      actor.view = seat.facing === 'sw' || seat.facing === 'se' ? 'front' : 'back';
      actor.flip = seat.facing === 'se' || seat.facing === 'ne';
      actor.pose =
        kind === 'thinking' || kind === 'waiting' || kind === 'starting' ? 'think'
        : kind === 'reading' ? 'read'
        : stuck ? 'slump'
        : 'type';
      return;
    }
    if (actor.pause?.kind === 'plausch') {
      // Beide Figuren stehen sich zugewandt. Wer gerade redet, gestikuliert.
      const partner = this.actors.get(actor.pause.partnerId);
      if (partner) {
        const dx = partner.i - actor.i;
        const dy = partner.j - actor.j;
        actor.view = dx < -0.01 || dy < -0.01 ? 'back' : 'front';
        actor.flip = Math.abs(dx) > Math.abs(dy) ? dx > 0 : dy < 0;
      }
      actor.pose = actor.pause.speaks ? 'talk' : 'stand';
      return;
    }
    actor.view = 'front';
    actor.flip = false;
    actor.pose = actor.atShelf ? 'read' : kind === 'review' || kind === 'done' ? 'wave' : actor.pause?.kind === 'handy' ? 'phone' : 'stand';
  }

  /* ---------- Pausen: Zeitvertreib freier Figuren ---------- */

  /** Zufällig eins von: Handy, Kaffee, Plausch mit einer anderen freien Figur, ein paar Schritte gehen. */
  private pickPastime(actor: Actor, now: number): void {
    const roll = Math.random();
    const partner = roll < 0.3 ? this.freeColleague(actor) : null;
    if (partner) {
      const spot = this.besideActor(partner);
      if (spot) {
        const until = now + 7000 + Math.random() * 6000;
        actor.pause = { kind: 'plausch', until, partnerId: partner.id, speaks: true };
        partner.pause = { kind: 'plausch', until, partnerId: actor.id, speaks: false };
        partner.goal = '';
        partner.path = [];
        partner.nextWander = until + 1000;
        this.setGoal(actor, `plausch:${spot.i},${spot.j}`, spot);
        return;
      }
    }
    if (roll < 0.5) {
      actor.pause = { kind: 'handy', until: now + 5000 + Math.random() * 5000 };
      return;
    }
    const target = this.wanderTarget(actor);
    if (target) this.setGoal(actor, `frei:${target.i},${target.j}`, target);
  }

  private endPause(actor: Actor): void {
    const pause = actor.pause;
    actor.pause = null;
    if (pause?.kind === 'plausch') {
      const partner = this.actors.get(pause.partnerId);
      if (partner?.pause?.kind === 'plausch' && partner.pause.partnerId === actor.id) partner.pause = null;
    }
  }

  /** Eine andere Figur, deren Agent wirklich frei ist und die gerade nicht beschäftigt oder unterwegs ist. */
  private freeColleague(actor: Actor): Actor | null {
    const candidates = [...this.actors.values()].filter((other) => {
      if (other.floor !== actor.floor || other.id === actor.id || other.pause || other.path.length) return false;
      const agent = this.company!.agents.find((a) => a.id === other.id);
      return agent?.live.kind === 'idle' && !this.meetingSeat(agent);
    });
    return candidates.length ? candidates[Math.floor(Math.random() * candidates.length)] : null;
  }

  private besideActor(other: Actor): Tile | null {
    const loc = this.location();
    const at = { i: Math.floor(other.i), j: Math.floor(other.j) };
    for (const [a, b] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
      const n = { i: at.i + a, j: at.j + b };
      if (inBounds(loc, n) && !this.blocked.has(`${n.i},${n.j}`)) return n;
    }
    return null;
  }

  /** Ein freies Feld direkt neben einem Arbeitsplatz, auf dem niemand auf dem Stuhl der anderen steht. */
  private besideDesk(desk: PlacedItem): Tile | null {
    const loc = this.location();
    const own = occupiedTiles(desk);
    const inside = new Set(own.map((t) => `${t.i},${t.j}`));
    for (const t of own) {
      for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const n = { i: t.i + a, j: t.j + b };
        const key = `${n.i},${n.j}`;
        if (inBounds(loc, n) && !inside.has(key) && !this.blocked.has(key)) return n;
      }
    }
    return null;
  }

  private wanderTarget(actor: Actor): Tile | null {
    const loc = this.location();
    const company = this.company!;
    const random = Math.random();
    // Gibt es einen Sozialbereich oder Gaming-Raum, gehen freie Agenten meist dorthin: an Kaffee, Sofa oder Automat.
    const lounges = (company.zones ?? []).filter((z) => floorOf(z) === actor.floor && LOUNGE_SPOTS[z.kind]);
    if (lounges.length && random < 0.7) {
      const zone = lounges[Math.floor(Math.random() * lounges.length)];
      const tiles = zoneTiles(company, zone);
      const kinds = LOUNGE_SPOTS[zone.kind]!;
      const spots = company.placed.filter((p) => floorOf(p) === actor.floor && kinds.includes(p.kind) && tiles.has(`${p.i},${p.j}`)).sort(() => Math.random() - 0.5);
      for (const spot of spots) {
        const near = standingTile(loc, this.blocked, spot);
        if (near && tiles.has(`${near.i},${near.j}`)) return near;
      }
      const free = [...tiles].filter((k) => !this.blocked.has(k));
      if (free.length) {
        const [i, j] = free[Math.floor(Math.random() * free.length)].split(',').map(Number);
        return { i, j };
      }
    }
    const coffee = company.placed.find((p) => p.kind === 'coffee' && floorOf(p) === actor.floor);
    if (coffee && random < 0.45) {
      const near = standingTile(loc, this.blocked, coffee);
      if (near) return near;
    }
    for (let n = 0; n < 12; n++) {
      const t = {
        i: Math.max(0, Math.min(loc.w - 1, Math.floor(actor.i) + Math.round((Math.random() - 0.5) * 4))),
        j: Math.max(0, Math.min(loc.d - 1, Math.floor(actor.j) + Math.round((Math.random() - 0.5) * 4))),
      };
      if (!this.blocked.has(`${t.i},${t.j}`)) return t;
    }
    return null;
  }

  /* ---------- Zeichnen ---------- */

  private frame(time: number): void {
    this.raf = requestAnimationFrame((t) => this.frame(t));
    if (!this.active || time - this.lastTime < 1000 / 30) return;
    // Großzügig begrenzt: Auch bei niedriger Bildrate soll eine Figur gleich schnell gehen.
    const dt = Math.min(0.3, (time - this.lastTime) / 1000);
    this.lastTime = time;
    if (!this.company || !this.room || !this.lowW) return;
    this.draw(time, dt);
  }

  private drawSprite(ctx: Ctx, s: Sprite, [x, y]: [number, number]): void {
    ctx.drawImage(s.canvas, x - s.ax, y - s.ay);
  }

  private draw(time: number, dt: number): void {
    const ctx = this.screen;
    const room = this.room!;
    const company = this.company!;
    const pen = new Pen(ctx, room.pen.ox + this.offX, room.pen.oy + this.offY);
    const tick = Math.floor(time / 170);

    // Wasser
    const shift = REDUCED_MOTION ? 0 : Math.floor(time / 900) % 128;
    for (let y = -128; y < this.lowH + 128; y += 128) {
      for (let x = -128; x < this.lowW + 128; x += 128) ctx.drawImage(this.water.canvas, x + shift, y);
    }
    // Rund ums Büro liegt die echte Stadt, Feld für Feld in derselben Grösse.
    const view = this.groundOfView();
    const [cornerX, cornerY] = pen.pt(0, 0);
    drawTownBehind(ctx, company, view.siteId, view.room.w, view.room.d, view.room.door.i, cornerX, cornerY, this.lowW, this.lowH);
    ctx.drawImage(room.base.canvas, this.offX, this.offY);
    for (const department of company.departments.filter((d) => floorOf(d) === this.viewFloor)) this.drawZone(ctx, pen, department, department.color, 0.22, false, department);
    for (const [id, el] of this.zoneLabels) {
      const department = company.departments.find((d) => d.id === id);
      if (department) {
        el.style.display = floorOf(department) === this.viewFloor ? '' : 'none';
        continue;
      }
      el.remove();
      this.zoneLabels.delete(id);
    }
    this.drawRoomZones(ctx, pen, company);
    if (storeyOf(this.viewFloor) === 0) this.drawBoard(pen);

    const items: { depth: number; draw: () => void }[] = [];

    // Ein Monitor leuchtet nur, wenn am Platz gearbeitet wird, nicht während einer Besprechung.
    const atDesk = company.runs.filter((r) => r.status === 'running' && !r.meetingId).map((r) => r.agentId);
    const busyDesks = new Set(company.agents.filter((a) => atDesk.includes(a.id)).map((a) => a.deskId));
    // Weiche Schatten unter allem, was im Raum steht. Sie halten die Möbel am Boden.
    for (const item of itemsOnFloor(company.placed, this.viewFloor)) {
      if (item.kind === 'meeting' || isEdgeKind(item.kind) || (this.ghost && this.ghost.kind !== 'zone' && this.ghost.id === item.id)) continue;
      const size = footprint(item.kind, item.rot);
      for (const [grow, alpha] of [[0.14, 0.1], [0.04, 0.16]] as const) {
        fillPoly(ctx, [pen.pt(item.i + 0.08 - grow, item.j + 0.14), pen.pt(item.i + size.w + grow, item.j + 0.14), pen.pt(item.i + size.w + grow, item.j + size.d + grow), pen.pt(item.i + 0.08 - grow, item.j + size.d + grow)], `rgba(14,18,30,${alpha})`);
      }
    }
    for (const item of itemsOnFloor(company.placed, this.viewFloor)) {
      if (this.ghost && this.ghost.kind !== 'zone' && this.ghost.id === item.id) continue;
      this.addItem(items, ctx, pen, item, busyDesks.has(item.id), tick);
    }

    this.updateLifts(time, dt);
    this.moveCeo(dt);
    this.drawCeo(ctx, pen, time, items);
    for (const agent of staffOf(company)) {
      const actor = this.actors.get(agent.id);
      if (!actor) continue;
      this.ctxFloor = actor.floor;
      this.behave(actor, agent, time, dt);
      this.ctxFloor = this.viewFloor;
      // Wer auf einer anderen Etage ist, arbeitet weiter, ist hier aber nicht zu sehen.
      if (actor.floor !== this.viewFloor || actor.hidden) continue;
      const seated = isSeated(actor);
      const zLift = seated ? 9 : 0;
      items.push({
        depth: actor.i + actor.j,
        draw: () => {
          const [sx, sy] = pen.pt(actor.i, actor.j);
          actor.lastScreen = { x: sx, y: sy - zLift };
          if (!seated) {
            rect(ctx, sx - 5, sy - 1, 10, 2, 'rgba(10,16,28,.28)');
            if (agent.id === this.selected) this.drawSelection(ctx, pen, actor);
          }
          const frame = actor.pose === 'walk' ? Math.floor(time / 110) : REDUCED_MOTION ? 0 : Math.floor(time / (actor.pose === 'type' ? 150 : 520));
          const sprite = characterSprite(agent.look, actor.pose, frame % 24, actor.view, !seated);
          ctx.save();
          if (actor.flip) {
            ctx.translate(sx * 2, 0);
            ctx.scale(-1, 1);
          }
          ctx.drawImage(sprite.canvas, sx - sprite.ax, sy - zLift - sprite.ay);
          ctx.restore();
          if (agent.live.kind === 'handoff') {
            // Das Blatt, das gerade übergeben wird
            rect(ctx, sx - 4, sy - 17, 8, 9, '#111a29');
            rect(ctx, sx - 3, sy - 16, 6, 7, '#f2f4ef');
            rect(ctx, sx - 2, sy - 14, 4, 1, '#7f93a8');
            rect(ctx, sx - 2, sy - 12, 3, 1, '#7f93a8');
          }
        },
      });
    }

    items.sort((a, b) => a.depth - b.depth);
    for (const item of items) item.draw();
    ctx.drawImage(room.front.canvas, this.offX, this.offY);
    // Nachbarhäuser vor dem Grundstück stehen auch vor dem Büro. Sie enden aber an seinem Umriss: Was darin geschieht, muss zu sehen sein.
    const edge = 0.3;
    const height = WALL_H + 8;
    const outline = [pen.pt(-edge, -edge, height), pen.pt(view.room.w + edge, -edge, height), pen.pt(view.room.w + edge, -edge), pen.pt(view.room.w + edge, view.room.d + edge), pen.pt(-edge, view.room.d + edge), pen.pt(-edge, view.room.d + edge, height)];
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, this.lowW, this.lowH);
    outline.forEach(([x, y], index) => (index ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.clip('evenodd');
    drawTownInFront(ctx, company, view.siteId, view.room.w, view.room.d, cornerX, cornerY, this.lowW, this.lowH);
    ctx.restore();

    if (this.ghost) this.drawGhost(ctx, pen, this.ghost, tick);

    for (const agent of staffOf(company)) {
      const actor = this.actors.get(agent.id);
      if (!actor) continue;
      const label = this.labelEls.get(agent.id);
      if (label) label.hidden = actor.floor !== this.viewFloor || actor.hidden;
      if (actor.floor !== this.viewFloor) continue;
      // Wer im Raum gerade an der Reihe ist, redet. Das zeigt die Sprechblase mit den Punkten.
      const speaking = WORKING.includes(agent.live.kind) && this.meetingSeat(agent);
      // Beim Plausch wechseln sich die beiden ab. Das ist Kulisse und steht in keiner Beschriftung.
      if (actor.pause?.kind === 'plausch' && !actor.path.length && actor.goal.startsWith('plausch:') === actor.pause.speaks) {
        const partner = this.actors.get(actor.pause.partnerId);
        const turn = Math.floor(time / 2600) % 2 === 0;
        actor.pause.speaks = turn;
        if (partner?.pause?.kind === 'plausch') partner.pause.speaks = !turn;
      }
      const chatting = actor.pause?.kind === 'plausch' && actor.pause.speaks && !actor.path.length && agent.live.kind === 'idle';
      const bubble: Bubble | null = speaking || chatting ? { icon: 'dots', color: '#1b2c46' } : bubbleFor(agent.live.kind);
      const seated = isSeated(actor);
      const top = actor.lastScreen.y - (seated ? 27 : 33);
      if (bubble) this.drawBubble(ctx, actor.lastScreen.x + 7, top - 2, bubble, tick);
      this.placeLabel(agent, actor.lastScreen.x, top + (bubble ? -13 : 0));
    }

    const running = (company.meetings ?? []).filter((m) => m.status === 'running');
    for (const meeting of running) {
      const room = company.placed.find((p) => p.id === meeting.roomId);
      if (room && floorOf(room) === this.viewFloor) this.drawRoomGlow(ctx, pen, room, meeting);
    }
    for (const [id, el] of this.roomLabels) {
      if (running.some((m) => m.id === id)) continue;
      el.remove();
      this.roomLabels.delete(id);
    }
  }

  /** Der leuchtende Rand zeigt, dass im Raum wirklich gerade eine Besprechung läuft. */
  private drawRoomGlow(ctx: Ctx, pen: Pen, room: PlacedItem, meeting: Meeting): void {
    const { i, j } = room;
    const S = room.kind === 'table' ? 2 : MEETING_SIZE;
    const top = [pen.pt(i, j, ROOM_HEIGHT), pen.pt(i + S, j, ROOM_HEIGHT), pen.pt(i + S, j + S, ROOM_HEIGHT), pen.pt(i, j + S, ROOM_HEIGHT)];
    const color = '#5eeac0';
    for (let n = 0; n < 4; n++) line(ctx, top[n][0], top[n][1], top[(n + 1) % 4][0], top[(n + 1) % 4][1], color);
    const [fx, fy] = pen.pt(i + S, j + S);
    const [lx, ly] = pen.pt(i, j + S);
    const [rx, ry] = pen.pt(i + S, j);
    line(ctx, fx, fy, top[2][0], top[2][1], color);
    line(ctx, lx, ly, fx, fy, color);
    line(ctx, rx, ry, fx, fy, color);
    this.placeRoomLabel(meeting, (top[0][0] + top[1][0]) / 2, (top[0][1] + top[1][1]) / 2 - 8);
  }

  /** Ein Abteilungsbereich: getönter Boden mit Kante. Beim Abstecken grün oder rot, je nachdem, ob er zulässig ist. */
  private drawZone(ctx: Ctx, pen: Pen, zone: Rect, color: string, alpha: number, ghost: boolean, department?: Department): void {
    const corners = [pen.pt(zone.i, zone.j), pen.pt(zone.i + zone.w, zone.j), pen.pt(zone.i + zone.w, zone.j + zone.d), pen.pt(zone.i, zone.j + zone.d)];
    ctx.save();
    ctx.globalAlpha = alpha;
    fillPoly(ctx, corners, color);
    ctx.restore();
    for (let n = 0; n < 4; n++) {
      const [ax, ay] = corners[n];
      const [bx, by] = corners[(n + 1) % 4];
      if (ghost) line(ctx, ax, ay, bx, by, color);
      else {
        ctx.save();
        ctx.globalAlpha = 0.7;
        line(ctx, ax, ay, bx, by, color);
        ctx.restore();
      }
    }
    if (department) this.placeZoneLabel(department, corners[0][0], corners[0][1]);
  }

  private placeZoneLabel(department: Department, x: number, y: number): void {
    let el = this.zoneLabels.get(department.id);
    if (!el) {
      el = document.createElement('div');
      el.className = 'zone-label';
      el.addEventListener('click', () => this.callbacks.onDepartmentClick(department.id));
      this.labels.append(el);
      this.zoneLabels.set(department.id, el);
    }
    if (el.textContent !== withoutEszett(department.name)) el.textContent = withoutEszett(department.name);
    el.style.borderColor = department.color;
    el.style.transform = `translate(calc(${Math.round(x * this.scale)}px - 50%), calc(${Math.round((y + 2) * this.scale)}px - 100%))`;
  }

  private placeRoomLabel(meeting: Meeting, x: number, y: number): void {
    let el = this.roomLabels.get(meeting.id);
    if (!el) {
      el = document.createElement('div');
      el.className = 'room-label';
      el.addEventListener('click', () => this.callbacks.onMeetingClick(meeting.id));
      this.labels.append(el);
      this.roomLabels.set(meeting.id, el);
    }
    const text = `Besprechung läuft, Runde ${meeting.round} von ${meeting.maxRounds}`;
    if (el.textContent !== show(text)) el.textContent = show(text);
    el.style.transform = `translate(calc(${Math.round(x * this.scale)}px - 50%), calc(${Math.round(y * this.scale)}px - 100%))`;
  }

  private addItem(items: { depth: number; draw: () => void }[], ctx: Ctx, pen: Pen, item: PlacedItem, active: boolean, tick: number): void {
    const at = (): [number, number] => pen.pt(item.i, item.j);
    if (item.kind === 'meeting') {
      this.addRoom(items, ctx, pen, item);
      return;
    }
    if (item.kind === 'lift') {
      this.addLift(items, pen, item);
      return;
    }
    if (item.kind === 'stairs') {
      const storey = storeyOf(floorOf(item));
      const floors = buildingAt(this.company!.town, siteAt(this.company!, floorOf(item)).siteId).floors;
      const mode: StairMode = storey > 0 && storey < floors - 1 ? 'both' : storey > 0 ? 'down' : 'up';
      items.push({ depth: item.i + 0.5 + item.j + 1, draw: () => this.drawSprite(ctx, stairSprite(mode), at()) });
      return;
    }
    if (isEdgeKind(item.kind)) {
      const sprite = edgeSprite(item.kind, item.rot, this.wallsLow, wallColor(item.color));
      items.push({ depth: item.i + item.j + 0.5, draw: () => this.drawSprite(ctx, sprite, at()) });
      return;
    }
    if (item.kind === 'arcade' || item.kind === 'beanbag') {
      const sprite = item.kind === 'arcade' ? arcadeSprite() : beanbagSprite();
      items.push({ depth: item.i + item.j + 1, draw: () => this.drawSprite(ctx, sprite, at()) });
      return;
    }
    if (item.kind === 'board') {
      items.push({ depth: item.i + item.j + 1, draw: () => this.drawSprite(ctx, boardSprite(item.rot), at()) });
      return;
    }
    if (item.kind === 'table') {
      // Der Tisch des Glasraums, ohne Glas: gezeichnet um den Ursprung eines gedachten Raums ein Feld davor.
      items.push({ depth: item.i + item.j + 2, draw: () => this.drawSprite(ctx, meetingTable(), pen.pt(item.i - 1, item.j - 1)) });
      return;
    }
    if (isProp(item.kind)) {
      const size = footprint(item.kind, item.rot);
      const kind = item.kind;
      items.push({ depth: item.i + size.w / 2 + item.j + size.d / 2, draw: () => this.drawSprite(ctx, propSprite({ kind: kind as PropKind, rot: item.rot }), at()) });
      return;
    }
    if (item.kind !== 'desk' && item.kind !== 'ceoDesk') {
      const sprite = furnitureSprite(item.kind as 'shelf', item.i + item.j, item.rot);
      items.push({ depth: item.i + item.j + 1, draw: () => this.drawSprite(ctx, sprite, at()) });
      return;
    }
    const seat = seatOf(item);
    const depth = seat.i + seat.j;
    const frontChair = item.rot >= 2;
    const tableDepth = frontChair ? depth - 1 : depth + 1;
    items.push({
      depth: tableDepth,
      draw: () => {
        if (item.kind === 'ceoDesk') {
          this.drawSprite(ctx, ceoTable(item.rot), at());
          return;
        }
        this.drawSprite(ctx, deskTable(item.rot), at());
        const [x, y] = at();
        drawScreen(new Pen(ctx, x, y), item.rot, active, tick);
      },
    });
    items.push({ depth: depth - 0.05, draw: () => this.drawSprite(ctx, chairBase(item.rot), at()) });
    items.push({ depth: frontChair ? depth + 0.05 : depth - 0.1, draw: () => this.drawSprite(ctx, chairBack(item.rot), at()) });
  }

  /** Erst Schacht und Kabine, dann die Figur, dann die Türflügel: So schliesst sich die Tür vor ihr. */
  private addLift(items: { depth: number; draw: () => void }[], pen: Pen, item: PlacedItem): void {
    const building = buildingAt(this.company!.town, this.company!.town.siteId);
    const shaft = building.shafts.find((s) => s.kind === 'lift' && s.i === item.i && s.j === item.j);
    const side = shaft ? this.liftSide(shaft) : null;
    const lift = shaft ? this.liftOf(shaft) : null;
    const floor = floorOf(item);
    items.push({
      depth: item.i + item.j + 0.5,
      draw: () => {
        this.drawSprite(pen.ctx, liftShell(), pen.pt(item.i, item.j));
        if (!side || !lift) return;
        const called = [...this.actors.values()].some((a) => {
          const trip = a.transit?.lift;
          return Boolean(trip) && a.floor === floor && trip!.shaft === shaft && ['press', 'wait', 'arrive'].includes(trip!.phase);
        });
        drawLiftFrame(pen, item.i, item.j, side, lift.moving ? Math.round(lift.moving.from + (lift.moving.to - lift.moving.from) * Math.min(1, (performance.now() - lift.moving.at) / lift.moving.ms)) : lift.cabin, building.floors, called);
      },
    });
    if (side && lift) items.push({ depth: item.i + item.j + 1.3, draw: () => drawLiftDoors(pen, item.i, item.j, side, this.liftDoor(lift, floor).open) });
  }

  /** Jedes Wandstück wird einzeln einsortiert. So steht eine Figur je nach Standort vor oder hinter dem Glas. */
  private addRoom(items: { depth: number; draw: () => void }[], ctx: Ctx, pen: Pen, item: Pick<PlacedItem, 'i' | 'j' | 'rot'>): void {
    const { i, j } = item;
    const door = meetingDoor(item).inside;
    const isDoor = (a: Tile, side: 'i+' | 'i-' | 'j+' | 'j-') =>
      a.i === door.i && a.j === door.j && ((side === 'i+' && item.rot === 0) || (side === 'j+' && item.rot === 1) || (side === 'i-' && item.rot === 2) || (side === 'j-' && item.rot === 3));
    items.push({ depth: i + j - 0.5, draw: () => this.drawSprite(ctx, meetingFloor(), pen.pt(i, j)) });
    const S = MEETING_SIZE;
    items.push({ depth: i + j + S, draw: () => this.drawSprite(ctx, meetingTable(), pen.pt(i, j)) });
    for (let n = 0; n < S; n++) {
      const segments: { axis: 'i' | 'j'; door: boolean; at: [number, number]; depth: number }[] = [
        { axis: 'i', door: isDoor({ i: i + n, j }, 'j-'), at: [i + n, j], depth: i + n + 0.5 + j },
        { axis: 'j', door: isDoor({ i, j: j + n }, 'i-'), at: [i, j + n], depth: i + j + n + 0.5 },
        { axis: 'i', door: isDoor({ i: i + n, j: j + S - 1 }, 'j+'), at: [i + n, j + S], depth: i + n + 0.5 + j + S },
        { axis: 'j', door: isDoor({ i: i + S - 1, j: j + n }, 'i+'), at: [i + S, j + n], depth: i + S + j + n + 0.5 },
      ];
      for (const segment of segments) {
        items.push({ depth: segment.depth, draw: () => this.drawSprite(ctx, glassSegment(segment.axis, segment.door), pen.pt(segment.at[0], segment.at[1])) });
      }
    }
  }

  private drawSelection(ctx: Ctx, pen: Pen, actor: Actor): void {
    const [sx, sy] = pen.pt(actor.i, actor.j);
    line(ctx, sx - 9, sy, sx, sy - 4, '#5eeac0');
    line(ctx, sx, sy - 4, sx + 9, sy, '#5eeac0');
    line(ctx, sx + 9, sy, sx, sy + 4, '#5eeac0');
    line(ctx, sx, sy + 4, sx - 9, sy, '#5eeac0');
  }

  private groundOfView() {
    const room = roomOf(this.company!, siteBase(this.viewFloor));
    return { room, siteId: siteAt(this.company!, this.viewFloor).siteId };
  }

  /** Eine Zettelfarbe je echtem Auftrag. So zeigt auch der Raum den Stand der Firma. */
  private drawBoard(pen: Pen): void {
    const b = this.room!.board;
    // Die Zettel hängen so, wie die Figuren sie gebracht haben. Passen nicht alle hin, überlappen sie sich.
    const notes = [...this.shownNotes.values()];
    const columns = Math.max(1, Math.floor((b.w - 3) / 6));
    const rows = Math.max(1, Math.floor((b.h - 3) / 6));
    notes.slice(0, columns * rows * 2).forEach((note, index) => {
      const slot = index % (columns * rows);
      const shift = index >= columns * rows ? 2 : 0;
      const u = b.u + 2 + (slot % columns) * 6 + shift;
      const v = b.v + b.h - 7 - Math.floor(slot / columns) * 6 - shift;
      pen.faceJ(0, 0, 0, u + 1, v - 1, 5, 5, 'rgba(20,20,30,.35)');
      const { color } = noteLook(this.company!, note);
      pen.faceJ(0, 0, 0, u, v, 5, 5, color);
      pen.faceJ(0, 0, 0, u, v + 4, 5, 1, noteEdge(color));
    });
  }

  private drawBubble(ctx: Ctx, x: number, y: number, bubble: Bubble, tick: number): void {
    const size = 13;
    const left = Math.round(x);
    const top = Math.round(y - size);
    rect(ctx, left - 1, top, size + 2, size, '#111a29');
    rect(ctx, left, top - 1, size, size + 2, '#111a29');
    rect(ctx, left, top, size, size, '#ffffff');
    rect(ctx, left + 2, top + size + 1, 3, 1, '#111a29');
    rect(ctx, left + 3, top + size, 2, 1, '#ffffff');
    if (bubble.icon === 'dots') {
      for (let n = 0; n < 3; n++) {
        const lift = !REDUCED_MOTION && (tick >> 1) % 3 === n ? 1 : 0;
        rect(ctx, left + 2 + n * 3, top + 5 - lift, 2, 2, bubble.color);
      }
      return;
    }
    const rows = ICONS[bubble.icon];
    ctx.fillStyle = bubble.color;
    rows.forEach((row, ry) => {
      for (let rx = 0; rx < row.length; rx++) if (row[rx] === '#') ctx.fillRect(left + 2 + rx, top + 2 + ry, 1, 1);
    });
    if (bubble.icon === 'gear' && !REDUCED_MOTION && tick % 4 < 2) {
      // Das Zahnrad dreht nur, solange ein echter Lauf arbeitet
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(left + 2 + 3, top + 2, 1, 1);
      ctx.fillRect(left + 2 + 5, top + 2 + 8, 1, 1);
      ctx.fillStyle = bubble.color;
      ctx.fillRect(left + 2 + 4, top + 2, 1, 1);
      ctx.fillRect(left + 2 + 4, top + 2 + 8, 1, 1);
    }
  }

  /** Benannte Räume: getönter Boden in der Farbe der Zonenart und ein Schild am obersten Feld. */
  private drawRoomZones(ctx: Ctx, pen: Pen, company: Company): void {
    const zones = (company.zones ?? []).filter((z) => floorOf(z) === this.viewFloor);
    for (const zone of zones) {
      const tiles = [...zoneTiles(company, zone)].map((k) => k.split(',').map(Number) as [number, number]);
      if (zone.floorStyle) this.paintFloor(ctx, pen, tiles, zone.floorStyle);
      this.tintTiles(ctx, pen, tiles, ZONE_COLORS[zone.kind], zone.floorStyle ? 0.06 : 0.14);
      const top = tiles.reduce((a, b) => (b[0] + b[1] < a[0] + a[1] ? b : a), tiles[0]);
      const [x, y] = pen.pt(top[0] + 0.5, top[1] + 0.5);
      let el = this.roomZoneLabels.get(zone.id);
      if (!el) {
        el = document.createElement('div');
        el.className = 'zone-label';
        this.labels.append(el);
        this.roomZoneLabels.set(zone.id, el);
      }
      if (el.textContent !== withoutEszett(zone.name)) el.textContent = withoutEszett(zone.name);
      el.style.borderColor = ZONE_COLORS[zone.kind];
      el.style.display = '';
      el.style.transform = `translate(calc(${Math.round(x * this.scale)}px - 50%), calc(${Math.round((y + 2) * this.scale)}px - 100%))`;
    }
    for (const [id, el] of this.roomZoneLabels) {
      if (zones.some((z) => z.id === id)) continue;
      el.remove();
      this.roomZoneLabels.delete(id);
    }
  }

  /** Bodenbelag eines Raums, Feld für Feld. Muster bleiben grob, damit sie zum Pixelbild passen. */
  private paintFloor(ctx: Ctx, pen: Pen, tiles: [number, number][], style: FloorStyle): void {
    const quad = (i: number, j: number, w: number, d: number, color: string) => fillPoly(ctx, [pen.pt(i, j), pen.pt(i + w, j), pen.pt(i + w, j + d), pen.pt(i, j + d)], color);
    for (const [i, j] of tiles) {
      if (style === 'holz') {
        for (let n = 0; n < 4; n++) quad(i + n / 4, j, 0.25, 1, (i * 4 + n + j) % 3 === 0 ? '#8a6443' : (i * 4 + n) % 2 ? '#9a7350' : '#a57d58');
      } else if (style === 'teppich') {
        quad(i, j, 1, 1, '#4f6f8f');
        if ((i + j) % 2 === 0) quad(i + 0.35, j + 0.35, 0.3, 0.3, '#5c7da0');
      } else if (style === 'fliesen') {
        quad(i, j, 1, 1, '#b9c2c8');
        quad(i + 0.04, j + 0.04, 0.92, 0.92, (i + j) % 2 ? '#d6dde2' : '#e6ebef');
      } else {
        quad(i, j, 1, 1, (i * 7 + j * 3) % 5 === 0 ? '#7a7d80' : '#85888b');
      }
    }
  }

  private tintTiles(ctx: Ctx, pen: Pen, tiles: [number, number][], color: string, alpha: number): void {
    ctx.save();
    ctx.globalAlpha = alpha;
    for (const [i, j] of tiles) fillPoly(ctx, [pen.pt(i, j), pen.pt(i + 1, j), pen.pt(i + 1, j + 1), pen.pt(i, j + 1)], color);
    ctx.restore();
  }

  private drawGhost(ctx: Ctx, pen: Pen, ghost: Ghost, tick: number): void {
    if (ghost.kind === 'roomwalls') {
      // Jede Kante innerhalb des Büros wird zur Wand. Kanten am Rand des Gebäudes bleiben, wie sie sind.
      const loc = this.location();
      const inside = (t: Tile) => t.i >= 0 && t.j >= 0 && t.i < loc.w && t.j < loc.d;
      ctx.save();
      ctx.globalAlpha = 0.72 + (tick % 6 < 3 ? 0.08 : 0);
      for (const edge of rectWalls(ghost)) {
        const [a, b] = wallSides(edge);
        if (!inside(a) || !inside(b)) continue;
        const { i, j } = edge;
        const strip = edge.rot === 0
          ? [pen.pt(i, j - 0.1), pen.pt(i + 1, j - 0.1), pen.pt(i + 1, j + 0.1), pen.pt(i, j + 0.1)]
          : [pen.pt(i - 0.1, j), pen.pt(i - 0.1, j + 1), pen.pt(i + 0.1, j + 1), pen.pt(i + 0.1, j)];
        fillPoly(ctx, strip, '#5eeac0');
        this.drawSprite(ctx, edgeSprite('wall', edge.rot, this.wallsLow), pen.pt(i, j));
      }
      ctx.restore();
      return;
    }
    if (ghost.kind === 'room') {
      const tiles = ghost.tiles.map((k) => k.split(',').map(Number) as [number, number]);
      this.tintTiles(ctx, pen, tiles, ghost.ok ? '#5eeac0' : '#e5534b', 0.28 + (tick % 6 < 3 ? 0.06 : 0));
      return;
    }
    if (ghost.kind === 'zone') {
      const ok = checkDepartment(this.location(), this.company!.departments.filter((d) => floorOf(d) === this.viewFloor), ghost).ok;
      this.drawZone(ctx, pen, ghost, ok ? '#5eeac0' : '#e5534b', 0.3 + (tick % 6 < 3 ? 0.06 : 0), true);
      return;
    }
    const check = isShaft(ghost.kind) && !ghost.id
      ? checkShaft(this.company!, { kind: ghost.kind, i: ghost.i, j: ghost.j, rot: ghost.rot })
      : checkPlacement(this.location(), itemsOnFloor(this.company!.placed, this.viewFloor), ghost);
    const size = footprint(ghost.kind, ghost.rot);
    const color = check.ok ? '#5eeac0' : '#e5534b';
    ctx.save();
    ctx.globalAlpha = 0.34;
    fillPoly(ctx, [pen.pt(ghost.i, ghost.j), pen.pt(ghost.i + size.w, ghost.j), pen.pt(ghost.i + size.w, ghost.j + size.d), pen.pt(ghost.i, ghost.j + size.d)], color);
    ctx.globalAlpha = 0.72 + (tick % 6 < 3 ? 0.08 : 0);
    const at = pen.pt(ghost.i, ghost.j);
    if (ghost.kind === 'arcade' || ghost.kind === 'beanbag') {
      this.drawSprite(ctx, ghost.kind === 'arcade' ? arcadeSprite() : beanbagSprite(), at);
    } else if (ghost.kind === 'board') {
      this.drawSprite(ctx, boardSprite(ghost.rot), at);
    } else if (ghost.kind === 'table') {
      this.drawSprite(ctx, meetingTable(), pen.pt(ghost.i - 1, ghost.j - 1));
    } else if (isEdgeKind(ghost.kind)) {
      // Jede Kante des Zugs leuchtet. Liegt schon eine Wand dort, zeigt Bernstein: Ein Klick reißt sie ab.
      const placed = itemsOnFloor(this.company!.placed, this.viewFloor);
      const run = ghost.run ?? [{ i: ghost.i, j: ghost.j, rot: ghost.rot }];
      const removing = !ghost.id && run.length === 1 && placed.some((p) => p.kind === ghost.kind && p.i === ghost.i && p.j === ghost.j && p.rot % 2 === ghost.rot % 2);
      for (const seg of run) {
        const { i, j } = seg;
        const strip = seg.rot % 2 === 0
          ? [pen.pt(i, j - 0.1), pen.pt(i + 1, j - 0.1), pen.pt(i + 1, j + 0.1), pen.pt(i, j + 0.1)]
          : [pen.pt(i - 0.1, j), pen.pt(i - 0.1, j + 1), pen.pt(i + 0.1, j + 1), pen.pt(i + 0.1, j)];
        fillPoly(ctx, strip, removing ? '#f8b62d' : color);
        if (!removing) this.drawSprite(ctx, edgeSprite(ghost.kind, seg.rot), pen.pt(i, j));
      }
    } else if (ghost.kind === 'meeting') {
      const parts: { depth: number; draw: () => void }[] = [];
      this.addRoom(parts, ctx, pen, ghost);
      parts.sort((a, b) => a.depth - b.depth).forEach((part) => part.draw());
    } else if (isProp(ghost.kind)) {
      this.drawSprite(ctx, propSprite({ kind: ghost.kind as PropKind, rot: ghost.rot }), at);
      if (isShaft(ghost.kind) && !ghost.id) {
        // Das Feld davor bleibt frei. Hier kommen die Figuren an.
        const t = shaftLanding(ghost.kind, ghost.i, ghost.j, ghost.rot);
        fillPoly(ctx, [pen.pt(t.i, t.j), pen.pt(t.i + 1, t.j), pen.pt(t.i + 1, t.j + 1), pen.pt(t.i, t.j + 1)], '#f8b62d');
      }
    } else if (ghost.kind === 'desk' || ghost.kind === 'ceoDesk') {
      this.drawSprite(ctx, chairBase(ghost.rot), at);
      this.drawSprite(ctx, chairBack(ghost.rot), at);
      this.drawSprite(ctx, ghost.kind === 'ceoDesk' ? ceoTable(ghost.rot) : deskTable(ghost.rot), at);
    } else {
      this.drawSprite(ctx, furnitureSprite(ghost.kind as 'shelf', ghost.i + ghost.j, ghost.rot), at);
    }
    ctx.restore();
    const corners = [pen.pt(ghost.i, ghost.j), pen.pt(ghost.i + size.w, ghost.j), pen.pt(ghost.i + size.w, ghost.j + size.d), pen.pt(ghost.i, ghost.j + size.d)];
    for (let n = 0; n < 4; n++) {
      const [ax, ay] = corners[n];
      const [bx, by] = corners[(n + 1) % 4];
      line(ctx, ax, ay, bx, by, color);
    }
    if (!check.ok) {
      const [cx, cy] = pen.pt(ghost.i + size.w / 2, ghost.j + size.d / 2);
      line(ctx, cx - 4, cy - 2, cx + 4, cy + 2, color);
      line(ctx, cx - 4, cy + 2, cx + 4, cy - 2, color);
    }
  }

  /** Name und echter Zustand als scharfe Beschriftung über der Figur. */
  private placeLabel(agent: Agent, x: number, y: number): void {
    let el = this.labelEls.get(agent.id);
    if (!el) {
      el = document.createElement('div');
      el.className = 'agent-label';
      el.dataset.agent = agent.id;
      const name = document.createElement('strong');
      const detail = document.createElement('span');
      el.append(name, detail);
      el.addEventListener('click', () => this.callbacks.onAgentClick(agent.id));
      this.labels.append(el);
      this.labelEls.set(agent.id, el);
    }
    const kind = agent.live.kind;
    const name = el.children[0] as HTMLElement;
    const detail = el.children[1] as HTMLElement;
    if (name.textContent !== withoutEszett(agent.name)) name.textContent = withoutEszett(agent.name);
    // Im Raum steht immer nur die letzte Aussage über den Köpfen. Alles andere würde die Figuren verdecken.
    const lastSpeaker = this.company!.meetings?.find((m) => m.status === 'running' && m.participantIds.includes(agent.id))?.turns.at(-1)?.agentId;
    const text = kind === 'idle' || (kind === 'meeting' && lastSpeaker !== agent.id) ? '' : agent.live.detail;
    if (detail.textContent !== show(text)) detail.textContent = show(text);
    el.dataset.kind = kind;
    el.classList.toggle('selected', agent.id === this.selected);
    el.style.transform = `translate(calc(${Math.round(x * this.scale)}px - 50%), calc(${Math.round(y * this.scale)}px - 100%))`;
  }
}

export const allLocations = LOCATIONS;

/** Kleine Vorschau eines Raums für die Standortwahl. */
export function roomPreview(locationId: Company['locationId']): HTMLCanvasElement {
  const loc = locationById(locationId);
  const room = buildRoom(loc);
  const out = layer(room.width, room.height);
  const water = waterPattern();
  for (let y = 0; y < room.height; y += 128) for (let x = 0; x < room.width; x += 128) out.ctx.drawImage(water.canvas, x, y);
  out.ctx.drawImage(room.base.canvas, 0, 0);
  const pen = new Pen(out.ctx, room.pen.ox, room.pen.oy);
  const stack: { depth: number; draw: () => void }[] = [];
  for (const prop of loc.props) {
    stack.push({
      depth: prop.i + prop.w / 2 + prop.j + prop.d / 2,
      draw: () => {
        const s = propSprite(prop);
        const [x, y] = pen.pt(prop.i, prop.j);
        out.ctx.drawImage(s.canvas, x - s.ax, y - s.ay);
      },
    });
  }
  for (const item of loc.startItems) {
    const seat = seatOf(item);
    stack.push({
      depth: seat.i + seat.j,
      draw: () => {
        const [x, y] = pen.pt(item.i, item.j);
        for (const s of [chairBack(item.rot), chairBase(item.rot), deskTable(item.rot)]) out.ctx.drawImage(s.canvas, x - s.ax, y - s.ay);
      },
    });
  }
  stack.sort((a, b) => a.depth - b.depth).forEach((entry) => entry.draw());
  out.ctx.drawImage(room.front.canvas, 0, 0);
  return out.canvas;
}
