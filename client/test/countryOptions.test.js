import test from 'node:test';
import assert from 'node:assert/strict';
import { getCountryName, getCountryOptions, isOfficialIsoCountryCode } from '../src/countryOptions.js';

test('iso country validation recognizes official alpha-2 codes', () => {
  assert.equal(isOfficialIsoCountryCode('US'), true);
  assert.equal(isOfficialIsoCountryCode('TW'), true);
  assert.equal(isOfficialIsoCountryCode('ZZ'), false);
  assert.equal(isOfficialIsoCountryCode('EU'), false);
});

test('country options come from iso-3166-1 and include other option', () => {
  const options = getCountryOptions('en', 'locale-default');
  assert.ok(options.length > 200);
  assert.ok(options.some((option) => option.code === 'US' && option.label));
  assert.ok(options.some((option) => option.code === 'TW' && option.label === 'Taiwan'));
  assert.equal(options.at(-1)?.code, 'OTHER');
});

test('taiwan naming mode changes localized labels', () => {
  assert.equal(getCountryName('TW', 'zh-hans', 'locale-default'), '中国台湾');
  assert.equal(getCountryName('TW', 'zh-hans', 'neutral'), '台湾');
  assert.equal(getCountryName('TW', 'en', 'cn'), 'Taiwan, China');
  assert.equal(getCountryName('TW', 'en', 'roc'), 'Republic of China (Taiwan)');
});
