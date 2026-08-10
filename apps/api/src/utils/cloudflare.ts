import { CLOUDFLARE } from '@api/constants';

export type ScreenshotViewport = {
  width: number;
  height: number;
  deviceScaleFactor?: number;
};

const BROWSER_RENDERING_BASE = 'https://api.cloudflare.com/client/v4/accounts';

/**
 * Browser Rendering needs both an account and a token carrying the
 * `Browser Rendering - Edit` permission. Without them the request used to be
 * sent to `accounts/undefined/...`, and Cloudflare's JSON error was handed back
 * to the caller as if it were a document.
 */
function requireBrowserRenderingConfig(): { accountId: string; apiKey: string } {
  const accountId = CLOUDFLARE.CONFIGS.ACCOUNT_ID;
  const apiKey = CLOUDFLARE.CONFIGS.RENDERING_API_KEY;

  if (!accountId || !apiKey) {
    const missing = [!accountId && 'CLOUDFLARE_ACCOUNT_ID', !apiKey && 'CLOUDFLARE_RENDERING_API_KEY']
      .filter(Boolean)
      .join(' and ');

    throw new Error(`Cloudflare Browser Rendering is not configured: ${missing} is missing`);
  }

  return { accountId, apiKey };
}

/**
 * Cloudflare reports failures with a JSON envelope. Returning that body would
 * produce a download that opens as a corrupt file, so anything that is not
 * binary is surfaced as an error instead.
 */
async function readRenderedDocument(response: Response, kind: 'PDF' | 'PNG'): Promise<Buffer> {
  const buffer = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers.get('content-type') ?? '';

  if (!response.ok || contentType.includes('application/json')) {
    const body = buffer.toString('utf8').slice(0, 500);
    throw new Error(`Cloudflare Browser Rendering failed to produce a ${kind} (HTTP ${response.status}): ${body}`);
  }

  if (buffer.byteLength === 0) {
    throw new Error(`Cloudflare Browser Rendering returned an empty ${kind}`);
  }

  return buffer;
}

export const getCloudflarePdfBuffer = async (html: string, styles?: string) => {
  const { accountId, apiKey } = requireBrowserRenderingConfig();

  const response = await fetch(`${BROWSER_RENDERING_BASE}/${accountId}/browser-rendering/pdf`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      html,
      addStyleTag: styles ? [{ content: styles }] : undefined
    })
  });

  return readRenderedDocument(response, 'PDF');
};

/**
 * Renders HTML to a PNG via Cloudflare Browser Rendering's `/screenshot` endpoint.
 * Defaults to 1100x780 for certificate canvases; pass a custom viewport for other assets.
 */
export const getCloudflarePngBuffer = async (
  html: string,
  styles?: string,
  viewport: ScreenshotViewport = { width: 1100, height: 780, deviceScaleFactor: 2 }
) => {
  const { accountId, apiKey } = requireBrowserRenderingConfig();

  const response = await fetch(`${BROWSER_RENDERING_BASE}/${accountId}/browser-rendering/screenshot`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      html,
      addStyleTag: styles ? [{ content: styles }] : undefined,
      viewport: {
        width: viewport.width,
        height: viewport.height,
        deviceScaleFactor: viewport.deviceScaleFactor ?? 2
      },
      screenshotOptions: { type: 'png', omitBackground: false, fullPage: false }
    })
  });

  return readRenderedDocument(response, 'PNG');
};
