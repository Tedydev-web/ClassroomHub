type EmbedWidgetRoute = {
  scriptKey: string;
  pageKey?: string;
  pageQueryParam?: string;
};

/** Public path segment → R2 object keys under the `assets` bucket. */
const EMBED_WIDGET_ROUTES: Record<string, EmbedWidgetRoute> = {
  'course-widget': {
    scriptKey: 'embeds/course-widget/course-widget.js',
    pageKey: 'embeds/course-widget/embed.html',
    pageQueryParam: 'key'
  },
  'question-type-picker': {
    scriptKey: 'embeds/question-type-picker/question-type-picker.js'
  }
};

const MARKETING_VIDEO_KEY = 'marketing/language-editor-demo.mov';

const EMBED_CONTENT_TYPES: Record<string, string> = {
  html: 'text/html',
  js: 'application/javascript',
  mjs: 'application/javascript',
  json: 'application/json',
  css: 'text/css',
  map: 'application/json',
  txt: 'text/plain',
  mov: 'video/quicktime',
  // Uploaded images share this host. R2 stores their content type and
  // `writeHttpMetadata` restores it, but a legacy object saved without one would
  // otherwise be served as a download rather than drawn.
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  avif: 'image/avif',
  ico: 'image/x-icon'
};

function contentTypeForObjectKey(objectKey: string): string {
  const dot = objectKey.lastIndexOf('.');
  if (dot === -1) return 'application/octet-stream';
  const ext = objectKey.slice(dot + 1).toLowerCase();

  return EMBED_CONTENT_TYPES[ext] ?? 'application/octet-stream';
}

function isBootstrapScriptKey(objectKey: string): boolean {
  return Object.values(EMBED_WIDGET_ROUTES).some((route) => route.scriptKey === objectKey);
}

function cacheControlForObjectKey(objectKey: string): string {
  if (objectKey === MARKETING_VIDEO_KEY) {
    return 'public, max-age=31536000, immutable';
  }

  if (objectKey.endsWith('.html')) {
    return 'public, max-age=300';
  }

  if (/\.(js|mjs)$/.test(objectKey)) {
    if (isBootstrapScriptKey(objectKey)) {
      return 'public, max-age=300, must-revalidate';
    }

    return 'public, max-age=31536000, immutable';
  }

  if (objectKey.endsWith('.css')) {
    return 'public, max-age=3600';
  }

  return 'public, max-age=3600';
}

function resolvePublicWidgetKey(pathname: string, searchParams: URLSearchParams): string | null {
  const route = EMBED_WIDGET_ROUTES[pathname];
  if (!route) {
    return null;
  }

  if ('pageKey' in route) {
    const pageParam = 'pageQueryParam' in route && route.pageQueryParam ? route.pageQueryParam : 'key';
    if (route.pageKey && searchParams.has(pageParam)) {
      return route.pageKey;
    }
  }

  return route.scriptKey;
}

export async function resolveEmbedObjectKey(url: URL, assetsBucket: R2Bucket): Promise<string | null> {
  const pathname = url.pathname.replace(/^\/+/, '').replace(/\/+$/, '');
  if (!pathname || pathname.includes('..')) {
    return null;
  }

  // Internal paths for lazy chunks (browser-loaded, not customer-facing).
  if (pathname.startsWith('embeds/')) {
    return pathname;
  }

  if (pathname === MARKETING_VIDEO_KEY) {
    return pathname;
  }

  if (!pathname.includes('/')) {
    const publicKey = resolvePublicWidgetKey(pathname, url.searchParams);
    if (publicKey) {
      return publicKey;
    }

    for (const widgetName of Object.keys(EMBED_WIDGET_ROUTES)) {
      const candidate = `embeds/${widgetName}/${pathname}`;
      const head = await assetsBucket.head(candidate);
      if (head) {
        return candidate;
      }
    }
  }

  return null;
}

export function needsApiUrlInjection(objectKey: string): boolean {
  return isBootstrapScriptKey(objectKey) || objectKey.endsWith('/embed.html');
}

export function injectApiUrl(body: string, objectKey: string, apiUrl: string): string {
  if (!needsApiUrlInjection(objectKey)) {
    return body;
  }

  const normalizedApiUrl = apiUrl.replace(/\/$/, '');
  const snippet = `window.CIO=window.CIO||{};window.CIO.apiBaseUrl=${JSON.stringify(normalizedApiUrl)};`;

  if (objectKey.endsWith('.html')) {
    return body.replace('<head>', `<head>\n    <script>${snippet}</script>`);
  }

  return `${snippet}\n${body}`;
}

export function embedResponseHeaders(objectKey: string): Headers {
  const headers = new Headers();
  headers.set('Content-Type', contentTypeForObjectKey(objectKey));
  headers.set('Cache-Control', cacheControlForObjectKey(objectKey));
  headers.set('Access-Control-Allow-Origin', '*');

  return headers;
}
