#!/usr/bin/env python3
import json
import re
import sys
from datetime import date, datetime
from pathlib import Path


def _mrz_char_value(ch: str) -> int:
    if ch == '<':
        return 0
    if ch.isdigit():
        return int(ch)
    if 'A' <= ch <= 'Z':
        return ord(ch) - 55
    return 0


def _mrz_check_digit(value: str) -> str:
    weights = (7, 3, 1)
    total = 0
    for i, ch in enumerate(value):
        total += _mrz_char_value(ch) * weights[i % 3]
    return str(total % 10)


def extract_passport_number(text: str) -> str:
    text = (text or '').upper()

    # 1) Structured MRZ-like two-line parse (line2[0:9] + check digit)
    lines = [re.sub(r'[^A-Z0-9<]', '', line) for line in text.splitlines() if line.strip()]
    for i in range(len(lines) - 1):
        l1, l2 = lines[i], lines[i + 1]
        if l1.startswith('P<') and len(l2) >= 10:
            field = l2[:9]
            check_digit = l2[9]
            if check_digit.isdigit() and _mrz_check_digit(field) == check_digit:
                num = field.replace('<', '')
                if 6 <= len(num) <= 9:
                    return num

    # 2) MRZ compact parse in one long OCR chunk
    compact = re.sub(r'\s+', '', text)
    mrz_compact = re.search(r'([A-Z0-9<]{9})(\d)([A-Z]{3})(\d{6})(\d)[MF<](\d{6})(\d)', compact)
    if mrz_compact:
        field = mrz_compact.group(1)
        check_digit = mrz_compact.group(2)
        if _mrz_check_digit(field) == check_digit:
            num = field.replace('<', '')
            if 6 <= len(num) <= 9:
                return num

    # 3) Labeled field parse allowing multiline/noisy separators
    labeled = re.search(r'PASSPORT\s*(NO|NUMBER)?[\s:#/\\\-]*([A-Z0-9]{6,10})', text)
    if labeled:
        return labeled.group(2)

    # 4) Nearby-line parse after "PASSPORT NO" marker
    marker = re.search(r'PASSPORT\s*(NO|NUMBER)?', text)
    if marker:
        tail = text[marker.end(): marker.end() + 120]
        near = re.search(r'([A-Z]{1,2}[0-9]{7,8})', tail)
        if near:
            return near.group(1)

    # 5) Conservative fallback: standalone passport-number-like token
    generic = re.search(r'\b([A-Z]{1,2}[0-9]{7,8})\b', text)
    return generic.group(1) if generic else ''


def is_likely_passport(text: str) -> bool:
    t = (text or '').upper()
    if 'PASSPORT' in t or '护照' in t or '護照' in t or '旅券' in t:
      return True
    if 'P<' in t and '<' in t:
      return True
    hints = ['NATIONALITY', 'SURNAME', 'GIVEN', 'DATE OF BIRTH', 'SEX']
    return sum(1 for h in hints if h in t) >= 2


def _normalize_name(raw: str) -> str:
    cleaned = re.sub(r'[^A-Z,\s]', '', (raw or '').upper()).strip(' ,')
    if not cleaned:
        return ''
    if ',' in cleaned:
        parts = [p.strip() for p in cleaned.split(',') if p.strip()]
        if len(parts) >= 2:
            return f"{parts[1]} {parts[0]}".strip()
    return cleaned.replace(',', ' ').strip()


def extract_name(text: str) -> str:
    t = (text or '').upper()
    lines = [ln.strip() for ln in t.splitlines() if ln.strip()]
    for i, line in enumerate(lines):
        if 'NAME' in line and i + 1 < len(lines):
            candidate = _normalize_name(lines[i + 1])
            if candidate:
                return candidate

    compact = re.sub(r'\s+', '', t)
    mrz_name = re.search(r'P<[A-Z<]{3}([A-Z<]+)<<([A-Z<]+)', compact)
    if mrz_name:
        surname = mrz_name.group(1).replace('<', ' ').strip()
        given = mrz_name.group(2).replace('<', ' ').strip()
        full = f"{given} {surname}".strip()
        if full:
            return full
    return ''


def _parse_date_token(token: str):
    token = token.upper().strip()
    token = token.replace('O', '0')
    month_map = {
        'JAN': 1, 'FEB': 2, 'MAR': 3, 'APR': 4, 'MAY': 5, 'JUN': 6,
        'JUL': 7, 'AUG': 8, 'SEP': 9, 'OCT': 10, 'NOV': 11, 'DEC': 12
    }

    m = re.match(r'^(\d{2})([A-Z]{3})(\d{4})$', token)
    if m and m.group(2) in month_map:
        return date(int(m.group(3)), month_map[m.group(2)], int(m.group(1)))

    for fmt in ('%d/%m/%Y', '%Y/%m/%d', '%d-%m-%Y', '%Y-%m-%d'):
        try:
            return datetime.strptime(token, fmt).date()
        except ValueError:
            pass
    return None


def extract_age(text: str):
    t = (text or '').upper()
    lines = [ln.strip() for ln in t.splitlines() if ln.strip()]

    # Find DOB near date-of-birth markers
    for i, line in enumerate(lines):
        if 'DATE OF BIRTH' in line or 'BIRTH' in line:
            nearby = ' '.join(lines[i:i + 3])
            candidates = re.findall(r'(\d{2}[A-Z]{3}\d{4}|\d{2}[/-]\d{2}[/-]\d{4}|\d{4}[/-]\d{2}[/-]\d{2})', nearby)
            for token in candidates:
                dob = _parse_date_token(token)
                if dob:
                    today = date.today()
                    age = today.year - dob.year - ((today.month, today.day) < (dob.month, dob.day))
                    if 0 <= age <= 120:
                        return age

    # MRZ fallback (YYMMDD)
    compact = re.sub(r'\s+', '', t)
    mrz = re.search(r'[A-Z0-9<]{9}\d[A-Z]{3}(\d{6})\d[MF<]', compact)
    if mrz:
        yy = int(mrz.group(1)[0:2])
        mm = int(mrz.group(1)[2:4])
        dd = int(mrz.group(1)[4:6])
        year = 1900 + yy if yy > (date.today().year % 100) else 2000 + yy
        try:
            dob = date(year, mm, dd)
            today = date.today()
            age = today.year - dob.year - ((today.month, today.day) < (dob.month, dob.day))
            if 0 <= age <= 120:
                return age
        except ValueError:
            pass

    return None


ISO3_TO_ISO2 = {
    'CHN': 'CN', 'JPN': 'JP', 'KOR': 'KR', 'USA': 'US', 'GBR': 'GB', 'CAN': 'CA',
    'AUS': 'AU', 'FRA': 'FR', 'DEU': 'DE', 'ITA': 'IT', 'ESP': 'ES', 'RUS': 'RU',
    'IND': 'IN', 'PHL': 'PH', 'VNM': 'VN', 'MYS': 'MY', 'THA': 'TH', 'IDN': 'ID',
    'SGP': 'SG', 'TWN': 'TW', 'HKG': 'HK', 'MAC': 'MO', 'NLD': 'NL', 'CHE': 'CH',
    'SWE': 'SE', 'NOR': 'NO', 'DNK': 'DK', 'FIN': 'FI', 'NZL': 'NZ', 'BRA': 'BR',
    'MEX': 'MX', 'ARG': 'AR', 'TUR': 'TR', 'SAU': 'SA', 'ARE': 'AE', 'ZAF': 'ZA'
}


NATIONALITY_KEYWORDS = {
    'CHINESE': 'CN', 'JAPANESE': 'JP', 'KOREAN': 'KR', 'AMERICAN': 'US',
    'BRITISH': 'GB', 'CANADIAN': 'CA', 'AUSTRALIAN': 'AU', 'FRENCH': 'FR',
    'GERMAN': 'DE', 'ITALIAN': 'IT', 'SPANISH': 'ES', 'RUSSIAN': 'RU',
    'INDIAN': 'IN', 'FILIPINO': 'PH', 'VIETNAMESE': 'VN', 'MALAYSIAN': 'MY',
    'THAI': 'TH', 'INDONESIAN': 'ID', 'SINGAPOREAN': 'SG'
}


def extract_nationality(text: str):
    t = (text or '').upper()
    compact = re.sub(r'\s+', '', t)

    mrz = re.search(r'[A-Z0-9<]{9}\d([A-Z]{3})\d{6}\d[MF<]', compact)
    if mrz:
        iso3 = mrz.group(1)
        return ISO3_TO_ISO2.get(iso3, ''), iso3

    for keyword, iso2 in NATIONALITY_KEYWORDS.items():
        if keyword in t:
            return iso2, keyword

    m = re.search(r'\bNATIONALITY\b[^A-Z0-9]{0,8}([A-Z]{3,15})', t)
    if m:
        raw = m.group(1)
        if len(raw) == 3 and raw in ISO3_TO_ISO2:
            return ISO3_TO_ISO2[raw], raw
        if raw in NATIONALITY_KEYWORDS:
            return NATIONALITY_KEYWORDS[raw], raw
        return '', raw

    return '', ''


def main() -> int:
    if len(sys.argv) < 2:
        print(json.dumps({'success': False, 'error': 'Usage: paddle_ocr_runner.py <image_path>'}))
        return 1

    image_path = Path(sys.argv[1])
    if not image_path.exists():
        print(json.dumps({'success': False, 'error': 'Image not found'}))
        return 1

    try:
        from paddleocr import PaddleOCR
    except Exception as exc:
        print(json.dumps({'success': False, 'error': f'PaddleOCR import failed: {exc}'}))
        return 2

    try:
        ocr = PaddleOCR(use_angle_cls=True, lang='en')
        result = ocr.ocr(str(image_path), cls=True)
        chunks = []
        for page in result or []:
            for row in page or []:
                if isinstance(row, (list, tuple)) and len(row) >= 2 and isinstance(row[1], (list, tuple)) and row[1]:
                    chunks.append(str(row[1][0]))
        text = '\n'.join(chunks)
        passport_number = extract_passport_number(text)
        is_passport = is_likely_passport(text)
        full_name = extract_name(text)
        age = extract_age(text)
        nationality_code, nationality_raw = extract_nationality(text)
        print(json.dumps({
            'success': bool(is_passport and passport_number),
            'isPassport': bool(is_passport),
            'passportNumber': passport_number,
            'fullName': full_name,
            'age': age,
            'nationalityCode': nationality_code,
            'nationalityRaw': nationality_raw,
            'text': text,
            'attempts': 1,
            'engine': 'paddleocr-python-local'
        }))
        return 0
    except Exception as exc:
        print(json.dumps({'success': False, 'error': f'PaddleOCR run failed: {exc}'}))
        return 3


if __name__ == '__main__':
    raise SystemExit(main())
