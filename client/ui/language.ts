// Die Sprachwahl. Beide Namen stehen in ihrer eigenen Sprache, damit man sie immer lesen kann.

import { getLanguage, type Language } from '../i18n/translate.ts';
import { api } from './api.ts';
import { html, type Safe } from './html.ts';

const LANGUAGES: { id: Language; name: string }[] = [{ id: 'en', name: 'English' }, { id: 'de', name: 'Deutsch' }];

export function languageSwitch(): Safe {
  return html`<div class="language-switch" role="group" aria-label="Sprache">${LANGUAGES.map((l) => html`<button type="button" class="btn" data-key="${l.id}" data-action="set-language" data-language="${l.id}" aria-pressed="${l.id === getLanguage()}">${l.name}</button>`)}</div>`;
}

/** Neu laden ist am einfachsten: So steht danach wirklich alles in der neuen Sprache. */
export async function chooseLanguage(language: Language): Promise<void> {
  if (language === getLanguage()) return;
  await api.setLanguage(language);
  location.reload();
}
