#!/usr/bin/env python3
import json
import os
import re
import sys
import logging
from datetime import date, datetime
from pathlib import Path
from typing import List, Dict, Optional, Tuple

PROJECT_SERVER_DIR = Path(__file__).resolve().parents[1]

def _set_project_cache_env(name: str, default_dir: str) -> None:
    raw = os.environ.get(name) or default_dir
    resolved = Path(raw)
    if not resolved.is_absolute():
        resolved = PROJECT_SERVER_DIR / resolved
    os.environ[name] = str(resolved)

_set_project_cache_env('PADDLEOCR_HOME', '.ocr-models')
_set_project_cache_env('XDG_CACHE_HOME', '.cache')
_set_project_cache_env('PADDLE_HOME', '.paddle')
_set_project_cache_env('PYTHONPYCACHEPREFIX', '.cache/pycache')
_ocr_home = Path(os.environ.get('CHECKIN_OCR_HOME') or '.cache/home')
if not _ocr_home.is_absolute():
    _ocr_home = PROJECT_SERVER_DIR / _ocr_home
os.environ['HOME'] = str(_ocr_home)

try:
    import pillow_avif  # noqa: F401 - registers AVIF support in Pillow
except Exception:
    pillow_avif = None

import cv2
import numpy as np
from PIL import Image, ImageOps

# 强制设置输出编码为 UTF-8
if sys.stdout.encoding != 'utf-8':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

# ==========================================
# 常量与配置
# ==========================================

# 识别前把图片降采样到的最长边。手机直出照片是 4032px，全尺寸推理要 20s+，
# 默认保留到 1600px；受损机读码会按检测坐标局部放大重试。设 0 关闭降采样。
OCR_MAX_IMAGE_SIDE = int(os.environ.get('OCR_MAX_IMAGE_SIDE') or 1600)

# onnxruntime 线程数。默认 -1（用满所有核）对这种小模型是灾难：32 核时
# 线程同步开销让单轮推理 9s，限到 8 线程只要 2s。
OCR_INTRA_OP_THREADS = int(os.environ.get('OCR_INTRA_OP_THREADS') or 8)

def create_engine():
    from rapidocr_onnxruntime import RapidOCR
    return RapidOCR(intra_op_num_threads=OCR_INTRA_OP_THREADS)

# 四个旋转角度依次尝试；EXIF 校正后绝大多数照片在 0 度就能命中，
# 命中后提前退出可省掉剩余 3 次推理。
ROTATIONS = (0, 90, 180, 270)

def emit_progress(stage: str, **fields) -> None:
    """向 stderr 输出一行进度事件，供 Node 端转发给前端。

    走 stderr 是为了和 stdout 上的最终 JSON 结果分流，互不干扰。
    """
    payload = {'stage': stage, **fields}
    try:
        sys.stderr.write('@@PROGRESS@@ ' + json.dumps(payload, ensure_ascii=False) + '\n')
        sys.stderr.flush()
    except Exception:
        pass  # 进度上报是尽力而为，不能影响识别本身

from passport_parser import parse_passport

def _score_ocr_data(data: Dict) -> float:
    weights = {'confirmed': 30, 'checked': 20, 'review': 8, 'missing': 0}
    return ((100 if data.get('isPassport') else 0)
            + sum(weights[v['status']] for v in data.get('fieldEvidence', {}).values())
            - len(data.get('warnings', [])))


def _rapidocr_blocks_for_image(engine, image: Image.Image) -> List[Dict]:
    img_bgr = cv2.cvtColor(np.array(image.convert('RGB')), cv2.COLOR_RGB2BGR)
    result, _ = engine(img_bgr)
    return [{'text': str(row[1]), 'box': np.asarray(row[0]).tolist(),
             'score': float(row[2]) if len(row) > 2 else None}
            for row in (result or []) if row and len(row) >= 2 and row[1]]


def _mrz_retry(engine, image, blocks):
    # Use detected positions, not a fixed bottom strip: screenshots may include
    # browser chrome below the passport. A retry is limited to the MRZ region.
    anchors = [b for b in blocks if '<<' in b['text'] and len(b['text']) >= 25]
    if not anchors:
        return None
    anchor = max(anchors, key=lambda b: max(p[1] for p in b['box']))
    top = min(p[1] for p in anchor['box'])
    height = max(p[1] for p in anchor['box']) - top
    selected = [b for b in blocks if len(re.sub(r'\s', '', b['text'])) >= 30
                and top - height <= min(p[1] for p in b['box']) <= top + height * 4]
    if not selected:
        return None
    points = [p for b in selected for p in b['box']]
    bounds = (max(0, int(min(p[0] for p in points)) - 12),
              max(0, int(min(p[1] for p in points)) - 12),
              min(image.width, int(max(p[0] for p in points)) + 12),
              min(image.height, int(max(p[1] for p in points)) + 12))
    crop = image.crop(bounds)
    crop = crop.resize((crop.width * 2, crop.height * 2), Image.Resampling.LANCZOS)
    retry = _rapidocr_blocks_for_image(engine, crop)
    if not retry:
        return None
    # Restore coordinates into the oriented original image.
    for block in retry:
        block['box'] = [[x / 2 + bounds[0], y / 2 + bounds[1]] for x, y in block['box']]
    return [b for b in blocks if b not in selected] + retry


def _rapidocr_result_for_image(engine, image: Image.Image):
    img_bgr = cv2.cvtColor(np.array(image.convert('RGB')), cv2.COLOR_RGB2BGR)
    result, _ = engine(img_bgr)
    if not result:
        return [], []
    rows = [row for row in result if row and len(row) >= 2 and row[1]]
    return [str(row[1]) for row in rows], rows

def _rapidocr_lines_for_image(engine, image: Image.Image) -> List[str]:
    return _rapidocr_result_for_image(engine, image)[0]

def _analyze_mrz_geometry(rows):
    """从 MRZ 文本框几何判断证件的视觉方向。

    RapidOCR 自带文字方向分类，横躺的照片在 0 度也能识别成功，
    因此「识别胜出的旋转角度」不等于视觉方向。这里检查 MRZ 行的
    检测框：竖排（高>宽）说明证件转了 ±90°；横排时再用 TD3 结构
    （P 开头的姓名行应在数据行上方）识别 180° 倒置。

    返回 (found, horizontal, inverted)。
    """
    boxes = []
    for row in rows or []:
        box, text = row[0], str(row[1])
        clean = re.sub(r'[^A-Z0-9<]', '', text.upper())
        if len(clean) >= 25 and '<' in clean:
            xs = [p[0] for p in box]
            ys = [p[1] for p in box]
            boxes.append((clean, min(xs), max(xs), min(ys), max(ys)))
    if not boxes:
        return False, True, False

    horizontal = all((x2 - x1) >= (y2 - y1) for _, x1, x2, y1, y2 in boxes)
    inverted = False
    if horizontal and len(boxes) >= 2:
        p_line = next((b for b in boxes if b[0].startswith('P')), None)
        if p_line:
            other = next((b for b in boxes if b is not p_line), None)
            if other:
                inverted = (p_line[3] + p_line[4]) / 2 > (other[3] + other[4]) / 2
    return True, horizontal, inverted

PROBE_MAX_SIDE = 640

def probe_orientation(engine, image: Image.Image) -> int:
    """用低分辨率 det-only 快速猜测证件方向（0 或 90），供全量识别定起始角度。

    只跑文本检测（~0.6s），看长条文本框的走向：证件上的 MRZ / 字段行
    都是细长条，竖排占多数说明照片横躺。90 与 270 的歧义交给全量识别
    里的倒置几何修正（_analyze_mrz_geometry），猜错也只是同一轮内修正。
    """
    try:
        ratio = PROBE_MAX_SIDE / max(image.size)
        small = image.resize(
            (max(1, round(image.width * ratio)), max(1, round(image.height * ratio))),
            Image.BILINEAR
        ) if ratio < 1 else image
        img_bgr = cv2.cvtColor(np.array(small.convert('RGB')), cv2.COLOR_RGB2BGR)
        boxes, _ = engine(img_bgr, use_det=True, use_cls=False, use_rec=False)
        vertical = horizontal = 0
        for box in boxes or []:
            xs = [p[0] for p in box]
            ys = [p[1] for p in box]
            w, h = max(xs) - min(xs), max(ys) - min(ys)
            if max(w, h) < 4 * min(w, h):
                continue  # 接近方形的框不含方向信息
            if h > w:
                vertical += 1
            else:
                horizontal += 1
        return 90 if vertical > horizontal else 0
    except Exception:
        return 0  # 探测失败不影响主流程

def downscale_for_ocr(image: Image.Image) -> Image.Image:
    """按最长边等比缩小，仅用于识别；落盘保存的原图不受影响。"""
    if not OCR_MAX_IMAGE_SIDE:
        return image
    longest = max(image.size)
    if longest <= OCR_MAX_IMAGE_SIDE:
        return image
    ratio = OCR_MAX_IMAGE_SIDE / longest
    return image.resize(
        (max(1, round(image.width * ratio)), max(1, round(image.height * ratio))),
        Image.LANCZOS
    )

def run_rapidocr(image_path: Path, engine=None):
    if engine is None:
        emit_progress('loading')
        engine = create_engine()
    with Image.open(image_path) as img:
        base = ImageOps.exif_transpose(img).convert('RGB')
    original_size = base.size
    base = downscale_for_ocr(base)
    emit_progress('compressed', originalWidth=original_size[0], originalHeight=original_size[1],
                  width=base.width, height=base.height)
    guess = probe_orientation(engine, base)
    rotations = [guess] + [d for d in ROTATIONS if d != guess]
    best = ({}, [], -1, 0)
    best_blocks, best_image, best_bonus = [], None, 0
    for index, degrees in enumerate(rotations):
        emit_progress('recognizing', **{'pass': index + 1, 'totalPasses': len(rotations), 'rotation': degrees})
        image = base.rotate(degrees, expand=True) if degrees else base
        blocks = _rapidocr_blocks_for_image(engine, image)
        lines = [b['text'] for b in blocks]
        final = parse_passport(lines)
        rows = [[b['box'], b['text'], b['score']] for b in blocks]
        found, horizontal, inverted = _analyze_mrz_geometry(rows)
        effective_rotation = (degrees + 180) % 360 if found and horizontal and inverted else degrees
        final.update(rotation=effective_rotation, preprocessing='original')
        bonus = 15 if found and horizontal else 0
        score = _score_ocr_data(final) + bonus
        if score > best[2]:
            best = (final, lines, score, effective_rotation)
            best_blocks, best_image, best_bonus = blocks, image, bonus
        if final['success'] and (not found or horizontal):
            emit_progress('matched', rotation=effective_rotation, passesUsed=index + 1)
            break
    if best[0].get('isPassport') and best[0].get('needsReview'):
        emit_progress('recognizing', **{'pass': len(rotations) + 1, 'totalPasses': len(rotations) + 1,
                                       'rotation': best[3], 'region': 'mrz'})
        try:
            retry = _mrz_retry(engine, best_image, best_blocks)
        except Exception:
            logging.getLogger(__name__).warning('Optional MRZ retry failed')
            retry = None
        if retry:
            lines = [b['text'] for b in retry]
            final = parse_passport(lines)
            final.update(rotation=best[3], preprocessing='mrz_crop_2x')
            score = _score_ocr_data(final) + best_bonus
            if score > best[2]:
                best = (final, lines, score, best[3])
    return best


def format_result(final, chunks, rotation):
    return {**final, 'rotation': rotation, 'text': '\n'.join(chunks),
            'engine': 'rapidocr-onnxruntime-local', 'method': 'mrz_viz_crosscheck_multirotation'}


def main():
    if len(sys.argv) < 2:
        print(json.dumps({'success': False, 'error': 'No image path'}))
        return 1
    try:
        logging.getLogger('ppocr').setLevel(logging.ERROR)
        final, chunks, score, rotation = run_rapidocr(Path(sys.argv[1]))
        print(json.dumps(format_result(final, chunks, rotation), ensure_ascii=False))
        return 0
    except Exception as exc:
        print(json.dumps({'success': False, 'error': str(exc)}))
        return 3


if __name__ == '__main__':
    sys.exit(main())
