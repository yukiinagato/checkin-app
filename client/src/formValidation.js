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

export const validateGuestForm = (guest) => {
  if (!guest || typeof guest !== 'object') return false;

  const age = parseAge(guest.age);
  const hasValidAge = Number.isInteger(age) && age >= 0 && age <= 120;
  if (!guest.name?.trim() || !hasValidAge) return false;

  const isMinor = age < 18;
  if (isMinor && !(guest.guardianName?.trim() && guest.guardianPhone?.trim())) {
    return false;
  }

  if (guest.isResident) {
    const needsPhone = age >= 16;
    return Boolean(Boolean(guest.address?.trim()) && (!needsPhone || guest.phone?.trim()));
  }

  return Boolean(guest.nationality && guest.passportNumber?.trim() && guest.passportPhoto);
};

export const isRegistrationValid = (guests) => {
  if (!Array.isArray(guests) || guests.length === 0) return false;
  return guests.every(validateGuestForm);
};
