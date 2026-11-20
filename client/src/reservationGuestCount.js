// Hostex can update the total without updating its adult/child breakdown.
export const reservationGuestCount = (reservation) => {
  const total = Number(reservation?.numberOfGuests);
  if (Number.isSafeInteger(total) && total > 0) return total;
  const count = (value) => {
    const n = Number(value);
    return Number.isSafeInteger(n) && n >= 0 ? n : 0;
  };
  return Math.max(1, count(reservation?.numberOfAdults) + count(reservation?.numberOfChildren));
};
