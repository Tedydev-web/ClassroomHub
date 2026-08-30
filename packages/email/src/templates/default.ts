import type { EmailBranding } from '../core/branding';
import { PRODUCT_HOSTS, PRODUCT_NAME } from '@cio/utils/constants';

/**
 * Shared shell for every transactional email.
 *
 * Layout follows the pattern that reads well across clients: sender mark above
 * a bordered card, content inside it, legal footer below on the page
 * background. The card is capped with a thin accent band in the brand colour —
 * it gives the message a deliberate, designed edge without depending on a
 * hosted illustration, which would break the moment images are blocked.
 *
 * Colours mirror the product design tokens in `packages/ui/src/index.css`,
 * converted from oklch because no mail client understands that syntax.
 *
 * Every email composes plain HTML and hands it to this function, so restyling
 * here restyles all of them. Content may rely on `.button`, `.tooltip` and
 * `.brandcolor`; those class names are part of the contract.
 */

const DEFAULT_BUTTON_COLOR = '#1D4EE2';
const PRODUCT_WEBSITE_URL = `https://${PRODUCT_HOSTS.marketing}`;
const PRODUCT_WORDMARK_URL = `https://${PRODUCT_HOSTS.dashboard}/wordmark.png`;

/** Product tokens, resolved to hex for mail clients. */
const PAGE_BG = '#F5F5F5'; // --muted
const CARD_BG = '#FFFFFF'; // --card
const BORDER = '#E5E5E5'; // --border
const TEXT = '#0A0A0A'; // --foreground
const TEXT_MUTED = '#737373'; // --muted-foreground
const SURFACE_MUTED = '#F5F5F5';

// Geist is the product typeface but no client will load a webfont reliably, so
// the stack falls through to whatever the reader's OS considers native.
const FONT_STACK =
  "'Geist', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

function escapeHtmlAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Whether an address can actually resolve inside an email.
 *
 * A message has no document to resolve a relative path against, and no session to send with
 * the request: whatever the reader's client fetches, it fetches cold, from an address that
 * has to stand entirely on its own. A root-relative path therefore cannot load anywhere, in
 * any client, ever — it renders as a broken-image box beside the organisation's name.
 *
 * `mailto:` and `data:` are excluded for the same reason from the other direction: some
 * clients refuse them outright, and a masthead that reads as the organisation's name is
 * better than one that might not draw at all.
 */
function isFetchableImageUrl(value: string): boolean {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}

function buildMasthead(branding: EmailBranding): string {
  const logoUrl = branding?.logoUrl && isFetchableImageUrl(branding.logoUrl) ? branding.logoUrl : undefined;
  const orgName = branding?.orgName ? escapeHtmlAttr(branding.orgName) : '';

  if (logoUrl) {
    const nameHtml = orgName
      ? `<span style="margin-left:10px;font-size:15px;font-weight:600;color:${TEXT};vertical-align:middle;">${orgName}</span>`
      : '';
    return `<img src="${escapeHtmlAttr(logoUrl)}" alt="${orgName || 'Logo'}" style="max-height:32px;width:auto;display:inline-block;vertical-align:middle;" />${nameHtml}`;
  }

  if (orgName) {
    return `<span style="font-size:17px;font-weight:600;color:${TEXT};">${orgName}</span>`;
  }

  return `<a href="${PRODUCT_WEBSITE_URL}" target="_blank" style="display:inline-block;text-decoration:none;"><img src="${PRODUCT_WORDMARK_URL}" width="180" height="46" alt="${PRODUCT_NAME}" style="display:block;width:180px;height:auto;" /></a>`;
}

export const getDefaultTemplate = (content: string, branding?: EmailBranding): string => {
  const accentColor = branding?.themeColor || DEFAULT_BUTTON_COLOR;
  const masthead = buildMasthead(branding);
  const year = new Date().getFullYear();

  return `<!DOCTYPE html>
<html>

<head>
  <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, minimum-scale=1" />
  <base target="_blank" />

  <style>
    body {
      background-color: ${PAGE_BG};
      font-family: ${FONT_STACK};
      font-size: 15px;
      font-weight: 400;
      line-height: 24px;
      color: ${TEXT};
      margin: 0;
      padding: 0;
      -webkit-font-smoothing: antialiased;
    }

    p {
      margin: 0 0 16px;
    }

    h1, h2, h3, h4 {
      margin: 0 0 12px;
      font-weight: 600;
      line-height: 1.3;
      color: ${TEXT};
    }

    h1 { font-size: 24px; letter-spacing: -0.02em; }
    h2 { font-size: 19px; letter-spacing: -0.01em; }
    h3 { font-size: 16px; }

    a {
      color: ${accentColor};
    }

    strong {
      font-weight: 600;
      color: ${TEXT};
    }

    hr {
      border: none;
      border-top: 1px solid ${BORDER};
      margin: 24px 0;
    }

    pre {
      background: ${SURFACE_MUTED};
      border: 1px solid ${BORDER};
      border-radius: 8px;
      padding: 12px 14px;
      font-size: 13px;
      overflow-x: auto;
      white-space: pre-wrap;
      word-break: break-word;
    }

    table {
      width: 100%;
      border-collapse: collapse;
    }

    table td {
      padding: 8px 0;
      vertical-align: middle;
    }

    .brandcolor {
      color: ${accentColor};
    }

    /*
     * Rendered as a centred block rather than an inline link: the emails wrap
     * the anchor in a bare <div>, so there is no parent hook to centre from.
     * Outlook ignores max-width and falls back to a full-width bar, which is a
     * perfectly good call-to-action.
     */
    .button {
      display: block;
      max-width: 300px;
      margin: 28px auto;
      background: ${accentColor};
      border-radius: 8px;
      text-align: center;
      text-decoration: none !important;
      color: #ffffff !important;
      font-weight: 600;
      font-size: 15px;
      line-height: 20px;
      padding: 13px 24px;
    }

    .tooltip {
      background-color: ${SURFACE_MUTED};
      border: 1px solid ${BORDER};
      border-radius: 10px;
      padding: 14px 16px;
      color: ${TEXT_MUTED};
      font-size: 14px;
      line-height: 22px;
      margin: 20px 0;
    }

    .tooltip a {
      color: ${TEXT};
    }

    img {
      max-width: 100%;
      height: auto;
      border: 0;
    }

    .footer a {
      color: ${TEXT_MUTED};
      text-decoration: none;
    }

    @media only screen and (max-width: 600px) {
      .card-padding { padding: 24px 20px !important; }
      .button { max-width: 100% !important; }
    }
  </style>
</head>

<body style="background-color:${PAGE_BG};font-family:${FONT_STACK};font-size:15px;line-height:24px;color:${TEXT};margin:0;padding:32px 16px;">
  <div style="max-width:600px;margin:0 auto;">

    <div style="padding:0 4px 16px;">
      ${masthead}
    </div>

    <div style="background-color:${CARD_BG};border:1px solid ${BORDER};border-radius:12px;overflow:hidden;">
      <div style="height:4px;background-color:${accentColor};font-size:0;line-height:0;">&nbsp;</div>
      <div class="card-padding" style="padding:32px;">
        ${content}
      </div>
    </div>

    <div class="footer" style="text-align:center;font-size:12px;line-height:20px;color:${TEXT_MUTED};padding:24px 16px 0;">
      <a href="${PRODUCT_WEBSITE_URL}" style="color:${TEXT_MUTED};text-decoration:none;">Website</a>
      &nbsp;&middot;&nbsp;
      <a href="${PRODUCT_WEBSITE_URL}/tos" style="color:${TEXT_MUTED};text-decoration:none;">Terms</a>
      &nbsp;&middot;&nbsp;
      <a href="${PRODUCT_WEBSITE_URL}/privacy" style="color:${TEXT_MUTED};text-decoration:none;">Privacy</a>
      <div style="margin-top:8px;">&copy; ${year} ${PRODUCT_NAME}. All rights reserved.</div>
    </div>

  </div>
</body>

</html>
`;
};
