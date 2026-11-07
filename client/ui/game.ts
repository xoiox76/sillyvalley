// Spielbildschirm: verbindet Server-Stand, Welt und Bedienung.

import { chooseLanguage } from './language.ts';
import type { Language } from '../i18n/translate.ts';
import { locale } from '../i18n/translate.ts';
import { marked } from 'marked';
import { DEFAULT_CEO, LOOK_OPTIONS, NAME_IDEAS, ROLES, RULES, roleById, setExtraModels } from '../../shared/catalog.ts';
import { checkDepartment, checkPlacement, isEdgeKind, rectFromCorners, type Tile } from '../../shared/layout.ts';
import { ROLE_TEMPLATE, parseRole, roleToMarkdown, withRoleColor } from '../../shared/roleMarkdown.ts';
import { siteAt, siteBase, storeyOf, buildingAt, checkShaft, floorOf, isShaft, itemsOnFloor, roomOf } from '../../shared/building.ts';
import type { Agent, BoardItem, FurnitureKind, ProjectAgent, LocationId, Look, PlacedItem, Rotation, Snapshot } from '../../shared/types.ts';
import { parcelById } from '../../shared/town.ts';
import type { City } from '../../shared/town.ts';
import { TownView } from '../world/town.ts';
import { World, type WallEdge } from '../world/world.ts';
import { api, type FileEntry } from './api.ts';
import { html, morph, type Safe, show } from './html.ts';
import {
  buildPanel, suggestedLimit, contractModal, departmentModal, departmentOfAgent, financePanel, laptopModal, hireModal, noteModal, teamModal, liveNote, mandateModal, meetingModal, meetingPanel, notices, orderModal,
  projectsPanel, roomChips, teamPanel, topBar, townCard, townChips, viewerModal,
  type ContractView, type DepartmentDraft, type FilesDraft, type HireDraft, type NoteDraft, type TeamDraft, type WorkspaceFolds, type MandateDraft, type MeetingDraft, type OrderDraft, type OrderTeamDraft, type SelfStartMode, type ViewerState,
  type RoomNaming,
} from './views.ts';
import { isSeparateRoom, regionAt, zoneAt } from '../../shared/zones.ts';

type Tab = 'bauen' | 'team' | 'projekte' | 'finanzen';
type Modal =
  | { type: 'hire'; draft: HireDraft }
  | { type: 'order'; draft: OrderDraft }
  | { type: 'meeting'; draft: MeetingDraft }
  | { type: 'department'; draft: DepartmentDraft }
  | { type: 'mandate'; draft: MandateDraft }
  | { type: 'contract'; view: ContractView }
  | { type: 'team'; draft: TeamDraft }
  | { type: 'note'; draft: NoteDraft }
  | { type: 'files'; draft: FilesDraft }
  | { type: 'viewer'; viewer: ViewerState };
/** Im Bau-Modus: ein Möbelstück, oder ein Abteilungsbereich, der mit zwei Ecken abgesteckt wird. */
type Build =
  | { kind: FurnitureKind; rot: Rotation; id?: string; inventoryId?: string; tile: Tile | null; withFloor?: boolean }
  | { kind: 'department'; rot: 0; id?: undefined; inventoryId?: undefined; tile: Tile | null; anchor: Tile | null; departmentId?: string };

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'bauen', label: 'Bauen', icon: 'hammer' },
  { id: 'team', label: 'Team', icon: 'people' },
  { id: 'projekte', label: 'Projekte', icon: 'doc' },
  { id: 'finanzen', label: 'Finanzen', icon: 'bars' },
];

export function renderGame(root: HTMLElement, companyId: string, onLeave: () => void): () => void {
  root.innerHTML = `
    <div class="game">
      <header class="topbar" id="topbar"></header>
      <div class="stage">
        <div class="world" id="world"></div>
        <div class="world" id="town" hidden></div>
        <div class="world-overlay" id="overlay"></div>
        <aside class="panel" id="panel" hidden></aside>
      </div>
      <footer class="navbar">
        <nav class="tabs" aria-label="${show('Bereiche')}">
          ${TABS.map((t) => `<button class="tab" data-action="tab" data-id="${t.id}"><span class="tab-icon tab-icon-${t.icon}" aria-hidden="true"></span>${show(t.label)}</button>`).join('')}
        </nav>
        <div class="live-slot" id="live"></div>
      </footer>
      <div class="toasts" id="toasts" aria-live="polite"></div>
      <div class="modal-backdrop" id="modal-backdrop" hidden>
        <div class="modal" id="modal" role="dialog" aria-modal="true"></div>
      </div>
    </div>`;

  const q = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel)!;
  const els = {
    topbar: q('#topbar'), world: q('#world'), town: q('#town'), overlay: q('#overlay'), panel: q('#panel'), live: q('#live'),
    toasts: q('#toasts'), backdrop: q('#modal-backdrop'), modal: q('#modal'),
  };

  let snap: Snapshot | null = null;
  let tab: Tab | null = null;
  let selectedAgent: string | null = null;
  let selectedOrder: string | null = null;
  let selectedMeeting: string | null = null;
  let selectedDepartment: string | null = null;
  let selectedMandate: string | null = null;
  let outside = false;
  let parcelId: string | null = null;
  let modal: Modal | null = null;
  let files: FileEntry[] = [];
  const folds: WorkspaceFolds = {};
  let shownModal: unknown = null;
  let projectAgents: ProjectAgent[] = [];
  let disconnected = false;
  let build: Build | null = null;
  /** Beim Wand-Werkzeug: der erste Klick. Der zweite Klick auf derselben Linie zieht die Wand bis dorthin. */
  let wallAnchor: WallEdge | null = null;
  /** Raum benennen: erst in den Raum klicken, dann Zweck und Name eintragen. */
  let roomMode: { target: Tile | null } | null = null;
  let buildMessage = '';
  let confirmDelete: string | null = null;
  let confirmFire: string | null = null;
  let selectedNote: string | null = null;
  let viewFloor = 0;
  let townCity: City | null = null;
  let ceoSeated = false;
  let toasts: { id: string; level: string; text: string }[] = [];
  const seenNotices = new Set<string>();
  let noticesPrimed = false;
  let lastRunEnded = 0;
  let lastChatLength = 0;


  const world = new World(els.world, {
    onCeoSeated(seated) {
      ceoSeated = seated;
      render();
    },
    onLaptop() {
      openFiles();
    },
    keyboardBlocked() {
      const active = document.activeElement as HTMLElement | null;
      return modal !== null || build !== null || Boolean(active?.closest('input, textarea, select'));
    },
    onZoomedOut() {
      if (modal || build || outside) return;
      goOutside();
      town.zoomToEdge();
    },
    onAgentClick(id) {
      selectedAgent = id;
      tab = 'team';
      refreshProjectAgents();
      world.setSelected(id);
      render();
    },
    onTileHover(tile) {
      if (roomMode && !roomMode.target) {
        if (tile) showRoom(tile);
        return;
      }
      if (!build || !tile) return;
      build.tile = tile;
      syncGhost();
    },
    onEdgeHover(edge) {
      if (!build || !isEdgeKind(build.kind) || !edge) return;
      build.tile = { i: edge.i, j: edge.j };
      build.rot = edge.rot;
      syncGhost();
    },
    onEdgeClick(edge) {
      void wallClick(edge);
    },
    onTileClick(tile) {
      if (roomMode) {
        roomMode.target = tile;
        showRoom(tile);
        render();
        return;
      }
      if (!build) return;
      build.tile = tile;
      // Wände sitzen auf Kanten. Ein Feld-Klick (ohne Vorschau) zeigt nur die Vorschau, gesetzt wird über die Kante.
      if (isEdgeKind(build.kind)) {
        syncGhost();
        return;
      }
      if (build.kind === 'department') {
        if (!build.anchor) {
          build.anchor = tile;
          buildMessage = '';
          syncGhost();
          render();
          return;
        }
        const rect = rectFromCorners(build.anchor, tile);
        const check = snap ? checkDepartment(roomOf(snap.company, viewFloor), snap.company.departments.filter((d) => floorOf(d) === viewFloor), { ...rect, id: build.departmentId }) : { ok: false, reason: '' };
        if (!check.ok) {
          buildMessage = check.reason;
          build.anchor = null;
          syncGhost();
          render();
          return;
        }
        if (build.departmentId) {
          api.patchDepartment(companyId, build.departmentId, { ...rect, floor: viewFloor }).then(cancelBuild).catch((err) => {
            buildMessage = (err as Error).message;
            render();
          });
          return;
        }
        modal = { type: 'department', draft: { ...rect, error: '', busy: false } };
        render();
        return;
      }
      syncGhost();
      placeBuild();
    },
    onMeetingClick(id) {
      selectedMeeting = id;
      tab = 'team';
      render();
    },
    onRotate(item) {
      if (tab !== 'bauen') return;
      if (item) rotateInPlace(item);
      else rotateBuild();
    },
    onDepartmentClick(id) {
      if (tab === 'bauen') return;
      selectedDepartment = selectedDepartment === id ? null : id;
      selectedMeeting = null;
      tab = 'team';
      render();
    },
    onDoor() {
      goOutside();
    },
    onBoardClick() {
      tab = 'projekte';
      els.panel.scrollTop = 0;
      refreshFiles();
      render();
    },
    onItemClick(item: PlacedItem) {
      // Treppe und Fahrstuhl führen auf die nächste Etage. Beim Bauen lassen sie sich auswählen.
      if (isShaft(item.kind) && tab !== 'bauen') {
        changeFloor(1, true);
        return;
      }
      if (item.kind === 'meeting' && tab !== 'bauen') {
        const meeting = snap?.company.meetings.findLast((m) => m.roomId === item.id && m.status !== 'closed');
        if (meeting) {
          selectedMeeting = meeting.id;
          tab = 'team';
          render();
        }
        return;
      }
      if (tab !== 'bauen') return;
      build = { kind: item.kind, rot: item.rot, id: item.id, tile: { i: item.i, j: item.j } };
      buildMessage = '';
      syncGhost();
      render();
    },
  });

  const town = new TownView(els.town, {
    onParcel(id) {
      parcelId = id;
      render();
    },
    onCity(city) {
      townCity = city;
      // Wer eine Stadt zum ersten Mal betritt, legt ihr Aussehen fest. Danach bleibt es.
      if (city && snap && snap.company.town.citySalts?.[city.id] === undefined) api.visitCity(companyId, city.id).catch(fail);
      render();
    },
    onEnter(parcelId) {
      api.enterSite(companyId, parcelId).then(({ floor, snapshot }) => {
        onSnapshot(snapshot);
        viewFloor = floor;
        goInside();
      }).catch(fail);
    },
    keyboardBlocked() {
      const active = document.activeElement as HTMLElement | null;
      return modal !== null || build !== null || Boolean(active?.closest('input, textarea, select'));
    },
  });

  function goOutside(): void {
    outside = true;
    tab = tab === 'bauen' ? null : tab;
    build = null;
    syncGhost();
    world.setActive(false);
    render();
    town.enter(snap ? siteAt(snap.company, viewFloor).siteId : undefined);
    // Die Schilder der anderen Firmen. Fehlt die Liste, bleibt wenigstens das eigene.
    api.companies().then((firms) => town.setNeighbors(firms.filter((f) => f.siteId))).catch(() => undefined);
  }

  function goInside(): void {
    outside = false;
    parcelId = null;
    town.setActive(false);
    world.setActive(true);
    // Du kommst unten durch die Tür herein.
    showFloor(siteBase(viewFloor));
    render();
  }

  function toast(level: string, text: string): void {
    const id = `${Date.now()}-${Math.random()}`;
    toasts = [...toasts, { id, level, text }].slice(-4);
    render();
    if (level === 'info') {
      setTimeout(() => {
        toasts = toasts.filter((t) => t.id !== id);
        render();
      }, 5000);
    }
  }

  const fail = (err: unknown) => toast('error', (err as Error).message);

  function syncGhost(): void {
    if (!build?.tile) {
      world.setGhost(null);
      return;
    }
    if (build.kind === 'department') {
      // Ohne Anker zeigt die Vorschau die Mindestgröße, mit Anker den Bereich bis zur Maus.
      const rect = build.anchor ? rectFromCorners(build.anchor, build.tile) : { i: build.tile.i, j: build.tile.j, w: RULES.departmentMinSize, d: RULES.departmentMinSize };
      world.setGhost({ kind: 'zone', id: build.departmentId, ...rect });
      return;
    }
    if (isEdgeKind(build.kind) && !build.id) {
      const here: WallEdge = { i: build.tile.i, j: build.tile.j, rot: build.rot };
      const run = build.kind === 'wall' && wallAnchor ? wallRun(wallAnchor, here) : [here];
      world.setGhost({ kind: build.kind, i: here.i, j: here.j, rot: here.rot, run });
      return;
    }
    world.setGhost({ kind: build.kind, id: build.id, i: build.tile.i, j: build.tile.j, rot: build.rot });
  }

  function showRoom(tile: Tile): void {
    if (!snap) return;
    const tiles = [...regionAt(snap.company, viewFloor, tile)];
    world.setGhost({ kind: 'room', i: tile.i, j: tile.j, tiles, ok: isSeparateRoom(snap.company, viewFloor, tile) });
  }

  function roomNaming(): RoomNaming | null {
    if (!roomMode || !snap) return null;
    const target = roomMode.target;
    return {
      target,
      zone: target ? (zoneAt(snap.company, viewFloor, target) ?? null) : null,
      ok: target ? isSeparateRoom(snap.company, viewFloor, target) : false,
    };
  }

  /** Alle Kanten vom Anfang bis zur Maus. Die Wand rastet auf der Linie des Anfangs ein. */
  function wallRun(from: WallEdge, raw: WallEdge): WallEdge[] {
    const to: WallEdge = from.rot === 0 ? { i: raw.i, j: from.j, rot: 0 } : { i: from.i, j: raw.j, rot: 1 };
    const along = from.rot === 0 ? 'i' : 'j';
    const lo = Math.min(from[along], to[along]);
    const hi = Math.max(from[along], to[along]);
    const run: WallEdge[] = [];
    for (let n = lo; n <= hi; n++) run.push(from.rot === 0 ? { i: n, j: from.j, rot: 0 } : { i: from.i, j: n, rot: 1 });
    return run;
  }

  function wallOn(edge: WallEdge, kind: FurnitureKind = 'wall'): PlacedItem | undefined {
    return snap?.company.placed.find((p) => p.kind === kind && floorOf(p) === viewFloor && p.i === edge.i && p.j === edge.j && p.rot % 2 === edge.rot % 2);
  }

  /** Wand-Werkzeug: Klick auf eine Wand reißt sie ab, sonst Anfang setzen und mit dem zweiten Klick ziehen. */
  async function wallClick(edge: WallEdge): Promise<void> {
    if (!build || !isEdgeKind(build.kind) || !snap) return;
    build.tile = { i: edge.i, j: edge.j };
    build.rot = edge.rot;
    if (build.id) {
      // Eine gewählte Wand oder Tür wandert an die angeklickte Kante.
      await placeBuild();
      return;
    }
    const existing = wallOn(edge, build.kind);
    if (build.kind === 'door') {
      // Türen setzt man einzeln. Ein Klick auf eine Tür nimmt sie wieder heraus.
      try {
        if (existing) await api.deleteItem(companyId, existing.id);
        else await api.placeItem(companyId, { kind: 'door', floor: viewFloor, i: edge.i, j: edge.j, rot: edge.rot });
        buildMessage = '';
      } catch (err) {
        buildMessage = (err as Error).message;
      }
      syncGhost();
      render();
      return;
    }
    if (!wallAnchor && existing) {
      try {
        await api.deleteItem(companyId, existing.id);
        buildMessage = '';
      } catch (err) {
        buildMessage = (err as Error).message;
      }
      syncGhost();
      render();
      return;
    }
    if (!wallAnchor) {
      wallAnchor = edge;
      buildMessage = '';
      syncGhost();
      render();
      return;
    }
    const run = wallRun(wallAnchor, edge);
    wallAnchor = null;
    buildMessage = '';
    for (const segment of run) {
      if (wallOn(segment)) continue;
      try {
        await api.placeItem(companyId, { kind: 'wall', floor: viewFloor, i: segment.i, j: segment.j, rot: segment.rot });
      } catch (err) {
        buildMessage = (err as Error).message;
        break;
      }
    }
    syncGhost();
    render();
  }

  function rotateBuild(): void {
    // Bei einem neuen Aufgang wählt die Drehung die Seite, auf der man ankommt.
    if (!build || build.kind === 'department') return;
    build.rot = ((build.rot + 1) % 4) as Rotation;
    buildMessage = '';
    syncGhost();
    render();
  }

  /** Wechselt die sichtbare Etage. Die Figuren arbeiten überall weiter. */
  function changeFloor(step: number, wrap = false): void {
    if (!snap) return;
    const floors = buildingAt(snap.company.town, siteAt(snap.company, viewFloor).siteId).floors;
    if (floors < 2) return;
    const storey = storeyOf(viewFloor);
    const next = wrap ? (storey + step + floors) % floors : Math.max(0, Math.min(floors - 1, storey + step));
    showFloor(siteBase(viewFloor) + next);
  }

  function showFloor(floor: number): void {
    viewFloor = floor;
    world.setFloor(floor);
    // Die Vorschau gehört auf die neue Etage; das Feld wählt die Maus neu.
    if (build) build.tile = null;
    syncGhost();
    render();
  }

  /** Wer hier eingestellt wird, sitzt auch hier, wenn es einen freien Platz gibt. */
  function freeDeskHere(): string | undefined {
    if (!snap) return undefined;
    const taken = new Set(snap.company.agents.map((a) => a.deskId));
    const base = siteBase(viewFloor);
    return snap.company.placed.find((p) => p.kind === 'desk' && !taken.has(p.id) && siteBase(floorOf(p)) === base)?.id;
  }

  /** Die Mitarbeiterakten am Laptop. */
  function openFiles(): void {
    const first = snap?.company.agents.find((a) => a.hired && !a.firedAt) ?? snap?.company.agents[0];
    modal = { type: 'files', draft: { app: null, browserFrom: null, browserKey: 0, diff: null, connectionKind: 'openai', mailId: null, roadmapOwner: null, filePath: null, fileDoc: null, agentId: first?.id ?? null, roleId: null, roleText: ROLE_TEMPLATE, roleKey: 0, roleError: '', roleNote: '' } };
    refreshProjectAgents();
    refreshFiles();
    render();
  }

  function cancelBuild(): void {
    build = null;
    wallAnchor = null;
    roomMode = null;
    buildMessage = '';
    confirmDelete = null;
    syncGhost();
    render();
  }

  /** Taste I: Der gewählte Gegenstand wandert ins Inventar. */
  async function storeBuild(): Promise<void> {
    if (!build?.id) return;
    try {
      await api.storeItem(companyId, build.id);
      cancelBuild();
    } catch (err) {
      buildMessage = (err as Error).message;
      render();
    }
  }

  /** Taste Entf: Beim ersten Druck fragt das Spiel nach, denn Löschen lässt sich nicht zurücknehmen. */
  async function deleteBuild(): Promise<void> {
    const id = build?.id ?? build?.inventoryId;
    if (!id) return;
    if (confirmDelete !== id) {
      confirmDelete = id;
      render();
      return;
    }
    try {
      await api.deleteItem(companyId, id);
      cancelBuild();
    } catch (err) {
      confirmDelete = null;
      buildMessage = (err as Error).message;
      render();
    }
  }

  /** Dreht ein stehendes Möbelstück zur nächsten Richtung, in der es dort stehen darf. */
  async function rotateInPlace(item: PlacedItem): Promise<void> {
    if (!snap) return;
    const floor = floorOf(item);
    const loc = roomOf(snap.company, floor);
    for (let step = 1; step < 4; step++) {
      const rot = ((item.rot + step) % 4) as Rotation;
      if (!checkPlacement(loc, itemsOnFloor(snap.company.placed, floor), { ...item, rot }).ok) continue;
      await api.moveItem(companyId, item.id, { i: item.i, j: item.j, rot }).catch(fail);
      return;
    }
    toast('error', 'In keiner anderen Richtung ist hier Platz.');
  }

  async function placeBuild(): Promise<void> {
    if (!build?.tile || !snap || build.kind === 'department') return;
    if (isShaft(build.kind) && !build.id) {
      const shaft = { kind: build.kind, i: build.tile.i, j: build.tile.j, rot: build.rot };
      const fits = checkShaft(snap.company, shaft);
      if (!fits.ok) {
        buildMessage = fits.reason;
        render();
        return;
      }
      try {
        if (build.withFloor) await api.expandBuilding(companyId, { kind: 'etage', shaft });
        else await api.addShaft(companyId, shaft);
        cancelBuild();
      } catch (err) {
        buildMessage = (err as Error).message;
        render();
      }
      return;
    }
    const candidate = { kind: build.kind, id: build.id, i: build.tile.i, j: build.tile.j, rot: build.rot };
    const check = checkPlacement(roomOf(snap.company, viewFloor), itemsOnFloor(snap.company.placed, viewFloor), candidate);
    if (!check.ok) {
      buildMessage = check.reason;
      render();
      return;
    }
    try {
      if (build.inventoryId) await api.placeItem(companyId, { inventoryId: build.inventoryId, floor: viewFloor, i: candidate.i, j: candidate.j, rot: candidate.rot });
      else if (build.id) await api.moveItem(companyId, build.id, { floor: viewFloor, i: candidate.i, j: candidate.j, rot: candidate.rot });
      else await api.placeItem(companyId, { kind: candidate.kind, floor: viewFloor, i: candidate.i, j: candidate.j, rot: candidate.rot });
      build = null;
      buildMessage = '';
      syncGhost();
      render();
    } catch (err) {
      buildMessage = (err as Error).message;
      render();
    }
  }

  async function refreshProjectAgents(): Promise<void> {
    if (!snap?.company.projectDir) return;
    try {
      projectAgents = await api.projectAgents(companyId);
      render();
    } catch {
      // Die Liste folgt beim nächsten Öffnen
    }
  }

  async function refreshFiles(): Promise<void> {
    try {
      files = await api.files(companyId);
      render();
    } catch {
      // Die Liste folgt beim nächsten Stand
    }
  }

  function randomName(): string {
    const taken = new Set(snap?.company.agents.map((a) => a.name));
    return NAME_IDEAS.find((n) => !taken.has(n)) ?? `Kraft ${(snap?.company.agents.length ?? 0) + 1}`;
  }

  function newHireDraft(): HireDraft {
    const role = ROLES[0];
    const pick = <T,>(list: T[]) => list[Math.floor(Math.random() * list.length)];
    const look: Look = { hair: pick(LOOK_OPTIONS.hair), hairColor: pick(LOOK_OPTIONS.hairColor), skin: pick(LOOK_OPTIONS.skin), top: role.top, glasses: Math.random() < 0.25 };
    return { roleId: role.id, companyRoleId: null, skillIds: [...role.skillIds], modelId: 'claude-haiku-5-5', name: randomName(), look, deskId: null, customSkills: [], textChars: {}, skillError: '', error: '', busy: false };
  }

  function newMandateDraft(managerId?: string, departmentId?: string, teamId: string | null = null): MandateDraft {
    const hired = snap?.company.agents.filter((a) => a.hired) ?? [];
    const members = snap?.company.teams.find((t) => t.id === teamId)?.memberIds;
    const inScope = members ? hired.filter((a) => members.includes(a.id)) : departmentId ? hired.filter((a) => departmentOfAgent(snap!.company, a)?.id === departmentId) : hired;
    const lead = snap?.company.teams.find((t) => t.id === teamId)?.leadId;
    const manager = (managerId ? hired.find((a) => a.id === managerId) : null) ?? inScope.find((a) => a.id === lead) ?? inScope.find((a) => a.roleId === 'fuehrung') ?? inScope.find((a) => a.roleId === 'planung') ?? inScope[0];
    return { teamId, textChars: 0, managerId: manager?.id ?? '', mode: 'none', webAccess: false, error: '', busy: false };
  }

  /** Schlägt ein Team anhand der Rollen vor. Der Spieler kann jede Stufe ändern oder streichen. */
  function suggestTeam(hired: Agent[], preferredWorker?: string): OrderTeamDraft {
    // Die Reihenfolge der Rollen ist die Rangfolge: Wer umsetzen kann, geht vor.
    const byRole = (...roles: string[]) => {
      for (const role of roles) {
        const found = hired.find((a) => a.roleId === role);
        if (found) return found.id;
      }
      return null;
    };
    const work = preferredWorker ?? byRole('entwicklung', 'frei', 'text', 'recherche', 'planung', 'pruefung') ?? hired[0]?.id ?? '';
    const plan = byRole('planung');
    const check = byRole('pruefung');
    return { plan: plan === work ? null : plan, work, check: check === work ? null : check };
  }

  let criterionKey = 0;
  const newCriterion = (text = '') => ({ key: `c${criterionKey++}`, text });

  /** Abnahmekriterien als Vorschlag, passend zur Rolle der Arbeitsstufe. Der Spieler passt sie an. */
  function suggestCriteria(workId: string | null, lead: string[] = []): string[] {
    const worker = snap?.company.agents.find((a) => a.id === workId);
    const role = worker ? roleById(worker.roleId) : null;
    return [...lead, ...(role?.criteria ?? ['Das Ergebnis liegt als Datei vor'])];
  }
  const orderChars = (draft: Pick<OrderDraft, 'criteria' | 'title' | 'notes'>, title?: string, notes?: string) =>
    (title ?? draft.title ?? '').length + (notes ?? draft.notes ?? '').length + draft.criteria.reduce((sum, c) => sum + c.text.length, 0);
  const withSuggestion = (draft: Omit<OrderDraft, 'criteria' | 'suggestion' | 'teamId' | 'textChars'> & { teamId?: string | null }, lead: string[] = []): OrderDraft => {
    const suggestion = suggestCriteria(draft.team.work, lead);
    const criteria = suggestion.map((text) => newCriterion(text));
    return { ...draft, teamId: draft.teamId ?? null, criteria, suggestion, textChars: orderChars({ criteria, title: draft.title, notes: draft.notes }) };
  };

  /** Eine definierte Rolle übernimmt die Einstellung: Fähigkeiten, Modell und Kleidung kommen von dort. */
  function applyCompanyRole(draft: HireDraft, roleId: string): void {
    const role = snap?.company.roles?.find((r) => r.id === roleId);
    if (!role) {
      draft.companyRoleId = null;
      const base = roleById(draft.roleId)!;
      draft.skillIds = [...base.skillIds];
      return;
    }
    draft.companyRoleId = role.id;
    draft.roleId = role.baseRoleId;
    draft.skillIds = [...role.skillIds];
    draft.customSkills = [];
    draft.modelId = role.modelId;
    draft.look.top = roleById(role.baseRoleId)!.top;
  }

  /** Zettel direkt vergeben: Das Ziehen ist die Anweisung, die Person beginnt sofort. Das Limit folgt ihrem Modell. */
  async function assignNote(noteId: string, agentId: string): Promise<void> {
    const note = snap?.company.board.find((n) => n.id === noteId && (n.status === 'open' || n.status === 'sprint'));
    const agent = snap?.company.agents.find((a) => a.id === agentId && a.hired);
    if (!note || !agent) return;
    try {
      const limitEur = suggestedLimit(agent.modelId);
      const order = await api.startOrder(companyId, {
        team: { work: agent.id, plan: null, check: null }, title: note.title, notes: note.notes,
        criteria: note.criteria.length ? note.criteria : suggestCriteria(agent.id), limitEur, maxRevisions: RULES.defaultMaxRevisions, webAccess: false, noteId: note.id,
      });
      selectedNote = null;
      selectedOrder = order.id;
      toast('info', `${agent.name} holt "${note.title}" von der Tafel. Limit: ${limitEur.toLocaleString(locale())} €.`);
      render();
    } catch (err) {
      fail(err);
    }
  }

  /** Der Vorschlag nennt eine Rolle in den Worten des Agenten. Ob jemand dazu passt, zeigen Name, Stelle, Rolle und Herkunft. */
  const fitsNote = (agent: Agent, note: BoardItem) => {
    const wanted = note.role.toLowerCase();
    return Boolean(wanted) && [agent.name, agent.job?.title, roleById(agent.roleId)?.title, agent.origin?.file].some((text) => text?.toLowerCase().includes(wanted));
  };

  function openNoteOrder(note: BoardItem, workerId: string | undefined): void {
    const everyone = snap!.company.agents.filter((a) => a.hired);
    const draft = withSuggestion({ teamId: null, team: suggestTeam(everyone, workerId), title: note.title, notes: note.notes, webAccess: false, error: '', busy: false });
    if (note.criteria.length) {
      draft.criteria = note.criteria.map((text) => newCriterion(text));
      draft.suggestion = [];
    }
    draft.noteId = note.id;
    modal = { type: 'order', draft };
    render();
  }

  /** Beide Dialoge nutzen dasselbe Feld für Fähigkeiten. */
  const skillDraft = () => (modal?.type === 'hire' ? modal.draft : null);

  /** Liest eine Markdown-Datei im Browser und gibt Titel und Text zurück. Die erste Überschrift wird zum Namen. */
  async function readSkillFile(file: File): Promise<{ title: string; instruction: string }> {
    if (file.size > RULES.skillTextMax * 4) throw new Error(`Die Datei ist zu groß: höchstens ${RULES.skillTextMax.toLocaleString(locale())} Zeichen, denn sie wird bei jedem Lauf mitgelesen.`);
    const instruction = (await file.text()).trim();
    if (!instruction) throw new Error('Die Datei ist leer.');
    if (instruction.length > RULES.skillTextMax) throw new Error(`Die Datei ist zu lang: ${instruction.length.toLocaleString(locale())} Zeichen, höchstens ${RULES.skillTextMax.toLocaleString(locale())}.`);
    const heading = instruction.match(/^#\s+(.+)$/m)?.[1]?.trim();
    return { title: (heading || file.name.replace(/\.\w+$/, '')).slice(0, 60), instruction };
  }

  /* ---------- Aktionen ---------- */

  const actions: Record<string, (el: HTMLElement) => void | Promise<void>> = {
    tab(el) {
      const id = el.dataset.id as Tab;
      tab = tab === id ? null : id;
      if (tab !== 'bauen') {
        build = null;
        syncGhost();
      }
      // Bauen geht nur drinnen.
      if (tab === 'bauen' && outside) goInside();
      if (tab === 'team') refreshProjectAgents();
      if (tab === 'projekte') {
        refreshFiles();
        if (!selectedOrder) {
          const active = snap?.company.orders.findLast((o) => ['running', 'review', 'limit', 'stopped', 'failed'].includes(o.status));
          selectedOrder = active?.id ?? null;
        }
      }
      render();
    },
    'to-start'() {
      onLeave();
    },
    'select-meeting'(el) {
      selectedMeeting = el.dataset.id!;
      els.panel.scrollTop = 0;
      render();
    },
    'select-department'(el) {
      selectedDepartment = selectedDepartment === el.dataset.id ? null : el.dataset.id!;
      render();
    },
    'select-mandate'(el) {
      selectedMandate = selectedMandate === el.dataset.id ? null : el.dataset.id!;
      render();
    },
    async 'dissolve-department'(el) {
      await api.dissolveDepartment(companyId, el.dataset.id!).catch(fail);
      selectedDepartment = null;
    },
    'open-mandate'(el) {
      if (!snap) return;
      modal = { type: 'mandate', draft: newMandateDraft(el.dataset.manager || undefined, el.dataset.department || undefined, el.dataset.team || null) };
      render();
    },
    'mandate-manager'(el) {
      if (modal?.type !== 'mandate') return;
      modal.draft.managerId = el.dataset.id!;
      render();
    },
    'mandate-mode'(el) {
      if (modal?.type !== 'mandate') return;
      modal.draft.mode = el.dataset.id as SelfStartMode;
      render();
    },
    async 'plan-mandate'(el) {
      await api.planMandate(companyId, el.dataset.id!).catch(fail);
    },
    async 'close-mandate'(el) {
      await api.closeMandate(companyId, el.dataset.id!).catch(fail);
    },
    async 'approve-proposal'(el) {
      await api.decideProposal(companyId, el.dataset.mandate!, el.dataset.id!, 'approve').catch(fail);
    },
    async 'decline-proposal'(el) {
      await api.decideProposal(companyId, el.dataset.mandate!, el.dataset.id!, 'decline').catch(fail);
    },
    async 'open-contract'(el) {
      try {
        const { contract, text } = await api.contract(companyId, el.dataset.mandate!, el.dataset.id!);
        modal = { type: 'contract', view: { mandateId: el.dataset.mandate!, contract, markdown: DOCUMENT_STYLE + (marked.parse(text, { async: false }) as string), busy: false, error: '' } };
        render();
      } catch (err) {
        fail(err);
      }
    },
    async 'sign-contract'(el) {
      if (modal?.type !== 'contract') return;
      const view = modal.view;
      view.busy = true;
      view.error = '';
      render();
      try {
        const name = el.closest('.modal')?.querySelector<HTMLInputElement>('input[name=contractName]')?.value ?? '';
        await api.signContract(companyId, el.dataset.mandate!, el.dataset.id!, { decision: 'sign', name });
        modal = null;
        tab = 'team';
        render();
      } catch (err) {
        view.busy = false;
        view.error = (err as Error).message;
        render();
      }
    },
    async 'decline-contract'(el) {
      await api.signContract(companyId, el.dataset.mandate!, el.dataset.id!, { decision: 'decline' }).catch(fail);
      modal = null;
      render();
    },
    'hire-skill-add'(el) {
      const draft = skillDraft();
      if (!draft) return;
      const box = el.closest('.skill-add')!;
      const titleEl = box.querySelector<HTMLInputElement>('[data-skill="title"]')!;
      const textEl = box.querySelector<HTMLTextAreaElement>('[data-skill="instruction"]')!;
      const title = titleEl.value.trim();
      const instruction = textEl.value.trim();
      if (!title || !instruction) {
        draft.skillError = 'Eine Fähigkeit braucht einen Namen und eine Beschreibung.';
        render();
        return;
      }
      draft.customSkills.push({ key: `n${criterionKey++}`, title, instruction, source: 'beschrieben' });
      draft.skillError = '';
      titleEl.value = '';
      textEl.value = '';
      render();
    },
    'hire-skill-remove'(el) {
      const draft = skillDraft();
      if (!draft) return;
      draft.customSkills = draft.customSkills.filter((skill) => skill.key !== el.dataset.id);
      render();
    },
    'tab-team'() {
      tab = 'team';
      els.panel.scrollTop = 0;
      refreshProjectAgents();
      render();
    },
    async 'approve-command'(el) {
      await api.decideCommand(companyId, el.dataset.id!, { decision: 'approve' }).catch(fail);
    },
    async 'decline-command'(el) {
      const note = el.closest('.command')?.querySelector<HTMLInputElement>('[data-command-note]')?.value ?? '';
      await api.decideCommand(companyId, el.dataset.id!, { decision: 'decline', note }).catch(fail);
    },
    async 'stop-command'(el) {
      await api.stopCommand(companyId, el.dataset.id!).catch(fail);
    },
    async 'adopt-agent'(el) {
      const row = el.closest('.project-adopt');
      const modelId = row?.querySelector<HTMLSelectElement>('[data-project-model]')?.value;
      const draft = newHireDraft();
      try {
        await api.adoptProjectAgent(companyId, { file: el.dataset.file, modelId, look: { ...draft.look, top: roleById('frei')!.top } });
        await refreshProjectAgents();
      } catch (err) {
        fail(err);
      }
    },
    async 'agent-skill-add'(el) {
      await api.addAgentSkill(companyId, el.dataset.agent!, { skillId: el.dataset.id }).catch(fail);
    },
    'open-team'(el) {
      if (!snap) return;
      const team = snap.company.teams.find((t) => t.id === el.dataset.id);
      modal = { type: 'team', draft: team ? { id: team.id, name: team.name, purpose: team.purpose, memberIds: [...team.memberIds], leadId: team.leadId ?? null, error: '', busy: false } : { id: null, name: '', purpose: '', memberIds: [], leadId: null, error: '', busy: false } };
      render();
    },
    'team-toggle'(el) {
      if (modal?.type !== 'team') return;
      const { memberIds } = modal.draft;
      modal.draft.memberIds = memberIds.includes(el.dataset.id!) ? memberIds.filter((id) => id !== el.dataset.id) : [...memberIds, el.dataset.id!];
      if (modal.draft.leadId && !modal.draft.memberIds.includes(modal.draft.leadId)) modal.draft.leadId = null;
      render();
    },
    async 'delete-team'(el) {
      if (modal?.type !== 'team') return;
      const draft = modal.draft;
      try {
        await api.deleteTeam(companyId, el.dataset.id!);
        modal = null;
      } catch (err) {
        draft.error = (err as Error).message;
      }
      render();
    },
    'order-team'(el) {
      if (modal?.type !== 'order' || !snap) return;
      const teamId = el.dataset.id || null;
      const everyone = snap.company.agents.filter((a) => a.hired);
      const members = snap.company.teams.find((t) => t.id === teamId)?.memberIds;
      modal.draft.teamId = teamId;
      modal.draft.team = suggestTeam(members ? everyone.filter((a) => members.includes(a.id)) : everyone);
      render();
    },
    'meeting-team'(el) {
      if (modal?.type !== 'meeting' || !snap) return;
      const teamId = el.dataset.id || null;
      const hired = snap.company.agents.filter((a) => a.hired);
      const members = snap.company.teams.find((t) => t.id === teamId)?.memberIds;
      const chosen = (members ? hired.filter((a) => members.includes(a.id)) : hired).slice(0, RULES.meetingMaxParticipants);
      modal.draft.teamId = teamId;
      modal.draft.participantIds = chosen.map((a) => a.id);
      modal.draft.moderatorId = (chosen.find((a) => a.roleId === 'planung') ?? chosen[0])?.id ?? '';
      render();
    },
    'mandate-team'(el) {
      if (modal?.type !== 'mandate') return;
      modal.draft.teamId = el.dataset.id || null;
      // Wechselt das Team, wechselt auch, wer die Aufgabe entgegennimmt.
      modal.draft.managerId = newMandateDraft(undefined, undefined, modal.draft.teamId).managerId;
      render();
    },
    'hire-desk'(el) {
      if (modal?.type !== 'hire') return;
      modal.draft.deskId = el.dataset.id || null;
      render();
    },
    'back-team'() {
      selectedMeeting = null;
      els.panel.scrollTop = 0;
      render();
    },
    'open-meeting'() {
      if (!snap) return;
      const hired = snap.company.agents.filter((a) => a.hired);
      const participantIds = hired.slice(0, RULES.meetingMaxParticipants).map((a) => a.id);
      const moderator = hired.find((a) => a.roleId === 'planung') ?? hired[0];
      modal = { type: 'meeting', draft: { teamId: null, participantIds, moderatorId: moderator?.id ?? '', error: '', busy: false } };
      render();
    },
    'meeting-toggle'(el) {
      if (modal?.type !== 'meeting') return;
      const draft = modal.draft;
      const id = el.dataset.id!;
      if (draft.participantIds.includes(id)) {
        draft.participantIds = draft.participantIds.filter((other) => other !== id);
        if (draft.moderatorId === id) draft.moderatorId = draft.participantIds[0] ?? '';
      } else if (draft.participantIds.length < RULES.meetingMaxParticipants) {
        draft.participantIds = [...draft.participantIds, id];
        draft.moderatorId ||= id;
      }
      render();
    },
    'meeting-moderator'(el) {
      if (modal?.type !== 'meeting') return;
      modal.draft.moderatorId = el.dataset.id!;
      render();
    },
    async 'stop-meeting'(el) {
      await api.stopMeeting(companyId, el.dataset.id!).catch(fail);
    },
    async 'decide-meeting'(el) {
      await api.decideMeeting(companyId, el.dataset.id!, el.dataset.decision!).catch(fail);
      refreshFiles();
    },
    async 'meeting-round'(el) {
      await api.resumeMeeting(companyId, el.dataset.id!, { addRound: true }).catch(fail);
    },
    'step-order'(el) {
      if (!snap) return;
      const meeting = snap.company.meetings.find((m) => m.id === el.dataset.meeting);
      const step = meeting?.outcome?.steps[Number(el.dataset.index)];
      if (!meeting || !step) return;
      modal = {
        type: 'order',
        draft: withSuggestion({
          team: suggestTeam(snap.company.agents.filter((a) => a.hired)),
          title: step.task,
          notes: `Aus der Besprechung "${meeting.topic}". Das Protokoll steht in ${meeting.protocolFile}.`,
          webAccess: false, error: '', busy: false,
        }, [`Setzt den Schritt aus der Besprechung "${meeting.topic}" um`]),
      };
      render();
    },
    'select-agent'(el) {
      selectedAgent = selectedAgent === el.dataset.id ? null : el.dataset.id!;
      world.setSelected(selectedAgent);
      render();
    },
    'select-order'(el) {
      selectedOrder = selectedOrder === el.dataset.id ? null : el.dataset.id!;
      render();
    },
    'open-hire'(el) {
      const draft = newHireDraft();
      if (el.dataset.role) applyCompanyRole(draft, el.dataset.role);
      modal = { type: 'hire', draft };
      render();
    },
    'hire-company-role'(el) {
      if (modal?.type !== 'hire') return;
      applyCompanyRole(modal.draft, el.dataset.id!);
      render();
    },
    'team-lead'(el) {
      if (modal?.type !== 'team') return;
      modal.draft.leadId = modal.draft.leadId === el.dataset.id ? null : el.dataset.id!;
      render();
    },
    async 'fire-agent'(el) {
      const id = el.dataset.id!;
      // Der erste Klick fragt nach. Die Session der Person lässt sich danach nicht mehr fortsetzen.
      if (confirmFire !== id) {
        confirmFire = id;
        render();
        return;
      }
      confirmFire = null;
      try {
        await api.fireAgent(companyId, id);
        selectedAgent = null;
        world.setSelected(null);
      } catch (err) {
        fail(err);
      }
      render();
    },
    async 'set-language'(el) {
      await chooseLanguage(el.dataset.language as Language);
    },
    'town-map'() {
      town.toggleMap();
    },
    'open-note'() {
      modal = { type: 'note', draft: { error: '', busy: false } };
      render();
    },
    'select-note'(el) {
      selectedNote = selectedNote === el.dataset.id ? null : el.dataset.id!;
      render();
    },
    'note-order'(el) {
      const note = snap?.company.board.find((n) => n.id === el.dataset.id);
      if (!snap || !note) return;
      const everyone = snap.company.agents.filter((a) => a.hired);
      openNoteOrder(note, everyone.find((a) => fitsNote(a, note))?.id);
    },
    'take-note'(el) {
      const agent = snap?.company.agents.find((a) => a.id === el.dataset.id);
      if (!snap || !agent) return;
      // Erst was zur Person passt, dann was niemandem zugedacht ist, dann der älteste Zettel. Das Limit setzt der Mensch.
      const open = snap.company.board.filter((n) => n.status === 'open');
      const note = open.find((n) => n.role && fitsNote(agent, n)) ?? open.find((n) => !n.role) ?? open[0];
      if (note) openNoteOrder(note, agent.id);
    },
    'note-project'(el) {
      const note = snap?.company.board.find((n) => n.id === el.dataset.id);
      if (!snap || !note) return;
      const criteria = note.criteria.length ? `\nAbnahme laut Zettel:\n${note.criteria.map((c) => `- ${c}`).join('\n')}` : '';
      modal = { type: 'mandate', draft: { ...newMandateDraft(undefined, undefined, snap.company.teams[0]?.id ?? null), goal: note.title.slice(0, 160), notes: `${note.notes}${criteria}`.trim(), noteId: note.id } };
      render();
    },
    'note-edit'(el) {
      const note = snap?.company.board.find((n) => n.id === el.dataset.id);
      if (!note) return;
      modal = { type: 'note', draft: { error: '', busy: false, note } };
      render();
    },
    async 'note-later'(el) {
      await api.laterNote(companyId, el.dataset.id!).catch(fail);
      selectedNote = null;
      render();
    },
    async 'note-back'(el) {
      await api.backToBoard(companyId, el.dataset.id!).catch(fail);
    },
    async 'note-drop'(el) {
      await api.dropNote(companyId, el.dataset.id!).catch(fail);
      selectedNote = null;
      render();
    },
    'open-work'(el) {
      modal = null;
      tab = 'projekte';
      selectedOrder = el.dataset.id!;
      els.panel.scrollTop = 0;
      refreshFiles();
      render();
    },
    async 'ask-next'(el) {
      // Ein echter Lauf in der Session des Agenten: Die Antwort baut auf dem auf, was er schon geliefert hat.
      await api.chat(companyId, el.dataset.id!, 'Was sollte als Nächstes passieren? Baue auf dem auf, was du schon geliefert hast, und hänge jede Aufgabe als Zettel an die Tafel, auch wenn du sie in einem Dokument schon genannt hast. Erledige noch nichts davon. Antworte sonst in einem Satz.', true).catch(fail);
    },
    'open-team-task'(el) {
      tab = 'projekte';
      selectedMandate = el.dataset.id!;
      els.panel.scrollTop = 0;
      refreshFiles();
      render();
    },
    'toggle-fold'(el) {
      const id = el.dataset.id!;
      folds[id] = el.getAttribute('aria-expanded') !== 'true';
      render();
    },
    'hire-role'(el) {
      if (modal?.type !== 'hire') return;
      const role = roleById(el.dataset.id!)!;
      modal.draft.companyRoleId = null;
      modal.draft.roleId = role.id;
      modal.draft.skillIds = [...role.skillIds];
      modal.draft.look.top = role.top;
      render();
    },
    'hire-skill'(el) {
      const draft = skillDraft();
      if (!draft) return;
      const { skillIds } = draft;
      const id = el.dataset.id!;
      draft.skillIds = skillIds.includes(id) ? skillIds.filter((s) => s !== id) : [...skillIds, id];
      render();
    },
    'hire-model'(el) {
      if (modal?.type !== 'hire') return;
      modal.draft.modelId = el.dataset.id!;
      render();
    },
    'hire-look'(el) {
      if (modal?.type !== 'hire') return;
      (modal.draft.look as unknown as Record<string, string>)[el.dataset.field!] = el.dataset.value!;
      render();
    },
    'open-order'(el) {
      if (!snap) return;
      const teamId = el.dataset.team || null;
      const everyone = snap.company.agents.filter((a) => a.hired);
      const members = snap.company.teams.find((t) => t.id === teamId)?.memberIds;
      modal = { type: 'order', draft: withSuggestion({ teamId, team: suggestTeam(members ? everyone.filter((a) => members.includes(a.id)) : everyone, el.dataset.id), webAccess: false, error: '', busy: false }) };
      render();
    },
    'order-slot'(el) {
      if (modal?.type !== 'order') return;
      const team = modal.draft.team;
      const id = el.dataset.id || null;
      if (el.dataset.slot === 'plan') team.plan = id;
      else if (el.dataset.slot === 'check') team.check = id;
      else if (id) {
        team.work = id;
        // Wer arbeitet, kann sich nicht selbst prüfen.
        if (team.check === id) team.check = null;
        // Der Vorschlag folgt der Rolle, solange der Spieler ihn nicht angefasst hat.
        const draft = modal.draft;
        if (draft.criteria.map((c) => c.text).join('\n') === draft.suggestion.join('\n')) {
          const lead = draft.suggestion.filter((text) => text.startsWith('Setzt den Schritt'));
          draft.suggestion = suggestCriteria(id, lead);
          draft.criteria = draft.suggestion.map((text) => newCriterion(text));
        }
      }
      render();
    },
    'order-add-criterion'() {
      if (modal?.type !== 'order') return;
      modal.draft.criteria.push(newCriterion());
      render();
    },
    'order-remove-criterion'(el) {
      if (modal?.type !== 'order') return;
      modal.draft.criteria = modal.draft.criteria.filter((c) => c.key !== el.dataset.id);
      if (!modal.draft.criteria.length) modal.draft.criteria.push(newCriterion());
      modal.draft.suggestion = [];
      render();
    },
    'close-modal'() {
      modal = null;
      render();
    },
    async 'stop-run'(el) {
      await api.stopRun(companyId, el.dataset.id!).catch(fail);
    },
    async 'stop-order'(el) {
      await api.stopOrder(companyId, el.dataset.id!).catch(fail);
    },
    async 'accept-order'(el) {
      const form = el.closest('.detail')!;
      const checked = [...form.querySelectorAll<HTMLInputElement>('[data-criterion-check]')].map((box) => box.checked);
      await api.decide(companyId, el.dataset.id!, { decision: 'accept', checked }).catch(fail);
    },
    async 'reject-order'(el) {
      const form = el.closest('.detail')!;
      const checked = [...form.querySelectorAll<HTMLInputElement>('[data-criterion-check]')].map((box) => box.checked);
      await api.decide(companyId, el.dataset.id!, { decision: 'reject', checked }).catch(fail);
    },
    'open-result'(el) {
      const order = snap?.company.orders.find((o) => o.id === el.dataset.order);
      if (order) openViewer(order.files, el.dataset.path!, order.title);
    },
    'browser-open'(el) {
      if (modal?.type !== 'files') return;
      openInBrowser(modal.draft, el.dataset.path!);
    },
    'browser-back'() {
      if (modal?.type !== 'files' || !modal.draft.browserFrom) return;
      modal.draft.app = modal.draft.browserFrom;
      modal.draft.browserFrom = null;
      render();
    },
    'browser-reload'() {
      if (modal?.type !== 'files') return;
      modal.draft.browserKey += 1;
      render();
    },
    'browser-home'() {
      if (modal?.type !== 'files') return;
      modal.draft.filePath = null;
      modal.draft.fileDoc = null;
      render();
    },
    'open-file'(el) {
      // Auf dem Laptop bleibt alles auf dem Laptop.
      if (modal?.type === 'files') {
        openInBrowser(modal.draft, el.dataset.path!);
        return;
      }
      openViewer([el.dataset.path!], el.dataset.path!, 'Arbeitsbereich');
    },
    'viewer-file'(el) {
      if (modal?.type === 'viewer') openViewer(modal.viewer.files, el.dataset.path!, modal.viewer.title);
    },
    async 'reveal-file'(el) {
      await api.reveal(companyId, el.dataset.path!).catch(fail);
    },
    'build-pick'(el) {
      const kind = el.dataset.id!;
      build = kind === 'department' ? { kind: 'department', rot: 0, tile: null, anchor: null } : { kind: kind as FurnitureKind, rot: 0, tile: null };
      buildMessage = '';
      syncGhost();
      render();
    },
    'inventory-pick'(el) {
      const stored = snap?.company.inventory.find((s) => s.id === el.dataset.id);
      if (!stored) return;
      build = { kind: stored.kind, rot: 0, tile: null, inventoryId: stored.id };
      buildMessage = '';
      confirmDelete = null;
      syncGhost();
      render();
    },
    'build-shaft'(el) {
      build = { kind: el.dataset.id as FurnitureKind, rot: 0, tile: null, withFloor: el.dataset.floor === '1' };
      buildMessage = '';
      els.panel.scrollTop = 0;
      syncGhost();
      render();
    },
    'room-mode'() {
      build = null;
      wallAnchor = null;
      roomMode = { target: null };
      buildMessage = '';
      world.setGhost(null);
      render();
    },
    'room-cancel'() {
      cancelBuild();
    },
    async 'room-save'() {
      const target = roomMode?.target;
      if (!target) return;
      const kind = (els.panel.querySelector('select[name=zoneKind]') as HTMLSelectElement | null)?.value ?? 'other';
      const name = (els.panel.querySelector('input[name=zoneName]') as HTMLInputElement | null)?.value ?? '';
      try {
        await api.setZone(companyId, { floor: viewFloor, i: target.i, j: target.j, kind, name });
        cancelBuild();
      } catch (err) {
        buildMessage = (err as Error).message;
        render();
      }
    },
    async 'room-remove'(el) {
      await api.removeZone(companyId, el.dataset.id!).catch(fail);
    },
    'redo-department'(el) {
      const department = snap?.company.departments.find((d) => d.id === el.dataset.id);
      if (!department) return;
      tab = 'bauen';
      showFloor(floorOf(department));
      build = { kind: 'department', rot: 0, tile: null, anchor: null, departmentId: department.id };
      buildMessage = '';
      els.panel.scrollTop = 0;
      syncGhost();
      render();
    },
    async 'ceo-look'(el) {
      await api.updateCeo(companyId, { look: { [el.dataset.field!]: el.dataset.value } }).catch(fail);
    },
    async 'ceo-glasses'() {
      const look = snap?.company.ceo?.look ?? DEFAULT_CEO.look;
      await api.updateCeo(companyId, { look: { glasses: !look.glasses } }).catch(fail);
    },
    'open-files'() {
      openFiles();
    },
    'laptop-app'(el) {
      if (modal?.type !== 'files') return;
      modal.draft.app = el.dataset.id as FilesDraft['app'];
      modal.draft.mailId = null;
      modal.draft.browserFrom = null;
      if (modal.draft.app === 'dateien' || modal.draft.app === 'browser') refreshFiles();
      render();
    },
    async 'anthropic-key-remove'() {
      await api.setAnthropicKey(null).catch(fail);
    },
    'connection-kind'(el) {
      if (modal?.type !== 'files') return;
      modal.draft.connectionKind = el.dataset.id!;
      render();
    },
    async 'connection-remove'(el) {
      await api.removeConnection(el.dataset.id!).catch(fail);
    },
    async 'connection-model-remove'(el) {
      await api.removeConnectionModel(el.dataset.id!, el.dataset.remote!).catch(fail);
    },
    'laptop-home'() {
      if (modal?.type !== 'files') return;
      modal.draft.app = null;
      render();
    },
    'open-sprint-app'() {
      openFiles();
      if (modal?.type !== 'files') return;
      modal.draft.app = 'sprint';
      render();
    },
    'shell-show'(el) {
      if (modal?.type !== 'files') return;
      modal.draft.app = 'dateien';
      refreshFiles();
      actions['shell-open'](el);
    },
    'shell-open'(el) {
      if (modal?.type !== 'files') return;
      showFile(modal.draft, el.dataset.path!);
    },
    'mail-open'(el) {
      if (modal?.type !== 'files' || !snap) return;
      const order = snap.company.orders.find((o) => o.id === el.dataset.id);
      if (!order) return;
      modal.draft.app = 'nachrichten';
      modal.draft.mailId = order.id;
      modal.draft.diff = null;
      const first = order.files.find((path) => !/\/pruefung-\d+\.md$/.test(path));
      if (first) showFile(modal.draft, first);
      else render();
    },
    async 'git-diff'(el) {
      if (modal?.type !== 'files') return;
      const draft = modal.draft;
      try {
        draft.diff = (await api.orderDiff(companyId, el.dataset.id!)).diff;
      } catch (err) {
        fail(err);
      }
      render();
    },
    async 'git-push'(el) {
      await api.pushOrder(companyId, el.dataset.id!).catch(fail);
    },
    async 'git-pr'(el) {
      await api.openOrderPr(companyId, el.dataset.id!).catch(fail);
    },
    async 'repo-disconnect'() {
      await api.disconnectRepo(companyId).catch(fail);
    },
    'mail-close'() {
      if (modal?.type !== 'files') return;
      modal.draft.mailId = null;
      render();
    },
    'roadmap-owner'(el) {
      if (modal?.type !== 'files') return;
      modal.draft.roadmapOwner = el.dataset.id || null;
      render();
    },
    async 'sprint-discard'(el) {
      await api.sprintAction(companyId, el.dataset.id!, 'discard').catch(fail);
    },
    async 'sprint-end'(el) {
      await api.sprintAction(companyId, el.dataset.id!, 'end').catch(fail);
    },
    async 'sprint-retro'(el) {
      await api.sprintAction(companyId, el.dataset.id!, 'retro').catch(fail);
    },
    async 'sprint-close'(el) {
      await api.sprintAction(companyId, el.dataset.id!, 'close').catch(fail);
    },
    async 'note-unsprint'(el) {
      await api.unsprintNote(companyId, el.dataset.sprint!, el.dataset.id!).catch(fail);
    },
    'role-new'() {
      if (modal?.type !== 'files') return;
      Object.assign(modal.draft, { roleId: null, roleText: ROLE_TEMPLATE, roleKey: modal.draft.roleKey + 1, roleError: '', roleNote: '' });
      render();
    },
    'role-color'(el) {
      if (modal?.type !== 'files') return;
      const draft = modal.draft;
      const text = root.querySelector<HTMLTextAreaElement>('[data-role-md]')?.value ?? draft.roleText;
      draft.roleText = withRoleColor(text, el.dataset.color || null);
      draft.roleKey += 1;
      render();
    },
    'role-open'(el) {
      if (modal?.type !== 'files' || !snap) return;
      const role = snap.company.roles.find((r) => r.id === el.dataset.id);
      if (!role) return;
      Object.assign(modal.draft, { roleId: role.id, roleText: roleToMarkdown(role, snap.company.customSkills), roleKey: modal.draft.roleKey + 1, roleError: '', roleNote: '' });
      render();
    },
    async 'role-save'() {
      if (modal?.type !== 'files' || !snap) return;
      const draft = modal.draft;
      draft.roleText = root.querySelector<HTMLTextAreaElement>('[data-role-md]')?.value ?? draft.roleText;
      const parsed = parseRole(draft.roleText, snap.company.customSkills);
      if ('error' in parsed) {
        draft.roleError = parsed.error;
        draft.roleNote = '';
        render();
        return;
      }
      try {
        const { baseRoleId, ...rest } = parsed.role;
        if (draft.roleId) await api.updateRole(companyId, draft.roleId, rest);
        else draft.roleId = (await api.createRole(companyId, { ...rest, baseRoleId })).id;
        draft.roleError = '';
        draft.roleNote = `Gespeichert. Das Modell gilt für neue Einstellungen, Änderungen erfahren alle mit dieser Rolle im nächsten Lauf.`;
      } catch (err) {
        draft.roleError = (err as Error).message;
        draft.roleNote = '';
      }
      render();
    },
    async 'role-delete'(el) {
      if (modal?.type !== 'files') return;
      const draft = modal.draft;
      try {
        await api.deleteRole(companyId, el.dataset.id!);
        Object.assign(draft, { roleId: null, roleText: ROLE_TEMPLATE, roleKey: draft.roleKey + 1, roleError: '', roleNote: '' });
      } catch (err) {
        draft.roleError = (err as Error).message;
      }
      render();
    },
    'open-agent-file'(el) {
      openFiles();
      if (modal?.type !== 'files') return;
      modal.draft.app = 'akten';
      modal.draft.agentId = el.dataset.id!;
      render();
    },
    'files-agent'(el) {
      if (modal?.type !== 'files') return;
      modal.draft.agentId = el.dataset.id!;
      render();
    },
    async 'files-team'(el) {
      const team = snap?.company.teams.find((t) => t.id === el.dataset.id);
      const agentId = el.dataset.agent!;
      if (!team) return;
      const memberIds = team.memberIds.includes(agentId) ? team.memberIds.filter((id) => id !== agentId) : [...team.memberIds, agentId];
      await api.updateTeam(companyId, team.id, { memberIds }).catch(fail);
    },
    'set-floor'(el) {
      showFloor(Number(el.dataset.id));
    },
    async 'expand'(el) {
      try {
        await api.expandBuilding(companyId, { kind: el.dataset.id });
        buildMessage = '';
      } catch (err) {
        buildMessage = (err as Error).message;
      }
      render();
    },
    async 'town-action'(el) {
      try {
        await api.townAction(companyId, el.dataset.id!, { action: el.dataset.town, locationId: el.dataset.location as LocationId | undefined });
        // Wer einzieht, geht auch hinein.
        if (el.dataset.town === 'move') goInside();
      } catch (err) {
        fail(err);
      }
    },
    'dismiss-toast'(el) {
      toasts = toasts.filter((t) => t.id !== el.dataset.id);
      render();
    },
  };

  function openInBrowser(draft: FilesDraft, path: string): void {
    if (draft.app !== 'browser') draft.browserFrom = draft.app;
    draft.app = 'browser';
    draft.browserKey += 1;
    showFile(draft, path);
  }

  /** Die Vorschau in Dateien und Post. */
  function showFile(draft: FilesDraft, path: string): void {
    draft.filePath = path;
    draft.fileDoc = null;
    render();
    const ext = path.split('.').pop()?.toLowerCase() ?? '';
    if (!['md', 'txt', 'csv', 'json'].includes(ext)) return;
    fetch(api.fileUrl(companyId, path))
      .then((res) => res.text())
      .then((text) => {
        if (draft.filePath !== path) return;
        draft.fileDoc = documentOf(ext, text);
        render();
      })
      .catch(fail);
  }

  const documentOf = (ext: string, text: string) =>
    DOCUMENT_STYLE + (ext === 'md' ? (marked.parse(text, { async: false }) as string) : `<pre>${text.replace(/[&<]/g, (c) => (c === '&' ? '&amp;' : '&lt;'))}</pre>`);

  function openViewer(list: string[], path: string, title: string): void {
    modal = { type: 'viewer', viewer: { files: list, path, markdown: null, title } };
    render();
    const ext = path.split('.').pop()?.toLowerCase() ?? '';
    if (['md', 'txt', 'csv', 'json'].includes(ext)) {
      fetch(api.fileUrl(companyId, path))
        .then((res) => res.text())
        .then((text) => {
          if (modal?.type !== 'viewer' || modal.viewer.path !== path) return;
          modal.viewer.markdown = documentOf(ext, text);
          render();
        })
        .catch(fail);
    }
  }

  /* ---------- Formulare ---------- */

  async function onSubmit(form: HTMLFormElement): Promise<void> {
    const data = new FormData(form);
    const kind = form.dataset.form;
    if (kind === 'hire' && modal?.type === 'hire') {
      const draft = modal.draft;
      draft.busy = true;
      draft.error = '';
      render();
      try {
        const name = String(data.get('name') ?? '');
        await api.hire(companyId, {
          name, roleId: draft.roleId, companyRoleId: draft.companyRoleId, skillIds: draft.skillIds, modelId: draft.modelId, look: { ...draft.look, top: roleById(draft.roleId)!.top }, deskId: draft.deskId ?? freeDeskHere(),
          job: { title: data.get('jobTitle'), task: data.get('jobTask'), requirements: data.get('jobRequirements') },
          customSkills: draft.customSkills.map(({ title, instruction, source }) => ({ title, instruction, source })),
        });
        modal = null;
        tab = 'team';
        render();
      } catch (err) {
        draft.busy = false;
        draft.error = (err as Error).message;
        render();
      }
    } else if (kind === 'order' && modal?.type === 'order') {
      const draft = modal.draft;
      draft.busy = true;
      draft.error = '';
      render();
      try {
        const order = await api.startOrder(companyId, {
          team: draft.team,
          title: data.get('title'),
          notes: data.get('notes'),
          criteria: draft.criteria.map((c) => c.text),
          limitEur: Number(data.get('limit')),
          maxRevisions: Number(data.get('revisions')),
          webAccess: draft.webAccess,
          noteId: draft.noteId ?? null,
        });
        selectedNote = null;
        modal = null;
        tab = 'projekte';
        selectedOrder = order.id;
        render();
      } catch (err) {
        draft.busy = false;
        draft.error = (err as Error).message;
        render();
      }
    } else if (kind === 'meeting' && modal?.type === 'meeting') {
      const draft = modal.draft;
      draft.busy = true;
      draft.error = '';
      render();
      try {
        const meeting = await api.startMeeting(companyId, {
          topic: data.get('topic'),
          notes: data.get('notes'),
          participantIds: draft.participantIds,
          moderatorId: draft.moderatorId,
          maxRounds: Number(data.get('rounds')),
          limitEur: Number(data.get('limit')),
        });
        modal = null;
        tab = 'team';
        selectedMeeting = meeting.id;
        els.panel.scrollTop = 0;
        render();
      } catch (err) {
        draft.busy = false;
        draft.error = (err as Error).message;
        render();
      }
    } else if (kind === 'department' && modal?.type === 'department') {
      const draft = modal.draft;
      draft.busy = true;
      draft.error = '';
      render();
      try {
        const department = await api.createDepartment(companyId, { name: data.get('name'), floor: viewFloor, i: draft.i, j: draft.j, w: draft.w, d: draft.d, budgetEur: Number(data.get('budget')) });
        modal = null;
        build = null;
        buildMessage = '';
        syncGhost();
        selectedDepartment = department.id;
        tab = 'team';
        render();
      } catch (err) {
        draft.busy = false;
        draft.error = (err as Error).message;
        render();
      }
    } else if (kind === 'mandate' && modal?.type === 'mandate') {
      const draft = modal.draft;
      draft.busy = true;
      draft.error = '';
      render();
      try {
        const budgetEur = Number(data.get('budget'));
        const selfStartUpToEur = draft.mode === 'all' ? budgetEur : draft.mode === 'upto' ? Number(data.get('selfStart') ?? 0) : 0;
        const mandate = await api.startMandate(companyId, {
          goal: data.get('goal'), notes: data.get('notes'), managerId: draft.managerId, budgetEur, selfStartUpToEur, webAccess: draft.webAccess, teamId: draft.teamId, noteId: draft.noteId ?? null,
        });
        selectedNote = null;
        modal = null;
        tab = 'projekte';
        selectedMandate = mandate.id;
        els.panel.scrollTop = 0;
        render();
      } catch (err) {
        draft.busy = false;
        draft.error = (err as Error).message;
        render();
      }
    } else if (kind === 'team' && modal?.type === 'team') {
      const draft = modal.draft;
      draft.busy = true;
      draft.error = '';
      render();
      try {
        const body = { name: data.get('name'), purpose: data.get('purpose'), memberIds: draft.memberIds, leadId: draft.leadId };
        if (draft.id) await api.updateTeam(companyId, draft.id, body);
        else await api.createTeam(companyId, body);
        modal = null;
        render();
      } catch (err) {
        draft.busy = false;
        draft.error = (err as Error).message;
        render();
      }
    } else if (kind === 'note' && modal?.type === 'note') {
      const draft = modal.draft;
      draft.busy = true;
      draft.error = '';
      render();
      try {
        const body = { title: data.get('title'), notes: data.get('notes'), role: data.get('role'), criteria: String(data.get('criteria') ?? '').split('\n') };
        if (draft.note) await api.updateNote(companyId, draft.note.id, body);
        else await api.createNote(companyId, body);
        modal = null;
        render();
      } catch (err) {
        draft.busy = false;
        draft.error = (err as Error).message;
        render();
      }
    } else if (kind === 'repo') {
      try {
        await api.connectRepo(companyId, String(data.get('source') ?? ''));
        toast('info', 'Repo verbunden.');
      } catch (err) {
        fail(err);
      }
    } else if (kind === 'anthropic-key') {
      await api.setAnthropicKey(String(data.get('apiKey') ?? '')).then(() => form.reset()).catch(fail);
    } else if (kind === 'connection') {
      try {
        await api.addConnection({ kind: data.get('kind'), apiKey: data.get('apiKey'), baseUrl: data.get('baseUrl'), label: data.get('label') });
        form.reset();
        toast('info', 'Verbunden.');
      } catch (err) {
        fail(err);
      }
    } else if (kind === 'connection-model') {
      try {
        await api.addConnectionModel(form.dataset.id!, { remote: data.get('remote'), input: data.get('input'), cached: data.get('cached') || data.get('input'), output: data.get('output'), contextWindow: data.get('contextWindow') });
        form.reset();
      } catch (err) {
        fail(err);
      }
    } else if (kind === 'sprint-plan') {
      await api.planSprint(companyId, { budgetEur: Number(data.get('budget')), hint: data.get('hint') }).catch(fail);
    } else if (kind === 'sprint-start') {
      await api.sprintAction(companyId, form.dataset.id!, 'start', { goal: data.get('goal'), budgetEur: Number(data.get('budget')), noteIds: data.getAll('note') }).catch(fail);
    } else if (kind === 'ceo') {
      await api.updateCeo(companyId, { name: data.get('name') }).catch(fail);
    } else if (kind === 'job') {
      await api.updateJob(companyId, form.dataset.id!, { title: data.get('title'), task: data.get('task'), requirements: data.get('requirements') })
        .then(() => toast('info', 'Stelle gespeichert. Die Änderung gilt ab dem nächsten Lauf.'))
        .catch(fail);
    } else if (kind === 'agent-skill') {
      await api.addAgentSkill(companyId, form.dataset.id!, { title: data.get('title'), instruction: data.get('instruction'), source: 'beschrieben' })
        .then(() => {
          form.reset();
          toast('info', 'Fähigkeit hinzugefügt. Sie gilt ab dem nächsten Lauf.');
        })
        .catch(fail);
    } else if (kind === 'department-budget') {
      await api.patchDepartment(companyId, form.dataset.id!, { budgetEur: Number(data.get('budget')) }).catch(fail);
    } else if (kind === 'meeting-resume') {
      await api.resumeMeeting(companyId, form.dataset.id!, { addLimitEur: Number(data.get('addLimit') ?? 0) }).catch(fail);
    } else if (kind === 'chat') {
      const text = String(data.get('text') ?? '');
      if (!text.trim()) return;
      form.reset();
      await api.chat(companyId, form.dataset.id!, text).catch(fail);
    } else if (kind === 'revise') {
      await api.revise(companyId, form.dataset.id!, { feedback: data.get('feedback'), addLimitEur: Number(data.get('addLimit') ?? 0) })
        .then(() => {
          form.reset();
          // Die Stufen stehen oben: Dort geht es jetzt weiter.
          els.panel.scrollTop = 0;
        })
        .catch(fail);
    } else if (kind === 'budget') {
      await api.patchCompany(companyId, { budgetEur: Number(data.get('budget')) }).catch(fail);
    }
  }

  function onClick(event: Event): void {
    // Das Ende eines Ziehens wählt keinen Zettel aus.
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    const el = (event.target as HTMLElement).closest<HTMLElement>('[data-action]');
    if (!el) return;
    const action = actions[el.dataset.action!];
    if (!action) return;
    event.preventDefault();
    action(el);
  }

  root.addEventListener('click', onClick);
  // Einen Zettel auf eine Person ziehen. Am Zeiger hängt eine Kopie, das Original bleibt bis zur Vergabe an der Tafel.
  let noteDrag: { id: string; x: number; y: number; ghost: HTMLElement | null; source: HTMLElement; agent: string | null } | null = null;
  let suppressClick = false;
  const agentUnder = (x: number, y: number): string | null => {
    const under = document.elementFromPoint(x, y) as HTMLElement | null;
    const row = under?.closest?.<HTMLElement>('[data-drop-agent]');
    if (row) return row.dataset.dropAgent!;
    return !outside && under?.tagName === 'CANVAS' ? world.agentAtPoint(x, y) : null;
  };
  const markDrop = (agent: string | null) => {
    world.setDropTarget(agent);
    root.querySelectorAll<HTMLElement>('[data-drop-agent]').forEach((el) => el.classList.toggle('over', el.dataset.dropAgent === agent));
  };
  const endNoteDrag = () => {
    noteDrag?.ghost?.remove();
    noteDrag = null;
    markDrop(null);
    document.body.classList.remove('dragging-note');
  };
  root.addEventListener('pointerdown', (event) => {
    const source = (event.target as HTMLElement).closest?.<HTMLElement>('[data-note]');
    if (source && event.button === 0) noteDrag = { id: source.dataset.note!, x: event.clientX, y: event.clientY, ghost: null, source, agent: null };
  });
  const onDragMove = (event: PointerEvent) => {
    if (!noteDrag) return;
    if (!noteDrag.ghost) {
      if (Math.hypot(event.clientX - noteDrag.x, event.clientY - noteDrag.y) < 6) return;
      const ghost = noteDrag.source.cloneNode(true) as HTMLElement;
      const box = noteDrag.source.getBoundingClientRect();
      ghost.classList.add('zettel-ghost');
      ghost.style.width = `${box.width}px`;
      document.body.append(ghost);
      noteDrag.ghost = ghost;
      document.body.classList.add('dragging-note');
    }
    noteDrag.ghost.style.left = `${event.clientX + 6}px`;
    noteDrag.ghost.style.top = `${event.clientY + 6}px`;
    noteDrag.agent = agentUnder(event.clientX, event.clientY);
    markDrop(noteDrag.agent);
  };
  const onDragEnd = () => {
    if (!noteDrag) return;
    const { id, ghost, agent } = noteDrag;
    if (ghost) suppressClick = true;
    endNoteDrag();
    if (agent) assignNote(id, agent);
  };
  const onDragKey = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && noteDrag?.ghost) {
      suppressClick = true;
      endNoteDrag();
    }
  };
  window.addEventListener('pointermove', onDragMove);
  window.addEventListener('pointerup', onDragEnd);
  window.addEventListener('keydown', onDragKey);
  root.addEventListener('submit', (event) => {
    const form = event.target as HTMLFormElement;
    if (!form.dataset.form) return;
    event.preventDefault();
    onSubmit(form);
  });
  root.addEventListener('input', (event) => {
    const input = event.target as HTMLInputElement;
    const key = input.dataset?.criterion;
    if (key && modal?.type === 'order') {
      const criterion = modal.draft.criteria.find((c) => c.key === key);
      if (criterion) criterion.text = input.value;
    }
    // Kontext und Kosten folgen beim Tippen.
    const form = input.closest?.('form');
    if (modal?.type === 'hire' && input.dataset?.measure) {
      modal.draft.textChars[input.dataset.measure] = input.value.length;
      render();
    } else if (modal?.type === 'order' && form && (input.dataset?.measure === 'order' || key)) {
      const data = new FormData(form);
      modal.draft.textChars = orderChars(modal.draft, String(data.get('title') ?? ''), String(data.get('notes') ?? ''));
      render();
    } else if (modal?.type === 'mandate' && form && input.dataset?.measure === 'mandate') {
      const data = new FormData(form);
      modal.draft.textChars = String(data.get('goal') ?? '').length + String(data.get('notes') ?? '').length;
      render();
    }
  });
  root.addEventListener('change', (event) => {
    const input = event.target as HTMLInputElement;
    if (input.dataset?.action === 'order-web' && modal?.type === 'order') modal.draft.webAccess = input.checked;
    if (input.dataset?.action === 'mandate-web' && modal?.type === 'mandate') modal.draft.webAccess = input.checked;
    if (input.dataset?.action === 'role-md-file' && modal?.type === 'files' && input.files?.[0]) {
      const draft = modal.draft;
      const file = input.files[0];
      if (file.size > 30000) {
        draft.roleError = 'Die Datei ist zu gross: höchstens 30.000 Zeichen.';
        render();
      } else {
        file.text().then((text) => {
          Object.assign(draft, { roleId: null, roleText: text, roleKey: draft.roleKey + 1, roleError: '', roleNote: 'Datei geladen. Prüfe sie und speichere sie als neue Rolle.' });
          input.value = '';
          render();
        });
      }
    }
    const fileDraft = skillDraft();
    if (input.dataset?.action === 'hire-skill-file' && fileDraft && input.files?.[0]) {
      const draft = fileDraft;
      readSkillFile(input.files[0])
        .then((skill) => {
          draft.customSkills.push({ key: `n${criterionKey++}`, ...skill, source: 'datei' });
          draft.skillError = '';
        })
        .catch((err) => {
          draft.skillError = (err as Error).message;
        })
        .finally(() => {
          input.value = '';
          render();
        });
    }
    if (input.dataset?.action === 'agent-skill-file' && input.files?.[0]) {
      const agentId = input.dataset.id!;
      readSkillFile(input.files[0])
        .then((skill) => api.addAgentSkill(companyId, agentId, { ...skill, source: 'datei' }))
        .then(() => toast('info', 'Fähigkeit aus der Datei hinzugefügt. Sie gilt ab dem nächsten Lauf.'))
        .catch(fail)
        .finally(() => {
          input.value = '';
        });
    }
    if (input.dataset?.action === 'hire-glasses' && modal?.type === 'hire') {
      modal.draft.look.glasses = input.checked;
      render();
    }
  });
  const onKey = (event: KeyboardEvent) => {
    const typing = (event.target as HTMLElement | null)?.closest?.('input, textarea, select');
    if (!modal && !typing && !outside && (event.key === 'PageUp' || event.key === 'PageDown')) {
      event.preventDefault();
      changeFloor(event.key === 'PageUp' ? 1 : -1);
      return;
    }
    if (event.key === 'Enter' && ceoSeated && !modal && !typing && !build && !outside) {
      event.preventDefault();
      openFiles();
      return;
    }
    // Zoomen geht überall, außer beim Tippen.
    if (!modal && !typing && !event.metaKey && !event.ctrlKey) {
      const view = outside ? town : world;
      if (event.key === '+' || event.key === '=') view.zoomBy(1);
      else if (event.key === '-') view.zoomBy(-1);
      else if (event.key === '0') view.resetView();
      if (['+', '=', '-', '0'].includes(event.key)) {
        event.preventDefault();
        return;
      }
    }
    // Im Bau-Modus läuft alles über die Tastatur. Der Fokus auf einem Knopf darf Enter nicht abfangen.
    if (build && !modal && !typing && !event.metaKey && !event.ctrlKey) {
      const key = event.key.toLowerCase();
      const act = key === 'r' ? rotateBuild : key === 'enter' ? placeBuild : key === 'i' ? storeBuild : key === 'delete' || key === 'backspace' ? deleteBuild : null;
      if (act) {
        event.preventDefault();
        act();
        return;
      }
    }
    if (event.key !== 'Escape') return;
    // Im Browser führt Esc zurück. Den Laptop klappt nur "Zuklappen" zu oder Esc auf dem Schreibtisch.
    if (modal?.type === 'files' && modal.draft.app === 'browser' && modal.draft.browserFrom) {
      modal.draft.app = modal.draft.browserFrom;
      modal.draft.browserFrom = null;
      render();
      return;
    }
    if (modal) {
      modal = null;
      render();
    } else if (build || roomMode) {
      cancelBuild();
    }
  };
  window.addEventListener('keydown', onKey);
  els.backdrop.addEventListener('click', (event) => {
    if (event.target === els.backdrop) {
      modal = null;
      render();
    }
  });

  /* ---------- Darstellung ---------- */

  function render(): void {
    if (!snap) return;
    morph(els.topbar, topBar(snap));
    morph(els.live, liveNote(snap, disconnected));
    els.world.hidden = outside;
    els.town.hidden = !outside;
    const parcel = parcelId ? parcelById(parcelId) ?? null : null;
    morph(els.overlay, html`${outside ? townChips(townCity) : roomChips(snap, viewFloor, ceoSeated)}${outside ? townCard(snap, parcel) : null}${disconnected ? html`<div class="stale" role="alert">Keine Verbindung zum Server.</div>` : null}`);
    root.querySelectorAll<HTMLElement>('.tab').forEach((button) => {
      const on = button.dataset.id === tab;
      button.classList.toggle('active', on);
      if (on) button.setAttribute('aria-current', 'true');
      else button.removeAttribute('aria-current');
    });
    els.panel.hidden = tab === null;
    els.panel.parentElement!.classList.toggle('is-building', tab === 'bauen' && build !== null);
    let panel: Safe | null = null;
    const openMeeting = snap.company.meetings.find((m) => m.id === selectedMeeting);
    if (tab === 'team' && openMeeting) panel = meetingPanel(snap, openMeeting);
    else if (tab === 'team') panel = teamPanel(snap, selectedAgent, selectedDepartment);
    else if (tab === 'projekte') panel = projectsPanel(snap, selectedOrder, selectedMandate, files, folds, selectedNote);
    else if (tab === 'finanzen') panel = financePanel(snap);
    else if (tab === 'bauen') panel = buildPanel(snap, build?.kind ?? null, Boolean(build?.id), buildMessage, build?.kind === 'department' && build.anchor !== null, build?.inventoryId ?? null, confirmDelete, viewFloor < 100, roomNaming());
    if (panel) morph(els.panel, panel);
    // Eine neue Antwort soll sichtbar sein, ohne dass man erst danach suchen muss.
    const chatLength = snap.company.agents.find((a) => a.id === selectedAgent)?.chat.length ?? 0;
    if (tab === 'team' && selectedAgent && chatLength > lastChatLength) els.panel.scrollTop = els.panel.scrollHeight;
    lastChatLength = chatLength;
    morph(els.toasts, notices(toasts));

    els.backdrop.hidden = modal === null;
    if (modal) {
      els.modal.className = `modal modal-${modal.type}`;
      if (modal.type === 'hire') morph(els.modal, hireModal(snap, modal.draft));
      else if (modal.type === 'order') morph(els.modal, orderModal(snap, modal.draft));
      else if (modal.type === 'meeting') morph(els.modal, meetingModal(snap, modal.draft));
      else if (modal.type === 'department') morph(els.modal, departmentModal(snap, modal.draft));
      else if (modal.type === 'mandate') morph(els.modal, mandateModal(snap, modal.draft));
      else if (modal.type === 'contract') morph(els.modal, contractModal(snap, modal.view));
      else if (modal.type === 'team') morph(els.modal, teamModal(snap, modal.draft));
      else if (modal.type === 'note') morph(els.modal, noteModal(modal.draft));
      else if (modal.type === 'files') morph(els.modal, laptopModal(snap, modal.draft, projectAgents, files, folds, companyId, confirmFire));
      else morph(els.modal, viewerModal(companyId, modal.viewer, snap.system.artifactPort));
      // Ein neuer Dialog beginnt oben, auch wenn der vorige weit unten stand.
      if (modal !== shownModal) els.modal.querySelector('.modal-body')?.scrollTo(0, 0);
    }
    shownModal = modal;
  }

  function onSnapshot(next: Snapshot): void {
    setExtraModels(next.system.extraModels ?? [], (next.system.connections ?? []).map((c) => ({ id: c.id, label: c.label })));
    const first = !snap;
    // Nach einem Umzug beginnt die Ansicht unten.
    if (snap && snap.company.locationId !== next.company.locationId) viewFloor = 0;
    snap = next;
    disconnected = false;
    if (first) refreshProjectAgents();
    world.setCompany(next.company);
    world.setQuota(next.system.provider.billing === 'api' ? null : next.system.plan);
    town.setCompany(next.company);
    for (const notice of next.company.notices) {
      if (seenNotices.has(notice.id)) continue;
      seenNotices.add(notice.id);
      if (noticesPrimed) toast(notice.level, notice.text);
    }
    noticesPrimed = true;
    const ended = next.company.runs.filter((r) => r.endedAt).length;
    if (ended !== lastRunEnded) {
      lastRunEnded = ended;
      if (tab === 'projekte' || modal?.type === 'files') refreshFiles();
    }
    render();
  }

  const source = new EventSource(api.streamUrl(companyId));
  source.onmessage = (event) => onSnapshot(JSON.parse(event.data));
  source.onerror = () => {
    disconnected = true;
    render();
  };

  return () => {
    source.close();
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('pointermove', onDragMove);
    window.removeEventListener('pointerup', onDragEnd);
    window.removeEventListener('keydown', onDragKey);
    endNoteDrag();
    world.destroy();
    town.destroy();
  };
}

// Reine Ansicht für Ergebnisse: bewusst keine Pixelschrift, hier wird gelesen.
// Ohne allow-scripts läuft im Rahmen kein Code. Die CSP verhindert, dass ein Agenten-Dokument
// über externe Bilder oder Stile Daten nach außen trägt.
const DOCUMENT_STYLE = `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:"><style>
body{font:17px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#1c2636;background:#fbfaf6;max-width:68ch;margin:0 auto;padding:32px 28px}
h1,h2,h3{line-height:1.25;color:#0e1b2c}h1{font-size:1.7em}pre{background:#eef0ec;padding:12px;overflow:auto;white-space:pre-wrap}code{background:#eef0ec;padding:0 4px}
table{border-collapse:collapse}td,th{border:1px solid #cfd4d0;padding:4px 8px}blockquote{border-left:3px solid #2fa58f;margin-left:0;padding-left:14px;color:#3d4a5c}
</style>`;
