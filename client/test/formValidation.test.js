import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAge, validateGuestForm, isRegistrationValid } from '../src/formValidation.js';

const createResident = (overrides = {}) => ({
  name: 'Resident Guest',
  age: '20',
  isResident: true,
  address: 'Osaka',
  phone: '09012345678',
  ...overrides
});

const createVisitor = (overrides = {}) => ({
  name: 'Visitor Guest',
  age: '22',
  isResident: false,
  nationality: 'US',
  passportNumber: 'P123',
  passportPhoto: 'data:image/png;base64,aGVsbG8=',
  ...overrides
});

test('parseAge handles whitespace, invalid string, and decimal value', () => {
  assert.equal(parseAge(' 16 '), 16);
  assert.equal(parseAge('abc'), Number.NaN);
  assert.equal(parseAge('17.9'), 17);
});

test('resident age < 16 does not require phone but still requires address', () => {
  assert.equal(validateGuestForm(createResident({ age: '15', phone: '', guardianName: 'Parent', guardianPhone: '090' })), true);
  assert.equal(validateGuestForm(createResident({ age: '15', address: ' ' })), false);
});

test('resident age >= 16 requires phone', () => {
  assert.equal(validateGuestForm(createResident({ age: '16', phone: '' })), false);
  assert.equal(validateGuestForm(createResident({ age: '16', phone: '08000000000', guardianName: 'Parent', guardianPhone: '090' })), true);
});

test('minor guest requires guardian info', () => {
  assert.equal(validateGuestForm(createResident({ age: '17', guardianName: '', guardianPhone: '090' })), false);
  assert.equal(validateGuestForm(createResident({ age: '17', guardianName: 'Parent', guardianPhone: '090' })), true);
});

test('visitor requires nationality, passport number and passport photo', () => {
  assert.equal(validateGuestForm(createVisitor({ nationality: '' })), false);
  assert.equal(validateGuestForm(createVisitor({ passportNumber: ' ' })), false);
  assert.equal(validateGuestForm(createVisitor({ passportPhoto: null })), false);
  assert.equal(validateGuestForm(createVisitor()), true);
});

test('age boundary is inclusive for 0 and 120, rejects negative and over 120', () => {
  assert.equal(validateGuestForm(createResident({ age: '0', phone: '', address: 'Tokyo', guardianName: 'Parent', guardianPhone: '090' })), true);
  assert.equal(validateGuestForm(createResident({ age: '120' })), true);
  assert.equal(validateGuestForm(createResident({ age: '-1' })), false);
  assert.equal(validateGuestForm(createResident({ age: '121' })), false);
});

test('isRegistrationValid requires non-empty list and all guests valid', () => {
  assert.equal(isRegistrationValid([]), false);
  assert.equal(isRegistrationValid([createResident(), createVisitor()]), true);
  assert.equal(isRegistrationValid([createResident(), createVisitor({ passportPhoto: '' })]), false);
});
