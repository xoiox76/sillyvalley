// Gründungsbildschirm: eine Idee, ein Startort, ein echtes Budget.

import { chooseLanguage, languageSwitch } from './language.ts';
import type { Language } from '../i18n/translate.ts';
import { LOCATIONS, locationById } from '../../shared/catalog.ts';
import type { CompanySummary, LocationId, SystemInfo } from '../../shared/types.ts';
import { roomPreview } from '../world/world.ts';
import { api } from './api.ts';
import { businessCaseFields, readBusinessCase, readVision, visionFields } from './charter.ts';
import { eur } from './format.ts';
import { html, morph } from './html.ts';

export function renderStart(root: HTMLElement, onOpen: (id: string) => void): void {
  let system: SystemInfo | null = null;
  let companies: CompanySummary[] = [];
  let locationId: LocationId = 'garage';
  let error = '';
  let busy = false;

  root.innerHTML = `<main class="start"><div class="start-inner" id="start-inner"></div></main>`;
  const inner = root.querySelector<HTMLElement>('#start-inner')!;

  const previews = new Map<string, string>();
  for (const location of LOCATIONS.filter((l) => l.moveCost === null)) previews.set(location.id, roomPreview(location.id).toDataURL());

  function render(): void {
    const provider = system?.provider;
    morph(inner, html`
      <header class="start-head">
        <h1 class="logo logo-big">Silly Valley</h1>
        <p class="start-claim">Firma gründen, KI-Agenten einstellen, Ergebnisse abnehmen.</p>
        ${languageSwitch()}
      </header>
      ${companies.length
        ? html`<section class="start-section">
            <h2>Weiterarbeiten</h2>
            <ul class="company-list">
              ${companies.map((c) => html`<li data-key="${c.id}">
                <button class="company-row" data-open="${c.id}">
                  <strong>${c.name}</strong>
                  <span>${locationById(c.locationId).title}, ${c.team === 1 ? '1 Mitarbeiter' : `${c.team} Mitarbeiter`}${c.projectDir ? `, Projekt ${c.projectDir.split('/').pop()}` : ''}</span>
                  <span class="num">${eur(c.spentEur)} von ${eur(c.budgetEur)}</span>
                </button>
              </li>`)}
            </ul>
          </section>`
        : null}
      <form class="start-section panel-form" id="found">
        <h2>Neue Firma gründen</h2>
        <label class="field"><span>Name der Firma</span>
          <input name="name" maxlength="40" required autocomplete="off" placeholder="Zum Beispiel Musterfirma" />
        </label>
        <label class="field"><span>Deine Idee</span>
          <textarea name="idea" rows="3" maxlength="1500" required placeholder="Woran soll deine Firma arbeiten? Dein Team liest das als Erstes."></textarea>
        </label>
        <fieldset class="field"><legend>Hier fängst du an</legend>
          <div class="location-cards">
            ${LOCATIONS.filter((l) => l.moveCost === null).map((l) => html`
              <button type="button" class="location-card ${l.id === locationId ? 'selected' : ''}" data-location="${l.id}" aria-pressed="${l.id === locationId}">
                <img src="${previews.get(l.id)}" alt="" />
                <strong>${l.title}</strong>
                <small>${l.blurb}</small>
              </button>`)}
          </div>
        </fieldset>
        <label class="field field-short"><span>KI-Budget in Euro</span>
          <input name="budget" type="number" step="0.5" min="0.5" value="5" required />
          <small>Deine Obergrenze für echten Verbrauch. Du kannst sie jederzeit anpassen.</small>
        </label>
        <label class="field"><span>Bestehendes Projekt einbinden (optional)</span>
          <input name="projectDir" maxlength="500" autocomplete="off" spellcheck="false" placeholder="Vollständiger Pfad zu einem Ordner, zum Beispiel /Pfad/zum/Projekt" />
          <small>Dein Team darf in diesem Ordner lesen und ändern, sonst nirgends außerhalb seines Arbeitsbereichs. Spielstand und Verbrauchsbuch bleiben außerhalb des Projekts.</small>
        </label>
        <details class="skill-add" data-key="charter"><summary>Produktvision und Business Case (optional)</summary>
          <p class="hint">Dein Team richtet sich nach der Vision. Der Business Case legt fest, ab wann du die Kosten prüfst. Beides kannst du später ändern.</p>
          ${visionFields(null)}
          ${businessCaseFields(null)}
        </details>
        ${provider && !provider.available ? html`
          <div class="alert alert-error" role="alert">
            <strong>Es sind keine Agenten verfügbar.</strong>
            <p>${provider.error}</p>
            <button type="button" class="btn" data-recheck>Erneut prüfen</button>
          </div>` : null}
        ${provider?.testDouble ? html`<div class="alert alert-error" role="alert"><strong>Test-Attrappe aktiv.</strong> <p>Es laufen keine echten Agenten.</p></div>` : null}
        ${error ? html`<p class="form-error" role="alert">${error}</p>` : null}
        <div class="form-foot">
          <span class="provider-line">${provider?.available ? html`Agenten bereit: ${provider.label}, ${provider.account}` : !provider ? 'Agenten werden geprüft' : ''}</span>
          <button class="btn btn-primary" type="submit" ${busy || !provider?.available ? 'disabled' : ''}>Firma gründen</button>
        </div>
      </form>`);
  }

  inner.addEventListener('click', async (event) => {
    const chosen = (event.target as HTMLElement).closest<HTMLElement>('[data-language]');
    if (chosen) {
      await chooseLanguage(chosen.dataset.language as Language);
      return;
    }
    const target = event.target as HTMLElement;
    const card = target.closest<HTMLElement>('[data-location]');
    if (card) {
      locationId = card.dataset.location as LocationId;
      render();
      return;
    }
    const open = target.closest<HTMLElement>('[data-open]');
    if (open) {
      onOpen(open.dataset.open!);
      return;
    }
    if (target.closest('[data-recheck]')) {
      system = await api.refreshSystem();
      render();
    }
  });

  inner.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.target as HTMLFormElement;
    const data = new FormData(form);
    busy = true;
    error = '';
    render();
    try {
      const company = await api.createCompany({
        name: data.get('name'),
        idea: data.get('idea'),
        locationId,
        budgetEur: Number(data.get('budget')),
        projectDir: String(data.get('projectDir') ?? '').trim() || null,
        vision: readVision(data),
        businessCase: readBusinessCase(data),
      });
      onOpen(company.id);
    } catch (err) {
      error = (err as Error).message;
      busy = false;
      render();
    }
  });

  render();
  Promise.all([api.system(), api.companies()]).then(([s, c]) => {
    system = s;
    companies = c;
    render();
  });
}
