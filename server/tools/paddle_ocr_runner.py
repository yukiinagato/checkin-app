#!/usr/bin/env python3
import json
import re
import sys
import logging
from datetime import date, datetime
from pathlib import Path

# 强制设置输出编码为 UTF-8，防止 Node.js 在读取非 ASCII 字符时崩溃
if sys.stdout.encoding != 'utf-8':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

def _mrz_char_value(ch: str) -> int:
    # 容错：处理 OCR 常见的符号误识别
    if ch in ('<', '(', '{', '[', '«'):
        return 0
    # 容错：处理数字和字母混淆
    if ch == 'O': ch = '0'
    if ch == 'I': ch = '1'
    if ch == 'Z': ch = '2'
    
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
    # 预处理：统一替换 OCR 容易识别错的符号
    text = (text or '').upper()
    text = text.replace('(', '<').replace('{', '<').replace('[', '<')
    
    # 1) 结构化 MRZ 解析（针对标准两行式 MRZ）
    lines = [re.sub(r'[^A-Z0-9<]', '', line) for line in text.splitlines() if line.strip()]
    for i in range(len(lines)):
        l = lines[i]
        # 护照号码通常在第二行前 9 位，后跟 1 位校验位
        if len(l) >= 10:
            # 滑动窗口查找符合校验逻辑的片段
            for j in range(len(l) - 9):
                field = l[j:j+9]
                check_digit = l[j+9]
                if check_digit.isdigit() and _mrz_check_digit(field) == check_digit:
                    num = field.replace('<', '')
                    if 6 <= len(num) <= 9:
                        return num

    # 2) 紧凑模式正则（一长串没有换行的文本）
    compact = re.sub(r'\s+', '', text)
    mrz_compact = re.search(r'([A-Z0-9<]{9})(\d)[A-Z]{3}(\d{6})(\d)[MF<](\d{6})(\d)', compact)
    if mrz_compact:
        field = mrz_compact.group(1)
        check_digit = mrz_compact.group(2)
        if _mrz_check_digit(field) == check_digit:
            num = field.replace('<', '')
            if 6 <= len(num) <= 9:
                return num

    # 3) 关键字匹配（针对非 MRZ 区域或识别不全的情况）
    labeled = re.search(r'PASSPORT\s*(NO|NUMBER)?[\s:#/\\\-]*([A-Z0-9]{6,10})', text)
    if labeled:
        return labeled.group(2)

    # 4) 常见护照格式回退正则（1-2字母+7-8位数字，如中国 E/G 开头）
    generic = re.search(r'\b([A-Z]{1,2}[0-9]{6,8})\b', text)
    return generic.group(1) if generic else ''

def is_likely_passport(text: str) -> bool:
    t = (text or '').upper()
    if any(k in t for k in ['PASSPORT', '护照', '護照', '旅券']):
        return True
    if 'P<' in t and '<' in t:
        return True
    hints = ['NATIONALITY', 'SURNAME', 'GIVEN', 'DATE OF BIRTH', 'SEX']
    return sum(1 for h in hints if h in t) >= 2

def _normalize_name(raw: str) -> str:
    cleaned = re.sub(r'[^A-Z,\s]', '', (raw or '').upper()).strip(' ,')
    if not cleaned: return ''
    if ',' in cleaned:
        parts = [p.strip() for p in cleaned.split(',') if p.strip()]
        if len(parts) >= 2: return f"{parts[1]} {parts[0]}".strip()
    return cleaned.replace(',', ' ').strip()

def extract_name(text: str) -> str:
    t = (text or '').upper()
    # 尝试从 MRZ 提取
    compact = re.sub(r'\s+', '', t).replace('(', '<')
    mrz_name = re.search(r'P<[A-Z<]{3}([A-Z<]+)<<([A-Z<]+)', compact)
    if mrz_name:
        surname = mrz_name.group(1).replace('<', ' ').strip()
        given = mrz_name.group(2).replace('<', ' ').strip()
        return f"{given} {surname}".strip()

    # 尝试从文本行提取
    lines = [ln.strip() for ln in t.splitlines() if ln.strip()]
    for i, line in enumerate(lines):
        if 'NAME' in line and i + 1 < len(lines):
            candidate = _normalize_name(lines[i + 1])
            if candidate: return candidate
    return ''

def _parse_date_token(token: str):
    token = token.upper().strip().replace('O', '0')
    month_map = {
        'JAN': 1, 'FEB': 2, 'MAR': 3, 'APR': 4, 'MAY': 5, 'JUN': 6,
        'JUL': 7, 'AUG': 8, 'SEP': 9, 'OCT': 10, 'NOV': 11, 'DEC': 12
    }
    m = re.match(r'^(\d{2})([A-Z]{3})(\d{4})$', token)
    if m and m.group(2) in month_map:
        try: return date(int(m.group(3)), month_map[m.group(2)], int(m.group(1)))
        except: pass

    for fmt in ('%d/%m/%Y', '%Y/%m/%d', '%d-%m-%Y', '%Y-%m-%d'):
        try: return datetime.strptime(token, fmt).date()
        except ValueError: pass
    return None

def extract_age(text: str):
    t = (text or '').upper()
    # MRZ 提取生日（格式 YYMMDD）
    compact = re.sub(r'\s+', '', t).replace('(', '<')
    mrz = re.search(r'[A-Z0-9<]{9}\d[A-Z]{3}(\d{6})\d[MF<]', compact)
    if mrz:
        try:
            yy, mm, dd = int(mrz.group(1)[0:2]), int(mrz.group(1)[2:4]), int(mrz.group(1)[4:6])
            year = 1900 + yy if yy > (date.today().year % 100) else 2000 + yy
            dob = date(year, mm, dd)
            today = date.today()
            return today.year - dob.year - ((today.month, today.day) < (dob.month, dob.day))
        except: pass

    # 文本提取
    lines = [ln.strip() for ln in t.splitlines() if ln.strip()]
    for i, line in enumerate(lines):
        if 'BIRTH' in line:
            nearby = ' '.join(lines[max(0, i):i + 3])
            candidates = re.findall(r'(\d{2}[A-Z]{3}\d{4}|\d{2}[/-]\d{2}[/-]\d{4}|\d{4}[/-]\d{2}[/-]\d{2})', nearby)
            for token in candidates:
                dob = _parse_date_token(token)
                if dob:
                    today = date.today()
                    return today.year - dob.year - ((today.month, today.day) < (dob.month, dob.day))
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
    compact = re.sub(r'\s+', '', t).replace('(', '<')
    mrz = re.search(r'[A-Z0-9<]{9}\d([A-Z]{3})\d{6}\d[MF<]', compact)
    if mrz:
        iso3 = mrz.group(1)
        return ISO3_TO_ISO2.get(iso3, ''), iso3

    for keyword, iso2 in NATIONALITY_KEYWORDS.items():
        if keyword in t: return iso2, keyword

    m = re.search(r'\bNATIONALITY\b[^A-Z0-9]{0,8}([A-Z]{3,15})', t)
    if m:
        raw = m.group(1)
        if len(raw) == 3 and raw in ISO3_TO_ISO2: return ISO3_TO_ISO2[raw], raw
        return '', raw
    return '', ''

def main() -> int:
    if len(sys.argv) < 2:
        print(json.dumps({'success': False, 'error': 'No image path provided'}))
        return 1

    image_path = Path(sys.argv[1])
    if not image_path.exists():
        print(json.dumps({'success': False, 'error': f'File not found: {image_path}'}))
        return 1

    try:
        # 屏蔽 PaddleOCR 启动时的大量日志
        logging.getLogger("ppocr").setLevel(logging.ERROR)
        from paddleocr import PaddleOCR
    except Exception as exc:
        print(json.dumps({'success': False, 'error': f'Import failed: {exc}'}))
        return 2

    try:
        # 初始化 OCR
        ocr = PaddleOCR(use_angle_cls=True, lang='en', show_log=False)
        result = ocr.ocr(str(image_path), cls=True)
        
        chunks = []
        if result:
            for page in result:
                if not page: continue
                for row in page:
                    if row and len(row) > 1 and row[1]:
                        chunks.append(str(row[1][0]))
        
        text = '\n'.join(chunks)
        passport_number = extract_passport_number(text)
        is_passport = is_likely_passport(text)
        full_name = extract_name(text)
        age = extract_age(text)
        nationality_code, nationality_raw = extract_nationality(text)

        # 只要能提取到关键信息，就认为 success
        print(json.dumps({
            'success': bool(passport_number),
            'isPassport': is_passport,
            'passportNumber': passport_number,
            'fullName': full_name,
            'age': age,
            'nationalityCode': nationality_code,
            'nationalityRaw': nationality_raw,
            'text': text,
            'engine': 'paddleocr-python-local'
        }, ensure_ascii=False))
        return 0
    except Exception as exc:
        print(json.dumps({'success': False, 'error': f'Runtime error: {str(exc)}'}))
        return 3

if __name__ == '__main__':
    try:
        sys.exit(main())
    except SystemExit as e:
        raise e
    except Exception:
        sys.exit(1)