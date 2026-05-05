'use strict';

// Canonical schema and validation helpers for the guest registration form
// configuration. Mirrors client/src/guestFieldsConfig.js — keep them in sync.

const BUILTIN_FIELD_KEYS = Object.freeze([
  'name',
  'age',
  'phone',
  'address',
  'postalCode',
  'nationality',
  'passportNumber',
  'passportPhoto',
  'guardianName',
  'guardianPhone'
]);

// "name" is the only built-in that cannot be disabled.
const ALWAYS_ENABLED_BUILTINS = Object.freeze(new Set(['name']));

const buildDefaultBuiltins = () => {
  const out = {};
  for (const key of BUILTIN_FIELD_KEYS) {
    out[key] = { enabled: true, defaultValue: key === 'passportPhoto' ? '' : '' };
  }
  return out;
};

const DEFAULT_GUEST_FIELDS_CONFIG = Object.freeze({
  builtins: Object.freeze(buildDefaultBuiltins()),
  custom: Object.freeze([])
});

const CUSTOM_FIELD_TYPES = Object.freeze(new Set(['text', 'number', 'select', 'checkbox', 'date', 'file']));
const SCOPES = Object.freeze(new Set(['both', 'resident', 'visitor']));
const KEY_RE = /^[a-zA-Z][a-zA-Z0-9_]{0,31}$/;
const MAX_CUSTOM_FIELDS = 30;
const MAX_LABEL_LENGTH = 80;
const MAX_TEXT_VALUE_LENGTH = 1000;

const isPlainObject = (v) => v && typeof v === 'object' && !Array.isArray(v);

const sanitizeBoolean = (v, fallback = false) => (typeof v === 'boolean' ? v : fallback);
const sanitizeString = (v, max = 200) => {
  if (typeof v !== 'string') return '';
  const trimmed = v.trim();
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
};
const sanitizeNumber = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const sanitizeBuiltinDefaultValue = (key, value) => {
  if (value == null) return '';
  if (key === 'age') {
    const n = Number.parseInt(String(value).trim(), 10);
    return Number.isInteger(n) && n >= 0 && n <= 120 ? String(n) : '';
  }
  if (key === 'passportPhoto') return ''; // photos can't have a default
  if (typeof value === 'string') return sanitizeString(value, 200);
  return '';
};

const sanitizeBuiltins = (raw) => {
  const base = buildDefaultBuiltins();
  if (!isPlainObject(raw)) return base;
  for (const key of BUILTIN_FIELD_KEYS) {
    const incoming = raw[key];
    if (!isPlainObject(incoming)) continue;
    const enabled = ALWAYS_ENABLED_BUILTINS.has(key)
      ? true
      : sanitizeBoolean(incoming.enabled, true);
    base[key] = {
      enabled,
      defaultValue: sanitizeBuiltinDefaultValue(key, incoming.defaultValue)
    };
  }
  return base;
};

const sanitizeCustomFieldOptions = (options) => {
  if (!Array.isArray(options)) return [];
  const seen = new Set();
  const out = [];
  for (const opt of options) {
    if (!isPlainObject(opt)) continue;
    const value = sanitizeString(opt.value, 100);
    const label = sanitizeString(opt.label, 100) || value;
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push({ value, label });
    if (out.length >= 50) break;
  }
  return out;
};

const sanitizeCustomFieldValidation = (raw, type) => {
  const v = isPlainObject(raw) ? raw : {};
  const out = {};
  if (type === 'text') {
    if (typeof v.regex === 'string' && v.regex.trim()) {
      const r = v.regex.trim().slice(0, 500);
      try {
        new RegExp(r);
        out.regex = r;
        const msg = sanitizeString(v.regexMessage, 200);
        if (msg) out.regexMessage = msg;
      } catch { /* ignore invalid regex */ }
    }
    const minLen = sanitizeNumber(v.minLength);
    const maxLen = sanitizeNumber(v.maxLength);
    if (Number.isInteger(minLen) && minLen >= 0) out.minLength = minLen;
    if (Number.isInteger(maxLen) && maxLen > 0) out.maxLength = Math.min(maxLen, MAX_TEXT_VALUE_LENGTH);
  } else if (type === 'number') {
    const min = sanitizeNumber(v.min);
    const max = sanitizeNumber(v.max);
    if (min !== null) out.min = min;
    if (max !== null) out.max = max;
  } else if (type === 'date') {
    if (typeof v.min === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.min)) out.min = v.min;
    if (typeof v.max === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.max)) out.max = v.max;
  }
  return out;
};

const sanitizeCustomDefaultValue = (type, value, options) => {
  if (value == null) {
    if (type === 'checkbox') return false;
    return '';
  }
  switch (type) {
    case 'text':
      return sanitizeString(value, MAX_TEXT_VALUE_LENGTH);
    case 'number': {
      const n = sanitizeNumber(value);
      return n === null ? '' : n;
    }
    case 'date':
      return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : '';
    case 'checkbox':
      return value === true || value === 'true';
    case 'select': {
      const v = sanitizeString(value, 100);
      return options.some((o) => o.value === v) ? v : '';
    }
    case 'file':
      return '';
    default:
      return '';
  }
};

const sanitizeCustomField = (raw, knownKeys, knownIds) => {
  if (!isPlainObject(raw)) return null;
  const key = sanitizeString(raw.key, 32);
  if (!KEY_RE.test(key) || BUILTIN_FIELD_KEYS.includes(key) || knownKeys.has(key)) return null;
  const type = typeof raw.type === 'string' && CUSTOM_FIELD_TYPES.has(raw.type) ? raw.type : 'text';
  const label = sanitizeString(raw.label, MAX_LABEL_LENGTH) || key;
  const scope = typeof raw.scope === 'string' && SCOPES.has(raw.scope) ? raw.scope : 'both';
  const required = sanitizeBoolean(raw.required, false);
  const archived = sanitizeBoolean(raw.archived, false);
  const options = type === 'select' ? sanitizeCustomFieldOptions(raw.options) : [];
  const validation = sanitizeCustomFieldValidation(raw.validation, type);
  const defaultValue = sanitizeCustomDefaultValue(type, raw.defaultValue, options);

  let id = sanitizeString(raw.id, 64);
  if (!id || knownIds.has(id)) id = `cf_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
  knownKeys.add(key);
  knownIds.add(id);

  const field = { id, key, label, type, required, scope, defaultValue, archived };
  if (type === 'select') field.options = options;
  if (Object.keys(validation).length) field.validation = validation;
  return field;
};

const sanitizeCustom = (raw) => {
  if (!Array.isArray(raw)) return [];
  const knownKeys = new Set();
  const knownIds = new Set();
  const out = [];
  for (const item of raw) {
    const f = sanitizeCustomField(item, knownKeys, knownIds);
    if (f) out.push(f);
    if (out.length >= MAX_CUSTOM_FIELDS) break;
  }
  return out;
};

const sanitizeGuestFieldsConfig = (raw) => ({
  builtins: sanitizeBuiltins(raw?.builtins),
  custom: sanitizeCustom(raw?.custom)
});

const isBuiltinEnabled = (config, key) => {
  if (ALWAYS_ENABLED_BUILTINS.has(key)) return true;
  return config?.builtins?.[key]?.enabled !== false;
};

const getActiveCustomFields = (config, { isResident } = {}) => {
  const list = Array.isArray(config?.custom) ? config.custom : [];
  return list.filter((f) => {
    if (f.archived) return false;
    if (typeof isResident !== 'boolean') return true;
    if (f.scope === 'both') return true;
    return isResident ? f.scope === 'resident' : f.scope === 'visitor';
  });
};

module.exports = {
  BUILTIN_FIELD_KEYS,
  ALWAYS_ENABLED_BUILTINS,
  CUSTOM_FIELD_TYPES,
  SCOPES,
  DEFAULT_GUEST_FIELDS_CONFIG,
  MAX_CUSTOM_FIELDS,
  MAX_TEXT_VALUE_LENGTH,
  sanitizeGuestFieldsConfig,
  sanitizeBuiltins,
  sanitizeCustom,
  isBuiltinEnabled,
  getActiveCustomFields
};
