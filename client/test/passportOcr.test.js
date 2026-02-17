import test from 'node:test';
import assert from 'node:assert/strict';
import { extractPassportNumberFromText, isLikelyPassportDocument } from '../src/passportOcr.js';

test('detects passport-like content from MRZ text', () => {
  const mrz = 'P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<\nL898902C36UTO7408122F1204159ZE184226B<<<<<10';
  assert.equal(isLikelyPassportDocument(mrz), true);
  assert.equal(extractPassportNumberFromText(mrz), 'L898902C3');
});

test('rejects invalid MRZ passport number checksum', () => {
  const invalidMrz = 'P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<\nL898902C35UTO7408122F1204159ZE184226B<<<<<10';
  assert.equal(extractPassportNumberFromText(invalidMrz), '');
});

test('extracts labeled passport number from OCR text', () => {
  const sample = 'PASSPORT NO: E12345678\nNATIONALITY CHN';
  assert.equal(extractPassportNumberFromText(sample), 'E12345678');
  assert.equal(isLikelyPassportDocument(sample), true);
});

test('rejects unrelated content', () => {
  const unrelated = 'Weekly menu\nCoffee\nTea\nSandwich';
  assert.equal(isLikelyPassportDocument(unrelated), false);
  assert.equal(extractPassportNumberFromText(unrelated), '');
});
