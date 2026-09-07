import { CLOUDFLARE } from '@api/constants';
import { CERTIFICATE_VIEWPORT, FONTS_READY_CLASS, FONTS_READY_SELECTOR } from '@cio/certificates';

export type RenderViewport = {
  width: number;
  height: number;
  deviceScaleFactor?: number;
};

export type PdfPageOptions = {
  width?: string;
  height?: string;
  landscape?: boolean;
  printBackground?: boolean;
  preferCSSPageSize?: boolean;
  margin?: { top?: string; right?: string; bottom?: string; left?: string };
};

/**
 * Browser Rendering needs both an account and a token carrying the `Browser Rendering - Edit`
 * permission. Without them the request goes to `accounts/undefined/...` and Cloudflare's JSON
 * error comes back to the caller as if it were a document — a certificate that is a stack
 * trace. Saying which variable is missing is the whole fix.
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

interface CloudflareRenderPayload {
  html: string;
  styles?: string;
  viewport?: RenderViewport;
  pdfOptions?: PdfPageOptions;
  screenshotOptions?: { type: 'png'; omitBackground?: boolean; fullPage?: boolean };
}

const DEFAULT_SCREENSHOT_OPTIONS: NonNullable<CloudflareRenderPayload['screenshotOptions']> = {
  type: 'png',
  omitBackground: false,
  fullPage: false
};

async function renderCloudflareBrowserDocument(
  endpoint: 'pdf' | 'screenshot',
  options: CloudflareRenderPayload
): Promise<Buffer> {
  let label: string | undefined;

  const { accountId, apiKey } = requireBrowserRenderingConfig();

  try {
    const requestBody: Record<string, unknown> = {
      html: options.html,
      addStyleTag: options.styles ? [{ content: options.styles }] : undefined,
      waitForSelector: options.html.includes(FONTS_READY_CLASS)
        ? { selector: FONTS_READY_SELECTOR, timeout: 10000 }
        : undefined,
      gotoOptions: {
        waitUntil: 'networkidle0',
        timeout: 30000
      },
      actionTimeout: 30000,
      viewport: options.viewport
        ? {
            width: options.viewport.width,
            height: options.viewport.height,
            deviceScaleFactor: options.viewport.deviceScaleFactor ?? (endpoint === 'screenshot' ? 2 : 1)
          }
        : undefined
    };

    switch (endpoint) {
      case 'pdf': {
        if (options.pdfOptions) {
          requestBody.pdfOptions = options.pdfOptions;
        }
        label = 'PDF';
        break;
      }
      case 'screenshot': {
        const screenshotOptions = options.screenshotOptions ?? DEFAULT_SCREENSHOT_OPTIONS;
        requestBody.screenshotOptions = screenshotOptions;
        label = screenshotOptions.type.toUpperCase();
        break;
      }
    }
    console.log(`Generating ${label} with Cloudflare API...`);

    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/browser-rendering/${endpoint}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify(requestBody),
        signal: AbortSignal.timeout(60000)
      }
    );

    console.log(`${label} response status:`, response.status);
    if (!response.ok) {
      const errorBody = await response.text();
      console.error(`Cloudflare ${label} generation error:`, response.status, errorBody);
      throw new Error(`Cloudflare ${label} rendering failed with status ${response.status}: ${errorBody}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (error) {
    console.error(`Error generating ${label ?? 'document'}:`, error);
    if (error instanceof Error) throw error;
    throw new Error(`Failed to generate ${label ?? 'document'}`, { cause: error });
  }
}

/**
 * Renders HTML to a PDF via Cloudflare Browser Rendering's `/pdf` endpoint.
 * Pass custom viewport / pdfOptions if specific page dimensions are needed (e.g. certificates).
 */
export const getCloudflarePdfBuffer = async (
  html: string,
  styles?: string,
  viewport?: RenderViewport,
  pdfOptions?: PdfPageOptions
): Promise<Buffer> => {
  return renderCloudflareBrowserDocument('pdf', { html, styles, viewport, pdfOptions });
};

/**
 * Renders HTML to a PNG via Cloudflare Browser Rendering's `/screenshot` endpoint.
 * Defaults to 1100×780 for certificate canvases; pass a custom viewport for other assets.
 */
export const getCloudflarePngBuffer = async (
  html: string,
  styles?: string,
  viewport: RenderViewport = { ...CERTIFICATE_VIEWPORT, deviceScaleFactor: 2 }
): Promise<Buffer> => {
  return renderCloudflareBrowserDocument('screenshot', {
    html,
    styles,
    viewport: { ...viewport, deviceScaleFactor: viewport.deviceScaleFactor ?? 2 },
    screenshotOptions: { type: 'png', omitBackground: false, fullPage: false }
  });
};
