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

# 全局容错月份映射表（专门对付 OCR 错别字，如 0CT, 1AN）
MONTH_MAP = {
    'JAN': 1, 'FEB': 2, 'MAR': 3, 'APR': 4, 'MAY': 5, 'JUN': 6,
    'JUL': 7, 'AUG': 8, 'SEP': 9, 'OCT': 10, 'NOV': 11, 'DEC': 12,
    '0CT': 10, '1AN': 1, 'A0G': 8, '0EC': 12, '5EP': 9, 'J4N': 1
}
MONTH_BLACKLIST = set(MONTH_MAP.keys())

# 全局印刷体黑名单
NAME_BLACKLIST = {
    'SIGNATURE', 'BEARER', 'MINISTRY', 'PASSPORT', 'REPUBLIC', 'KOREA',
    'DATE', 'SURNAME', 'GIVEN', 'NATIONALITY', 'BIRTH', 'AUTHORITY',
    'COUNTRY', 'NUMBER', 'SEX', 'TYPE', 'CODE', 'ISSUING', 'AFFAIRS', 'FOREIGN', 'NAMES',
    'KOR', 'CHN', 'JPN', 'USA', 'GBR'
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
    """极其严格的 MRZ 提取。删除了所有危险的关键字盲猜逻辑。"""
    text = (text or '').upper()
    text = text.replace('(', '<').replace('{', '<').replace('[', '<')
    compact = re.sub(r'\s+', '', text)
    
    # 1) 紧凑模式正则：优先匹配完整标准的两行式 MRZ
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

def extract_name(text: str) -> str:
    t = (text or '').upper()
    compact = re.sub(r'\s+', '', t).replace('(', '<')
    mrz_name = re.search(r'P[A-Z<]{4}([A-Z<]+)<<([A-Z<]+)', compact)
    if mrz_name:
        surname = mrz_name.group(1).replace('<', ' ').strip()
        given = mrz_name.group(2).replace('<', ' ').strip()
        return f"{given} {surname}".strip()
    return ''

def extract_dob_and_age(text: str):
    """强大容错的出生日期提取，返回 (YYYMMDD, age)"""
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
            nearby = ' '.join(lines[max(0, i):min(len(lines), i + 3)])
            # 兼容 "1710/0CT1978" 这种紧凑混杂格式
            m = re.search(r'\b(\d{2})[\s\d/.-]*([A-Z0-9]{3})[\s/.-]*(\d{4})\b', nearby)
            if m:
                dd, mm_str, yy = int(m.group(1)), m.group(2), int(m.group(3))
                mm = MONTH_MAP.get(mm_str)
                if mm:
                    try:
                        dob = date(yy, mm, dd)
                        today = date.today()
                        age = today.year - dob.year - ((today.month, today.day) < (dob.month, dob.day))
                        return dob.strftime('%Y%m%d'), age
                    except: pass
    return '', None

def extract_sex(text: str) -> str:
    """提取性别"""
    t = (text or '').upper()
    compact = re.sub(r'\s+', '', t).replace('(', '<')
    mrz = re.search(r'[A-Z0-9<]{9}\d[A-Z0-9<]{3}\d{6}\d([MF<])', compact)
    if mrz and mrz.group(1) in ('M', 'F'): return mrz.group(1)
    
    lines = [ln.strip() for ln in t.splitlines() if ln.strip()]
    for i, line in enumerate(lines):
        if 'BIRTH' in line or 'SEX' in line:
            # 向下寻找孤立的 M 或 F
            for j in range(i, min(len(lines), i + 4)):
                if lines[j] == 'M': return 'M'
                if lines[j] == 'F': return 'F'
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


# ==========================================
# 增强与防呆模块 (Fallback & Enhancements)
# ==========================================

def safe_load_image_with_exif(image_path: Path) -> np.ndarray:
    with Image.open(image_path) as img:
        normalized = ImageOps.exif_transpose(img)
        rgb = normalized.convert('RGB')
        arr = np.array(rgb)
    return cv2.cvtColor(arr, cv2.COLOR_RGB2BGR)

def fallback_extract_viz(text_lines: List[str]) -> Dict[str, str]:
    passport_number = ''
    full_name = ''

    # 1. 提取护照号
    for line in text_lines:
        if not line: continue
        tokens = re.findall(r'\b[A-Z0-9]{8,10}\b', line.upper())
        for token in tokens:
            # 要求必须含数字，且不能包含月份
            if any(c.isdigit() for c in token) and not any(month in token for month in MONTH_BLACKLIST):
                passport_number = token
                break
        if passport_number: break

    # 2. 提取姓名
    name_candidates: List[str] = []
    for orig_line in text_lines:
        if not orig_line or len(orig_line) < 3: continue
        if re.search(r'[a-z]', orig_line): continue
        if '<' in orig_line: continue
            
        line_upper = orig_line.upper()
        words = [re.sub(r'[^A-Z]', '', w) for w in line_upper.split()]
        words = [w for w in words if w]
        
        if not words: continue
        if any(word in NAME_BLACKLIST for word in words): continue
        if re.search(r'\d', orig_line): continue
            
        name_candidates.append(' '.join(words))

    if name_candidates:
        full_name = sorted(name_candidates, key=len, reverse=True)[0]

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

        # 执行严苛的 VIZ Fallback 并智能合并
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
