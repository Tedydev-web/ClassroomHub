import { describe, expect, it, vi } from 'vitest';

/**
 * What counts as proof that a sitting write came from our own page.
 *
 * The guard exists because the resume cookie is `SameSite=None`: a cross-site page can
 * make the browser attach it. It cannot, however, set a custom header without a preflight
 * we refuse, and it cannot forge `Origin` — so either one is proof, and requiring both
 * would only add ways for an honest sitter to be locked out.
 */
vi.mock('@api/utils/origins', () => ({
  resolveTrustedBrowserOriginForCors: (origin: string) =>
    origin === 'https://msna.classroom.io.vn' ? origin : undefined
}));

const { requireSittingRequest } = await import('./exam-sitting-guard');

function requestWith(headers: Record<string, string>) {
  return { req: { header: (name: string) => headers[name.toLowerCase()] } };
}

describe('proving a sitting write came from us', () => {
  it('accepts the custom header', () => {
    expect(() => requireSittingRequest(requestWith({ 'x-exam-sitting': '1' }))).not.toThrow();
  });

  it('accepts a trusted origin without the header, which is what a proxy hop leaves', () => {
    expect(() => requireSittingRequest(requestWith({ origin: 'https://msna.classroom.io.vn' }))).not.toThrow();
  });

  it('refuses another site, header or not', () => {
    expect(() => requireSittingRequest(requestWith({ origin: 'https://evil.example' }))).toThrow(/sitting/i);
  });

  it('refuses a request that offers neither', () => {
    expect(() => requireSittingRequest(requestWith({}))).toThrow(/sitting/i);
  });

  it('refuses a header with the wrong value, so a stray proxy default cannot pass', () => {
    expect(() => requireSittingRequest(requestWith({ 'x-exam-sitting': 'yes' }))).toThrow(/sitting/i);
  });
});
