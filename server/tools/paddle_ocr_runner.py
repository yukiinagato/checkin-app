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

# 強制設置輸出編碼為 UTF-8，防止 Node.js 在讀取非 ASCII 字元時崩潰
if sys.stdout.encoding != 'utf-8':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

# 全局容錯月份映射表（處理 OCR 常見錯誤，如 0CT, 1AN）
MONTH_MAP = {
    'JAN': 1, 'FEB': 2, 'MAR': 3, 'APR': 4, 'MAY': 5, 'JUN': 6,
    'JUL': 7, 'AUG': 8, 'SEP': 9, 'OCT': 10, 'NOV': 11, 'DEC': 12,
    '0CT': 10, '1AN': 1, 'A0G': 8, '0EC': 12, '5EP': 9, 'J4N': 1
}
MONTH_BLACKLIST = set(MONTH_MAP.keys())

# VIZ 提取黑名單 - 排除護照上的固定標籤與機構名稱
VIZ_NAME_BLACKLIST = {
    'SIGNATURE', 'BEARER', 'MINISTRY', 'PASSPORT', 'REPUBLIC', 'KOREA',
    'DATE', 'SURNAME', 'GIVEN', 'NATIONALITY', 'BIRTH', 'AUTHORITY',
    'COUNTRY', 'NUMBER', 'SEX', 'TYPE', 'CODE', 'ISSUING', 'AFFAIRS', 
    'FOREIGN', 'NAMES', 'KOR', 'CHN', 'JPN', 'USA', 'GBR', 'HONG', 'KONG',
    'REGION', 'SPECIAL', 'ADMINISTRATIVE', 'PEOPLE', 'CHINA', 'IMMIGRATION',
    'DEPARTMENT', 'STATE', 'OFFICE', 'GOVERNMENT', 'HKSAR'
}

# ==========================================
# MRZ 基礎校驗工具
# ==========================================

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

# ==========================================
# 核心 MRZ 解析模組 (最高優先級)
# ==========================================

def extract_passport_number_mrz(text: str) -> str:
    """嚴格從機讀碼區域提取護照號。"""
    text = (text or '').upper().replace('(', '<').replace('{', '<')
    compact = re.sub(r'\s+', '', text)
    
    # 標準 TD3 MRZ 第二行格式
    m_td3 = re.search(r'([A-Z0-9<]{9})(\d)[A-Z0-9<]{3}', compact)
    if m_td3:
        field, check = m_td3.group(1), m_td3.group(2)
        if _mrz_check_digit(field) == check:
            return field.replace('<', '')

    # 針對殘缺行的滑動窗口校驗
    lines = [re.sub(r'[^A-Z0-9<]', '', ln) for ln in text.splitlines() if len(ln) >= 28]
    for l in lines:
        for j in range(len(l) - 9):
            field, check = l[j:j+9], l[j+9]
            if check.isdigit() and _mrz_check_digit(field) == check:
                num = field.replace('<', '')
                if 7 <= len(num) <= 9: return num
    return ''

def extract_name_mrz(text: str) -> str:
    """嚴格從機讀碼第一行提取姓名。"""
    lines = [ln.upper().replace(' ', '').replace('(', '<') for ln in text.splitlines()]
    for line in lines:
        m = re.search(r'P[A-Z<]{4}([A-Z<]+?)<<([A-Z<]+)', line)
        if m:
            surname = m.group(1).replace('<', ' ').strip()
            given_part = m.group(2).split('<<')[0]
            given = given_part.replace('<', ' ').strip()
            return f"{given} {surname}".strip()
    return ''

def extract_dob_sex_mrz(text: str):
    """從機讀碼提取出生日期與性別。"""
    compact = re.sub(r'\s+', '', (text or '').upper()).replace('(', '<')
    m = re.search(r'[A-Z0-9<]{9}\d[A-Z0-9<]{3}(\d{6})(\d)([MF<])(\d{6})', compact)
    if m:
        dob_raw, dob_check, sex, expiry = m.groups()
        if _mrz_check_digit(dob_raw) == dob_check:
            yy, mm, dd = int(dob_raw[0:2]), int(dob_raw[2:4]), int(dob_raw[4:6])
            year = 1900 + yy if yy > (date.today().year % 100) else 2000 + yy
            try:
                dob = date(year, mm, dd)
                today = date.today()
                age = today.year - dob.year - ((today.month, today.day) < (dob.month, dob.day))
                return dob.strftime('%Y%m%d'), age, (sex if sex in 'MF' else '')
            except: pass
    return '', None, ''

# ==========================================
# VIZ 可視區解析模組 (次要補全)
# ==========================================

def _parse_viz_date(token: str):
    """解析 VIZ 區域常見的日期格式 (如 22JUL00 或 22JUL2000)。"""
    token = token.upper().replace('O', '0').replace(' ', '')
    # 匹配 DDMMMYY 或 DDMMMYYYY
    m = re.match(r'^(\d{2})([A-Z0-9]{3})(\d{2,4})$', token)
    if m:
        dd, mm_str, yy_str = int(m.group(1)), m.group(2), m.group(3)
        mm = MONTH_MAP.get(mm_str)
        if mm:
            try:
                year = int(yy_str)
                if len(yy_str) == 2:
                    curr_yy = date.today().year % 100
                    year += 2000 if year <= curr_yy else 1900
                return date(year, mm, dd)
            except: pass
    return None

def fallback_extract_viz_all(text_lines: List[str]) -> Dict:
    """
    當 MRZ 缺失或不完整時的備用提取器。
    包含關鍵字過濾與黑名單防禦。
    """
    res = {'passportNumber': '', 'fullName': '', 'birthDate': '', 'age': None, 'sex': ''}
    
    # 1. 護照號與日期備選
    for i, line in enumerate(text_lines):
        ln = line.upper()
        # 護照號
        if not res['passportNumber']:
            tokens = re.findall(r'\b[A-Z0-9]{8,10}\b', ln)
            for tk in tokens:
                if any(c.isdigit() for c in tk) and not any(m in tk for m in MONTH_BLACKLIST):
                    res['passportNumber'] = tk; break

        # 出生日期 (針對 22JUL00 這種格式)
        if not res['birthDate'] and ('BIRTH' in ln or 'BIH' in ln):
            # 搜索附近 5 行
            nearby = ' '.join(text_lines[max(0, i):min(len(text_lines), i+6)]).upper()
            dates = re.findall(r'(\d{2}[A-Z0-9]{3}\d{2,4})', nearby)
            for d_str in dates:
                dob = _parse_viz_date(d_str)
                if dob:
                    res['birthDate'] = dob.strftime('%Y%m%d')
                    today = date.today()
                    res['age'] = today.year - dob.year - ((today.month, today.day) < (dob.month, dob.day))
                    break

        # 性別備選
        if not res['sex'] and ('SEX' in ln or 'SEX' in line.upper()):
            for j in range(i, min(len(text_lines), i + 5)):
                char = text_lines[j].strip().upper()
                if char in ('M', 'F'): res['sex'] = char; break
                if re.search(r'\bM\b', char): res['sex'] = 'M'; break
                if re.search(r'\bF\b', char): res['sex'] = 'F'; break

    # 2. 姓名備選
    name_cands = []
    for i, line in enumerate(text_lines):
        ln = line.upper()
        if any(k in ln for k in ['SURNAME', 'GIVEN NAMES', 'NAME']):
            for j in range(i + 1, min(len(text_lines), i + 4)):
                cand = re.sub(r'^[/]+', '', text_lines[j].upper())
                cand = re.sub(r'[^A-Z\s]', '', cand).strip()
                # 過濾黑名單，且長度合理（避免把整個機構名稱當作名字）
                if 3 < len(cand) < 30 and not any(w in VIZ_NAME_BLACKLIST for w in cand.split()):
                    name_cands.append(cand)
    
    if name_cands:
        name_cands.sort(key=lambda x: (2 <= len(x.split()) <= 3, len(x)), reverse=True)
        res['fullName'] = name_cands[0]

    # 性別最後兜底：全局搜索獨立的 M/F
    if not res['sex']:
        for ln in text_lines:
            if ln.strip().upper() in ('M', 'F'): res['sex'] = ln.strip().upper(); break

    return res

def main() -> int:
    if len(sys.argv) < 2:
        print(json.dumps({'success': False, 'error': 'No image path'}))
        return 1

    image_path = Path(sys.argv[1])
    try:
        logging.getLogger("ppocr").setLevel(logging.ERROR)
        from paddleocr import PaddleOCR
        ocr = PaddleOCR(use_angle_cls=True, lang='en', show_log=False, det_limit_side_len=1920, det_db_unclip_ratio=2.0)
        
        with Image.open(image_path) as img:
            img = ImageOps.exif_transpose(img)
            image_bgr = cv2.cvtColor(np.array(img.convert('RGB')), cv2.COLOR_RGB2BGR)
        
        result = ocr.ocr(image_bgr, cls=True)
        chunks = [str(row[1][0]) for page in result for row in page if row and row[1]] if result else []
        text = '\n'.join(chunks)

        # 1. 優先從 MRZ 提取 (Golden Source)
        passport_number = extract_passport_number_mrz(text)
        full_name = extract_name_mrz(text)
        birthDate, age, sex = extract_dob_sex_mrz(text)

        # 2. 只有當 MRZ 缺失時，才執行 VIZ 備選提取
        viz = fallback_extract_viz_all(chunks)
        
        if not passport_number: passport_number = viz['passportNumber']
        if not full_name: full_name = viz['fullName']
        if not birthDate: birthDate = viz['birthDate']
        if not age: age = viz['age']
        if not sex: sex = viz['sex']

        # 只要護照號拿到了就算成功
        print(json.dumps({
            'success': bool(passport_number),
            'isPassport': True,
            'passportNumber': passport_number,
            'fullName': full_name,
            'birthDate': birthDate,
            'age': age,
            'sex': sex,
            'nationalityCode': 'CN' if 'CHN' in text.upper() else '',
            'text': text,
            'engine': 'paddleocr-python-local'
        }, ensure_ascii=False))
        return 0
    except Exception as exc:
        print(json.dumps({'success': False, 'error': str(exc)}))
        return 3

if __name__ == '__main__':
    sys.exit(main())
