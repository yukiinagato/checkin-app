const CODE_RE = /^[A-Za-z0-9_-]{4,64}$/;
export const reservationPath = (code, done = false) =>
  CODE_RE.test(code || '') ? `/checkin/r/${encodeURIComponent(code)}${done ? '/done' : ''}` : (done ? '/checkin/done' : '/checkin');

export const reservationLinkState = ({ pathname = '/', search = '', hash = '' }) => {
  const match = pathname.match(/^\/checkin\/r\/([^/]+)(\/done)?\/?$/);
  let pathCode = '';
  try { pathCode = match ? decodeURIComponent(match[1]) : ''; } catch { /* malformed path */ }
  const params = new URLSearchParams(search);
  const legacyCode = params.get('res') || '';
  const eligible = pathname === '/' || pathname === '/checkin' || pathname === '/checkin/done' || Boolean(match);
  const code = CODE_RE.test(pathCode) ? pathCode : (eligible && CODE_RE.test(legacyCode) ? legacyCode : '');
  const done = Boolean(match?.[2]) || pathname === '/checkin/done';
  if (!code) return { code: '', done, canonical: null };
  params.delete('res');
  const suffix = `${params.size ? `?${params}` : ''}${hash}`;
  return { code, done, canonical: `${reservationPath(code, done)}${suffix}` };
};

export const reservationUrl = (origin, code) => new URL(reservationPath(code), origin).href;
