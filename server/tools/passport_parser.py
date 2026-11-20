"""Passport field extraction, independent of the OCR runtime.

MRZ checks validate individual fields, never the unchecked name. VIZ candidates
remain reviewable when machine-readable text is damaged or inconsistent.
"""
import re
import json
from pathlib import Path
from datetime import date, datetime

MONTHS = {m: i for i, m in enumerate(
    ('JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'), 1)}
MONTHS.update({'0CT': 10, '1AN': 1, 'A0G': 8, '0EC': 12, '5EP': 9})
# Snapshot of the application's existing iso-3166-1 dataset. ICAO special
# document codes are allowed structurally but are not invented nationalities.
ISO3_TO_ISO2 = json.loads(Path(__file__).with_name('passport_countries.json').read_text())
ISO3_TO_ISO2.update({'D<<': 'DE', 'UTO': '', 'XXX': '', 'XXA': '', 'XXB': '', 'XXC': ''})

FIELDS = ('passportNumber', 'fullName', 'birthDate', 'sex', 'nationalityCode')


def check_digit(value):
    """ICAO 9303: letters retain values 10..35, including O, I and Z."""
    if not re.fullmatch(r'[A-Z0-9<]+', value):
        return None
    return str(sum((0 if c == '<' else int(c) if c.isdigit() else ord(c) - 55)
                   * (7, 3, 1)[i % 3] for i, c in enumerate(value)) % 10)


def iso_code(raw):
    return raw.translate(str.maketrans('0125', 'OIZS'))


def age_on(birth, today):
    return today.year - birth.year - ((today.month, today.day) < (birth.month, birth.day))


def parse_date(raw, today, birth=False):
    try:
        if re.fullmatch(r'\d{6}', raw):
            year = 2000 + int(raw[:2])
            if birth and (year, int(raw[2:4]), int(raw[4:])) > (today.year, today.month, today.day):
                year -= 100
            result = date(year, int(raw[2:4]), int(raw[4:]))
        else:
            match = re.search(r'(?<!\d)(\d{1,2})[\s./-]*([A-Z0-9]{3})[\s./-]*(\d{4}|\d{2})(?!\d)', raw.upper())
            if not match:
                match = re.search(r'(?<!\d)(\d{2})[./-](\d{2})[./-](\d{4})(?!\d)', raw)
                if not match:
                    return None
                day, month, year = map(int, match.groups())
            else:
                day, month, year = match.groups()
                day, month, year = int(day), MONTHS[month], int(year)
                if year < 100:
                    return parse_date(f'{year:02d}{month:02d}{day:02d}', today, birth)
            result = date(year, month, day)
        if birth and (result > today or age_on(result, today) > 120):
            return None
        return result.strftime('%Y%m%d')
    except (ValueError, KeyError):
        return None


def parse_mrz(lines, today):
    clean = [re.sub(r'[^A-Z0-9<]', '', line.upper()) for line in lines]
    headers = [line for line in clean if line.startswith('P') and '<<' in line]
    result, checks, warnings = {}, {}, []
    if not headers:
        return result, checks, warnings
    # Do not slice a shortened header: PMKRLEE would turn LEE into EE.
    names = []
    for line in headers:
        if len(line) != 44 or '<<' not in line[5:] or not re.fullmatch(r'P[A-Z<][A-Z0-9<]{3}[A-Z<]{39}', line) or iso_code(line[2:5]) not in ISO3_TO_ISO2:
            warnings.append('mrz_name_structure_invalid')
            continue
        surname, given = line[5:].split('<<', 1)
        name = ' '.join((given.replace('<', ' ').strip() + ' ' + surname.replace('<', ' ').strip()).split())
        if name:
            names.append(name)
    if len(set(names)) == 1:
        result['fullName'] = names[0]
    elif names:
        warnings.append('multiple_mrz_names')

    candidates = []
    for line in clean:
        if len(line) != 44 or not re.fullmatch(r'[A-Z0-9<]{9}\d[A-Z0-9<]{3}\d{7}[MF<]\d{7}[A-Z0-9<]{14}[0-9<]\d', line):
            continue
        if iso_code(line[10:13]) not in ISO3_TO_ISO2:
            continue
        candidates.append(line)
    if len(set(candidates)) != 1:
        warnings.append('mrz_data_structure_invalid' if not candidates else 'multiple_mrz_data_lines')
        return result, checks, warnings
    line = candidates[0]
    checks = {
        'passportNumber': check_digit(line[:9]) == line[9],
        'birthDate': check_digit(line[13:19]) == line[19],
        'expiryDate': check_digit(line[21:27]) == line[27],
        'optionalData': check_digit(line[28:42]) == line[42] or (line[28:43] == '<' * 15),
        'composite': check_digit(line[:10] + line[13:20] + line[21:43]) == line[43],
    }
    result.update(passportNumber=line[:9].rstrip('<'), nationalityCode=ISO3_TO_ISO2[iso_code(line[10:13])], sex=line[20] if line[20] in 'MF' else '')
    for key, raw in (('birthDate', line[13:19]), ('expiryDate', line[21:27])):
        value = parse_date(raw, today, birth=key == 'birthDate')
        if value:
            result[key] = value
        else:
            warnings.append('mrz_' + key + '_date_invalid')
    for key, valid in checks.items():
        if not valid:
            warnings.append('mrz_' + key + '_checksum_invalid')
    return result, checks, warnings


def extract_viz(lines, today):
    # MRZ is a separate source, never a VIZ name or document-number candidate.
    lines = [line.strip() for line in lines if '<' not in line and len(line.strip()) < 60]
    result = {}
    names = []
    in_names = False
    active_date = None
    date_values = {}
    passport_candidates = set()
    nationality_candidates = set()
    for original in lines:
        upper = original.upper()
        compact = re.sub(r'[^A-Z]', '', upper)
        if 'SURNAME' in compact:
            in_names = True
            inline = re.split(r'SURNAME\s*[:/：]?\s*', upper, maxsplit=1)[-1]
            if re.fullmatch(r"[A-Z][A-Z '-]+", inline):
                names.append(inline.strip())
            continue
        if compact == 'SEX' or any(word in compact for word in ('NATION', 'NATONAL', 'DATEOF', 'BIRTH', 'AUTHORITY', 'REPUBLIC')):
            in_names = False
        if in_names:
            # Includes names such as HONG and KONG; no blacklist of real surnames.
            if 'GIVEN' in compact or compact in ('NAM', 'NAME', 'NAMES'):
                inline = re.split(r'GIVEN\s*NAMES?\s*[:/：]?\s*', upper, maxsplit=1)
                if len(inline) > 1 and re.fullmatch(r"[A-Z][A-Z '-]+", inline[1]):
                    names.append(inline[1].strip())
                continue
            if original == upper and re.fullmatch(r"[A-Z][A-Z '-]{1,39}", upper):
                names.append(upper)

        if 'BIRTH' in compact:
            active_date = 'birthDate'
        elif 'EXPIR' in compact:
            active_date = 'expiryDate'
        elif 'DATEOFIS' in compact or 'DATEISS' in compact:
            active_date = 'issueDate'
        elif compact in ('SEX', 'NATIONALITY'):
            active_date = None
        if active_date:
            value = parse_date(upper, today, birth=active_date == 'birthDate')
            if value:
                date_values.setdefault(active_date, set()).add(value)
                active_date = None  # A later unlabelled date cannot overwrite it.

        if re.fullmatch(r'[MF]', upper):
            result['sex'] = upper
        elif re.search(r'\bSEX\s*[:/]\s*([MF])\b', upper):
            result['sex'] = re.search(r'\bSEX\s*[:/]\s*([MF])\b', upper)[1]
        # Unlabelled all-numeric values may be personal numbers. Only consider
        # mixed standalone tokens here; checked MRZ handles numeric passports.
        token = upper
        labeled = re.search(r'PASSPORT\s*(?:NO\.?|NUMBER)\s*[:：]?\s*([A-Z0-9]{6,9})\b', upper)
        if labeled:
            passport_candidates.add(labeled[1])
        elif re.fullmatch(r'[A-Z0-9]{7,9}', token) and re.search('[A-Z]', token) and re.search(r'\d', token) and not any(m in token for m in MONTHS):
            passport_candidates.add(token)
        # Issuing country is not nationality. Accept a nearby nationality label.
        if 'NATION' in compact or 'NATONAL' in compact:
            result['_nationalityPending'] = True
        elif result.get('_nationalityPending'):
            if upper in ISO3_TO_ISO2:
                nationality_candidates.add(ISO3_TO_ISO2[upper])
            elif compact == 'REPUBLICOFKOREA':
                nationality_candidates.add('KR')
            result.pop('_nationalityPending', None)
    result.pop('_nationalityPending', None)
    if len(names) == 2:
        result['surname'], result['givenNames'] = names
        result['fullName'] = names[1] + ' ' + names[0]
    if len(passport_candidates) == 1:
        result['passportNumber'] = passport_candidates.pop()
    if len(nationality_candidates) == 1:
        result['nationalityCode'] = nationality_candidates.pop()
    for key, values in date_values.items():
        if len(values) == 1:
            result[key] = values.pop()
    return result


def parse_passport(lines, today=None):
    today = today or date.today()
    mrz, checks, warnings = parse_mrz(lines, today)
    viz = extract_viz(lines, today)
    text = '\n'.join(lines).upper()
    is_passport = bool(re.search(r'PASSPORT|PASSEPORT|旅券|护照|護照', text) or (checks and any('<<' in line for line in lines)))
    result = {key: '' for key in FIELDS}
    evidence = {}
    for key in (*FIELDS, 'expiryDate', 'issueDate'):
        v, m = viz.get(key), mrz.get(key)
        conflict = bool(v and m and v != m)
        # VIZ has full years and names. MRZ names have no check digit at all.
        value = v or m or ''
        if conflict:
            warnings.append(key + '_source_conflict')
        checked = checks.get(key, False)
        status = 'missing'
        if value:
            status = 'review'
            if v == m and v and (checked or key not in checks):
                status = 'confirmed'
            elif checked and m and value == m and not conflict and key != 'fullName':
                status = 'checked'
        result[key] = value
        evidence[key] = {'source': 'viz+mrz' if v and m and v == m else 'viz' if v else 'mrz' if m else None,
                         'status': status, 'checksumValid': checked, 'conflict': conflict,
                         'vizValue': v, 'mrzValue': m}
    if result['issueDate'] and result['expiryDate'] and result['issueDate'] > result['expiryDate']:
        warnings.append('issue_after_expiry')
    if result['birthDate'] and result['issueDate'] and result['birthDate'] > result['issueDate']:
        warnings.append('birth_after_issue')
    result['age'] = age_on(datetime.strptime(result['birthDate'], '%Y%m%d').date(), today) if result['birthDate'] else None
    required_ok = all(evidence[key]['status'] in ('confirmed', 'checked') for key in FIELDS)
    review = not required_ok or bool(warnings)
    # This is an evidence score, not an estimated probability of correctness.
    weights = {'confirmed': 1.0, 'checked': .85, 'review': .45, 'missing': 0.0}
    confidence = sum(weights[evidence[key]['status']] for key in FIELDS) / len(FIELDS)
    result.update(isPassport=is_passport, success=is_passport and bool(result['passportNumber']) and not review,
                  needsReview=review, fieldEvidence=evidence, mrzChecks=checks,
                  warnings=sorted(set(warnings)), confidence=round(min(confidence, .69) if review else confidence, 2),
                  confidenceKind='evidence_score', parserVersion='2', viz=viz, mrz=mrz)
    if not is_passport:
        for key in (*FIELDS, 'expiryDate', 'issueDate'):
            result[key] = ''
        result['age'] = None
        result['confidence'] = 0.0
    return result
