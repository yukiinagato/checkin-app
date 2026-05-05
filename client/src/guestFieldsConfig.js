// Canonical schema and helpers for the guest registration form configuration.
// Mirrors server/guestFieldsConfig.js — keep them in sync.

export const BUILTIN_FIELD_KEYS = Object.freeze([
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

export const ALWAYS_ENABLED_BUILTINS = Object.freeze(new Set(['name']));

export const CUSTOM_FIELD_TYPES = Object.freeze(['text', 'number', 'select', 'checkbox', 'date', 'file']);
export const SCOPES = Object.freeze(['both', 'resident', 'visitor']);

export const buildDefaultBuiltinsConfig = () => {
  const out = {};
  for (const key of BUILTIN_FIELD_KEYS) {
    out[key] = { enabled: true, defaultValue: '' };
  }
  return out;
};

export const DEFAULT_GUEST_FIELDS_CONFIG = Object.freeze({
  builtins: buildDefaultBuiltinsConfig(),
  custom: []
});

export const isBuiltinEnabled = (config, key) => {
  if (ALWAYS_ENABLED_BUILTINS.has(key)) return true;
  return config?.builtins?.[key]?.enabled !== false;
};

export const getBuiltinDefault = (config, key) => {
  const v = config?.builtins?.[key]?.defaultValue;
  return typeof v === 'string' ? v : '';
};

export const getActiveCustomFields = (config, { isResident } = {}) => {
  const list = Array.isArray(config?.custom) ? config.custom : [];
  return list.filter((f) => {
    if (f.archived) return false;
    if (typeof isResident !== 'boolean') return true;
    if (f.scope === 'both') return true;
    return isResident ? f.scope === 'resident' : f.scope === 'visitor';
  });
};

const emptyDefaultForType = (type) => {
  if (type === 'checkbox') return false;
  return '';
};

export const buildCustomFieldsDefaults = (config, { isResident } = {}) => {
  const fields = getActiveCustomFields(config, { isResident });
  const out = {};
  for (const f of fields) {
    if (f.defaultValue !== undefined && f.defaultValue !== '' && f.defaultValue !== null) {
      out[f.key] = f.defaultValue;
    } else {
      out[f.key] = emptyDefaultForType(f.type);
    }
  }
  return out;
};

export const validateCustomFieldValue = (field, value) => {
  const isEmpty =
    value === undefined ||
    value === null ||
    value === '' ||
    (field.type === 'checkbox' && value === false && !field.required);
  if (field.required && isEmpty && field.type !== 'checkbox') return false;
  if (field.required && field.type === 'checkbox' && value !== true) return false;
  if (isEmpty && !field.required) return true;

  switch (field.type) {
    case 'text': {
      if (typeof value !== 'string') return false;
      const len = value.trim().length;
      const v = field.validation || {};
      if (Number.isInteger(v.minLength) && len < v.minLength) return false;
      if (Number.isInteger(v.maxLength) && len > v.maxLength) return false;
      if (v.regex) {
        try { if (!new RegExp(v.regex).test(value)) return false; } catch { /* ignore */ }
      }
      return true;
    }
    case 'number': {
      const n = Number(value);
      if (!Number.isFinite(n)) return false;
      const v = field.validation || {};
      if (Number.isFinite(v.min) && n < v.min) return false;
      if (Number.isFinite(v.max) && n > v.max) return false;
      return true;
    }
    case 'date': {
      if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
      const v = field.validation || {};
      if (v.min && value < v.min) return false;
      if (v.max && value > v.max) return false;
      return true;
    }
    case 'select':
      return Array.isArray(field.options) && field.options.some((o) => o.value === value);
    case 'checkbox':
      return typeof value === 'boolean';
    case 'file':
      return typeof value === 'string' && value.length > 0;
    default:
      return true;
  }
};
