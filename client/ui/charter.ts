// Produktvision und Business Case: Formulare zum Auswählen, dazu eine kurze Übersicht.

import { AUDIENCES, LIMIT_ACTIONS, PRODUCT_TYPES, SUCCESS_MEASURES, WARN_LEVELS, businessCaseHolds, visionLines, type BusinessCase, type Choice, type ProductVision } from '../../shared/vision.ts';
import type { Company, Money } from '../../shared/types.ts';
import { eur, percent } from './format.ts';
import { html, type Safe } from './html.ts';

const choices = (name: string, list: Choice[], selected: (id: string) => boolean, multiple: boolean): Safe =>
  html`<div class="toggle-row">${list.map((c) => html`<label class="toggle check-toggle" data-key="${c.id}"><input type="${multiple ? 'checkbox' : 'radio'}" name="${name}" value="${c.id}" ${selected(c.id) ? 'checked' : ''} />${c.title}</label>`)}</div>`;

export function visionFields(v: ProductVision | null): Safe {
  return html`
    <fieldset class="field"><legend>Was entsteht</legend>${choices('v_type', PRODUCT_TYPES, (id) => v?.productType === id, false)}</fieldset>
    <fieldset class="field"><legend>Für wen</legend>${choices('v_audience', AUDIENCES, (id) => !!v?.audiences.includes(id), true)}
      <input name="v_audienceNote" maxlength="300" autocomplete="off" value="${v?.audienceNote ?? ''}" placeholder="Genauer, optional: zum Beispiel kleine Sportvereine" /></fieldset>
    <label class="field"><span>Welches Problem es löst</span><input name="v_problem" maxlength="300" autocomplete="off" value="${v?.problem ?? ''}" placeholder="Ein Satz" /></label>
    <fieldset class="field"><legend>Woran du Erfolg erkennst</legend>${choices('v_success', SUCCESS_MEASURES, (id) => !!v?.successIds.includes(id), true)}
      <input name="v_successNote" maxlength="300" autocomplete="off" value="${v?.successNote ?? ''}" placeholder="Zielmarke, optional: zum Beispiel 100 Nutzer bis Jahresende" /></fieldset>
    <label class="field"><span>Was es bewusst nicht macht (optional)</span><input name="v_nonGoals" maxlength="300" autocomplete="off" value="${v?.nonGoals ?? ''}" /></label>`;
}

export function businessCaseFields(bc: BusinessCase | null): Safe {
  return html`
    <label class="field"><span>Was es bringen soll</span><input name="b_benefit" maxlength="300" autocomplete="off" value="${bc?.benefit ?? ''}" placeholder="Ein Satz" /></label>
    <label class="field field-short"><span>Erwarteter Erlös im Monat in Euro (optional)</span><input name="b_revenue" type="number" min="0" step="1" value="${bc?.revenueEurMonth ?? ''}" /></label>
    <fieldset class="field"><legend>Prüfen bei verbrauchtem KI-Budget</legend>${choices('b_warn', WARN_LEVELS.map((n) => ({ id: String(n), title: `${n} %` })), (id) => Number(id) === (bc?.warnPercent ?? 80), false)}</fieldset>
    <fieldset class="field"><legend>Dann</legend>${choices('b_action', LIMIT_ACTIONS, (id) => id === (bc?.limitAction ?? 'warnen'), false)}</fieldset>`;
}

const str = (data: FormData, name: string) => String(data.get(name) ?? '').trim();

export const readVision = (data: FormData) => ({
  productType: str(data, 'v_type') || null,
  audiences: data.getAll('v_audience').map(String),
  audienceNote: str(data, 'v_audienceNote'),
  problem: str(data, 'v_problem'),
  successIds: data.getAll('v_success').map(String),
  successNote: str(data, 'v_successNote'),
  nonGoals: str(data, 'v_nonGoals'),
});

export const readBusinessCase = (data: FormData) => ({
  benefit: str(data, 'b_benefit'),
  revenueEurMonth: str(data, 'b_revenue') === '' ? null : Number(str(data, 'b_revenue')),
  warnPercent: Number(str(data, 'b_warn') || 80),
  limitAction: str(data, 'b_action') || 'warnen',
});

/** Unter Projekte: die Vision in Kurzform, darunter zum Ändern. */
export function visionSection(company: Company): Safe {
  const v = company.vision ?? null;
  return html`<section class="charter" data-key="vision">
    <h3>Produktvision</h3>
    ${v ? html`<ul class="charter-list">${visionLines(v).map((line) => html`<li>${line.replace(/^- /, '')}</li>`)}</ul>` : html`<p class="hint">Noch keine. Dein Team kennt nur die Idee.</p>`}
    <details class="skill-add"><summary>${v ? 'Vision ändern' : 'Vision festlegen'}</summary>
      <form class="panel-form" data-form="vision">
        ${visionFields(v)}
        <div class="form-foot"><button class="btn btn-primary">Speichern</button></div>
      </form>
    </details>
  </section>`;
}

/** Unter Finanzen: der Business Case gegen den echten Verbrauch. */
export function businessCaseSection(company: Company, money: Money): Safe {
  const bc = company.businessCase ?? null;
  const used = company.budgetEur > 0 ? money.spentEur / company.budgetEur : 0;
  return html`<section class="charter" data-key="business-case">
    <h3>Business Case</h3>
    ${bc ? html`<dl class="facts">
        ${bc.benefit ? html`<div><dt>Nutzen</dt><dd>${bc.benefit}</dd></div>` : null}
        ${bc.revenueEurMonth !== null ? html`<div><dt>Erwarteter Erlös im Monat</dt><dd class="num">${eur(bc.revenueEurMonth)}</dd></div>` : null}
        <div><dt>Verbraucht</dt><dd class="num">${percent(used)} von ${bc.warnPercent} %</dd></div>
      </dl>
      ${bc.reachedAt !== null && bc.confirmedAt === null ? html`<div class="alert ${businessCaseHolds(bc) ? 'alert-error' : ''}" role="alert">
        <strong>${bc.warnPercent} % des KI-Budgets sind verbraucht.</strong>
        <p>${businessCaseHolds(bc) ? 'Neue Arbeit ist angehalten.' : 'Prüfe, ob der Nutzen die Kosten noch trägt.'} Zum Beenden startest du einfach nichts Neues.</p>
        <button class="btn" data-action="business-case-confirm">Weitermachen</button>
      </div>` : null}
      ${bc.confirmedAt !== null ? html`<p class="hint">Geprüft und weitergemacht. Hebe die Schwelle an, um erneut zu prüfen.</p>` : null}`
      : html`<p class="hint">Noch keiner. Lege fest, was das Produkt bringen soll und ab wann du die Kosten prüfst.</p>`}
    <details class="skill-add"><summary>${bc ? 'Business Case ändern' : 'Business Case festlegen'}</summary>
      <form class="panel-form" data-form="business-case">
        ${businessCaseFields(bc)}
        <div class="form-foot"><button class="btn btn-primary">Speichern</button></div>
      </form>
    </details>
  </section>`;
}
