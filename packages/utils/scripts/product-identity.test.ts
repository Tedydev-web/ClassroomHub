import assert from 'node:assert/strict';
import test from 'node:test';
import { OPERATOR_EMAIL, PRODUCT_HOSTS, PRODUCT_NAME, PRODUCT_ROOT_DOMAIN } from '../src/constants/product-identity';

test('defines the independently operated ClassroomHub identity and host topology', () => {
  // One word, not "Classroom Hub": the name is reused as a domain, a package
  // name and a container label, and a two-word form takes a different shape in
  // each of those.
  assert.equal(PRODUCT_NAME, 'ClassroomHub');
  assert.ok(!PRODUCT_NAME.includes(' '));
  assert.equal(PRODUCT_ROOT_DOMAIN, 'classroom.io.vn');
  // Must stay on the product domain: it is the Reply-To on every sent email and
  // is printed in template bodies, so a consumer address there reads as phishing.
  assert.equal(OPERATOR_EMAIL, 'support@classroom.io.vn');
  assert.ok(OPERATOR_EMAIL.endsWith(`@${PRODUCT_ROOT_DOMAIN}`));
  assert.deepEqual(PRODUCT_HOSTS, {
    marketing: 'classroom.io.vn',
    dashboard: 'hub.classroom.io.vn',
    api: 'api.classroom.io.vn',
    play: 'play.classroom.io.vn',
    embed: 'embed.classroom.io.vn',
    assets: 'assets.classroom.io.vn'
  });
});
