// Die Übersichtskarte. Sie zeigt nur die Landschaft und die Orte: So entsteht sie schnell, auch für die ganze Welt.

import { mapKind, placesIn, REGION, WORLD_RADIUS, type TileKind, type TownTile } from '../../shared/town.ts';
import { show } from '../ui/html.ts';

const PIXEL = 3;
const ZOOMS = [2, 4, 8, 16, 32, 64, 128, 256, 512, 1024];
/** Weiter draussen wären es zu viele Orte, um sie bei jedem Bild zu berechnen. */
const PLACES_UP_TO = 32;

const COLORS: Record<TileKind, [number, number, number]> = {
  water: [38, 112, 134], beach: [226, 210, 162], sand: [204, 174, 118], rock: [125, 120, 112], snow: [232, 238, 242],
  forest: [47, 104, 58], grass: [79, 143, 82], field: [184, 156, 71], road: [92, 94, 102], bridge: [127, 99, 67], sidewalk: [172, 169, 157],
};

export interface WorldMapOptions {
  player: TownTile;
  /** Stufe beim Öffnen. Ohne Angabe sind die Städte der Umgebung zu sehen. */
  zoom?: number;
  home: TownTile | null;
  onTravel(id: string): void;
  onClose(): void;
}
/** Ein Feld ist ungefähr ein Meter, so wie die Gebäude gebaut sind. */
export const METERS_PER_TILE = 1;
/** Die Leiste wählt eine runde Länge, die auf den Bildschirm passt. */
const SCALE_STEPS = [1, 10, 100, 1000, 10_000, 100_000];

/** Die Länge der Maßstabsleiste: die runde Strecke, die einer Breite von etwa 125 Bildpunkten am nächsten kommt. */
export function scaleBar(cssPerTile: number): { meters: number; px: number; label: string } {
  let best = { meters: SCALE_STEPS[0], px: 0 };
  let bestDistance = Infinity;
  for (const meters of SCALE_STEPS) {
    const px = (meters / METERS_PER_TILE) * cssPerTile;
    const distance = Math.abs(Math.log(px / 125));
    if (distance < bestDistance) {
      bestDistance = distance;
      best = { meters, px };
    }
  }
  return { ...best, label: best.meters >= 1000 ? `${best.meters / 1000} km` : `${best.meters} m` };
}

export class WorldMap {
  private readonly root = document.createElement('div');
  private readonly canvas = document.createElement('canvas');
  private readonly labels = document.createElement('div');
  private readonly options: WorldMapOptions;
  private readonly onKey: (e: KeyboardEvent) => void;
  private readonly observer: ResizeObserver;
  private centerI: number;
  private centerJ: number;
  private zoom = 3;
  private wheelSum = 0;
  private readonly scaleBarEl = document.createElement('div');
  private timer = 0;
  private drag: { x: number; y: number; i: number; j: number; moved: boolean } | null = null;

  constructor(parent: HTMLElement, options: WorldMapOptions) {
    this.options = options;
    this.centerI = options.player.i;
    this.centerJ = options.player.j;
    this.zoom = options.zoom ?? 3;
    this.root.className = 'world-map';
    this.labels.className = 'world-map-labels';
    const bar = document.createElement('div');
    bar.className = 'world-map-bar';
    const close = document.createElement('button');
    close.className = 'btn';
    close.textContent = show('Schliessen');
    close.addEventListener('click', () => this.close());
    bar.append(close);
    const hint = document.createElement('div');
    this.scaleBarEl.className = 'world-map-scale';
    hint.className = 'world-map-hint';
    hint.textContent = show('Ort anklicken: dorthin reisen. Ziehen: verschieben. Mausrad: zoomen.');
    this.root.append(this.canvas, this.labels, bar, this.scaleBarEl, hint);
    parent.append(this.root);

    this.root.addEventListener('wheel', (e) => {
      e.preventDefault();
      // Wie in der Stadt: Ein Trackpad schickt viele kleine Schritte.
      this.wheelSum += e.deltaY;
      if (Math.abs(this.wheelSum) < 40) return;
      this.zoomBy(this.wheelSum < 0 ? 1 : -1);
      this.wheelSum = 0;
    }, { passive: false });
    this.root.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('button')) return;
      this.drag = { x: e.clientX, y: e.clientY, i: this.centerI, j: this.centerJ, moved: false };
      this.root.setPointerCapture(e.pointerId);
      this.root.classList.add('dragging');
    });
    this.root.addEventListener('pointermove', (e) => {
      if (!this.drag) return;
      const dx = ((e.clientX - this.drag.x) / PIXEL) * this.tiles();
      const dy = ((e.clientY - this.drag.y) / PIXEL) * this.tiles();
      this.centerI = this.drag.i - (dx / 2 + dy);
      this.centerJ = this.drag.j - (dy - dx / 2);
      this.schedule();
    });
    const release = () => {
      this.drag = null;
      this.root.classList.remove('dragging');
    };
    this.root.addEventListener('pointerup', release);
    this.root.addEventListener('pointercancel', release);
    this.onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      this.close();
    };
    window.addEventListener('keydown', this.onKey, true);
    this.observer = new ResizeObserver(() => this.schedule());
    this.observer.observe(this.root);
  }

  close(): void {
    window.clearTimeout(this.timer);
    window.removeEventListener('keydown', this.onKey, true);
    this.observer.disconnect();
    this.root.remove();
    this.options.onClose();
  }

  /** Positive Schritte zoomen hinein. Wer ganz nah herangeht, ist wieder in der Stadt. */
  zoomBy(steps: number): void {
    const next = this.zoom - steps;
    if (next < 0) {
      this.close();
      return;
    }
    this.zoom = Math.min(ZOOMS.length - 1, next);
    this.schedule();
  }

  private tiles(): number {
    return ZOOMS[this.zoom];
  }

  private schedule(): void {
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.render(), 16);
  }

  /** Wie im Spiel: +i läuft nach rechts unten, +j nach links unten. */
  private toScreen(i: number, j: number, width: number, height: number) {
    const di = i - this.centerI;
    const dj = j - this.centerJ;
    return { x: width / 2 + ((di - dj) / this.tiles()), y: height / 2 + ((di + dj) / 2 / this.tiles()) };
  }

  private render(): void {
    const box = this.root.getBoundingClientRect();
    const width = Math.max(1, Math.ceil(box.width / PIXEL));
    const height = Math.max(1, Math.ceil(box.height / PIXEL));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    const ctx = this.canvas.getContext('2d')!;
    const image = ctx.createImageData(width, height);
    const tiles = this.tiles();
    const limit = WORLD_RADIUS * REGION;
    for (let y = 0; y < height; y++) {
      const dy = (y - height / 2) * tiles;
      for (let x = 0; x < width; x++) {
        const dx = (x - width / 2) * tiles;
        const i = Math.round(this.centerI + dx / 2 + dy);
        const j = Math.round(this.centerJ + dy - dx / 2);
        const at = (y * width + x) * 4;
        const [r, g, b] = Math.abs(i) >= limit || Math.abs(j) >= limit ? [23, 50, 74] : COLORS[mapKind(i, j)];
        image.data[at] = r;
        image.data[at + 1] = g;
        image.data[at + 2] = b;
        image.data[at + 3] = 255;
      }
    }
    ctx.putImageData(image, 0, 0);
    this.renderPlaces(ctx, width, height);
    this.renderScale();
  }

  private renderPlaces(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    const tiles = this.tiles();
    const reachX = (width / 2) * tiles;
    const reachY = height * tiles;
    // Die Städte zuerst, damit sie beim Platz für Namen Vorrang haben.
    const rank = (p: object) => (!('size' in p) ? 0 : (p as { size: string }).size === 'city' ? 1 : (p as { size: string }).size === 'town' ? 2 : 3);
    const places = (tiles > PLACES_UP_TO ? [] : placesIn(this.centerI - reachX - reachY, this.centerJ - reachX - reachY, this.centerI + reachX + reachY, this.centerJ + reachX + reachY)).sort((a, b) => rank(a) - rank(b));
    const items: HTMLElement[] = [];
    const taken: { x: number; y: number }[] = [];
    for (const place of places) {
      const size = 'size' in place ? (place as { size: string }).size : 'city';
      const { x, y } = this.toScreen(place.i + 40, place.j + 40, width, height);
      if (x < -4 || y < -4 || x > width + 4 || y > height + 4) continue;
      const dot = size === 'city' ? 5 : size === 'town' ? 3 : 2;
      ctx.fillStyle = size === 'city' ? '#e8e2d2' : '#cfc7b3';
      ctx.fillRect(Math.round(x - dot / 2), Math.round(y - dot / 2), dot, dot);
      // Die Orte im Tal stehen immer da, die übrigen je nach Grösse erst beim Heranzoomen.
      const core = !('size' in place);
      const shown = core ? tiles <= 16 : size === 'city' ? tiles <= 16 : size === 'town' ? tiles <= 4 : tiles <= 2;
      if (!shown) continue;
      const free = !taken.some((t) => Math.abs(t.x - x) < 26 && Math.abs(t.y - y) < 7);
      if (!free) continue;
      taken.push({ x, y });
      const label = document.createElement('button');
      label.className = `world-map-place${size === 'city' ? ' world-map-place-city' : ''}`;
      label.textContent = show(place.name);
      label.style.transform = `translate(calc(${Math.round(x * PIXEL)}px - 50%), ${Math.round(y * PIXEL) + 6}px)`;
      label.addEventListener('click', () => {
        this.options.onTravel(place.id);
        this.close();
      });
      items.push(label);
    }
    if (this.options.home) items.push(this.marker(this.options.home, 'Deine Firma', 'world-map-marker world-map-marker-home', width, height));
    items.push(this.marker(this.options.player, 'Du', 'world-map-marker', width, height));
    this.labels.replaceChildren(...items);
  }

  /** Die Leiste zeigt die Strecke in Metern: Ein Feld ist ein Meter. */
  private renderScale(): void {
    const bar = scaleBar((PIXEL / this.tiles()) * 1);
    this.scaleBarEl.style.width = `${Math.round(bar.px)}px`;
    this.scaleBarEl.textContent = show(bar.label);
  }

  private marker(tile: TownTile, text: string, name: string, width: number, height: number): HTMLElement {
    const { x, y } = this.toScreen(tile.i, tile.j, width, height);
    const el = document.createElement('div');
    el.className = name;
    el.textContent = show(text);
    el.style.transform = `translate(calc(${Math.round(x * PIXEL)}px - 50%), calc(${Math.round(y * PIXEL)}px - 100%))`;
    return el;
  }
}
