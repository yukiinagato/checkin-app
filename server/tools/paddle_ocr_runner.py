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

# 全局黑名单定义（加入了 0CT, 1AN 等 OCR 常见拼写错误，防患未然）
MONTH_BLACKLIST = {'JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC', '0CT', '1AN', 'A0G', '0EC', '5EP'}
NAME_BLACKLIST = {
    'SIGNATURE', 'BEARER', 'MINISTRY', 'PASSPORT', 'REPUBLIC', 'KOREA',
    'DATE', 'SURNAME', 'GIVEN', 'NATIONALITY', 'BIRTH', 'AUTHORITY',
    'COUNTRY', 'NUMBER', 'SEX', 'TYPE', 'CODE', 'ISSUING', 'AFFAIRS', 'FOREIGN', 'NAMES'
}

def _mrz_char_value(ch: str) -> int:
    if ch in ('<', '(', '{', '[', '«'):
        return 0
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
            if 6 <= len(num) <= 10:
                return num

    # 2) 结构化 MRZ 滑动窗口解析 
    # 核心修复：严禁在短文本上运行滑动窗口（防止日期发生巧合校验通过）。必须是疑似 MRZ 行（>= 28字符）
    lines = [re.sub(r'[^A-Z0-9<]', '', line) for line in text.splitlines() if line.strip()]
    for l in lines:
        if len(l) >= 28:
            for j in range(len(l) - 9):
                field = l[j:j+9]
                check_digit = l[j+9]
                if check_digit.isdigit() and _mrz_check_digit(field) == check_digit:
                    num = field.replace('<', '')
                    if 6 <= len(num) <= 10:
                        return num

    # 3) 关键字匹配
    labeled = re.search(r'PASSPORT\s*(NO|NUMBER)?[\s:#/\\\-]*([A-Z0-9]{6,10})', text)
    if labeled:
        return labeled.group(2)

    return ''

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
    compact = re.sub(r'\s+', '', t).replace('(', '<')
    
    # 核心修复：放宽 MRZ 提取正则，兼容 PMKOR 这类特殊护照类型
    mrz_name = re.search(r'P[A-Z<]{4}([A-Z<]+)<<([A-Z<]+)', compact)
    if mrz_name:
        surname = mrz_name.group(1).replace('<', ' ').strip()
        given = mrz_name.group(2).replace('<', ' ').strip()
        return f"{given} {surname}".strip()

    # Fallback to Text
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
            # 核心修复：要求候选字符串中必须含有数字，避免纯英文单词如 "REPUBLIC" 抢占位置
            if any(c.isdigit() for c in token) and not any(month in token for month in MONTH_BLACKLIST):
                passport_number = token
                break
        if passport_number:
            break

    # 2. 提取姓名
    name_candidates: List[str] = []
    for orig_line in text_lines:
        # 放宽长度至 3，允许短名字
        if not orig_line or len(orig_line) < 3:
            continue
        if re.search(r'[a-z]', orig_line):
            continue
            
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
        age = extract_age(text)
        nationality_code, nationality_raw = extract_nationality(text)

        # 核心修改：无条件执行严苛的 VIZ Fallback 并智能合并，确保绝不漏掉正确信息
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
