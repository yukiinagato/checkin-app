#!/usr/bin/env python3
"""常驻 OCR worker：模型只加载一次，按行读取任务、按行输出结果。

协议（stdout，均为单行 JSON）：
  启动完成      {"event": "ready"}
  识别进度      {"event": "progress", "id": <任务id>, "data": {stage 事件}}
  识别结果      {"event": "result",   "id": <任务id>, "data": {识别 JSON}}
  任务级错误    {"event": "error",    "id": <任务id>, "error": "..."}

stdin 每行一个任务：{"id": "...", "imagePath": "..."}
日志走 stderr。由 Node 侧 ocrWorkerPool 管理生命周期。
"""
import json
import sys
import logging
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import paddle_ocr_runner as runner

def emit(obj) -> None:
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + '\n')
    sys.stdout.flush()

def main() -> int:
    logging.getLogger('ppocr').setLevel(logging.ERROR)
    from PIL import Image

    engine = runner.create_engine()
    # 吃掉 onnxruntime 首次推理的预热开销（实测冷推理比温推理慢约一倍）
    warmup = Image.new('RGB', (320, 240), 'white')
    try:
        runner._rapidocr_result_for_image(engine, warmup)
    except Exception as exc:
        print(f'warmup failed: {exc}', file=sys.stderr)

    emit({'event': 'ready'})

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            task = json.loads(line)
        except json.JSONDecodeError:
            print(f'bad task line: {line[:200]}', file=sys.stderr)
            continue

        task_id = task.get('id')
        image_path = Path(task.get('imagePath', ''))

        # 把 runner 的进度上报重定向到本任务的 stdout 事件
        runner.emit_progress = lambda stage, **fields: emit(
            {'event': 'progress', 'id': task_id, 'data': {'stage': stage, **fields}}
        )

        try:
            final, chunks, score, rotation = runner.run_rapidocr(image_path, engine=engine)
            emit({'event': 'result', 'id': task_id, 'data': runner.format_result(final, chunks, rotation)})
        except Exception as exc:
            emit({'event': 'error', 'id': task_id, 'error': str(exc)})

    return 0

if __name__ == '__main__':
    sys.exit(main())
