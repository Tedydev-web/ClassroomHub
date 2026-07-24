import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { superAdminMiddleware } from '@api/middlewares/super-admin';

const SECRET = 'super-admin-secret-value';

function buildApp() {
  return new Hono().use('/*', superAdminMiddleware).get('/probe', (c) => c.json({ ok: true }));
}

const originalPassword = process.env.SUPER_ADMIN_PASSWORD;
const originalNodeEnv = process.env.NODE_ENV;

afterEach(() => {
  process.env.SUPER_ADMIN_PASSWORD = originalPassword;
  process.env.NODE_ENV = originalNodeEnv;
});

describe('superAdminMiddleware', () => {
  describe('with a configured secret', () => {
    beforeEach(() => {
      process.env.SUPER_ADMIN_PASSWORD = SECRET;
    });

    it('rejects a request with no key', async () => {
      const response = await buildApp().request('/probe');

      expect(response.status).toBe(401);
    });

    it('rejects a wrong key', async () => {
      const response = await buildApp().request('/probe', {
        headers: { 'X-Super-Admin-Key': 'wrong-value-same-length!' }
      });

      expect(response.status).toBe(401);
    });

    it('rejects a key that is only a prefix of the secret', async () => {
      const response = await buildApp().request('/probe', {
        headers: { 'X-Super-Admin-Key': SECRET.slice(0, 5) }
      });

      expect(response.status).toBe(401);
    });

    it('accepts the correct key', async () => {
      const response = await buildApp().request('/probe', {
        headers: { 'X-Super-Admin-Key': SECRET }
      });

      expect(response.status).toBe(200);
    });

    it('never echoes the expected secret in a rejection body', async () => {
      const response = await buildApp().request('/probe', {
        headers: { 'X-Super-Admin-Key': 'nope' }
      });
      const body = await response.text();

      expect(body).not.toContain(SECRET);
    });
  });

  describe('with no secret configured', () => {
    beforeEach(() => {
      delete process.env.SUPER_ADMIN_PASSWORD;
    });

    it('refuses to serve in production rather than leaving the API open', async () => {
      process.env.NODE_ENV = 'production';

      const response = await buildApp().request('/probe');

      expect(response.status).toBe(503);
    });

    it('stays open in development so local operators are not blocked', async () => {
      process.env.NODE_ENV = 'development';

      const response = await buildApp().request('/probe');

      expect(response.status).toBe(200);
    });
  });
});
