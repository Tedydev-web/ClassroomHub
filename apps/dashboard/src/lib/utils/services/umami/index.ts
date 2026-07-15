import { dev } from '$app/environment';
import { env } from '$env/dynamic/public';
import { licenseApi } from '$features/license/api/license.svelte';

export const initUmami = (): void => {
  if (dev || licenseApi.hasAccess('no-tracking')) return;

  const scriptUrl = env.PUBLIC_UMAMI_SCRIPT_URL?.trim();
  const websiteId = env.PUBLIC_UMAMI_WEBSITE_ID?.trim();
  if (!scriptUrl || !websiteId) return;

  const script = document.createElement('script');
  script.defer = true;
  script.src = scriptUrl;
  script.dataset.websiteId = websiteId;
  const nonce = document.querySelector('script[nonce]')?.getAttribute('nonce');
  if (nonce) script.setAttribute('nonce', nonce);
  document.head.appendChild(script);
};
