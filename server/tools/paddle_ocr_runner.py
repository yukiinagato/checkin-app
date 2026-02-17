#!/usr/bin/env python3
import json
import re
import sys
from pathlib import Path


def extract_passport_number(text: str) -> str:
    text = (text or '').upper()
    # MRZ-like line 2: passport number field is first 9 chars, followed by check digit
    lines = [re.sub(r'[^A-Z0-9<]', '', line) for line in text.splitlines()]
    for i in range(len(lines) - 1):
        l1, l2 = lines[i], lines[i + 1]
        if l1.startswith('P<') and len(l2) >= 10:
            num = l2[:9].replace('<', '')
            if 6 <= len(num) <= 9:
                return num
    m = re.search(r'PASSPORT\s*(NO|NUMBER)?\s*[:：]?\s*([A-Z0-9]{6,10})', text)
    return m.group(2) if m else ''


def is_likely_passport(text: str) -> bool:
    t = (text or '').upper()
    if 'PASSPORT' in t or '护照' in t or '護照' in t or '旅券' in t:
      return True
    if 'P<' in t and '<' in t:
      return True
    hints = ['NATIONALITY', 'SURNAME', 'GIVEN', 'DATE OF BIRTH', 'SEX']
    return sum(1 for h in hints if h in t) >= 2


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
        print(json.dumps({
            'success': bool(is_passport and passport_number),
            'isPassport': bool(is_passport),
            'passportNumber': passport_number,
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
