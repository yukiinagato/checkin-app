import {
  DEFAULT_GUEST_FIELDS_CONFIG,
  isBuiltinEnabled,
  getActiveCustomFields,
  validateCustomFieldValue
} from './guestFieldsConfig.js';

export const parseAge = (ageValue) => Number.parseInt(String(ageValue ?? '').trim(), 10);

export const parsePassportBirthDateToAge = (birthDate, todayValue = new Date()) => {
  const normalized = String(birthDate ?? '').replace(/\D/g, '');
  if (normalized.length !== 8) return '';

  const year = Number.parseInt(normalized.slice(0, 4), 10);
  const month = Number.parseInt(normalized.slice(4, 6), 10);
  const day = Number.parseInt(normalized.slice(6, 8), 10);
  const birth = new Date(year, month - 1, day);

  if (
    Number.isNaN(birth.getTime()) ||
    birth.getFullYear() !== year ||
    birth.getMonth() !== month - 1 ||
    birth.getDate() !== day
  ) {
    return '';
  }

  const today = todayValue instanceof Date ? todayValue : new Date(todayValue);
  let age = today.getFullYear() - year;
  const hasHadBirthday =
    today.getMonth() > month - 1 ||
    (today.getMonth() === month - 1 && today.getDate() >= day);

  if (!hasHadBirthday) {
    age -= 1;
  }

  return age >= 0 ? String(age) : '';
};

export const validateGuestForm = (guest, config = DEFAULT_GUEST_FIELDS_CONFIG) => {
  if (!guest || typeof guest !== 'object') return false;

  // name always required
  if (!guest.name?.trim()) return false;

  const ageEnabled = isBuiltinEnabled(config, 'age');
  let age = NaN;
  if (ageEnabled) {
    age = parseAge(guest.age);
    if (!Number.isInteger(age) || age < 0 || age > 120) return false;
  }

  const isMinor = ageEnabled && age < 18;
  if (isMinor) {
    if (isBuiltinEnabled(config, 'guardianName') && !guest.guardianName?.trim()) return false;
    if (isBuiltinEnabled(config, 'guardianPhone') && !guest.guardianPhone?.trim()) return false;
  }

  if (guest.isResident) {
    if (isBuiltinEnabled(config, 'address') && !guest.address?.trim()) return false;
    if (isBuiltinEnabled(config, 'phone')) {
      const needsPhone = !ageEnabled || age >= 16;
      if (needsPhone && !guest.phone?.trim()) return false;
    }
  } else {
    if (isBuiltinEnabled(config, 'nationality') && !guest.nationality) return false;
    if (isBuiltinEnabled(config, 'passportNumber') && !guest.passportNumber?.trim()) return false;
    if (isBuiltinEnabled(config, 'passportPhoto') && !guest.passportPhoto) return false;
  }

  const customFields = guest.customFields || {};
  const activeCustom = getActiveCustomFields(config, { isResident: !!guest.isResident });
  for (const field of activeCustom) {
    if (!validateCustomFieldValue(field, customFields[field.key])) return false;
  }

  return true;
};

export const isRegistrationValid = (guests, config = DEFAULT_GUEST_FIELDS_CONFIG) => {
  if (!Array.isArray(guests) || guests.length === 0) return false;
  return guests.every((g) => validateGuestForm(g, config));
};
