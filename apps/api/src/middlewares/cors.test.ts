import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { sessionCors } from './cors';

/**
 * The preflight a sitter's browser sends before starting an exam.
 *
 * The exam-sitting writes are unauthenticated and carry a `SameSite=None` cookie, so they
 * are guarded by requiring a custom header that a hostile site cannot set. That guard only
 * holds because CORS decides who may set it — which means our own origin must be allowed
 * to, or the sitter is blocked before the request is ever sent. A test rather than a
 * comment, because the failure is invisible server-side: the browser refuses, and the API
 * logs nothing at all.
 */
describe('the exam-sitting preflight', () => {
  const app = new Hono().use('*', sessionCors).post('/exam-sitting/:slug/start', (c) => c.json({ ok: true }));

  async function preflight(origin: string, requestHeaders: string) {
    return app.request('/exam-sitting/abc/start', {
      method: 'OPTIONS',
      headers: {
        Origin: origin,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': requestHeaders
      }
    });
  }

  it('allows the header the sitting routes require', async () => {
    const response = await preflight('http://localhost:5173', 'content-type,x-exam-sitting');
    const allowed = (response.headers.get('access-control-allow-headers') ?? '').toLowerCase();

    expect(allowed).toContain('x-exam-sitting');
    expect(allowed).toContain('content-type');
  });

  it('still refuses an origin we do not trust', async () => {
    const response = await preflight('https://not-ours.example', 'content-type,x-exam-sitting');

    expect(response.headers.get('access-control-allow-origin')).not.toBe('https://not-ours.example');
  });
});
