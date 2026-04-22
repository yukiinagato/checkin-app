#!/usr/bin/env python3
import json
import re
import sys
import logging
import time
from datetime import date, datetime
from pathlib import Path
from typing import List, Dict, Optional, Tuple

import cv2
import numpy as np
from PIL import Image, ImageOps
import requests

# 强制设置输出编码为 UTF-8
if sys.stdout.encoding != 'utf-8':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

# ==========================================
# 常量与配置
# ==========================================

MONTH_MAP = {
    'JAN': 1, 'FEB': 2, 'MAR': 3, 'APR': 4, 'MAY': 5, 'JUN': 6,
    'JUL': 7, 'AUG': 8, 'SEP': 9, 'OCT': 10, 'NOV': 11, 'DEC': 12,
    '0CT': 10, '1AN': 1, 'A0G': 8, '0EC': 12, '5EP': 9
}

VIZ_BLACKLIST = {
    'SIGNATURE', 'BEARER', 'MINISTRY', 'PASSPORT', 'REPUBLIC', 'KOREA',
    'DATE', 'SURNAME', 'GIVEN', 'NATIONALITY', 'BIRTH', 'AUTHORITY',
    'COUNTRY', 'NUMBER', 'SEX', 'TYPE', 'CODE', 'ISSUING', 'AFFAIRS', 
    'FOREIGN', 'NAMES', 'HONG', 'KONG', 'REGION', 'SPECIAL', 'ADMINISTRATIVE', 
    'PEOPLE', 'CHINA', 'IMMIGRATION', 'DEPARTMENT', 'STATE', 'OFFICE'
}

ISO3_TO_ISO2 = {
    'CHN': 'CN', 'JPN': 'JP', 'KOR': 'KR', 'USA': 'US', 'GBR': 'GB', 'CAN': 'CA',
    'AUS': 'AU', 'FRA': 'FR', 'DEU': 'DE', 'ITA': 'IT', 'ESP': 'ES', 'RUS': 'RU',
    'IND': 'IN', 'PHL': 'PH', 'VNM': 'VN', 'MYS': 'MY', 'THA': 'TH', 'IDN': 'ID',
    'SGP': 'SG', 'TWN': 'TW', 'HKG': 'HK', 'MAC': 'MO', 'CHE': 'CH'
}

DEFAULT_SYSTEM_PROMPT = (
    "你是一个证件解析专家。我会给你一段护照 OCR 原始文本，请你过滤掉无用的印刷体（如 AUTHORITY, SIGNATURE），"
    "提取以下字段：passportNumber, fullName (名在前姓在后), birthDate (YYYYMMDD), sex (M/F), "
    "nationalityCode (ISO 2位代码), expiryDate (YYYYMMDD)。请直接返回 JSON 格式，不要有任何多余描述。"
)

# ==========================================
# MRZ 工具函数 (位置敏感)
# ==========================================

def _mrz_val(ch: str) -> int:
    if ch in ('<', ' ', '(', '{'): return 0
    c = ch.upper()
    if c == 'O': c = '0'
    if c == 'I': c = '1'
    if c == 'Z': c = '2'
    if c.isdigit(): return int(c)
    if 'A' <= c <= 'Z': return ord(c) - 55
    return 0

def _mrz_check(val: str, expected: str) -> bool:
    if not expected.isdigit(): return False
    weights = (7, 3, 1)
    s = sum(_mrz_val(ch) * weights[i % 3] for i, ch in enumerate(val))
    return str(s % 10) == expected

# ==========================================
# 结构化解析引擎
# ==========================================

def parse_mrz_block(lines: List[str]) -> Optional[Dict]:
    """
    寻找并解析 TD3 标准的 44x2 MRZ 区域。
    这是最稳健的提取方式，基于 ICAO Doc 9303 位置标准。
    """
    # 预处理：提取所有看起来像 MRZ 的行（包含大量 < 或 长度接近 44）
    mrz_lines = []
    for ln in lines:
        clean = re.sub(r'[^A-Z0-9<]', '', ln.upper())
        if len(clean) >= 30: # 允许部分遮挡
            mrz_lines.append(clean)

    # 尝试寻找两行配对（通常第一行 P 开头，第二行以护照号开头）
    for i in range(len(mrz_lines)):
        l1 = mrz_lines[i]
        if not l1.startswith('P'): continue
        
        for j in range(len(mrz_lines)):
            if i == j: continue
            l2 = mrz_lines[j]
            
            # 校验护照号位置 (0-9位)
            pass_no = l2[0:9]
            pass_check = l2[9:10]
            if _mrz_check(pass_no, pass_check):
                # 这是一个高置信度的 MRZ 块
                data = {
                    'passportNumber': pass_no.replace('<', ''),
                    'nationalityCode': ISO3_TO_ISO2.get(_mrz_fix_iso(l2[10:13]), ''),
                    'sex': l2[20:21] if l2[20:21] in 'MF' else '',
                    'checksumValid': True
                }
                
                # 生日解析 (13-19位)
                dob_raw = l2[13:19]
                if _mrz_check(dob_raw, l2[19:20]):
                    yy, mm, dd = int(dob_raw[0:2]), int(dob_raw[2:4]), int(dob_raw[4:6])
                    year = 1900 + yy if yy > (date.today().year % 100) else 2000 + yy
                    try:
                        d = date(year, mm, dd)
                        data['birthDate'] = d.strftime('%Y%m%d')
                        data['age'] = date.today().year - d.year - ((date.today().month, date.today().day) < (d.month, d.day))
                    except: pass
                
                # 姓名解析 (Line 1: 5-44位)
                name_part = l1[5:]
                if '<<' in name_part:
                    parts = name_part.split('<<')
                    surname = parts[0].replace('<', ' ').strip()
                    given = parts[1].replace('<', ' ').strip()
                    data['fullName'] = f"{given} {surname}".strip()
                else:
                    data['fullName'] = name_part.replace('<', ' ').strip()
                
                return data
    return None

def _mrz_fix_iso(raw: str) -> str:
    return raw.replace('0', 'O').replace('1', 'I').replace('2', 'Z').replace('5', 'S')


def _normalize_date(value: str) -> str:
    raw = re.sub(r'[^0-9]', '', str(value or ''))
    if len(raw) == 8:
        return raw
    return ''


def _extract_json_payload(text: str) -> Optional[Dict]:
    if not text:
        return None
    stripped = text.strip()
    try:
        payload = json.loads(stripped)
        if isinstance(payload, dict):
            return payload
    except Exception:
        pass

    fenced = re.search(r'```(?:json)?\s*(\{[\s\S]*\})\s*```', stripped, re.IGNORECASE)
    if fenced:
        try:
            payload = json.loads(fenced.group(1))
            if isinstance(payload, dict):
                return payload
        except Exception:
            return None
    return None


def extract_with_llm(
    ocr_text: str,
    api_key: str,
    model: str,
    prompt: str,
    base_url: str = "https://api.openai.com/v1",
    max_retries: int = 4
) -> Optional[Dict]:
    """
    使用 OpenAI 兼容协议调用 LLM，对 OCR 原文进行语义化结构提取。
    带指数退避重试，处理超时/限流场景。
    """
    if not api_key or not model:
        return None

    endpoint = base_url.rstrip('/') + '/chat/completions'
    system_prompt = prompt or DEFAULT_SYSTEM_PROMPT
    user_prompt = (
        "请从以下护照 OCR 原始文本中提取字段并仅返回 JSON 对象：\n"
        "{\n"
        "  \"passportNumber\": \"\",\n"
        "  \"fullName\": \"\",\n"
        "  \"birthDate\": \"YYYYMMDD\",\n"
        "  \"sex\": \"M/F\",\n"
        "  \"nationalityCode\": \"ISO2\",\n"
        "  \"expiryDate\": \"YYYYMMDD\"\n"
        "}\n\n"
        f"OCR文本：\n{ocr_text}"
    )

    headers = {
        'Authorization': f'Bearer {api_key}',
        'Content-Type': 'application/json'
    }
    payload = {
        'model': model,
        'temperature': 0,
        'response_format': {'type': 'json_object'},
        'messages': [
            {'role': 'system', 'content': system_prompt},
            {'role': 'user', 'content': user_prompt}
        ]
    }

    for attempt in range(max_retries):
        try:
            response = requests.post(endpoint, headers=headers, json=payload, timeout=30)
            if response.status_code in (429, 500, 502, 503, 504):
                raise requests.HTTPError(f"{response.status_code}: {response.text}", response=response)
            response.raise_for_status()

            body = response.json()
            raw_content = body['choices'][0]['message']['content']
            parsed = _extract_json_payload(raw_content)
            if not parsed:
                return None

            return {
                'passportNumber': str(parsed.get('passportNumber', '')).strip().replace(' ', ''),
                'fullName': str(parsed.get('fullName', '')).strip(),
                'birthDate': _normalize_date(parsed.get('birthDate', '')),
                'sex': str(parsed.get('sex', '')).strip().upper()[:1] if str(parsed.get('sex', '')).strip().upper()[:1] in ('M', 'F') else '',
                'nationalityCode': str(parsed.get('nationalityCode', '')).strip().upper()[:2],
                'expiryDate': _normalize_date(parsed.get('expiryDate', ''))
            }
        except Exception:
            if attempt >= max_retries - 1:
                break
            backoff_s = min(8.0, (2 ** attempt) + 0.2)
            time.sleep(backoff_s)
    return None

# ==========================================
# VIZ 备选方案 (基于评分系统的鲁棒提取)
# ==========================================

def fallback_extract_viz(lines: List[str]) -> Dict:
    res = {'passportNumber': '', 'fullName': '', 'birthDate': '', 'age': None, 'sex': ''}
    text = '\n'.join(lines).upper()

    # 1. 护照号提取：寻找 8-10 位，包含数字，排除月份
    pass_candidates = []
    for ln in lines:
        tokens = re.findall(r'\b[A-Z0-9]{7,12}\b', ln.upper())
        for tk in tokens:
            if any(c.isdigit() for c in tk) and not any(m in tk for m in MONTH_MAP):
                # 评分：包含字母和数字的权重更高
                score = 10 if (re.search(r'[A-Z]', tk) and re.search(r'[0-9]', tk)) else 5
                pass_candidates.append((tk, score))
    
    if pass_candidates:
        res['passportNumber'] = sorted(pass_candidates, key=lambda x: x[1], reverse=True)[0][0]

    # 2. 姓名提取：基于排除法与结构得分
    name_candidates = []
    for i, ln in enumerate(lines):
        orig = ln.strip()
        if len(orig) < 3 or any(ch.islower() for ch in orig) or any(ch.isdigit() for ch in orig):
            continue
        
        words = orig.upper().replace('/', ' ').split()
        if any(w in VIZ_BLACKLIST for w in words): continue
        
        # 评分：多单词更有可能是姓名
        score = len(words) * 5 - (1 if len(orig) > 20 else 0)
        name_candidates.append((orig.replace('/', ' ').strip(), score))
    
    if name_candidates:
        res['fullName'] = sorted(name_candidates, key=lambda x: x[1], reverse=True)[0][0]

    # 3. 日期提取
    for ln in lines:
        # 匹配各种格式 03APR1972, 19.08.1998, 22JUL00
        m = re.search(r'(\d{2})[\s\./-]?([A-Z0-9]{3})[\s\./-]?(\d{2,4})', ln.upper())
        if m:
            dd, mm_str, yy_str = m.groups()
            mm = MONTH_MAP.get(mm_str)
            if mm:
                try:
                    yy = int(yy_str)
                    if yy < 100: yy += 2000 if yy <= (date.today().year % 100) else 1900
                    d = date(yy, mm, int(dd))
                    res['birthDate'] = d.strftime('%Y%m%d')
                    res['age'] = date.today().year - d.year - ((date.today().month, date.today().day) < (d.month, d.day))
                except: pass
        
        if not res['sex']:
            if re.search(r'\b[MF]\b', ln.upper()):
                res['sex'] = 'M' if 'M' in ln.upper() else 'F'

    return res

# ==========================================
# 主流程
# ==========================================

def main() -> int:
    if len(sys.argv) < 2:
        print(json.dumps({'success': False, 'error': 'No image path'}))
        return 1

    image_path = Path(sys.argv[1])
    api_key = sys.argv[2].strip() if len(sys.argv) > 2 else ''
    model_name = sys.argv[3].strip() if len(sys.argv) > 3 else ''
    system_prompt = sys.argv[4] if len(sys.argv) > 4 else DEFAULT_SYSTEM_PROMPT
    base_url = sys.argv[5].strip() if len(sys.argv) > 5 and sys.argv[5].strip() else 'https://api.openai.com/v1'
    try:
        logging.getLogger("ppocr").setLevel(logging.ERROR)
        from paddleocr import PaddleOCR
        
        # 提升检测极限边长，确保大图中细小的 MRZ 也能被看清
        ocr = PaddleOCR(use_angle_cls=True, lang='en', show_log=False, det_limit_side_len=1920, det_db_unclip_ratio=2.2)
        
        with Image.open(image_path) as img:
            img = ImageOps.exif_transpose(img)
            img_bgr = cv2.cvtColor(np.array(img.convert('RGB')), cv2.COLOR_RGB2BGR)
        
        result = ocr.ocr(img_bgr, cls=True)
        chunks = [str(row[1][0]) for page in result for row in page if row and row[1]] if result else []
        
        # 1. 结构化 MRZ 解析 (Golden Source)
        mrz_data = parse_mrz_block(chunks)
        
        # 2. VIZ 提取 (备选/补全)
        viz_data = fallback_extract_viz(chunks)
        
        # 3. LLM 语义提取（MRZ失败时兜底；MRZ成功时做 VIZ 校验和补全）
        llm_data = extract_with_llm('\n'.join(chunks), api_key, model_name, system_prompt, base_url)
        
        # 4. 智能合并：MRZ 优先，LLM 与 VIZ 补全
        final = mrz_data if mrz_data else {}
        for key in ['passportNumber', 'fullName', 'birthDate', 'sex', 'nationalityCode', 'expiryDate']:
            if not final.get(key) and llm_data and llm_data.get(key):
                final[key] = llm_data.get(key)

        for key in ['passportNumber', 'fullName', 'birthDate', 'age', 'sex', 'nationalityCode']:
            if not final.get(key) and viz_data.get(key):
                final[key] = viz_data.get(key)

        if final.get('birthDate') and not final.get('age'):
            try:
                d = datetime.strptime(final['birthDate'], '%Y%m%d').date()
                final['age'] = date.today().year - d.year - ((date.today().month, date.today().day) < (d.month, d.day))
            except Exception:
                pass

        print(json.dumps({
            'success': bool(final.get('passportNumber')),
            'isPassport': True,
            'passportNumber': final.get('passportNumber', ''),
            'fullName': final.get('fullName', ''),
            'birthDate': final.get('birthDate', ''),
            'age': final.get('age'),
            'sex': final.get('sex', ''),
            'nationalityCode': final.get('nationalityCode', ''),
            'expiryDate': final.get('expiryDate', ''),
            'text': '\n'.join(chunks),
            'engine': 'paddleocr-python-local',
            'method': 'mrz_structural+llm' if mrz_data and llm_data else ('llm' if llm_data else ('mrz_structural' if mrz_data else 'viz_fallback')),
            'llmUsed': bool(llm_data),
            'goldenSource': 'mrz_structural' if mrz_data else 'llm_or_viz'
        }, ensure_ascii=False))
        return 0
    except Exception as exc:
        print(json.dumps({'success': False, 'error': str(exc)}))
        return 3

if __name__ == '__main__':
    sys.exit(main())
