export const parseAge = (ageValue) => Number.parseInt(String(ageValue ?? '').trim(), 10);

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
