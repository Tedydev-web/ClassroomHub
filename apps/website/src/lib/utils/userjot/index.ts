import { dev } from '$app/environment';
import { env } from '$env/dynamic/public';

const USERJOT_APP_ID = env.PUBLIC_USERJOT_APP_ID?.trim();

let isInitialized = false;

function isWidgetAllowed(): boolean {
  return !dev && env.PUBLIC_IS_SELF_OWNED !== 'true' && Boolean(USERJOT_APP_ID);
}

function ensureSdkLoaded(): void {
  if (window.uj) return;

  window.$ujq = window.$ujq || [];
  window.uj =
    window.uj ||
    (new Proxy({} as Window['uj'], {
      get:
        (_, prop) =>
        (...args: unknown[]) =>
          window.$ujq.push([prop, ...args])
    }) as Window['uj']);

  const script = document.createElement('script');
  script.type = 'module';
  script.async = true;
  script.src = 'https://cdn.userjot.com/sdk/v2/uj.js';
  document.head.appendChild(script);
}

export function initUserJot(): void {
  if (isInitialized) return;
  if (!isWidgetAllowed()) return;

  ensureSdkLoaded();

  window.uj.init(USERJOT_APP_ID!, {
    trigger: 'custom',
    position: 'right',
    theme: 'auto'
  });

  isInitialized = true;
}
