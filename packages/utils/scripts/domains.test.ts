import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ACCEPTED_ROOT_DOMAINS,
  BRAND_ROOT_DOMAIN,
  getTenantSiteNameFromHost,
  isPlatformHost,
  LEGACY_ROOT_DOMAINS,
  TENANT_ROOT_DOMAIN
} from '../src/constants/domains';

test('every apex the deployment answers on is accepted, canonical first', () => {
  assert.equal(ACCEPTED_ROOT_DOMAINS[0], BRAND_ROOT_DOMAIN);

  for (const root of [BRAND_ROOT_DOMAIN, TENANT_ROOT_DOMAIN, ...LEGACY_ROOT_DOMAINS]) {
    assert.ok(ACCEPTED_ROOT_DOMAINS.includes(root), `${root} is served but not accepted`);
  }

  // A duplicate would double every derived CORS pattern and trusted origin.
  assert.equal(new Set(ACCEPTED_ROOT_DOMAINS).size, ACCEPTED_ROOT_DOMAINS.length);
});

test('a platform host is recognised on every accepted apex', () => {
  for (const root of ACCEPTED_ROOT_DOMAINS) {
    assert.ok(isPlatformHost(root));
    assert.ok(isPlatformHost(`hub.${root}`));
    assert.ok(isPlatformHost(`msna.${root}`));
    // Hostnames arrive from Host headers and URLs, which normalise neither case
    // nor the root's trailing dot, and both would otherwise read as a customer
    // domain — letting an org claim the platform's own apex.
    assert.ok(isPlatformHost(`HUB.${root.toUpperCase()}`));
    assert.ok(isPlatformHost(`hub.${root}.`));
  }
});

test('a customer domain is not a platform host', () => {
  assert.ok(!isPlatformHost('learn.acme.com'));
  assert.ok(!isPlatformHost('acme.com'));
  // Suffix matching without the dot would accept this as ours.
  assert.ok(!isPlatformHost(`not${BRAND_ROOT_DOMAIN}`));
  assert.ok(!isPlatformHost(''));
});

test('a tenant site name is read from one label under an accepted apex', () => {
  for (const root of ACCEPTED_ROOT_DOMAINS) {
    assert.equal(getTenantSiteNameFromHost(`msna.${root}`), 'msna');
    assert.equal(getTenantSiteNameFromHost(`www.msna.${root}`), 'msna');
    assert.equal(getTenantSiteNameFromHost(root), null);
    // Deeper labels are platform hosts, never a tenant called "a.b".
    assert.equal(getTenantSiteNameFromHost(`a.b.${root}`), null);
  }

  assert.equal(getTenantSiteNameFromHost('learn.acme.com'), null);
});
