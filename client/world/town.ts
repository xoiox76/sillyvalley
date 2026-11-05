// Die Stadt draußen vor der Tür. Die Spielerfigur läuft hier herum, Kulisse sind nur Häuser und Bäume:
// Wem ein Grundstück gehört und was in der Firma läuft, kommt aus dem Server-Stand.

import { findPath } from '../../shared/layout.ts';
import { withoutEszett } from '../ui/html.ts';
import { buildLimits, buildingAt } from '../../shared/building.ts';
import { PARCELS, STREET_LABELS, firmSign, TOWN_BLOCKED, TOWN_D, TOWN_W, TREES, inParcel, inTown, parcelById, parcelNear, tileKind, type Parcel, type TownBuilding, type TownTile } from '../../shared/town.ts';
import { DEFAULT_CEO } from '../../shared/catalog.ts';
import type { Company } from '../../shared/types.ts';
import { characterSprite, type Pose, type View } from './characters.ts';
import { Pen, darken, fillPoly, hash2, layer, lighten, line, rect, seeded, tri, type Ctx, type Layer } from './pixel.ts';

/** So hoch ragen die Wände des Büros über den Boden. */
const WALL_TOP = 60;
const SPEED = 4.2;
const MARGIN = 90;
const TOP = 70;
const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const KEYS: Record<string, TownTile> = {
  ArrowUp: { i: 0, j: -1 }, w: { i: 0, j: -1 }, W: { i: 0, j: -1 },
  ArrowDown: { i: 0, j: 1 }, s: { i: 0, j: 1 }, S: { i: 0, j: 1 },
  ArrowLeft: { i: -1, j: 0 }, a: { i: -1, j: 0 }, A: { i: -1, j: 0 },
  ArrowRight: { i: 1, j: 0 }, d: { i: 1, j: 0 }, D: { i: 1, j: 0 },
};

export interface TownCallbacks {
  /** Die Figur steht jetzt an diesem Grundstück, oder an keinem mehr. */
  onParcel(parcelId: string | null): void;
  /** Die Figur hat die Tür eines eigenen Hauses erreicht. */
  onEnter(parcelId: string): void;
  /** Tastatur gehört gerade einem Fenster oder Eingabefeld. */
  keyboardBlocked(): boolean;
}

interface Piece {
  /** Was wirklich steht, wenn es kleiner ist als das Grundstück. Davor läuft die Figur sichtbar. */
  solid?: { i: number; j: number; w: number; d: number };
  i: number;
  j: number;
  w: number;
  d: number;
  left: number;
  top: number;
  image: Layer;
}

export class TownView {
  private readonly container: HTMLElement;
  private readonly callbacks: TownCallbacks;
  private readonly canvas: HTMLCanvasElement;
  private readonly screen: CanvasRenderingContext2D;
  private readonly labels: HTMLDivElement;
  private readonly labelEls = new Map<string, HTMLDivElement>();
  private neighbors: { id: string; name: string; siteId: string; createdAt: number }[] = [];
  private readonly ground: Layer;
  private readonly field: Layer;
  private readonly treeImages: Layer[];
  private pieces: Piece[] = [];
  private company: Company | null = null;
  private stateKey = '';
  private active = false;
  private raf = 0;
  private lastTime = 0;
  private scale = 2;
  private zoomSteps = 0;
  /** Das Schild ist Schrift über dem Bild. Es wächst und schrumpft mit dem Zoom, sonst passt es nicht mehr aufs Haus. */
  private fittedScale = 2;
  private wheelSum = 0;
  private lowW = 0;
  private lowH = 0;
  private camX = 0;
  private camY = 0;
  private x = 5.5;
  private y = 12.5;
  private path: TownTile[] = [];
  private key: TownTile | null = null;
  private view: View = 'front';
  private flip = false;
  private walking = false;
  private parcel: string | null = null;
  private entering: string | null = null;
  private blocked: Set<string> = TOWN_BLOCKED;
  private readonly onKeyDown: (e: KeyboardEvent) => void;
  private readonly onKeyUp: (e: KeyboardEvent) => void;

  constructor(container: HTMLElement, callbacks: TownCallbacks) {
    this.container = container;
    this.callbacks = callbacks;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'world-canvas';
    this.canvas.setAttribute('role', 'img');
    this.canvas.setAttribute('aria-label', 'Die Stadt Silly Valley. Laufe per Klick oder mit den Pfeiltasten.');
    this.screen = this.canvas.getContext('2d')!;
    this.labels = document.createElement('div');
    this.labels.className = 'world-labels';
    container.append(this.canvas, this.labels);
    this.canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.wheelSum += e.deltaY;
      if (Math.abs(this.wheelSum) < 40) return;
      this.zoomBy(this.wheelSum < 0 ? 1 : -1);
      this.wheelSum = 0;
    }, { passive: false });
    this.ground = buildGround();
    this.field = grassField();
    this.treeImages = [buildTree(0), buildTree(1), buildTree(2)];
    new ResizeObserver(() => this.resize()).observe(container);
    this.canvas.addEventListener('click', (e) => this.onClick(e));
    this.canvas.addEventListener('pointermove', (e) => {
      this.canvas.style.cursor = this.ownDoorAt(e) ? 'pointer' : 'default';
    });
    this.onKeyDown = (e) => {
      const step = KEYS[e.key];
      if (!step || !this.active || this.callbacks.keyboardBlocked()) return;
      e.preventDefault();
      // Gehaltene Tasten führt move() fort; die Wiederholungen des Systems ändern nichts daran.
      if (e.repeat) return;
      this.entering = null;
      this.key = step;
      // Der erste Schritt steht sofort fest, damit auch ein kurzes Antippen zwischen zwei Bildern zählt.
      const from = { i: Math.floor(this.x), j: Math.floor(this.y) };
      const next = { i: from.i + step.i, j: from.j + step.j };
      this.path = inTown(next) && !this.blocked.has(`${next.i},${next.j}`) ? [next] : [];
    };
    this.onKeyUp = (e) => {
      if (KEYS[e.key]) this.key = null;
    };
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    this.container.replaceChildren();
  }

  /** Die anderen Firmen des Spielstands. Ihre Schilder zeigen, wer in der Stadt wo sitzt. */
  setNeighbors(firms: { id: string; name: string; siteId: string; createdAt: number }[]): void {
    this.neighbors = firms;
  }

  setCompany(company: Company): void {
    this.company = company;
    const key = JSON.stringify(company.town);
    if (key === this.stateKey) return;
    this.stateKey = key;
    this.pieces = buildPieces(company);
    // Ein Neubau steht auf einem Grundstück, das vorher begehbar war. Durch ihn hindurch geht es nicht mehr.
    this.blocked = new Set(TOWN_BLOCKED);
    for (const { solid } of this.pieces) {
      if (!solid) continue;
      for (let i = Math.floor(solid.i); i < solid.i + solid.w; i++) for (let j = Math.floor(solid.j); j < solid.j + solid.d; j++) this.blocked.add(`${i},${j}`);
    }
  }

  /** Beim Verlassen des Büros steht die Figur vor der eigenen Tür. */
  enter(siteId = this.company?.town.siteId ?? ''): void {
    const site = parcelById(siteId) ?? PARCELS[0];
    this.x = site.entry.i + 0.5;
    this.y = site.entry.j + 0.5;
    this.path = [];
    this.key = null;
    this.parcel = null;
    this.setActive(true);
    this.resize();
    this.updateParcel();
  }

  setActive(active: boolean): void {
    this.active = active;
    if (!active) this.key = null;
  }

  /** Stufenweise zoomen. Die Kamera folgt weiter der Figur. */
  zoomBy(steps: number): void {
    this.zoomSteps += steps;
    this.resize();
  }

  resetView(): void {
    this.zoomSteps = 0;
    this.resize();
  }

  private resize(): void {
    const box = this.container.getBoundingClientRect();
    if (!box.width || !box.height) return;
    // Ganze Gerätepixel halten die Grafik scharf. Die Stadt ist größer als das Bild, die Kamera folgt der Figur.
    const dpr = window.devicePixelRatio || 1;
    const fitted = Math.max(1, Math.floor(Math.max(box.width / 540, box.height / 360) * dpr));
    this.zoomSteps = Math.max(1 - fitted, Math.min(16 - fitted, this.zoomSteps));
    this.scale = (fitted + this.zoomSteps) / dpr;
    this.fittedScale = fitted / dpr;
    this.lowW = Math.ceil(box.width / this.scale);
    this.lowH = Math.ceil(box.height / this.scale);
    if (this.canvas.width === this.lowW && this.canvas.height === this.lowH) return;
    this.canvas.width = this.lowW;
    this.canvas.height = this.lowH;
    this.canvas.style.width = `${this.lowW * this.scale}px`;
    this.canvas.style.height = `${this.lowH * this.scale}px`;
    this.screen.imageSmoothingEnabled = false;
  }

  private tileAt(e: MouseEvent): TownTile | null {
    const box = this.canvas.getBoundingClientRect();
    const dx = (e.clientX - box.left) / this.scale - this.camX - originX();
    const dy = (e.clientY - box.top) / this.scale - this.camY - TOP;
    const tile = { i: Math.floor((dx / 16 + dy / 8) / 2), j: Math.floor((dy / 8 - dx / 16) / 2) };
    return inTown(tile) ? tile : null;
  }

  /** Die Tür eines Hauses, das der Firma gehört. Sie zählt nach der Stelle im Bild, nicht nach dem Feld. */
  private ownDoorAt(e: MouseEvent): Parcel | null {
    if (!this.company) return null;
    const box = this.canvas.getBoundingClientRect();
    const x = (e.clientX - box.left) / this.scale - this.camX;
    const y = (e.clientY - box.top) / this.scale - this.camY;
    return PARCELS.find((p) => {
      const door = parcelDoor(this.company!, p);
      if (!door) return false;
      const u = x - (originX() + (door.i - door.j) * 16);
      if (u < door.u || u >= door.u + DOOR_WIDTH) return false;
      const up = TOP + (door.i + door.j) * 8 + Math.floor(u / 2) - y;
      return up >= 0 && up < DOOR_HEIGHT;
    }) ?? null;
  }

  private onClick(e: MouseEvent): void {
    const parcel = this.ownDoorAt(e);
    if (parcel) {
      this.walkTo(parcel.entry);
      this.entering = parcel.id;
      if (!this.path.length) {
        this.entering = null;
        this.callbacks.onEnter(parcel.id);
      }
      return;
    }
    const tile = this.tileAt(e);
    if (tile) this.walkTo(tile);
  }

  private walkTo(tile: TownTile): void {
    const from = { i: Math.floor(this.x), j: Math.floor(this.y) };
    // Wer auf ein Gebäude klickt, will dorthin: Der Weg endet vor dessen Eingang.
    const parcel = PARCELS.find((p) => inParcel(p, tile));
    const target = this.blocked.has(`${tile.i},${tile.j}`) ? parcel?.entry : tile;
    if (!target) return;
    this.key = null;
    this.entering = null;
    this.path = findPath({ w: TOWN_W, d: TOWN_D }, this.blocked, from, target);
  }

  private frame(time: number): void {
    this.raf = requestAnimationFrame((t) => this.frame(t));
    if (!this.active || time - this.lastTime < 1000 / 30) return;
    // Nach einer langen Pause (Tab im Hintergrund) springt die Figur nicht quer durch die Stadt.
    const dt = Math.min(1, (time - this.lastTime) / 1000);
    this.lastTime = time;
    if (!this.company || !this.lowW) return;
    this.move(dt);
    this.draw(time);
  }

  private move(dt: number): void {
    if (!this.path.length && this.key) {
      const next = { i: Math.floor(this.x) + this.key.i, j: Math.floor(this.y) + this.key.j };
      if (inTown(next) && !this.blocked.has(`${next.i},${next.j}`)) this.path = [next];
    }
    this.walking = this.path.length > 0;
    // Auch bei wenigen Bildern pro Sekunde legt die Figur die Strecke zurück, die der verstrichenen Zeit entspricht.
    let step = SPEED * dt;
    while (step > 0 && this.path.length) {
      const next = this.path[0];
      const dx = next.i + 0.5 - this.x;
      const dy = next.j + 0.5 - this.y;
      const dist = Math.hypot(dx, dy);
      // Wie im Büro: +j läuft nach unten links, +i nach unten rechts.
      if (dist > 0.001) {
        this.view = dx < -0.01 || dy < -0.01 ? 'back' : 'front';
        this.flip = Math.abs(dx) > Math.abs(dy) ? dx > 0 : dy < 0;
      }
      if (dist <= step) {
        this.x = next.i + 0.5;
        this.y = next.j + 0.5;
        this.path.shift();
        step -= dist;
        this.updateParcel();
        if (!this.path.length && this.entering) {
          const parcelId = this.entering;
          this.entering = null;
          this.callbacks.onEnter(parcelId);
          return;
        }
        // Mit gehaltener Taste geht es nahtlos auf das nächste Feld.
        if (!this.path.length && this.key) {
          const more = { i: next.i + this.key.i, j: next.j + this.key.j };
          if (inTown(more) && !this.blocked.has(`${more.i},${more.j}`)) this.path = [more];
        }
      } else {
        this.x += (dx / dist) * step;
        this.y += (dy / dist) * step;
        step = 0;
      }
    }
  }

  private updateParcel(): void {
    const near = parcelNear({ i: Math.floor(this.x), j: Math.floor(this.y) })?.id ?? null;
    if (near === this.parcel) return;
    this.parcel = near;
    this.callbacks.onParcel(near);
  }

  private draw(time: number): void {
    const ctx = this.screen;
    const screenX = originX() + (this.x - this.y) * 16;
    const screenY = TOP + (this.x + this.y) * 8;
    const width = this.ground.canvas.width;
    const height = this.ground.canvas.height;
    const clamp = (value: number, size: number, view: number) => (size <= view ? Math.round((view - size) / 2) : Math.min(0, Math.max(view - size, value)));
    this.camX = clamp(Math.round(this.lowW / 2 - screenX), width, this.lowW);
    this.camY = clamp(Math.round(this.lowH / 2 - screenY), height, this.lowH);

    for (let y = 0; y < this.lowH + 64; y += 64) for (let x = 0; x < this.lowW + 64; x += 64) ctx.drawImage(this.field.canvas, x, y);
    ctx.drawImage(this.ground.canvas, this.camX, this.camY);

    const parts: { i: number; j: number; w: number; d: number; solid?: Piece['solid']; draw: () => void }[] = [
      ...this.pieces.map((piece) => ({ ...piece, solid: piece.solid, draw: () => ctx.drawImage(piece.image.canvas, piece.left + this.camX, piece.top + this.camY) })),
      ...TREES.map((t) => ({
        i: t.i, j: t.j, w: 1, d: 1,
        draw: () => ctx.drawImage(this.treeImages[(t.i * 7 + t.j * 3) % 3].canvas, originX() + (t.i - t.j) * 16 - 16 + this.camX, TOP + (t.i + t.j) * 8 - 40 + this.camY),
      })),
    ].sort((a, b) => a.i + a.w + a.j + a.d - (b.i + b.w + b.j + b.d));

    // Vor der Figur liegt alles, was auf beiden Achsen hinter ihr endet.
    const inFront = (part: { i: number; j: number; w: number; d: number; solid?: Piece['solid'] }) => {
      const p = part.solid ?? part;
      return this.x < p.i + p.w && this.y < p.j + p.d;
    };
    for (const part of parts) if (!inFront(part)) part.draw();
    this.drawPlayer(ctx, screenX + this.camX, screenY + this.camY, time);
    for (const part of parts) if (inFront(part)) part.draw();
    this.drawSignPosts(ctx);
    this.placeLabels(screenX + this.camX, screenY + this.camY);
  }

  private drawPlayer(ctx: Ctx, sx: number, sy: number, time: number): void {
    const x = Math.round(sx);
    const y = Math.round(sy);
    rect(ctx, x - 5, y - 1, 10, 2, 'rgba(10,16,28,.3)');
    const pose: Pose = this.walking ? 'walk' : 'stand';
    const frame = this.walking ? Math.floor(time / 110) : REDUCED_MOTION ? 0 : Math.floor(time / 520);
    const sprite = characterSprite(this.company?.ceo?.look ?? DEFAULT_CEO.look, pose, frame % 24, this.view, true);
    ctx.save();
    if (this.flip) {
      ctx.translate(x * 2, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(sprite.canvas, x - sprite.ax, y - sprite.ay);
    ctx.restore();
  }

  /** Andere Firmen, die hier sitzen. Die eigene zählt nicht: Sie steht immer vorn auf dem Schild. */
  private othersAt(parcelId: string) {
    return this.neighbors.filter((n) => n.id !== this.company!.id && n.siteId === parcelId);
  }

  /** Das Schild steht auf zwei Pfosten auf dem Dach. Die Schrift darüber bleibt so auch vergrößert scharf. */
  private drawSignPosts(ctx: Ctx): void {
    for (const p of PARCELS) {
      if (p.id !== this.company!.town.siteId && !this.othersAt(p.id).length) continue;
      const { x, y } = this.siteAnchor(p);
      // Das Schild steht quer zur Hauswand: Der linke Pfosten reicht tiefer als der rechte.
      for (const [dx, foot] of [[-20, 24], [18, 8]] as const) {
        rect(ctx, x + dx, y - 6, 2, foot + 6, '#3b4450');
        rect(ctx, x + dx + 2, y - 6, 1, foot + 6, '#20262e');
      }
      rect(ctx, x - 21, y + 12, 4, 1, '#20262e');
      rect(ctx, x + 17, y + 2, 4, 1, '#20262e');
    }
  }

  private siteAnchor(p: Parcel): { x: number; y: number } {
    const b = p.building;
    const i = (b?.i ?? p.i) + (b?.w ?? p.w) / 2;
    const j = (b?.j ?? p.j) + (b?.d ?? p.d) / 2;
    const extra = FLOOR_H * (buildingAt(this.company!.town, p.id).floors - 1);
    const height = (b ? (p.kind === 'home' || p.kind === 'house' ? 52 : 56) : 44) + extra;
    return { x: originX() + (i - j) * 16 + this.camX, y: TOP + (i + j) * 8 - height + this.camY };
  }

  /** Beschriftungen als scharfe Schrift über dem Bild. */
  private placeLabels(playerX: number, playerY: number): void {
    const wanted = new Map<string, { text: string; x: number; y: number; kind: string; parcel?: Parcel; sign?: FirmBoard[]; note?: string }>();
    wanted.set('du', { text: this.company!.ceo?.name ?? DEFAULT_CEO.name, x: playerX, y: playerY - 34, kind: 'du' });
    for (const street of STREET_LABELS) {
      wanted.set(`s-${street.name}`, { text: street.name, x: originX() + (street.i - street.j) * 16 + this.camX, y: TOP + (street.i + street.j) * 8 + this.camY, kind: 'street' });
    }
    const { town, agents } = this.company!;
    for (const p of PARCELS) {
      const anchor = this.siteAnchor(p);
      const others = this.othersAt(p.id).map((n): FirmBoard => ({ name: firmSign(n.name), since: n.createdAt, lit: false, id: n.id }));
      if (p.id === town.siteId) {
        const working = agents.filter((a) => a.live.runId).length;
        const waiting = agents.filter((a) => a.live.kind === 'review').length;
        const state = [working ? `${working} ${working === 1 ? 'arbeitet' : 'arbeiten'}` : '', waiting ? `${waiting} ${waiting === 1 ? 'wartet' : 'warten'} auf dich` : ''].filter(Boolean).join(', ');
        // Die eigene Firma steht vorn. Teilen sich mehrere ein Haus, stehen alle auf dem Schild.
        const own: FirmBoard = { name: firmSign(this.company!.name), since: this.company!.createdAt, lit: working > 0, id: this.company!.id };
        wanted.set(p.id, { text: '', x: anchor.x, y: anchor.y, kind: 'sign', parcel: p, sign: [own, ...others], note: state || 'Deine Firma' });
      } else if (others.length) {
        wanted.set(p.id, { text: '', x: anchor.x, y: anchor.y, kind: 'sign', parcel: p, sign: others });
      } else if (p.kind === 'vacant') {
        wanted.set(p.id, town.rented.includes(p.id) ? { text: 'Gemietet', x: anchor.x, y: anchor.y, kind: 'mine', parcel: p } : { text: 'Zu vermieten', x: anchor.x, y: anchor.y, kind: 'offer', parcel: p });
      } else if (p.kind === 'lot') {
        const text = town.built.includes(p.id) ? 'Dein Neubau' : town.owned.includes(p.id) ? 'Dein Grundstück' : 'Zu verkaufen';
        wanted.set(p.id, { text, x: anchor.x, y: anchor.y, kind: text === 'Zu verkaufen' ? 'offer' : 'mine', parcel: p });
      }
    }
    for (const [id, el] of this.labelEls) {
      if (wanted.has(id)) continue;
      el.remove();
      this.labelEls.delete(id);
    }
    for (const [id, label] of wanted) {
      let el = this.labelEls.get(id);
      if (!el) {
        el = document.createElement('div');
        this.labels.append(el);
        this.labelEls.set(id, el);
        if (label.parcel) {
          const entry = label.parcel.entry;
          el.addEventListener('click', () => this.walkTo(entry));
        }
      }
      if (label.sign) paintSign(el, label.sign, label.note ?? '');
      else if (el.textContent !== withoutEszett(label.text)) el.textContent = withoutEszett(label.text);
      const name = label.sign ? 'firm-sign' : `town-label town-label-${label.kind}`;
      if (el.className !== name) el.className = name;
      // Die Schräge folgt der Hauswand im Isometrie-Raster von 2 zu 1.
      el.style.transform = `translate(calc(${Math.round(label.x * this.scale)}px - 50%), calc(${Math.round(label.y * this.scale)}px - 100%))${label.sign ? ` skewY(-26.57deg) scale(${(this.scale / this.fittedScale).toFixed(3)})` : ''}`;
    }
  }
}

/* ---------- Firmenschilder ---------- */

interface FirmBoard {
  id: string;
  name: string;
  since: number;
  /** Die Lämpchen brennen nur, wenn in der Firma gerade wirklich gearbeitet wird. */
  lit: boolean;
}

/** Jede Firma behält ihre Farben, egal von wo aus man sie sieht. */
const SIGN_COLORS = ['burgund', 'petrol', 'nacht', 'wald', 'nuss'];
const signColor = (id: string) => SIGN_COLORS[[...id].reduce((sum, c) => sum + c.charCodeAt(0), 0) % SIGN_COLORS.length];

function paintSign(el: HTMLElement, boards: FirmBoard[], note: string): void {
  const key = JSON.stringify([boards, note]);
  if (el.dataset.sign === key) return;
  el.dataset.sign = key;
  el.replaceChildren(...boards.map((board) => {
    const box = document.createElement('div');
    box.className = `firm-board firm-board-${signColor(board.id)}${board.lit ? ' firm-board-lit' : ''}`;
    const name = document.createElement('strong');
    name.textContent = withoutEszett(board.name);
    const since = document.createElement('small');
    since.textContent = `Seit ${new Date(board.since).getFullYear()}`;
    box.append(name, since);
    return box;
  }));
  if (note) {
    const plaque = document.createElement('div');
    plaque.className = 'firm-plaque';
    plaque.textContent = withoutEszett(note);
    el.append(plaque);
  }
}

/* ---------- Zeichnen des Stadtbilds ---------- */

const originX = () => TOWN_D * 16 + MARGIN;

export interface TownBackdrop {
  image: Layer;
  /** Was vor dem Grundstück steht und deshalb nach dem Büro gezeichnet wird. */
  front: Layer;
  /** Die Mitte des eigenen Grundstücks im Bild. */
  x: number;
  y: number;
  /** So oft ist die Stadt zu vergrössern, damit das Büro auf sein Grundstück passt. */
  zoom: number;
  /** Das Grundstück in den Feldern des Büros: Ein Haus steht zur Strasse hin, dahinter liegt der Garten. */
  plot: { image: Layer; ox: number; oy: number; i0: number; j0: number; i1: number; j1: number };
}

let backdropCache: { key: string; backdrop: TownBackdrop } | null = null;

/** Die echte Stadt rund um den Standort der Firma, ohne das eigene Haus: An dessen Stelle steht das Büro. */
export function townBackdrop(company: Company, siteId: string, roomW: number, roomD: number, doorI: number): TownBackdrop | null {
  const site = parcelById(siteId);
  if (!site) return null;
  const key = `${siteId}:${JSON.stringify(company.town)}:${roomW}x${roomD}:${doorI}`;
  if (backdropCache?.key === key) return backdropCache.backdrop;
  const zoom = Math.max(1, Math.min(4, Math.ceil(Math.max(roomW / site.w, roomD / site.d))));
  const ground = buildGround();
  const image = layer(ground.canvas.width, ground.canvas.height);
  const field = grassField();
  for (let y = 0; y < image.canvas.height; y += 64) for (let x = 0; x < image.canvas.width; x += 64) image.ctx.drawImage(field.canvas, x, y);
  image.ctx.drawImage(ground.canvas, 0, 0);
  const trees = [buildTree(0), buildTree(1), buildTree(2)];
  const front = layer(ground.canvas.width, ground.canvas.height);
  // Davor steht, was auf einer der beiden Achsen ganz hinter dem Grundstück beginnt. Alles andere liegt unter dem Büro.
  const target = (i: number, j: number) => (i >= site.i + site.w || j >= site.j + site.d ? front : image).ctx;
  const parts: { i: number; j: number; w: number; d: number; draw: () => void }[] = [
    ...buildPieces(company, site.id).map((part) => ({ i: part.i, j: part.j, w: part.w, d: part.d, draw: () => target(part.i, part.j).drawImage(part.image.canvas, part.left, part.top) })),
    ...TREES.filter((t) => !inParcel(site, t) && !hidesHouse(site, t, roomW, roomD, zoom)).map((t) => ({
      i: t.i, j: t.j, w: 1, d: 1,
      draw: () => target(t.i, t.j).drawImage(trees[(t.i * 7 + t.j * 3) % 3].canvas, originX() + (t.i - t.j) * 16 - 16, TOP + (t.i + t.j) * 8 - 40),
    })),
  ].sort((a, b) => a.i + a.w + a.j + a.d - (b.i + b.w + b.j + b.d));
  for (const part of parts) part.draw();
  // Dieselbe Abdunklung wie im Rest der Stadt, nur auf den Häusern selbst.
  front.ctx.globalCompositeOperation = 'source-atop';
  rect(front.ctx, 0, 0, front.canvas.width, front.canvas.height, 'rgba(12, 22, 38, .16)');
  front.ctx.globalCompositeOperation = 'source-over';
  const backdrop: TownBackdrop = {
    image,
    front,
    x: originX() + (site.i + site.w / 2 - site.j - site.d) * 16,
    y: TOP + (site.i + site.w / 2 + site.j + site.d) * 8,
    zoom,
    plot: paintPlot(site, roomW, roomD, doorI, zoom, trees),
  };
  backdropCache = { key, backdrop };
  return backdrop;
}

/**
 * Die Stadt liegt unter dem Büro. Ein Baum davor käme mit dem Stamm unter dem Haus hervor, seine Krone läge dahinter.
 * Deshalb bleiben vorn alle Bäume weg, deren vergrössertes Bild in das Haus hineinragt. Dahinter stören sie nicht.
 */
function hidesHouse(site: Parcel, t: { i: number; j: number }, roomW: number, roomD: number, zoom: number): boolean {
  const anchorI = site.i + site.w / 2;
  const anchorJ = site.j + site.d;
  const gap = plotGap(site, roomD, zoom);
  // Die Lage des Baums in Feldern des Büros.
  const i = roomW / 2 + (t.i + 0.5 - anchorI) * zoom;
  const j = roomD + gap + (t.j + 0.5 - anchorJ) * zoom;
  if (i + j < roomW / 2 + roomD / 2) return false;
  const px = (i - j) * 16;
  const py = (i + j) * 8;
  const left = -roomD * 16 - 16;
  const right = roomW * 16 + 16;
  const top = -WALL_TOP;
  const bottom = (roomW + roomD) * 8 + 16;
  const size = 32 * zoom;
  return px + size > left && px - size < right && py > top && py - 50 * zoom < bottom;
}

/** Abstand des Hauses zur Strasse, in Feldern des Büros. */
export const plotGap = (site: Parcel, roomD: number, zoom: number) => Math.min(1.5, Math.max(0, (site.d * zoom - roomD) / 2));

/**
 * Das eigene Grundstück in der Schärfe des Büros. Es trägt das Haus: Rasen oder Pflaster, Weg zur Strasse, Hecke und Schatten.
 * Das Büro sitzt mit (0, 0) in seiner hinteren Ecke, darum gelten hier seine Koordinaten.
 */
function paintPlot(site: Parcel, roomW: number, roomD: number, doorI: number, zoom: number, trees: Layer[]): TownBackdrop['plot'] {
  const gap = plotGap(site, roomD, zoom);
  const i0 = roomW / 2 - (site.w * zoom) / 2;
  const i1 = roomW / 2 + (site.w * zoom) / 2;
  const j1 = roomD + gap;
  const j0 = j1 - site.d * zoom;
  const pad = 8;
  const headroom = 44;
  const ox = Math.round((j1 - i0) * 16) + pad;
  const oy = headroom + pad - Math.round((i0 + j0) * 8);
  const width = Math.ceil((i1 - i0 + j1 - j0) * 16) + pad * 2;
  const image = layer(width, Math.ceil((i1 - i0 + j1 - j0) * 8) + headroom + pad * 2);
  const pen = new Pen(image.ctx, ox, oy);
  const paved = site.kind === 'shop' || site.kind === 'vacant';
  const random = seeded(site.i * 97 + site.j);
  pen.floorPoly(i0, j0, i1 - i0, j1 - j0, paved ? '#8d8f8f' : '#4a8a50');
  // Rasen oder Pflaster nicht einfarbig. Punkte liegen nur innerhalb des Grundstücks.
  for (let n = 0; n < (i1 - i0) * (j1 - j0) * 26; n++) {
    const [x, y] = pen.pt(i0 + random() * (i1 - i0), j0 + random() * (j1 - j0));
    rect(image.ctx, x, y, paved ? 2 : 1 + Math.floor(random() * 2), 1, paved ? (random() > 0.5 ? '#818383' : '#999b9b') : random() > 0.5 ? '#569a5c' : '#3e7a46');
  }
  // Schatten des Hauses auf dem Boden. Er bindet es stärker an den Grund als jede Kante.
  pen.floorPoly(-0.3, -0.5, roomW + 1.5, roomD + 1.1, 'rgba(18, 28, 26, .32)');
  pen.floorPoly(-0.12, -0.12, roomW + 0.36, roomD + 0.36, 'rgba(18, 28, 26, .4)');
  // Der Weg von der Haustür zum Bürgersteig.
  const stone = paved ? '#a7a8a4' : '#b5ad96';
  const edge = paved ? '#8a8b88' : '#8f8772';
  pen.floorPoly(doorI + 0.04, roomD, 0.92, j1 - roomD + 0.1, edge);
  pen.floorPoly(doorI + 0.1, roomD, 0.8, j1 - roomD + 0.1, stone);
  if (!paved) {
    // Hecke an den Grenzen und Beete am Haus, offen dort, wo der Weg zur Strasse führt.
    const shades = ['#2c6a3d', '#357a46', '#46935a'];
    const hedge = (i: number, j: number) => {
      const [x, y] = pen.pt(i, j);
      for (let k = 0; k < 7; k++) rect(image.ctx, x + Math.round((random() - 0.5) * 8), y - Math.round(random() * 6), 2, 2, shades[Math.floor(random() * 3)]);
    };
    for (let i = i0 + 0.3; i < i1; i += 0.45) {
      hedge(i, j0 + 0.3);
      if (Math.abs(i - doorI - 0.5) > 0.9) hedge(i, j1 - 0.2);
      if (i > 0 && i < roomW && Math.abs(i - doorI - 0.5) > 0.9 && gap >= 1) hedge(i, roomD + 0.45);
    }
    for (let j = j0 + 0.3; j < j1; j += 0.45) {
      hedge(i0 + 0.3, j);
      hedge(i1 - 0.3, j);
    }
    // Bäume nur hinter und neben dem Haus, sonst stünden sie im Bild vor dem Büro.
    const spots: [number, number][] = [[i0 + 1.5, j0 + 1.5], [roomW * 0.35, Math.max(j0 + 1.2, -2.6)], [roomW * 0.75, Math.max(j0 + 1.2, -3.4)], [i0 + 1.2, roomD * 0.3], [i1 - 1.4, roomD * 0.3]];
    for (const [i, j] of spots) {
      if (i > i0 && i < i1 && j > j0 && j < j1 && (j < -1.6 || i < -1.2 || i > roomW + 1.8)) {
        const [x, y] = pen.pt(i, j);
        image.ctx.drawImage(trees[Math.floor(random() * 3)].canvas, x - 16, y - 40);
      }
    }
  }
  return { image, ox, oy, i0, j0, i1, j1 };
}

function grassField(): Layer {
  const l = layer(64, 64);
  rect(l.ctx, 0, 0, 64, 64, '#3f7d48');
  const random = seeded(77);
  for (let n = 0; n < 90; n++) rect(l.ctx, Math.floor(random() * 64), Math.floor(random() * 64), 2, 1, random() > 0.5 ? '#4f9457' : '#33693d');
  return l;
}

function buildGround(): Layer {
  const width = (TOWN_W + TOWN_D) * 16 + MARGIN * 2;
  const height = (TOWN_W + TOWN_D) * 8 + TOP + 60;
  const out = layer(width, height);
  const pen = new Pen(out.ctx, originX(), TOP);
  const ctx = out.ctx;
  const random = seeded(4711);

  for (let i = 0; i < TOWN_W; i++) {
    for (let j = 0; j < TOWN_D; j++) {
      const kind = tileKind(i, j);
      const parcel = PARCELS.find((p) => inParcel(p, { i, j }));
      if (kind === 'road') {
        pen.floorPoly(i, j, 1, 1, hash2(i, j) > 0.5 ? '#4b4e56' : '#474a52');
      } else if (kind === 'sidewalk') {
        pen.floorPoly(i, j, 1, 1, '#a9a69b');
        pen.floorPoly(i + 0.02, j + 0.02, 0.96, 0.96, hash2(i, j) > 0.5 ? '#b5b2a6' : '#afaca0');
      } else if (parcel?.kind === 'lot') {
        pen.floorPoly(i, j, 1, 1, hash2(i, j) > 0.5 ? '#8f7a55' : '#88734f');
      } else if (parcel?.kind === 'park') {
        pen.floorPoly(i, j, 1, 1, hash2(i, j) > 0.5 ? '#5a9e5c' : '#559858');
      } else {
        pen.floorPoly(i, j, 1, 1, hash2(i, j) > 0.5 ? '#4f8f52' : '#4a8a4e');
      }
    }
  }

  // Asphalt mit Körnung und Flicken, Bordstein, Fugen, Gullydeckel
  for (let i = 0; i < TOWN_W; i++) {
    for (let j = 0; j < TOWN_D; j++) {
      const kind = tileKind(i, j);
      if (kind === 'road') {
        if (hash2(i * 3, j) > 0.86) pen.floorPoly(i + 0.2, j + 0.25, 0.5, 0.35, '#42454d');
        if (hash2(i, j * 3) > 0.95) {
          pen.floorPoly(i + 0.34, j + 0.34, 0.32, 0.32, '#33363d');
          pen.floorPoly(i + 0.4, j + 0.4, 0.2, 0.2, '#3d4048');
        }
      } else if (kind === 'sidewalk') {
        pen.floorPoly(i + 0.49, j, 0.03, 1, '#928f85');
        pen.floorPoly(i, j + 0.49, 1, 0.03, '#928f85');
        if (i + 1 < TOWN_W && tileKind(i + 1, j) === 'road') pen.floorPoly(i + 0.9, j, 0.1, 1, '#d2cfc4');
        if (j + 1 < TOWN_D && tileKind(i, j + 1) === 'road') pen.floorPoly(i, j + 0.9, 1, 0.1, '#d2cfc4');
        if (i > 0 && tileKind(i - 1, j) === 'road') pen.floorPoly(i, j, 0.1, 1, '#8c897f');
        if (j > 0 && tileKind(i, j - 1) === 'road') pen.floorPoly(i, j, 1, 0.1, '#8c897f');
      }
    }
  }
  // Schlagschatten der Häuser und Bäume fallen nach rechts vorn.
  for (const p of PARCELS) {
    const b = p.building;
    if (!b) continue;
    const reach = p.kind === 'home' || p.kind === 'house' ? 0.9 : 0.7;
    fillPoly(ctx, [pen.pt(b.i + b.w, b.j), pen.pt(b.i + b.w + reach, b.j + reach * 0.4), pen.pt(b.i + b.w + reach, b.j + b.d + reach * 0.4), pen.pt(b.i + reach, b.j + b.d + reach * 0.4), pen.pt(b.i, b.j + b.d)], 'rgba(16,26,24,.26)');
  }
  for (const t of TREES) {
    const [x, y] = pen.pt(t.i + 0.6, t.j + 0.6);
    for (let n = 0; n < 7; n++) rect(ctx, x - 9 + n, y - 3 + n, 19 - n * 2 + 4, 1, 'rgba(16,26,24,.24)');
  }

  // Grasbüschel, Steinchen auf den Grundstücken
  for (let n = 0; n < 2600; n++) {
    const i = random() * TOWN_W;
    const j = random() * TOWN_D;
    const tile = { i: Math.floor(i), j: Math.floor(j) };
    if (tileKind(tile.i, tile.j) !== 'grass') continue;
    const onLot = PARCELS.some((p) => p.kind === 'lot' && inParcel(p, tile));
    const [x, y] = pen.pt(i, j);
    rect(ctx, x, y, 2, 1, onLot ? (random() > 0.5 ? '#a28c66' : '#75623f') : random() > 0.5 ? '#63a665' : '#3f7d48');
  }

  // Fahrbahnmarkierung, nur zwischen den Kreuzungen
  for (let i = 0; i < TOWN_W; i++) {
    for (const j of [4, 14, 24, 32]) {
      if ([12, 13, 26, 27].includes(i)) continue;
      pen.floorPoly(i + 0.15, j - 0.04, 0.5, 0.08, '#d9c36a');
    }
  }
  for (let j = 0; j < TOWN_D; j++) {
    if ([3, 4, 13, 14, 23, 24, 31, 32].includes(j)) continue;
    for (const i of [13, 27]) pen.floorPoly(i - 0.04, j + 0.15, 0.08, 0.5, '#d9c36a');
  }
  // Zebrastreifen an den Einmündungen
  for (const j of [3, 13, 23, 31]) {
    for (const i of [11, 14, 25, 28]) for (let n = 0; n < 4; n++) pen.floorPoly(i + 0.1, j + n * 0.5 + 0.06, 0.8, 0.26, '#d8d6cc');
  }

  // Einfahrt und Weg zum Elternhaus
  for (let j = 11; j < 12; j++) pen.floorPoly(4.3, j, 1.4, 1, '#a9a69b');
  pen.floorPoly(7, 10, 2, 2, '#9b988d');

  // Teich im Park
  fillPoly(ctx, [pen.pt(35, 27), pen.pt(38, 27), pen.pt(38.6, 28.2), pen.pt(36.8, 29.4), pen.pt(35, 29)], '#2f7f9a');
  fillPoly(ctx, [pen.pt(35.5, 27.4), pen.pt(37.6, 27.4), pen.pt(38, 28.1), pen.pt(36.8, 28.8), pen.pt(35.6, 28.6)], '#3a93b0');
  return out;
}

/** Drei Baumarten, damit die Stadt nicht wie gestempelt aussieht. */
function buildTree(variant = 0): Layer {
  const l = layer(32, 48);
  const ctx = l.ctx;
  rect(ctx, 14, 30, 4, 12, '#5f4630');
  rect(ctx, 14, 30, 1, 12, '#745639');
  rect(ctx, 17, 30, 1, 12, '#47331f');
  rect(ctx, 13, 40, 6, 2, '#47331f');
  const palettes = [['#2c6a3d', '#3a8549', '#57a65e', '#79c278'], ['#2a5f47', '#2f7a5a', '#4a9770', '#6db98b'], ['#5b7a2c', '#7a9a35', '#9ab84a', '#c2d36a']];
  const [deep, mid, light, tip] = palettes[variant % palettes.length];
  const random = seeded(9 + variant * 31);
  const blobs: [number, number, number, string][] = [[16, 21, 11, deep], [12, 19, 7, deep], [20, 18, 7, mid], [13, 15, 8, mid], [18, 13, 6, light], [14, 10, 4, light]];
  for (const [cx, cy, r, color] of blobs) {
    for (let n = 0; n < r * r * 4; n++) {
      const a = random() * Math.PI * 2;
      const d = Math.sqrt(random()) * r;
      rect(ctx, Math.round(cx + Math.cos(a) * d), Math.round(cy + Math.sin(a) * d * 0.9), 2, 2, color);
    }
  }
  for (let n = 0; n < 14; n++) rect(ctx, 8 + Math.floor(random() * 12), 7 + Math.floor(random() * 10), 1, 1, tip);
  return l;
}

/** Jedes Gebäude bekommt ein eigenes Bild, damit die Figur korrekt davor oder dahinter gehen kann. */
function buildPieces(company: Company, without: string | null = null): Piece[] {
  const pieces: Piece[] = [];
  for (const p of PARCELS) {
    if (p.id === without) continue;
    if (p.kind === 'lot') {
      pieces.push(paintLot(p, company));
    } else if (p.building) {
      pieces.push(piece(p.building, (pen) => {
        if (p.kind === 'home') paintHome(pen, p.building!);
        else if (p.kind === 'house') paintHouse(pen, p.building!);
        else paintShop(pen, p.building!, p.kind === 'vacant' && !company.town.rented.includes(p.id));
      }));
    }
  }
  return pieces;
}

const FLOOR_H = 30;

function piece(b: { i: number; j: number; w: number; d: number }, paint: (pen: Pen) => void, extraTop = 0): Piece {
  const left = originX() + (b.i - (b.j + b.d)) * 16 - 4;
  const right = originX() + (b.i + b.w - b.j) * 16 + 4;
  const top = TOP + (b.i + b.j) * 8 - 78 - extraTop;
  const bottom = TOP + (b.i + b.w + b.j + b.d) * 8 + 4;
  const image = layer(right - left, bottom - top);
  paint(new Pen(image.ctx, originX() - left, TOP - top));
  return { i: b.i, j: b.j, w: b.w, d: b.d, left, top, image };
}

function door(pen: Pen, b: TownBuilding, u: number, color: string): void {
  const j = b.j + b.d;
  pen.faceJ(b.i, j, 0, u - 2, 0, 14, 21, '#e6e4da');
  pen.faceJ(b.i, j, 0, u - 1, 0, 12, 20, '#20262f');
  pen.faceJ(b.i, j, 0, u, 0, 10, 19, color);
  pen.faceJ(b.i, j, 0, u + 1, 2, 8, 5, darken(color, 0.16));
  pen.faceJ(b.i, j, 0, u + 2, 10, 6, 6, '#a8dfe6');
  pen.faceJ(b.i, j, 0, u + 3, 13, 2, 2, '#ffffff');
  pen.faceJ(b.i, j, 0, u + 8, 7, 1, 2, '#f0c04a');
}

function windowJ(pen: Pen, b: TownBuilding, u: number, v: number, w: number, h: number, lit = true): void {
  const j = b.j + b.d;
  pen.faceJ(b.i, j, 0, u - 2, v - 2, w + 4, h + 4, '#e6e4da');
  pen.faceJ(b.i, j, 0, u - 1, v - 1, w + 2, h + 2, '#2a3347');
  pen.faceJ(b.i, j, 0, u, v, w, h, lit ? '#a8dfe6' : '#4a5468');
  pen.faceJ(b.i, j, 0, u, v + Math.floor(h / 2), w, Math.ceil(h / 2), lit ? '#c9eef0' : '#566076');
  if (lit) {
    // Vorhänge und ein Lichtreflex
    pen.faceJ(b.i, j, 0, u, v + h - 3, w, 3, '#f2d9a8');
    pen.faceJ(b.i, j, 0, u, v, 1, h, '#f2efe4');
    pen.faceJ(b.i, j, 0, u + w - 1, v, 1, h, '#f2efe4');
    pen.faceJ(b.i, j, 0, u + 2, v + 2, 2, 1, '#ffffff');
  }
  pen.faceJ(b.i, j, 0, u + Math.floor(w / 2), v, 1, h, '#2a3347');
  pen.faceJ(b.i, j, 0, u - 2, v - 3, w + 4, 1, '#8d8d85');
}

function windowI(pen: Pen, b: TownBuilding, u: number, v: number, w: number, h: number): void {
  const i = b.i + b.w;
  pen.faceI(i, b.j, 0, u - 2, v - 2, w + 4, h + 4, '#c9c7bd');
  pen.faceI(i, b.j, 0, u - 1, v - 1, w + 2, h + 2, '#2a3347');
  pen.faceI(i, b.j, 0, u, v, w, h, '#8fc4cc');
  pen.faceI(i, b.j, 0, u, v + Math.floor(h / 2), w, Math.ceil(h / 2), '#a8d4da');
  pen.faceI(i, b.j, 0, u + Math.floor(w / 2), v, 1, h, '#2a3347');
}

/** Holzverschalung und Sockel. Beides macht aus Kisten Häuser. */
function siding(pen: Pen, b: TownBuilding, height: number): void {
  const front = b.j + b.d;
  const width = Math.floor(b.w * 16);
  const depth = Math.floor(b.d * 16);
  for (let v = 6; v < height; v += 4) {
    pen.faceJ(b.i, front, 0, 0, v, width, 1, darken(b.color, 0.08));
    pen.faceI(b.i + b.w, b.j, 0, 0, v, depth, 1, darken(b.color, 0.24));
  }
  pen.faceJ(b.i, front, 0, 0, 0, width, 4, '#7d7f80');
  pen.faceJ(b.i, front, 0, 0, 3, width, 1, '#9a9c9d');
  pen.faceI(b.i + b.w, b.j, 0, 0, 0, depth, 4, '#66686a');
}

/** Satteldach mit First entlang i: von vorn links die Dachfläche, rechts der Giebel. */
function gabledRoof(pen: Pen, b: { i: number; j: number; w: number; d: number }, z: number, rise: number, roof: string, wall: string): void {
  const { i, j, w, d } = b;
  const ridge = j + d / 2;
  const ctx = pen.ctx;
  fillPoly(ctx, [pen.pt(i, j, z), pen.pt(i + w, j, z), pen.pt(i + w, ridge, z + rise), pen.pt(i, ridge, z + rise)], lighten(roof, 0.12));
  fillPoly(ctx, [pen.pt(i + w, j, z), pen.pt(i + w, j + d, z), pen.pt(i + w, ridge, z + rise)], darken(wall, 0.2));
  fillPoly(ctx, [pen.pt(i - 0.08, j + d + 0.08, z - 2), pen.pt(i + w + 0.08, j + d + 0.08, z - 2), pen.pt(i + w + 0.08, ridge, z + rise), pen.pt(i - 0.08, ridge, z + rise)], roof);
  // Schindelreihen auf der vorderen Dachfläche, mit versetzten Fugen.
  const rows = Math.max(3, Math.round(rise / 3));
  for (let n = 1; n < rows; n++) {
    const t = n / rows;
    const rowJ = j + d + 0.08 - (j + d + 0.08 - ridge) * t;
    const rowZ = z - 2 + (rise + 2) * t;
    const [ax, ay] = pen.pt(i - 0.08, rowJ, rowZ);
    const [bx, by] = pen.pt(i + w + 0.08, rowJ, rowZ);
    line(ctx, ax, ay, bx, by, darken(roof, 0.2));
    for (let k = (n % 2) * 0.25; k < w; k += 0.5) {
      const [sx, sy] = pen.pt(i + k, rowJ, rowZ);
      rect(ctx, Math.round(sx), Math.round(sy), 1, 2, darken(roof, 0.24));
    }
  }
  // Schornstein mit Krone
  const [cx, cy] = pen.pt(i + w * 0.72, ridge + (j + d - ridge) * 0.35, z + rise * 0.65);
  rect(ctx, cx, cy - 12, 6, 12, '#8a4a3a');
  rect(ctx, cx + 4, cy - 12, 2, 12, '#6d3a2e');
  rect(ctx, cx - 1, cy - 14, 8, 2, '#5a3028');
  const [ax, ay] = pen.pt(i - 0.08, ridge, z + rise);
  const [bx, by] = pen.pt(i + w + 0.08, ridge, z + rise);
  line(ctx, ax, ay, bx, by, lighten(roof, 0.28));
}

function paintHouse(pen: Pen, b: TownBuilding): void {
  const height = 22;
  pen.box(b.i, b.j, 0, b.w, b.d, height, tri(b.color, 0.14));
  siding(pen, b, height);
  const width = b.w * 16;
  door(pen, b, Math.floor(width / 2) - 5, '#7a4f3a');
  // Stufe vor der Tür und Blumen unter den Fenstern
  pen.box(b.i + (width / 2 - 8) / 16, b.j + b.d, 0, 1, 0.2, 2, tri('#a9a69b', 0.12));
  for (const u of [7, width - 16]) {
    if (u < 0 || (u !== 7 && width <= 40)) continue;
    pen.box(b.i + u / 16, b.j + b.d, 5, 9 / 16, 0.1, 2, tri('#6a4a2e', 0.12));
    for (let n = 0; n < 4; n++) pen.faceJ(b.i, b.j + b.d + 0.1, 0, u + 1 + n * 2, 7, 1, 1, n % 2 ? '#e5534b' : '#f8d34a');
  }
  windowJ(pen, b, 7, 9, 9, 9);
  if (width > 40) windowJ(pen, b, width - 16, 9, 9, 9);
  windowI(pen, b, Math.floor((b.d * 16) / 2) - 5, 9, 10, 9);
  gabledRoof(pen, b, height, 16, b.accent, b.color);
}

function paintHome(pen: Pen, b: TownBuilding): void {
  // Garage nebenan: flach, mit Rolltor zur Einfahrt.
  const garage: TownBuilding = { i: b.i + b.w, j: b.j + 1, w: 2, d: b.d - 1, color: b.color, accent: b.accent };
  paintHouse(pen, { ...b, accent: '#8a4438' });
  pen.box(garage.i, garage.j, 0, garage.w, garage.d, 20, tri(darken(b.color, 0.06), 0.14));
  pen.box(garage.i - 0.04, garage.j - 0.04, 20, garage.w + 0.08, garage.d + 0.08, 2, tri('#6a4a3a', 0.12));
  const j = garage.j + garage.d;
  pen.faceJ(garage.i, j, 0, 3, 0, 26, 16, '#2f3644');
  for (let v = 1; v < 15; v += 3) pen.faceJ(garage.i, j, 0, 4, v, 24, 2, '#4a5261');
  // Briefkasten an der Straße
  pen.box(b.i - 1.4, b.j + b.d + 0.5, 0, 0.1, 0.1, 10, tri('#54606b', 0.1));
  pen.box(b.i - 1.5, b.j + b.d + 0.45, 10, 0.3, 0.2, 5, tri('#3f7fd0', 0.16));
}

function paintShop(pen: Pen, b: TownBuilding, closed: boolean): void {
  // Amerikanische Hauptstraße: flaches Dach, hohe Schaufassade, Markise über den Fenstern.
  const height = 30;
  const front = b.j + b.d;
  const width = b.w * 16;
  pen.box(b.i, b.j, 0, b.w, b.d, height, tri(b.color, 0.14));
  // Backstein: versetzte Fugen, Sockel, Gesims
  for (let v = 2; v < height; v += 3) {
    pen.faceJ(b.i, front, 0, 0, v, width, 1, darken(b.color, 0.09));
    for (let u = v % 2 ? 2 : 6; u < width; u += 8) pen.faceJ(b.i, front, 0, u, v + 1, 1, 2, darken(b.color, 0.09));
  }
  pen.faceJ(b.i, front, 0, 0, 0, width, 3, '#6d7076');
  pen.box(b.i, front - 0.14, height, b.w, 0.14, 12, tri(darken(b.color, 0.1), 0.12));
  pen.box(b.i - 0.03, front - 0.14, height + 12, b.w + 0.06, 0.18, 2, tri(lighten(b.color, 0.18), 0.1));
  pen.box(b.i, b.j, height, b.w, 0.1, 3, tri(darken(b.color, 0.2), 0.1));
  pen.box(b.i + b.w - 0.1, b.j, height, 0.1, b.d, 3, tri(darken(b.color, 0.2), 0.1));
  windowJ(pen, b, 5, 5, Math.floor(width / 2) - 13, 13, !closed);
  windowJ(pen, b, Math.floor(width / 2) + 8, 5, Math.floor(width / 2) - 13, 13, !closed);
  door(pen, b, Math.floor(width / 2) - 5, closed ? '#4a5261' : '#2f6f62');
  for (let u = Math.floor(b.d * 16 / 4); u < b.d * 16 - 8; u += 22) windowI(pen, b, u, 14, 11, 8);
  if (closed) {
    // Vernagelt: zwei Latten quer über die Schaufenster, ein Schild in der Tür.
    for (const u of [5, Math.floor(width / 2) + 8]) {
      pen.faceJ(b.i, front, 0, u, 8, Math.floor(width / 2) - 13, 2, '#8a6443');
      pen.faceJ(b.i, front, 0, u, 13, Math.floor(width / 2) - 13, 2, '#7a5a3e');
    }
    pen.faceJ(b.i, front, 0, Math.floor(width / 2) - 3, 9, 6, 5, '#f2efe4');
    return;
  }
  pen.faceJ(b.i, front, 24, 3, 0, width - 6, 6, b.accent);
  for (let u = 3; u < width - 6; u += 8) pen.faceJ(b.i, front, 22, u, 0, 4, 5, '#f2efe4');
  for (let u = 7; u < width - 6; u += 8) pen.faceJ(b.i, front, 22, u, 0, 4, 5, b.accent);
  pen.faceJ(b.i, front, height, 5, 2, width - 10, 7, '#f2efe4');
  pen.faceJ(b.i, front, height, 8, 4, Math.max(4, width - 16), 2, darken(b.color, 0.25));
}

/** Der Neubau auf einem Grundstück. Etwas Abstand zur Grenze; vorn bleibt der Weg zur Straße frei. Ein Anbau füllt das Grundstück nach und nach. */
function builtBox(p: Parcel, company: Company) {
  const house = buildingAt(company.town, p.id);
  const limits = p.locationId ? buildLimits(p.locationId) : null;
  const share = (done: number, most: number | undefined) => 0.72 + 0.28 * (most ? done / most : 1);
  const bw = (p.w - 1) * share(house.w, limits?.w);
  const bd = (p.d - 1.4) * share(house.d, limits?.d);
  return { i: p.i + 0.5, j: p.j + p.d - 0.9 - bd, w: bw, d: bd };
}

const DOOR_WIDTH = 14;
const DOOR_HEIGHT = 21;

/** Wo die Tür eines Hauses der Firma sitzt: immer mittig in der Front. Fremde Häuser haben hier keine. */
function parcelDoor(company: Company, site: Parcel): { i: number; j: number; u: number } | null {
  const { town } = company;
  const own = site.id === town.siteId || site.kind === 'home' || town.rented.includes(site.id) || town.built.includes(site.id);
  if (!own) return null;
  const b = site.kind === 'lot' ? (town.built.includes(site.id) ? builtBox(site, company) : null) : site.building ?? null;
  return b ? { i: b.i, j: b.j + b.d, u: Math.floor((b.w * 16) / 2) - 7 } : null;
}

function paintLot(p: Parcel, company: Company): Piece {
  const owned = company.town.owned.includes(p.id);
  const built = company.town.built.includes(p.id);
  const { i, j, w, d } = p;
  if (built) {
    const house = buildingAt(company.town, p.id);
    const b = builtBox(p, company);
    const walls = 44 + FLOOR_H * (house.floors - 1);
    return { solid: b, ...piece({ i, j, w, d }, (pen) => {
      pen.box(b.i, b.j, 0, b.w, b.d, walls, tri('#c8d2d0', 0.14));
      pen.box(b.i - 0.04, b.j - 0.04, walls, b.w + 0.08, b.d + 0.08, 3, tri('#2f6f62', 0.14));
      const front = b.j + b.d;
      const width = Math.floor(b.w * 16);
      // Sockel, Fensterbänder mit Pfosten, Technik auf dem Dach
      pen.faceJ(b.i, front, 0, 0, 0, width, 4, '#7d8688');
      pen.box(b.i + 0.3, b.j + 0.3, walls + 3, 0.6, 0.5, 5, tri('#8d97a3', 0.14));
      pen.box(b.i + b.w - 0.9, b.j + b.d / 2, walls + 3, 0.5, 0.4, 3, tri('#59636f', 0.14));
      for (const v of [8, 26]) pen.faceJ(b.i, front, 0, 4, v, width - 8, 12, v === 8 ? '#3e5a66' : '#a8dfe6');
      for (let f = 1; f < house.floors; f++) pen.faceJ(b.i, front, 0, 4, 44 + (f - 1) * FLOOR_H + 8, width - 8, 14, '#a8dfe6');
      for (let u = 12; u < width - 8; u += 10) for (let f = 0; f < house.floors; f++) pen.faceJ(b.i, front, 0, u, f === 0 ? 8 : 44 + (f - 1) * FLOOR_H + 8, 1, f === 0 ? 30 : 14, '#3e5a66');
      pen.faceJ(b.i, front, 0, Math.floor(width / 2) - 7, 0, 14, 21, '#20262f');
      pen.faceJ(b.i, front, 0, Math.floor(width / 2) - 6, 0, 12, 20, '#a8dfe6');
      pen.faceJ(b.i, front, 40, 6, 0, width - 12, 4, '#f8b62d');
    }, FLOOR_H * (house.floors - 1)) };
  }
  return piece({ i, j, w, d }, (pen) => {
    if (owned) {
      // Abgesteckt: Pflöcke an den Ecken und eine Fahne.
      for (const [a, b] of [[i + 0.2, j + 0.2], [i + w - 0.3, j + 0.2], [i + 0.2, j + d - 0.3], [i + w - 0.3, j + d - 0.3]]) pen.box(a, b, 0, 0.1, 0.1, 10, tri('#f8b62d', 0.14));
      const [fx, fy] = pen.pt(i + w / 2, j + d / 2, 26);
      pen.box(i + w / 2, j + d / 2, 0, 0.06, 0.06, 26, tri('#54606b', 0.1));
      rect(pen.ctx, fx + 1, fy, 10, 6, '#f8b62d');
      return;
    }
    // Schild am Straßenrand
    const a = p.entry.i;
    const b = j + d - 0.6;
    pen.box(a - 0.5, b, 0, 0.1, 0.1, 15, tri('#6a4a2e', 0.12));
    pen.box(a + 0.3, b, 0, 0.1, 0.1, 15, tri('#6a4a2e', 0.12));
    pen.box(a - 0.6, b, 12, 1.1, 0.06, 11, tri('#f2efe4', 0.08));
    pen.faceJ(a - 0.6, b + 0.06, 12, 3, 3, 12, 2, '#b5493f');
    pen.faceJ(a - 0.6, b + 0.06, 12, 3, 6, 8, 2, '#b5493f');
  });
}
