#!/usr/bin/env python3
import json
import re
import sys
import logging
from datetime import date, datetime
from pathlib import Path
from typing import List, Dict

import cv2
import numpy as np
from PIL import Image, ImageOps

# 强制设置输出编码为 UTF-8，防止 Node.js 在读取非 ASCII 字符时崩溃
if sys.stdout.encoding != 'utf-8':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

# 全局容错月份映射表
MONTH_MAP = {
    'JAN': 1, 'FEB': 2, 'MAR': 3, 'APR': 4, 'MAY': 5, 'JUN': 6,
    'JUL': 7, 'AUG': 8, 'SEP': 9, 'OCT': 10, 'NOV': 11, 'DEC': 12,
    '0CT': 10, '1AN': 1, 'A0G': 8, '0EC': 12, '5EP': 9, 'J4N': 1
}
MONTH_BLACKLIST = set(MONTH_MAP.keys())

# 全局印刷体黑名单 - 增加更多干扰词
NAME_BLACKLIST = {
    'SIGNATURE', 'BEARER', 'MINISTRY', 'PASSPORT', 'REPUBLIC', 'KOREA',
    'DATE', 'SURNAME', 'GIVEN', 'NATIONALITY', 'BIRTH', 'AUTHORITY',
    'COUNTRY', 'NUMBER', 'SEX', 'TYPE', 'CODE', 'ISSUING', 'AFFAIRS', 
    'FOREIGN', 'NAMES', 'KOR', 'CHN', 'JPN', 'USA', 'GBR', 'HONG', 'KONG',
    'REGION', 'SPECIAL', 'ADMINISTRATIVE', 'PEOPLE', 'CHINA', 'IMMIGRATION'
}

def _mrz_char_value(ch: str) -> int:
    if ch in ('<', '(', '{', '[', '«'): return 0
    if ch == 'O': ch = '0'
    if ch == 'I': ch = '1'
    if ch == 'Z': ch = '2'
    if ch.isdigit(): return int(ch)
    if 'A' <= ch <= 'Z': return ord(ch) - 55
    return 0

def _mrz_check_digit(value: str) -> str:
    weights = (7, 3, 1)
    total = sum(_mrz_char_value(ch) * weights[i % 3] for i, ch in enumerate(value))
    return str(total % 10)

def extract_passport_number(text: str) -> str:
    """极其严格的 MRZ 提取。"""
    text = (text or '').upper()
    text = text.replace('(', '<').replace('{', '<').replace('[', '<')
    compact = re.sub(r'\s+', '', text)
    
    # 1) 紧凑模式正则
    mrz_compact = re.search(r'([A-Z0-9<]{9})(\d)[A-Z0-9<]{3}(\d{6})(\d)[MF<](\d{6})(\d)', compact)
    if mrz_compact:
        field = mrz_compact.group(1)
        check_digit = mrz_compact.group(2)
        if _mrz_check_digit(field) == check_digit:
            num = field.replace('<', '')
            if 6 <= len(num) <= 10: return num

    # 2) 结构化 MRZ 滑动窗口解析
    lines = [re.sub(r'[^A-Z0-9<]', '', line) for line in text.splitlines() if line.strip()]
    for l in lines:
        if len(l) >= 28:
            for j in range(len(l) - 9):
                field = l[j:j+9]
                check_digit = l[j+9]
                if check_digit.isdigit() and _mrz_check_digit(field) == check_digit:
                    num = field.replace('<', '')
                    if 6 <= len(num) <= 10: return num
    return ''

def is_likely_passport(text: str) -> bool:
    t = (text or '').upper()
    if any(k in t for k in ['PASSPORT', '护照', '護照', '旅券']): return True
    if 'P<' in t and '<' in t: return True
    hints = ['NATIONALITY', 'SURNAME', 'GIVEN', 'DATE OF BIRTH', 'SEX']
    return sum(1 for h in hints if h in t) >= 2

def _normalize_name(raw: str) -> str:
    # 移除标签前缀和非字母字符
    cleaned = re.sub(r'^[/]+', '', raw.upper())
    cleaned = re.sub(r'[^A-Z\s]', '', cleaned).strip()
    if not cleaned or cleaned in NAME_BLACKLIST: return ''
    return cleaned

def extract_name(text: str) -> str:
    t = (text or '').upper()
    
    # 1. MRZ 提取
    lines = [ln.strip() for ln in t.splitlines() if ln.strip()]
    for line in lines:
        compact_line = line.replace(' ', '').replace('(', '<').replace('[', '<')
        mrz_name = re.search(r'P[A-Z<]{4}([A-Z<]+?)<<([A-Z<]+)', compact_line)
        if mrz_name:
            surname = mrz_name.group(1).replace('<', ' ').strip()
            given_raw = mrz_name.group(2)
            given = given_raw.split('<<')[0].strip('<').replace('<', ' ').strip()
            return f"{given} {surname}".strip()

    # 2. VIZ 提取 - 针对特定标签寻找后续行
    for i, line in enumerate(lines):
        # 排除掉本身就是关键词的行作为名字
        if any(k in line for k in ['SURNAME', 'GIVEN NAMES']):
            # 寻找接下来的 3 行中第一个看起来像名字的
            for j in range(i + 1, min(len(lines), i + 4)):
                candidate = _normalize_name(lines[j])
                if candidate and len(candidate) >= 2:
                    return candidate
    
    # 3. 兜底逻辑由 fallback_extract_viz 处理
    return ''

def _parse_date_token(token: str):
    token = token.upper().strip().replace('O', '0')
    # 匹配 DDMMMYYYY 或 DDMMMYY
    m = re.match(r'^(\d{2})([A-Z0-9]{3})(\d{2,4})$', token)
    if m:
        dd, mm_str, yy_str = int(m.group(1)), m.group(2), m.group(3)
        mm = MONTH_MAP.get(mm_str)
        if mm:
            try:
                # 处理 2 位年份
                year = int(yy_str)
                if len(yy_str) == 2:
                    # 简单规则：当前年份以后认为是 19XX
                    current_yy = date.today().year % 100
                    year += 2000 if year <= current_yy else 1900
                return date(year, mm, dd)
            except: pass

    for fmt in ('%d/%m/%Y', '%Y/%m/%d', '%d-%m-%Y', '%Y-%m-%d'):
        try: return datetime.strptime(token, fmt).date()
        except ValueError: pass
    return None

def extract_dob_and_age(text: str):
    t = (text or '').upper()
    compact = re.sub(r'\s+', '', t).replace('(', '<')
    mrz = re.search(r'[A-Z0-9<]{9}\d[A-Z0-9<]{3}(\d{6})\d[MF<]', compact)
    if mrz:
        try:
            yy, mm, dd = int(mrz.group(1)[0:2]), int(mrz.group(1)[2:4]), int(mrz.group(1)[4:6])
            year = 1900 + yy if yy > (date.today().year % 100) else 2000 + yy
            dob = date(year, mm, dd)
            today = date.today()
            age = today.year - dob.year - ((today.month, today.day) < (dob.month, dob.day))
            return dob.strftime('%Y%m%d'), age
        except: pass

    lines = [ln.strip() for ln in t.splitlines() if ln.strip()]
    for i, line in enumerate(lines):
        if 'BIRTH' in line:
            # 扩大搜索范围到 5 行，应对排版松散的情况
            nearby = ' '.join(lines[max(0, i):min(len(lines), i + 6)])
            # 匹配 DDMMM YY/YYYY
            candidates = re.findall(r'(\d{2}[A-Z0-9]{3}\s?\d{2,4})', nearby)
            # 也要匹配标准格式
            candidates += re.findall(r'(\d{2}[/-]\d{2}[/-]\d{2,4}|\d{4}[/-]\d{2}[/-]\d{2})', nearby)
            
            for token in candidates:
                # 移除空格再解析
                dob = _parse_date_token(token.replace(' ', ''))
                if dob:
                    today = date.today()
                    age = today.year - dob.year - ((today.month, today.day) < (dob.month, dob.day))
                    return dob.strftime('%Y%m%d'), age
    return '', None

def extract_sex(text: str) -> str:
    t = (text or '').upper()
    compact = re.sub(r'\s+', '', t).replace('(', '<')
    mrz = re.search(r'[A-Z0-9<]{9}\d[A-Z0-9<]{3}\d{6}\d([MF<])', compact)
    if mrz and mrz.group(1) in ('M', 'F'): return mrz.group(1)
    
    lines = [ln.strip() for ln in t.splitlines() if ln.strip()]
    for i, line in enumerate(lines):
        if 'SEX' in line:
            # 向下寻找 5 行
            for j in range(i, min(len(lines), i + 6)):
                content = lines[j].strip('/')
                if content == 'M': return 'M'
                if content == 'F': return 'F'
                # 处理粘连情况，如 "/M" 或 "SEX M"
                if re.search(r'\bM\b', content): return 'M'
                if re.search(r'\bF\b', content): return 'F'
    
    # 最后的尝试：搜索整个文本中独立的 M/F
    if re.search(r'\bM\b', t): return 'M'
    if re.search(r'\bF\b', t): return 'F'
    return ''

ISO3_TO_ISO2 = {
    'CHN': 'CN', 'JPN': 'JP', 'KOR': 'KR', 'USA': 'US', 'GBR': 'GB', 'CAN': 'CA',
    'AUS': 'AU', 'FRA': 'FR', 'DEU': 'DE', 'ITA': 'IT', 'ESP': 'ES', 'RUS': 'RU',
    'IND': 'IN', 'PHL': 'PH', 'VNM': 'VN', 'MYS': 'MY', 'THA': 'TH', 'IDN': 'ID',
    'SGP': 'SG', 'TWN': 'TW', 'HKG': 'HK', 'MAC': 'MO'
}

NATIONALITY_KEYWORDS = {
    'CHINESE': 'CN', 'CHINA': 'CN', 'JAPANESE': 'JP', 'JAPAN': 'JP', 
    'KOREAN': 'KR', 'KOREA': 'KR', 'REPUBLIC OF KOREA': 'KR',
    'AMERICAN': 'US', 'BRITISH': 'GB', 'CANADIAN': 'CA', 'AUSTRALIAN': 'AU'
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

def safe_load_image_with_exif(image_path: Path) -> np.ndarray:
    with Image.open(image_path) as img:
        normalized = ImageOps.exif_transpose(img)
        rgb = normalized.convert('RGB')
        arr = np.array(rgb)
    return cv2.cvtColor(arr, cv2.COLOR_RGB2BGR)

def fallback_extract_viz(text_lines: List[str]) -> Dict[str, str]:
    passport_number = ''
    full_name = ''

    # 1. 护照号
    for line in text_lines:
        if not line: continue
        tokens = re.findall(r'\b[A-Z0-9]{8,10}\b', line.upper())
        for token in tokens:
            if any(c.isdigit() for c in token) and not any(month in token for month in MONTH_BLACKLIST):
                passport_number = token
                break
        if passport_number: break

    # 2. 姓名
    name_candidates: List[str] = []
    for orig_line in text_lines:
        if not orig_line or len(orig_line) < 3: continue
        if re.search(r'[a-z]', orig_line): continue
        if '<' in orig_line: continue
        
        line_upper = orig_line.upper().replace('/', ' ').strip()
        words = [re.sub(r'[^A-Z]', '', w) for w in line_upper.split()]
        words = [w for w in words if w]
        
        if not words: continue
        # 排除包含黑名单单词的行
        if any(word in NAME_BLACKLIST for word in words): continue
        if re.search(r'\d', orig_line): continue
            
        name_candidates.append(' '.join(words))

    if name_candidates:
        # 优先取包含多个单词且长度适中的作为姓名
        name_candidates.sort(key=lambda x: (len(x.split()) > 1, len(x)), reverse=True)
        full_name = name_candidates[0]

    return {
        'passportNumber': passport_number,
        'fullName': full_name
    }

def main() -> int:
    if len(sys.argv) < 2:
        print(json.dumps({'success': False, 'error': 'No image path provided'}))
        return 1

    image_path = Path(sys.argv[1])
    if not image_path.exists():
        print(json.dumps({'success': False, 'error': f'File not found: {image_path}'}))
        return 1

    try:
        logging.getLogger("ppocr").setLevel(logging.ERROR)
        from paddleocr import PaddleOCR
    except Exception as exc:
        print(json.dumps({'success': False, 'error': f'Import failed: {exc}'}))
        return 2

    try:
        ocr = PaddleOCR(
            use_angle_cls=True, 
            lang='en', 
            show_log=False,
            det_limit_side_len=1920,
            det_db_unclip_ratio=2.0
        )
        
        image_bgr = safe_load_image_with_exif(image_path)
        result = ocr.ocr(image_bgr, cls=True)
        
        chunks = []
        if result:
            for page in result:
                if not page: continue
                for row in page:
                    if row and len(row) > 1 and row[1]:
                        chunks.append(str(row[1][0]))
        
        text_lines = [c.strip() for c in chunks if c.strip()]
        text = '\n'.join(text_lines)
        
        passport_number = extract_passport_number(text)
        is_passport = is_likely_passport(text)
        full_name = extract_name(text)
        birthDate, age = extract_dob_and_age(text)
        sex = extract_sex(text)
        nationality_code, nationality_raw = extract_nationality(text)

        fallback = fallback_extract_viz(text_lines)
        if not passport_number:
            passport_number = fallback.get('passportNumber', '')
        if not full_name:
            full_name = fallback.get('fullName', '')

        print(json.dumps({
            'success': bool(passport_number),
            'isPassport': is_passport,
            'passportNumber': passport_number,
            'fullName': full_name,
            'birthDate': birthDate,
            'age': age,
            'sex': sex,
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
