import test from 'node:test';
import assert from 'node:assert/strict';
import { reservationLinkState, reservationPath, reservationUrl } from '../src/reservationLink.js';
const code = '0-HMFCA24XTR-ihoqpkwzqk';
test('legacy links retain the booking in the path and preserve other parameters', () => {
  for (const pathname of ['/', '/checkin']) {
    assert.deepEqual(reservationLinkState({ pathname, search: `?res=${code}&lang=zh-hans&x=1`, hash: '#welcome' }),
      { code, done: false, canonical: `/checkin/r/${code}?lang=zh-hans&x=1#welcome` });
  }
});
test('refresh and completion URLs retain the booking; path wins over legacy query', () => {
  const pathname = reservationPath(code);
  assert.equal(reservationLinkState({ pathname }).code, code);
  assert.equal(reservationLinkState({ pathname, search: '?res=other-code' }).canonical, pathname);
  assert.deepEqual(reservationLinkState({ pathname: `${pathname}/done` }), { code, done: true, canonical: `${pathname}/done` });
  assert.equal(reservationUrl('https://example.test', code), `https://example.test${pathname}`);
});
test('unrelated routes, malformed encoding and invalid codes do not become booking links', () => {
  assert.equal(reservationLinkState({ pathname: '/admin/hostex', search: `?res=${code}` }).code, '');
  for (const pathname of ['/checkin/r/%zz', '/checkin/r/%2Fbad', '/checkin', '/']) {
    assert.equal(reservationLinkState({ pathname }).code, '');
  }
});
