// Die Stadt draußen vor der Tür. Die Spielerfigur läuft hier herum, Kulisse sind nur Häuser und Bäume:
// Wem ein Grundstück gehört und was in der Firma läuft, kommt aus dem Server-Stand.

import { show } from '../ui/html.ts';
import { buildingAt, roomAt } from '../../shared/building.ts';
import { CITIES, PARCELS, STREET_LABELS, cityOf, decorIn, firmSign, isBlocked, laneMark, parcelAt, parcelsIn, placeById, placesIn, roomBox, TOWN_D, townPath, inParcel, inTown, parcelById, parcelNear, tileKind, type City, type DecorKind, type Parcel, type TownBuilding, type TownTile } from '../../shared/town.ts';
import { DEFAULT_CEO } from '../../shared/catalog.ts';
import type { Company } from '../../shared/types.ts';
import { WorldMap } from './worldmap.ts';
import { isGeneric, lotLook, setCitySalts, styleOf, type BuildingStyle, type Fence, type Ground, type RoofStyle } from './styles.ts';
import { characterSprite, type Pose, type View } from './characters.ts';
import { Pen, darken, fillPoly, hash2, layer, lighten, line, rect, seeded, tri, type Ctx, type Layer } from './pixel.ts';

const SPEED = 10;
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
  /** Die Figur ist in einer anderen Stadt angekommen. */
  onCity(city: City | null): void;
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
  width: number;
  height: number;
  /** Erst zeichnen, wenn das Haus ins Bild kommt: Auf der Karte stehen viele Häuser, die man nie sieht. */
  image(): Layer;
}

export class TownView {
  private readonly container: HTMLElement;
  private readonly callbacks: TownCallbacks;
  private readonly canvas: HTMLCanvasElement;
  private readonly screen: CanvasRenderingContext2D;
  private readonly labels: HTMLDivElement;
  private readonly labelEls = new Map<string, HTMLDivElement>();
  private neighbors: { id: string; name: string; siteId: string; createdAt: number }[] = [];
  private map: WorldMap | null = null;
  private city: City | null = null;
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
  /** Eigene Neubauten stehen auf Grund, der sonst frei ist. */
  private built = new Set<string>();
  private readonly onKeyDown: (e: KeyboardEvent) => void;
  private readonly onKeyUp: (e: KeyboardEvent) => void;

  constructor(container: HTMLElement, callbacks: TownCallbacks) {
    this.container = container;
    this.callbacks = callbacks;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'world-canvas';
    this.canvas.setAttribute('role', 'img');
    this.canvas.setAttribute('aria-label', show('Die Stadt Silly Valley. Laufe per Klick oder mit den Pfeiltasten.'));
    this.screen = this.canvas.getContext('2d')!;
    this.labels = document.createElement('div');
    this.labels.className = 'world-labels';
    container.append(this.canvas, this.labels);
    // Am Behälter, damit auch Schilder und Namen unter dem Zeiger das Zoomen nicht schlucken.
    container.addEventListener('wheel', (e) => {
      if (this.map) return;
      e.preventDefault();
      this.wheelSum += e.deltaY;
      if (Math.abs(this.wheelSum) < 40) return;
      this.zoomBy(this.wheelSum < 0 ? 1 : -1);
      this.wheelSum = 0;
    }, { passive: false });
    new ResizeObserver(() => this.resize()).observe(container);
    this.canvas.addEventListener('click', (e) => this.onClick(e));
    this.canvas.addEventListener('pointermove', (e) => {
      this.canvas.style.cursor = this.ownDoorAt(e) ? 'pointer' : 'default';
    });
    this.onKeyDown = (e) => {
      if (!this.active || this.callbacks.keyboardBlocked()) return;
      if ((e.key === 'm' || e.key === 'M') && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        this.toggleMap();
        return;
      }
      const step = KEYS[e.key];
      if (!step || this.map) return;
      e.preventDefault();
      // Gehaltene Tasten führt move() fort; die Wiederholungen des Systems ändern nichts daran.
      if (e.repeat) return;
      this.entering = null;
      this.key = step;
      // Der erste Schritt steht sofort fest, damit auch ein kurzes Antippen zwischen zwei Bildern zählt.
      const from = { i: Math.floor(this.x), j: Math.floor(this.y) };
      const next = { i: from.i + step.i, j: from.j + step.j };
      this.path = this.free(next.i, next.j) ? [next] : [];
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
    setCitySalts(company.town.citySalts ?? {});
    const key = JSON.stringify(company.town);
    if (key === this.stateKey) return;
    this.stateKey = key;
    // Ein Neubau steht auf einem Grundstück, das vorher begehbar war. Durch ihn hindurch geht es nicht mehr.
    this.built = new Set();
    for (const id of company.town.built) {
      const parcel = parcelById(id);
      if (!parcel) continue;
      const solid = builtBox(parcel, company);
      for (let i = Math.floor(solid.i); i < solid.i + solid.w; i++) for (let j = Math.floor(solid.j); j < solid.j + solid.d; j++) this.built.add(`${i},${j}`);
    }
  }

  private isTaken(i: number, j: number): boolean {
    return this.built.has(`${i},${j}`) || isBlocked(i, j);
  }

  private free(i: number, j: number): boolean {
    return inTown({ i, j }) && !this.isTaken(i, j);
  }

  /** Die Übersichtskarte. Ein Klick auf einen Ort bringt die Figur dorthin. */
  toggleMap(zoom?: number): void {
    if (this.map) {
      this.map.close();
      return;
    }
    if (!this.company) return;
    // Die Figur bleibt stehen, sobald die Karte aufgeht: Ein Weg, der noch läuft, wird abgebrochen.
    this.key = null;
    this.path = [];
    this.entering = null;
    this.walking = false;
    const home = parcelById(this.company.town.siteId);
    this.map = new WorldMap(this.container, {
      player: { i: Math.floor(this.x), j: Math.floor(this.y) },
      zoom,
      home: home?.entry ?? null,
      onTravel: (id) => this.travelTo(id),
      onClose: () => {
        this.map = null;
      },
    });
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
    if (this.map) {
      this.map.zoomBy(steps);
      return;
    }
    // Weiter hinaus geht es auf der Karte, bis die ganze Welt zu sehen ist.
    if (steps < 0 && this.scale * (window.devicePixelRatio || 1) <= 1) {
      this.toggleMap(1);
      return;
    }
    this.zoomSteps += steps;
    this.resize();
  }

  /** So weit hinaus, wie die Stadtansicht geht. Der nächste Schritt öffnet die Karte. */
  zoomToEdge(): void {
    this.zoomSteps = -1000;
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
    return this.parcelsInView().find((p) => {
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
    const parcel = parcelAt(tile.i, tile.j);
    const target = this.isTaken(tile.i, tile.j) ? parcel?.entry : tile;
    if (!target) return;
    this.key = null;
    this.entering = null;
    this.path = townPath(from, target, (i, j) => this.isTaken(i, j));
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
      if (this.free(next.i, next.j)) this.path = [next];
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
          if (this.free(more.i, more.j)) this.path = [more];
        }
      } else {
        this.x += (dx / dist) * step;
        this.y += (dy / dist) * step;
        step = 0;
      }
    }
  }

  /** Mit der Bahn: Die Figur steht danach an der Hauptstrasse der gewählten Stadt. */
  travelTo(cityId: string): void {
    const city = CITIES.find((c) => c.id === cityId);
    const entry = city ? PARCELS.find((p) => cityOf(p.i, p.j)?.id === city.id && p.building)?.entry : placeById(cityId)?.entry;
    if (!entry) return;
    this.x = entry.i + 0.5;
    this.y = entry.j + 0.5;
    this.path = [];
    this.key = null;
    this.entering = null;
    this.updateParcel();
  }

  private updateParcel(): void {
    const city = cityOf(Math.floor(this.x), Math.floor(this.y));
    if (city !== this.city) {
      this.city = city;
      this.callbacks.onCity(city);
    }
    const near = parcelNear({ i: Math.floor(this.x), j: Math.floor(this.y) })?.id ?? null;
    if (near === this.parcel) return;
    this.parcel = near;
    this.callbacks.onParcel(near);
  }

  private draw(time: number): void {
    const ctx = this.screen;
    const screenX = originX() + (this.x - this.y) * 16;
    const screenY = TOP + (this.x + this.y) * 8;
    this.camX = Math.round(this.lowW / 2 - screenX);
    this.camY = Math.round(this.lowH / 2 - screenY);

    drawGround(ctx, this.camX, this.camY, this.lowW, this.lowH);
    const parts = visibleParts(ctx, this.company!, this.camX, this.camY, this.lowW, this.lowH);

    // Vor der Figur liegt alles, was auf beiden Achsen hinter ihr endet.
    const inFront = (part: Part) => {
      const p = part.solid ?? part;
      return this.x < p.i + p.w && this.y < p.j + p.d;
    };
    for (const part of parts) if (!inFront(part)) part.draw();
    this.drawPlayer(ctx, screenX + this.camX, screenY + this.camY, time);
    for (const part of parts) if (inFront(part)) part.draw();
    this.drawSignPosts(ctx);
    this.placeLabels(screenX + this.camX, screenY + this.camY);
  }

  private parcelsInView(): Parcel[] {
    const r = tilesInView(this.camX, this.camY, this.lowW, this.lowH);
    return parcelsIn(r.i0, r.j0, r.i1, r.j1);
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
    for (const p of this.parcelsInView()) {
      if (p.id !== this.company!.town.siteId && !this.othersAt(p.id).length) continue;
      const { x, y } = this.siteAnchor(p);
      if (x < -60 || y < -60 || x > this.lowW + 60 || y > this.lowH + 60) continue;
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
    const built = p.kind === 'lot' && this.company!.town.built.includes(p.id) ? builtBox(p, this.company!) : null;
    const b = p.building ?? built;
    const i = (b?.i ?? p.i) + (b?.w ?? p.w) / 2;
    const j = (b?.j ?? p.j) + (b?.d ?? p.d) / 2;
    const extra = FLOOR_H * (buildingAt(this.company!.town, p.id).floors - 1);
    const height = (b ? buildingHeight(p) + 8 : 26) + extra;
    return { x: originX() + (i - j) * 16 + this.camX, y: TOP + (i + j) * 8 - height + this.camY };
  }

  /** Beschriftungen als scharfe Schrift über dem Bild. */
  private placeLabels(playerX: number, playerY: number): void {
    const wanted = new Map<string, { text: string; x: number; y: number; kind: string; parcel?: Parcel; sign?: FirmBoard[]; note?: string }>();
    wanted.set('du', { text: this.company!.ceo?.name ?? DEFAULT_CEO.name, x: playerX, y: playerY - 34, kind: 'du' });
    const seen = (x: number, y: number) => x > -220 && y > -160 && x < this.lowW + 220 && y < this.lowH + 220;
    for (const street of STREET_LABELS) {
      if (!seen(originX() + (street.i - street.j) * 16 + this.camX, TOP + (street.i + street.j) * 8 + this.camY)) continue;
      wanted.set(`s-${street.name}-${street.i}`, { text: street.name, x: originX() + (street.i - street.j) * 16 + this.camX, y: TOP + (street.i + street.j) * 8 + this.camY, kind: 'street' });
    }
    const view = tilesInView(this.camX, this.camY, this.lowW, this.lowH);
    for (const place of placesIn(view.i0, view.j0, view.i1, view.j1)) {
      if (!('w' in place)) continue;
      const { i, j } = place;
      const x = originX() + (i - j) * 16 + this.camX;
      const y = TOP + (i + j) * 8 + this.camY;
      if (seen(x, y)) wanted.set(`o-${place.id}`, { text: place.name, x, y, kind: 'street' });
    }
    const { town, agents } = this.company!;
    for (const p of this.parcelsInView()) {
      const anchor = this.siteAnchor(p);
      if (!seen(anchor.x, anchor.y)) continue;
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
      else if (el.textContent !== show(label.text)) el.textContent = show(label.text);
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
    name.textContent = show(board.name);
    const since = document.createElement('small');
    since.textContent = show(`Seit ${new Date(board.since).getFullYear()}`);
    box.append(name, since);
    return box;
  }));
  if (note) {
    const plaque = document.createElement('div');
    plaque.className = 'firm-plaque';
    plaque.textContent = show(note);
    el.append(plaque);
  }
}

/* ---------- Zeichnen des Stadtbilds ---------- */

const originX = () => TOWN_D * 16 + MARGIN;

export interface TownBackdropPlot {
  image: Layer;
  ox: number;
  oy: number;
}

let plotCache: { key: string; plot: TownBackdropPlot } | null = null;
let trees: Layer[] | null = null;
const treeImages = () => (trees ??= [buildTree(0), buildTree(1), buildTree(2)]);

/** Der Ausschnitt der Karte, den die Kamera zeigt, mit Rand für hohe Häuser und Berge. */
function tilesInView(camX: number, camY: number, viewW: number, viewH: number) {
  const x0 = -camX - originX() - 90;
  const x1 = viewW - camX - originX() + 90;
  const y0 = -camY - TOP - 30;
  const y1 = viewH - camY - TOP + 230;
  return { i0: Math.floor((x0 / 16 + y0 / 8) / 2), i1: Math.ceil((x1 / 16 + y1 / 8) / 2), j0: Math.floor((y0 / 8 - x1 / 16) / 2), j1: Math.ceil((y1 / 8 - x0 / 16) / 2) };
}

/** Wie die Kamera der Stadt stehen muss, damit die hintere Ecke des Büros auf (sx, sy) liegt. */
function cameraAround(site: Parcel, roomW: number, roomD: number, sx: number, sy: number) {
  const box = roomBox(site, roomW, roomD);
  return { box, camX: sx - (originX() + (box.i - box.j) * 16), camY: sy - (TOP + (box.i + box.j) * 8) };
}

/** Was vom Grundstück aus gesehen davor steht und darum nach dem Büro gezeichnet wird. */
const standsInFront = (site: Parcel, part: Part) => part.i >= site.i + site.w || part.j >= site.j + site.d;

/** Die Stadt rund ums Büro, Feld für Feld in derselben Grösse wie das Büro. Das eigene Haus fehlt: An seiner Stelle steht der Raum. */
export function drawTownBehind(ctx: Ctx, company: Company, siteId: string, roomW: number, roomD: number, doorI: number, sx: number, sy: number, viewW: number, viewH: number): boolean {
  const site = parcelById(siteId);
  if (!site) return false;
  const { box, camX, camY } = cameraAround(site, roomW, roomD, sx, sy);
  drawGround(ctx, camX, camY, viewW, viewH);
  const parts = visibleParts(ctx, company, camX, camY, viewW, viewH, site);
  for (const part of parts) if (!standsInFront(site, part)) part.draw();
  const key = `${siteId}:${roomW}x${roomD}:${doorI}`;
  if (plotCache?.key !== key) plotCache = { key, plot: paintPlot(site, box, roomW, roomD, doorI) };
  ctx.drawImage(plotCache.plot.image.canvas, sx - plotCache.plot.ox, sy - plotCache.plot.oy);
  return true;
}

export function drawTownInFront(ctx: Ctx, company: Company, siteId: string, roomW: number, roomD: number, sx: number, sy: number, viewW: number, viewH: number): void {
  const site = parcelById(siteId);
  if (!site) return;
  const { camX, camY } = cameraAround(site, roomW, roomD, sx, sy);
  for (const part of visibleParts(ctx, company, camX, camY, viewW, viewH, site)) if (standsInFront(site, part)) part.draw();
}

interface Part {
  i: number;
  j: number;
  w: number;
  d: number;
  solid?: Piece['solid'];
  draw: () => void;
}

/** Häuser, Bäume und Berge im Bild, von hinten nach vorn. */
function visibleParts(ctx: Ctx, company: Company, camX: number, camY: number, viewW: number, viewH: number, without: Parcel | null = null): Part[] {
  const parts: Part[] = [];
  const view = tilesInView(camX, camY, viewW, viewH);
  for (const parcel of parcelsIn(view.i0, view.j0, view.i1, view.j1)) {
    if (parcel.id === without?.id) continue;
    const found = pieceOf(company, parcel);
    if (!found) continue;
    const x = found.left + camX;
    const y = found.top + camY;
    if (x > viewW || y > viewH || x + found.width < 0 || y + found.height < 0) continue;
    parts.push({ i: found.i, j: found.j, w: found.w, d: found.d, solid: found.solid, draw: () => ctx.drawImage(found.image().canvas, x, y) });
  }
  for (const t of decorIn(view.i0, view.j0, view.i1, view.j1)) {
    const sprite = decorSprite(t.kind, t.i, t.j);
    const x = originX() + (t.i - t.j) * 16 - sprite.ax + camX;
    const y = TOP + (t.i + t.j) * 8 - sprite.ay + camY;
    if (x > viewW || y > viewH || x + sprite.image.canvas.width < 0 || y + sprite.image.canvas.height < 0) continue;
    if (without && inParcel(without, t)) continue;
    parts.push({ i: t.i, j: t.j, w: 1, d: 1, draw: () => ctx.drawImage(sprite.image.canvas, x, y) });
  }
  return parts.sort((a, b) => a.i + a.w + a.j + a.d - (b.i + b.w + b.j + b.d));
}

/**
 * Das eigene Grundstück: Rasen oder Pflaster, Weg von der Haustür zum Gehweg, Hecke und Schatten des Hauses.
 * Das Büro sitzt mit (0, 0) in seiner hinteren Ecke, darum gelten hier seine Koordinaten.
 */
function paintPlot(site: Parcel, box: { i: number; j: number }, roomW: number, roomD: number, doorI: number): TownBackdropPlot {
  const i0 = site.i - box.i;
  const i1 = i0 + site.w;
  const j0 = site.j - box.j;
  const j1 = j0 + site.d;
  const pad = 8;
  const headroom = 44;
  const ox = Math.round((j1 - i0) * 16) + pad;
  const oy = headroom + pad - Math.round((i0 + j0) * 8);
  const image = layer(Math.ceil((i1 - i0 + j1 - j0) * 16) + pad * 2, Math.ceil((i1 - i0 + j1 - j0) * 8) + headroom + pad * 2);
  const pen = new Pen(image.ctx, ox, oy);
  const paved = site.kind === 'shop' || site.kind === 'vacant';
  const random = seeded(site.i * 97 + site.j);
  pen.floorPoly(i0, j0, i1 - i0, j1 - j0, paved ? '#8d8f8f' : '#4a8a50');
  for (let n = 0; n < (i1 - i0) * (j1 - j0) * 26; n++) {
    const [x, y] = pen.pt(i0 + random() * (i1 - i0), j0 + random() * (j1 - j0));
    rect(image.ctx, x, y, paved ? 2 : 1 + Math.floor(random() * 2), 1, paved ? (random() > 0.5 ? '#818383' : '#999b9b') : random() > 0.5 ? '#569a5c' : '#3e7a46');
  }
  // Schatten des Hauses auf dem Boden. Er bindet es stärker an den Grund als jede Kante.
  pen.floorPoly(-0.3, -0.5, roomW + 1.5, roomD + 1.1, 'rgba(18, 28, 26, .32)');
  pen.floorPoly(-0.12, -0.12, roomW + 0.36, roomD + 0.36, 'rgba(18, 28, 26, .4)');
  // Der Weg von der Haustür zum Gehweg.
  pen.floorPoly(doorI + 0.04, roomD, 0.92, j1 - roomD + 0.1, paved ? '#8a8b88' : '#8f8772');
  pen.floorPoly(doorI + 0.1, roomD, 0.8, j1 - roomD + 0.1, paved ? '#a7a8a4' : '#b5ad96');
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
      if (i > 0 && i < roomW && Math.abs(i - doorI - 0.5) > 0.9 && j1 - roomD >= 1) hedge(i, roomD + 0.45);
    }
    for (let j = j0 + 0.3; j < j1; j += 0.45) {
      hedge(i0 + 0.3, j);
      hedge(i1 - 0.3, j);
    }
    // Bäume nur hinter und neben dem Haus, sonst stünden sie im Bild vor dem Büro.
    const spots: [number, number][] = [[i0 + 1.5, j0 + 1.5], [roomW * 0.35, j0 + 1.2], [roomW * 0.75, j0 + 1.4], [i0 + 1.2, roomD * 0.3], [i1 - 1.4, roomD * 0.3]];
    for (const [i, j] of spots) {
      if (i > i0 && i < i1 && j > j0 && j < j1 && (j < -1.6 || i < -1.2 || i > roomW + 1.8)) {
        const [x, y] = pen.pt(i, j);
        image.ctx.drawImage(treeImages()[Math.floor(random() * 3)].canvas, x - 16, y - 40);
      }
    }
  }
  return { image, ox, oy };
}

/* ---------- Der Boden ---------- */

const CHUNK_W = 768;
const CHUNK_H = 384;
const MAX_CHUNKS = 96;
const chunks = new Map<string, Layer>();

function paintTile(pen: Pen, i: number, j: number): void {
  const kind = tileKind(i, j);
  const shade = hash2(i, j) > 0.5;
  if (kind === 'water') {
    const shore = [tileKind(i + 1, j), tileKind(i - 1, j), tileKind(i, j + 1), tileKind(i, j - 1)].some((k) => k !== 'water' && k !== 'bridge');
    pen.floorPoly(i, j, 1, 1, shore ? '#3d94a3' : shade ? '#2b7c8f' : '#27768a');
    if (hash2(i * 2, j) > 0.8) pen.floorPoly(i + 0.2, j + 0.4, 0.5, 0.06, '#4f9fae');
    return;
  }
  if (kind === 'bridge') {
    pen.floorPoly(i, j, 1, 1, shade ? '#8a6c4a' : '#7f6343');
    pen.floorPoly(i, j + 0.48, 1, 0.04, '#5f4630');
    pen.floorPoly(i + 0.48, j, 0.04, 1, '#5f4630');
    for (const [a, b, w, d] of [[1, 0, 0.08, 1], [-1, 0, 0.08, 1], [0, 1, 1, 0.08], [0, -1, 1, 0.08]]) {
      if (tileKind(i + a, j + b) !== 'water') continue;
      pen.floorPoly(i + (a > 0 ? 0.92 : 0), j + (b > 0 ? 0.92 : 0), w, d, '#d7c7a6');
    }
    return;
  }
  if (kind === 'beach' || kind === 'sand') {
    const [light, dark] = kind === 'beach' ? ['#e3d3a3', '#dbc997'] : ['#cfb078', '#c6a66e'];
    pen.floorPoly(i, j, 1, 1, shade ? light : dark);
    if (hash2(i * 3, j * 5) > 0.75) pen.floorPoly(i + 0.2, j + 0.5, 0.5, 0.08, kind === 'beach' ? '#cdbb8a' : '#b39560');
    return;
  }
  if (kind === 'rock' || kind === 'snow') {
    const [light, dark, spot] = kind === 'rock' ? ['#7f7b74', '#77736c', '#68645e'] : ['#e8edf0', '#dfe6ea', '#c6d2da'];
    pen.floorPoly(i, j, 1, 1, shade ? light : dark);
    if (hash2(i * 5, j * 3) > 0.7) pen.floorPoly(i + 0.2, j + 0.3, 0.4, 0.3, spot);
    return;
  }
  if (kind === 'forest') {
    pen.floorPoly(i, j, 1, 1, shade ? '#34703f' : '#2f683a');
    if (hash2(i * 5, j * 3) > 0.7) pen.floorPoly(i + 0.3, j + 0.3, 0.3, 0.2, '#285a33');
    return;
  }
  if (kind === 'field') {
    // Jeder Acker hat seine Frucht und eine Richtung der Furchen.
    const plot = hash2(Math.floor(i / 12), Math.floor(j / 12));
    const [light, dark] = plot < 0.33 ? ['#c9ad54', '#b89c47'] : plot < 0.66 ? ['#7fa04a', '#6f903f'] : ['#8a6d48', '#7c613e'];
    pen.floorPoly(i, j, 1, 1, (plot > 0.5 ? i : j) % 2 === 0 ? light : dark);
    return;
  }
  if (kind === 'road') {
    pen.floorPoly(i, j, 1, 1, shade ? '#4b4e56' : '#474a52');
    if (hash2(i * 3, j) > 0.9) pen.floorPoly(i + 0.2, j + 0.25, 0.5, 0.35, '#42454d');
    const lane = laneMark(i, j);
    if (lane.alongI && i % 2 === 0) pen.floorPoly(i + 0.15, j - 0.04, 0.9, 0.08, '#d9c36a');
    if (lane.alongJ && j % 2 === 0) pen.floorPoly(i - 0.04, j + 0.15, 0.08, 0.9, '#d9c36a');
    return;
  }
  if (kind === 'sidewalk') {
    pen.floorPoly(i, j, 1, 1, '#a9a69b');
    pen.floorPoly(i + 0.02, j + 0.02, 0.96, 0.96, shade ? '#b5b2a6' : '#afaca0');
    pen.floorPoly(i + 0.49, j, 0.03, 1, '#928f85');
    pen.floorPoly(i, j + 0.49, 1, 0.03, '#928f85');
    if (tileKind(i + 1, j) === 'road') pen.floorPoly(i + 0.9, j, 0.1, 1, '#d2cfc4');
    if (tileKind(i, j + 1) === 'road') pen.floorPoly(i, j + 0.9, 1, 0.1, '#d2cfc4');
    if (tileKind(i - 1, j) === 'road') pen.floorPoly(i, j, 0.1, 1, '#8c897f');
    if (tileKind(i, j - 1) === 'road') pen.floorPoly(i, j, 1, 0.1, '#8c897f');
    return;
  }
  const parcel = parcelAt(i, j);
  const lot = parcel?.kind === 'lot' ? GROUND[lotLook(parcel).ground] : null;
  const color = lot ? (shade ? lot.light : lot.dark) : parcel?.kind === 'park' ? (shade ? '#5a9e5c' : '#559858') : parcel?.kind === 'shop' || parcel?.kind === 'vacant' || parcel?.kind === 'office' ? (shade ? '#8d8f8f' : '#868888') : shade ? '#4f8f52' : '#4a8a4e';
  pen.floorPoly(i, j, 1, 1, color);
  // Grasbüschel und Steinchen
  if (hash2(i * 5, j * 3) > 0.7) {
    const [x, y] = pen.pt(i + 0.3 + hash2(i, j * 7) * 0.4, j + 0.3 + hash2(i * 7, j) * 0.4);
    rect(pen.ctx, x, y, 2, 1, lot ? lot.tuft : parcel?.kind === 'shop' || parcel?.kind === 'vacant' || parcel?.kind === 'office' ? '#7d7f7f' : hash2(i, j * 3) > 0.5 ? '#63a665' : '#3e7a46');
  }
}

/** Ein Stück Boden. Es entsteht erst, wenn es ins Bild kommt: Die ganze Karte wäre als ein Bild zu gross. */
function chunkAt(cx: number, cy: number): Layer {
  const key = `${cx},${cy}`;
  const known = chunks.get(key);
  if (known) {
    chunks.delete(key);
    chunks.set(key, known);
    return known;
  }
  const out = layer(CHUNK_W, CHUNK_H);
  rect(out.ctx, 0, 0, CHUNK_W, CHUNK_H, '#4a8a4e');
  const px = cx * CHUNK_W;
  const py = cy * CHUNK_H;
  const pen = new Pen(out.ctx, originX() - px, TOP - py);
  const sumFrom = Math.floor((py - TOP) / 8) - 2;
  const sumTo = Math.ceil((py + CHUNK_H - TOP) / 8) + 2;
  const diffFrom = Math.floor((px - originX()) / 16) - 2;
  const diffTo = Math.ceil((px + CHUNK_W - originX()) / 16) + 2;
  for (let sum = sumFrom; sum <= sumTo; sum++) {
    for (let diff = diffFrom; diff <= diffTo; diff++) {
      if ((sum + diff) % 2) continue;
      const i = (sum + diff) / 2;
      const j = (sum - diff) / 2;
      paintTile(pen, i, j);
    }
  }
  chunks.set(key, out);
  if (chunks.size > MAX_CHUNKS) chunks.delete(chunks.keys().next().value!);
  return out;
}

function drawGround(ctx: Ctx, camX: number, camY: number, viewW: number, viewH: number): void {
  rect(ctx, 0, 0, viewW, viewH, '#3f7d48');
  const fromX = Math.floor(-camX / CHUNK_W);
  const toX = Math.floor((viewW - camX) / CHUNK_W);
  const fromY = Math.floor(-camY / CHUNK_H);
  const toY = Math.floor((viewH - camY) / CHUNK_H);
  for (let cy = fromY; cy <= toY; cy++) for (let cx = fromX; cx <= toX; cx++) ctx.drawImage(chunkAt(cx, cy).canvas, cx * CHUNK_W + camX, cy * CHUNK_H + camY);
}

function buildTree(variant = 0): Layer {
  const l = layer(32, 48);
  const ctx = l.ctx;
  for (let n = 0; n < 6; n++) rect(ctx, 8 + n, 41 + n, 21 - n * 2, 1, 'rgba(16,26,24,.22)');
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

function buildPine(variant: number): Layer {
  const l = layer(32, 48);
  const ctx = l.ctx;
  for (let n = 0; n < 5; n++) rect(ctx, 9 + n, 42 + n, 18 - n * 2, 1, 'rgba(16,26,24,.22)');
  rect(ctx, 15, 34, 3, 9, '#4f3a26');
  const shades = variant ? ['#1f5238', '#2a6a48', '#3d8259'] : ['#1d4a3a', '#265f4a', '#37785f'];
  for (let tier = 0; tier < 3; tier++) {
    const y = 6 + tier * 9;
    const half = 6 + tier * 3;
    fillPoly(ctx, [[16, y], [16 + half, y + 14], [16, y + 16], [16 - half, y + 14]], shades[0]);
    fillPoly(ctx, [[16, y], [16 - half, y + 14], [14, y + 15]], shades[1]);
    rect(ctx, 14, y + 3, 2, 2, shades[2]);
  }
  return l;
}

function buildCactus(): Layer {
  const l = layer(20, 28);
  const ctx = l.ctx;
  for (let n = 0; n < 4; n++) rect(ctx, 5 + n, 23 + n, 10 - n * 2, 1, 'rgba(60,40,20,.22)');
  rect(ctx, 8, 4, 4, 20, '#4b8a55');
  rect(ctx, 8, 4, 1, 20, '#6aa86f');
  rect(ctx, 3, 10, 2, 7, '#4b8a55');
  rect(ctx, 3, 15, 5, 2, '#4b8a55');
  rect(ctx, 15, 7, 2, 7, '#3f7a4a');
  rect(ctx, 12, 12, 5, 2, '#3f7a4a');
  return l;
}

/** Berge sind größer als ein Feld. Je höher, desto mehr Schnee. */
function buildPeak(variant: number, snowy: boolean): Layer {
  const width = 112;
  const height = 92 + variant * 8;
  const l = layer(width, height);
  const ctx = l.ctx;
  const foot = height - 10;
  const tipX = 50 + variant * 6;
  const left: [number, number] = [4, foot - 4];
  const right: [number, number] = [width - 4, foot - 4];
  const front: [number, number] = [tipX + 4, foot + 8];
  const tip: [number, number] = [tipX, 4];
  const lit = snowy ? '#8f97a0' : '#8c8378';
  const dark = snowy ? '#646d78' : '#625b52';
  fillPoly(ctx, [tip, left, front], lit);
  fillPoly(ctx, [tip, front, right], dark);
  const random = seeded(71 + variant * 13);
  for (let n = 0; n < 60; n++) {
    const y = 18 + random() * (foot - 22);
    const spread = ((y - 4) / (foot - 4)) * 44;
    rect(ctx, Math.round(tipX + (random() - 0.5) * spread * 2), Math.round(y), 2 + Math.floor(random() * 4), 1, random() > 0.5 ? darken(lit, 0.14) : darken(dark, 0.12));
  }
  const reach = snowy ? 0.55 : 0.26;
  const at = (p: [number, number]): [number, number] => [tip[0] + (p[0] - tip[0]) * reach, tip[1] + (p[1] - tip[1]) * reach];
  fillPoly(ctx, [tip, at(left), [tipX - 8, at(left)[1] + 3], [tipX - 2, at(left)[1] - 4], at(front)], '#f4f7f9');
  fillPoly(ctx, [tip, at(front), [tipX + 9, at(right)[1] - 2], at(right)], '#cdd8e0');
  return l;
}

interface DecorSprite {
  image: Layer;
  ax: number;
  ay: number;
}

const sprites = new Map<string, DecorSprite>();

function decorSprite(kind: DecorKind, i: number, j: number): DecorSprite {
  const roll = hash2(i * 11, j * 13);
  const variant = kind === 'tree' ? Math.floor(roll * 3) : kind === 'cactus' ? 0 : Math.floor(roll * 2);
  const key = `${kind}${variant}`;
  let sprite = sprites.get(key);
  if (!sprite) {
    if (kind === 'tree') sprite = { image: treeImages()[variant], ax: 16, ay: 40 };
    else if (kind === 'pine') sprite = { image: buildPine(variant), ax: 16, ay: 40 };
    else if (kind === 'cactus') sprite = { image: buildCactus(), ax: 10, ay: 24 };
    else {
      const image = buildPeak(variant, kind === 'snowpeak');
      sprite = { image, ax: 56, ay: image.canvas.height - 12 };
    }
    sprites.set(key, sprite);
  }
  return sprite;
}

/* ---------- Die Gebäude ---------- */

const MAX_PIECES = 300;
const pieces = new Map<string, Piece | null>();
let piecesState = '';
const townKeys = new WeakMap<object, string>();

/** Jedes Gebäude bekommt ein eigenes Bild, damit die Figur korrekt davor oder dahinter gehen kann. Gezeichnet wird, was gerade zu sehen ist. */
function pieceOf(company: Company, p: Parcel): Piece | null {
  let state = townKeys.get(company.town);
  if (state === undefined) {
    state = JSON.stringify(company.town);
    townKeys.set(company.town, state);
  }
  if (state !== piecesState) {
    piecesState = state;
    pieces.clear();
  }
  const known = pieces.get(p.id);
  if (known !== undefined) return known;
  let made: Piece | null;
  if (p.kind === 'lot') {
    made = paintLot(p, company);
  } else if (p.building && isGeneric(p)) {
    const style = styleOf(p);
    made = piece(p.building, (pen) => {
      castShadow(pen, p.building!, buildingHeight(p));
      paintTyped(pen, p.building!, style);
    }, FLOOR_H * (style.floors - 1));
  } else {
    made = p.building ? piece(p.building, (pen) => {
      castShadow(pen, p.building!, buildingHeight(p));
      if (p.kind === 'home') paintHome(pen, p.building!);
      else if (p.kind === 'house') paintHouse(pen, p.building!);
      else if (p.kind === 'office') paintOffice(pen, p.building!);
      else paintShop(pen, p.building!, p.kind === 'vacant' && !company.town.rented.includes(p.id), p.kind === 'vacant' ? doorUOf(p, company) : undefined);
    }) : null;
  }
  pieces.set(p.id, made);
  if (pieces.size > MAX_PIECES) pieces.delete(pieces.keys().next().value!);
  return made;
}

const FLOOR_H = 44;
const HOUSE_H = 44;
const SHOP_H = 52;
const OFFICE_FLOORS = 3;
/** Die Haustür ist so gross wie die im Büro. */
const DOOR_WIDTH = 17;
const DOOR_HEIGHT = 38;

const buildingHeight = (p: Parcel) => {
  if (isGeneric(p)) {
    const s = styleOf(p);
    if (s.kind === 'house') return HOUSE_H * s.floors + 44;
    if (s.kind === 'shop') return SHOP_H + 14 + HOUSE_H * (s.floors - 1);
    return HOUSE_H * s.floors + 6;
  }
  return p.kind === 'home' || p.kind === 'house' ? HOUSE_H + 44 : p.kind === 'office' ? 44 * OFFICE_FLOORS + 6 : p.kind === 'lot' ? 56 : SHOP_H + 14;
};

/* ---------- Gebäude nach Typ: 100 Wohnhäuser, 50 Läden, 50 Bürohäuser ---------- */

/** Ein Gebäude im eigenen Typ. Die Grundfläche bleibt, wie das Grundstück sie vorgibt. */
function paintTyped(pen: Pen, b: TownBuilding, style: BuildingStyle): void {
  if (style.kind === 'house') paintHouseType(pen, b, style.look, style.floors);
  else if (style.kind === 'shop') paintShopType(pen, b, style.look, style.floors);
  else paintOfficeType(pen, b, style.look, style.floors);
}

function roofType(pen: Pen, b: TownBuilding, z: number, style: RoofStyle, roof: string, wall: string): void {
  const { i, j, w, d } = b;
  if (style === 'gable') return gabledRoof(pen, b, z, Math.max(24, (d * 16) / 3.4), roof, wall);
  if (style === 'gambrel') return gabledRoof(pen, b, z, (d * 16) / 2.2, roof, wall);
  if (style === 'shed') {
    const rise = (d * 16) / 4;
    fillPoly(pen.ctx, [pen.pt(i, j + d, z), pen.pt(i + w, j + d, z), pen.pt(i + w, j, z + rise), pen.pt(i, j, z + rise)], lighten(roof, 0.1));
    return;
  }
  pen.box(i - 0.05, j - 0.05, z, w + 0.1, d + 0.1, 3, tri(roof, 0.14));
  if (style === 'parapet') pen.box(i - 0.05, j + d - 0.12, z + 3, w + 0.1, 0.16, 6, tri(lighten(wall, 0.1), 0.14));
}

function paintHouseType(pen: Pen, b: TownBuilding, look: { roof: RoofStyle; wall: string; roofColor: string; windows: 'tall' | 'wide' }, floors: number): void {
  const walls = HOUSE_H * floors;
  const width = Math.floor(b.w * 16);
  const front = b.j + b.d;
  pen.box(b.i, b.j, 0, b.w, b.d, walls, tri(look.wall, 0.14));
  siding(pen, { ...b, color: look.wall }, walls);
  const doorU = centerDoorU(b);
  door(pen, b, doorU, '#7a4f3a');
  for (let f = 1; f < floors; f++) pen.faceJ(b.i, front, 0, 0, f * HOUSE_H - 1, width, 2, darken(look.wall, 0.12));
  const span = look.windows === 'wide' ? 24 : 18;
  for (let f = 0; f < floors; f++) {
    const v = f * HOUSE_H + 14;
    for (const u of frontBays(width, doorU)) windowJ(pen, b, u, v, span, 16);
    for (let u = 18; u + 18 < b.d * 16; u += 44) windowI(pen, b, u, v, 18, 16);
  }
  roofType(pen, b, walls, look.roof, look.roofColor, look.wall);
}

function paintShopType(pen: Pen, b: TownBuilding, look: { wall: string; accent: string; cornice: boolean }, floors: number): void {
  const height = SHOP_H + HOUSE_H * (floors - 1);
  const front = b.j + b.d;
  const width = b.w * 16;
  pen.box(b.i, b.j, 0, b.w, b.d, height, tri(look.wall, 0.14));
  for (let v = 2; v < height; v += 3) pen.faceJ(b.i, front, 0, 0, v, width, 1, darken(look.wall, 0.09));
  pen.faceJ(b.i, front, 0, 0, 0, width, 3, '#6d7076');
  if (look.cornice) pen.box(b.i - 0.03, front - 0.14, height, b.w + 0.06, 0.18, 3, tri(lighten(look.wall, 0.18), 0.1));
  const doorU = centerDoorU(b);
  for (const u of frontBays(width, doorU)) windowJ(pen, b, u, 8, 18, 24);
  door(pen, b, doorU, '#2f6f62');
  for (let f = 1; f < floors; f++) for (let u = 12; u + 18 < width - 6; u += 40) windowJ(pen, b, u, SHOP_H + (f - 1) * HOUSE_H + 14, 18, 16);
  for (let u = 16; u + 18 < b.d * 16; u += 40) windowI(pen, b, u, 22, 18, 16);
  pen.faceJ(b.i, front, 0, 3, 34, width - 6, 6, look.accent);
  for (let u = 3; u < width - 6; u += 8) pen.faceJ(b.i, front, 0, u, 34, 4, 3, '#f2efe4');
  pen.faceJ(b.i, front, height, 5, 2, width - 10, 7, '#f2efe4');
  pen.box(b.i, b.j, height, b.w, b.d, 2, tri(darken(look.wall, 0.2), 0.1));
}

function paintOfficeType(pen: Pen, b: TownBuilding, look: { wall: string; accent: string; crown: boolean }, floors: number): void {
  const height = HOUSE_H * floors;
  const front = b.j + b.d;
  const width = Math.floor(b.w * 16);
  const depth = Math.floor(b.d * 16);
  pen.box(b.i, b.j, 0, b.w, b.d, height, tri(look.wall, 0.14));
  pen.box(b.i - 0.05, b.j - 0.05, height, b.w + 0.1, b.d + 0.1, 4, tri(look.accent, 0.14));
  pen.box(b.i + 2, b.j + 2, height + 4, 3, 2, 8, tri('#8d97a3', 0.14));
  if (look.crown) pen.box(b.i + b.w * 0.25, b.j + b.d * 0.25, height + 4, b.w * 0.5, b.d * 0.5, 10, tri(darken(look.wall, 0.08), 0.14));
  for (let floor = 0; floor < floors; floor++) {
    const v = floor * HOUSE_H + 10;
    pen.faceJ(b.i, front, 0, 4, v, width - 8, 26, '#3e5a66');
    pen.faceJ(b.i, front, 0, 4, v + 13, width - 8, 13, '#a8dfe6');
    for (let u = 16; u < width - 6; u += 14) pen.faceJ(b.i, front, 0, u, v, 1, 26, '#26323f');
    pen.faceI(b.i + b.w, b.j, 0, 4, v, depth - 8, 26, '#334b56');
    pen.faceI(b.i + b.w, b.j, 0, 4, v + 13, depth - 8, 13, '#8fc4cc');
    for (let u = 16; u < depth - 6; u += 14) pen.faceI(b.i + b.w, b.j, 0, u, v, 1, 26, '#1f2a35');
  }
  door(pen, b, centerDoorU(b), '#2f6f62');
  pen.faceJ(b.i, front, 0, 6, 36, width - 12, 5, look.accent);
}

/** Der Schatten fällt nach rechts vorn auf den Boden. */
function castShadow(pen: Pen, b: { i: number; j: number; w: number; d: number }, height: number): void {
  const reach = Math.min(2.2, height / 40);
  fillPoly(pen.ctx, [pen.pt(b.i + b.w, b.j), pen.pt(b.i + b.w + reach, b.j + reach * 0.4), pen.pt(b.i + b.w + reach, b.j + b.d + reach * 0.4), pen.pt(b.i, b.j + b.d + reach * 0.4), pen.pt(b.i, b.j + b.d)], 'rgba(16,26,24,.24)');
}

function piece(b: { i: number; j: number; w: number; d: number }, paint: (pen: Pen) => void, extraTop = 0): Piece {
  const left = originX() + (b.i - (b.j + b.d)) * 16 - 8;
  const right = originX() + (b.i + b.w - b.j) * 16 + 44;
  const top = TOP + (b.i + b.j) * 8 - 150 - extraTop;
  const bottom = TOP + (b.i + b.w + b.j + b.d) * 8 + 28;
  let image: Layer | null = null;
  return {
    i: b.i, j: b.j, w: b.w, d: b.d, left, top, width: right - left, height: bottom - top,
    image() {
      if (!image) {
        image = layer(right - left, bottom - top);
        paint(new Pen(image.ctx, originX() - left, TOP - top));
      }
      return image;
    },
  };
}

function door(pen: Pen, b: TownBuilding, u: number, color: string): void {
  const j = b.j + b.d;
  pen.faceJ(b.i, j, 0, u - 2, 0, 17, 40, '#e6e4da');
  pen.faceJ(b.i, j, 0, u - 1, 0, 15, 38, '#141b2a');
  pen.faceJ(b.i, j, 0, u, 0, 13, 37, color);
  pen.faceJ(b.i, j, 0, u + 2, 4, 9, 14, darken(color, 0.16));
  pen.faceJ(b.i, j, 0, u + 2, 24, 9, 10, '#a8dfe6');
  pen.faceJ(b.i, j, 0, u + 3, 30, 2, 2, '#ffffff');
  pen.faceJ(b.i, j, 0, u + 10, 18, 2, 3, '#f0c04a');
}

/** Wiederkehrende Fenster entlang der Front, die Tür bleibt frei. */
function frontBays(width: number, doorU: number, step = 40): number[] {
  const out: number[] = [];
  for (let u = 12; u + 18 < width - 6; u += step) if (u + 22 < doorU - 2 || u > doorU + 20) out.push(u);
  return out;
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
  const height = HOUSE_H;
  pen.box(b.i, b.j, 0, b.w, b.d, height, tri(b.color, 0.14));
  siding(pen, b, height);
  const width = b.w * 16;
  const doorU = centerDoorU(b);
  door(pen, b, doorU, '#7a4f3a');
  // Stufe vor der Tür und Blumen unter den Fenstern
  pen.box(b.i + (doorU - 2) / 16, b.j + b.d, 0, 1.1, 0.25, 2, tri('#a9a69b', 0.12));
  for (const u of frontBays(width, doorU)) {
    windowJ(pen, b, u, 16, 18, 16);
    pen.box(b.i + u / 16, b.j + b.d, 12, 18 / 16, 0.1, 2, tri('#6a4a2e', 0.12));
    for (let n = 0; n < 8; n++) pen.faceJ(b.i, b.j + b.d + 0.1, 0, u + 1 + n * 2, 14, 1, 1, n % 2 ? '#e5534b' : '#f8d34a');
  }
  for (let u = 18; u + 18 < b.d * 16; u += 44) windowI(pen, b, u, 16, 18, 16);
  gabledRoof(pen, b, height, Math.max(24, (b.d * 16) / 3.4), b.accent, b.color);
}

function paintHome(pen: Pen, b: TownBuilding): void {
  // Garage nebenan: flach, mit Rolltor zur Einfahrt.
  const garage: TownBuilding = { i: b.i + b.w, j: b.j + 2, w: 4, d: b.d - 2, color: b.color, accent: b.accent };
  castShadow(pen, garage, 30);
  paintHouse(pen, { ...b, accent: '#8a4438' });
  pen.box(garage.i, garage.j, 0, garage.w, garage.d, 36, tri(darken(b.color, 0.06), 0.14));
  pen.box(garage.i - 0.04, garage.j - 0.04, 36, garage.w + 0.08, garage.d + 0.08, 3, tri('#6a4a3a', 0.12));
  const j = garage.j + garage.d;
  pen.faceJ(garage.i, j, 0, 6, 0, 52, 28, '#2f3644');
  for (let v = 1; v < 27; v += 3) pen.faceJ(garage.i, j, 0, 7, v, 50, 2, '#4a5261');
  // Briefkasten an der Straße
  pen.box(b.i - 1.4, b.j + b.d + 1, 0, 0.1, 0.1, 14, tri('#54606b', 0.1));
  pen.box(b.i - 1.5, b.j + b.d + 0.95, 14, 0.4, 0.25, 7, tri('#3f7fd0', 0.16));
}

/** Bürohäuser im Campus: mehrere Stockwerke mit Fensterbändern, Technik auf dem Dach. */
function paintOffice(pen: Pen, b: TownBuilding): void {
  const height = 44 * OFFICE_FLOORS;
  const front = b.j + b.d;
  const width = Math.floor(b.w * 16);
  const depth = Math.floor(b.d * 16);
  pen.box(b.i, b.j, 0, b.w, b.d, height, tri(b.color, 0.14));
  pen.box(b.i - 0.05, b.j - 0.05, height, b.w + 0.1, b.d + 0.1, 4, tri(b.accent, 0.14));
  pen.box(b.i + 2, b.j + 2, height + 4, 3, 2, 8, tri('#8d97a3', 0.14));
  pen.box(b.i + b.w - 5, b.j + b.d / 2, height + 4, 2, 2, 5, tri('#59636f', 0.14));
  for (let floor = 0; floor < OFFICE_FLOORS; floor++) {
    const v = floor * 44 + 10;
    pen.faceJ(b.i, front, 0, 4, v, width - 8, 26, '#3e5a66');
    pen.faceJ(b.i, front, 0, 4, v + 13, width - 8, 13, '#a8dfe6');
    for (let u = 16; u < width - 6; u += 14) pen.faceJ(b.i, front, 0, u, v, 1, 26, '#26323f');
    pen.faceI(b.i + b.w, b.j, 0, 4, v, depth - 8, 26, '#334b56');
    pen.faceI(b.i + b.w, b.j, 0, 4, v + 13, depth - 8, 13, '#8fc4cc');
    for (let u = 16; u < depth - 6; u += 14) pen.faceI(b.i + b.w, b.j, 0, u, v, 1, 26, '#1f2a35');
  }
  door(pen, b, centerDoorU(b), '#2f6f62');
  pen.faceJ(b.i, front, 0, 6, 36, width - 12, 5, b.accent);
}

const centerDoorU = (b: { w: number }) => Math.floor((b.w * 16) / 2) - 7;

function paintShop(pen: Pen, b: TownBuilding, closed: boolean, doorU = centerDoorU(b)): void {
  // Amerikanische Hauptstraße: flaches Dach, hohe Schaufassade, Markise über den Fenstern.
  const height = SHOP_H;
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
  const bays = frontBays(width, doorU);
  for (const u of bays) windowJ(pen, b, u, 8, 18, 24, !closed);
  door(pen, b, doorU, closed ? '#4a5261' : '#2f6f62');
  for (let u = 16; u + 18 < b.d * 16; u += 40) windowI(pen, b, u, 22, 18, 16);
  if (closed) {
    // Vernagelt: zwei Latten quer über die Schaufenster.
    for (const u of bays) {
      pen.faceJ(b.i, front, 0, u, 14, 18, 2, '#8a6443');
      pen.faceJ(b.i, front, 0, u, 24, 18, 2, '#7a5a3e');
    }
    return;
  }
  // Markise und Schriftfeld
  pen.faceJ(b.i, front, 0, 3, 34, width - 6, 6, b.accent);
  for (let u = 3; u < width - 6; u += 8) pen.faceJ(b.i, front, 0, u, 34, 4, 3, '#f2efe4');
  pen.faceJ(b.i, front, height, 5, 2, width - 10, 7, '#f2efe4');
  pen.faceJ(b.i, front, height, 8, 4, Math.max(4, width - 16), 2, darken(b.color, 0.25));
}

/** Der Neubau steht genau dort, wo auch das Büro liegt, und ist genauso gross. */
function builtBox(p: Parcel, company: Company) {
  const room = roomAt(p.locationId!, buildingAt(company.town, p.id));
  return roomBox(p, room.w, room.d);
}

/** Die Haustür sitzt in der Stadt an derselben Stelle wie im Büro. */
const doorUOf = (p: Parcel, company: Company) => roomAt(p.locationId!, buildingAt(company.town, p.id)).door.i * 16 + 2;

/** Wo die Tür eines Hauses der Firma sitzt: immer mittig in der Front. Fremde Häuser haben hier keine. */
function parcelDoor(company: Company, site: Parcel): { i: number; j: number; u: number } | null {
  const { town } = company;
  const own = site.id === town.siteId || site.kind === 'home' || town.rented.includes(site.id) || town.built.includes(site.id);
  if (!own) return null;
  const b = site.kind === 'lot' ? (town.built.includes(site.id) ? builtBox(site, company) : null) : site.building ?? null;
  if (!b) return null;
  return { i: b.i, j: b.j + b.d, u: (site.kind === 'home' ? centerDoorU(b) : doorUOf(site, company)) - 2 };
}

/** Boden der Grundstücke: Erde, Rasen oder Kies. */
const GROUND: Record<Ground, { light: string; dark: string; tuft: string }> = {
  dirt: { light: '#8f7a55', dark: '#88734f', tuft: '#75623f' },
  grass: { light: '#5a9a58', dark: '#4f8f52', tuft: '#3e7a46' },
  gravel: { light: '#9b968a', dark: '#8f8b80', tuft: '#7d7a70' },
};

/** Zaun an Straßenseite und den beiden Seiten: Pfosten und Latten, bei der Hecke Büsche. */
const FENCE: Record<Fence, { post: string; rail: string; height: number }> = {
  picket: { post: '#f2efe4', rail: '#f2efe4', height: 9 },
  chain: { post: '#8d97a3', rail: '#b8c0c8', height: 8 },
  hedge: { post: '#2c6a3d', rail: '#357a46', height: 6 },
  wood: { post: '#6a4a2e', rail: '#8a6443', height: 9 },
};

function paintFence(pen: Pen, p: Parcel, fence: Fence): void {
  const style = FENCE[fence];
  const { i, j, w, d } = p;
  const edges: [number, number, number, number][] = [[i, j + d - 0.1, w, 0], [i + w - 0.1, j, 0, d], [i + 0.1, j, 0, d]];
  for (const [x, y, lenI, lenJ] of edges) {
    const steps = Math.max(1, Math.round(lenI + lenJ));
    for (let n = 0; n <= steps; n++) pen.box(x + (lenI * n) / steps, y + (lenJ * n) / steps, 0, 0.12, 0.12, style.height, tri(style.post, 0.12));
    if (fence === 'hedge') {
      for (let n = 0; n < steps * 2; n++) pen.box(x + (lenI * n) / (steps * 2), y + (lenJ * n) / (steps * 2), 0, 0.55, 0.55, style.height, tri(style.rail, 0.1));
    } else {
      pen.box(x, y, style.height - 2, lenI || 0.08, lenJ || 0.08, 1.6, tri(style.rail, 0.1));
    }
  }
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
      const doorU = doorUOf(p, company);
      pen.faceJ(b.i, front, 0, doorU - 2, 0, 17, 40, '#e6e4da');
      pen.faceJ(b.i, front, 0, doorU, 0, 13, 37, '#2a3550');
      pen.faceJ(b.i, front, 0, doorU + 2, 24, 9, 10, '#a8dfe6');
      pen.faceJ(b.i, front, 40, 6, 0, width - 12, 4, '#f8b62d');
    }, FLOOR_H * (house.floors - 1)) };
  }
  return piece({ i, j, w, d }, (pen) => {
    paintFence(pen, p, lotLook(p).fence);
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
