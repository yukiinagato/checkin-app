import test from 'node:test';
import assert from 'node:assert/strict';
import { reservationGuestCount } from '../src/reservationGuestCount.js';

test('Hostex total overrides stale adult/child counts after an amendment', () => {
  assert.equal(reservationGuestCount({ numberOfGuests: 8, numberOfAdults: 1, numberOfChildren: 0 }), 8);
  assert.equal(reservationGuestCount({ numberOfGuests: 2, numberOfAdults: 8, numberOfChildren: 0 }), 2);
  assert.equal(reservationGuestCount({ numberOfGuests: '8', numberOfAdults: 1 }), 8);
});
test('missing or invalid totals fall back to adult/child counts', () => {
  for (const numberOfGuests of [undefined, null, '', 0, -1, 1.5, 'invalid']) {
    assert.equal(reservationGuestCount({ numberOfGuests, numberOfAdults: 2, numberOfChildren: 3 }), 5);
  }
  assert.equal(reservationGuestCount({}), 1);
});
