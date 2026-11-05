import '@fontsource/vt323/latin-400.css';
import './styles.css';
import { renderGame } from './ui/game.ts';
import { renderStart } from './ui/start.ts';
import { setDictionary, setLanguage } from './i18n/translate.ts';
import { en } from './i18n/en.ts';
import { api } from './ui/api.ts';

const root = document.querySelector<HTMLElement>('#app')!;
let cleanup: (() => void) | null = null;

function route(): void {
  cleanup?.();
  cleanup = null;
  const id = decodeURIComponent(location.hash.match(/^#firma\/(.+)$/)?.[1] ?? '');
  if (id) {
    cleanup = renderGame(root, id, () => {
      location.hash = '';
    });
  } else {
    renderStart(root, (companyId) => {
      location.hash = `firma/${encodeURIComponent(companyId)}`;
    });
  }
}

window.addEventListener('hashchange', route);
setDictionary(en);
api.language().then(({ language }) => setLanguage(language)).catch(() => setLanguage('en')).finally(route);
