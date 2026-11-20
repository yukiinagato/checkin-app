'use strict';

const { spawn } = require('child_process');
const crypto = require('crypto');

const RESTART_DELAY_MS = 2000;
const REQUEST_TIMEOUT_MS = 120000;

// 常驻 Python OCR worker 池：模型只在 worker 启动时加载一次，
// 每个 worker 同一时刻只处理一个任务；worker 崩溃自动重启并使当前任务失败。
const createOcrWorkerPool = ({ pythonPath, workerScript, size, env, cwd, logger }) => {
  const workers = [];
  const queue = [];
  let stopped = false;

  const dispatch = () => {
    if (stopped) return;
    const idle = workers.find((w) => w.ready && !w.current);
    if (!idle || queue.length === 0) return;
    const job = queue.shift();
    idle.current = job;
    job.timer = setTimeout(() => {
      logger.error({ worker: idle.id }, 'ocr worker request timed out, restarting worker');
      idle.child.kill('SIGKILL'); // close 处理器会 fail 当前任务并重启
    }, REQUEST_TIMEOUT_MS);
    idle.child.stdin.write(`${JSON.stringify({ id: job.id, imagePath: job.imagePath })}\n`);
  };

  const failJob = (job, message) => {
    if (!job) return;
    clearTimeout(job.timer);
    job.reject(new Error(message));
  };

  const startWorker = (slot) => {
    if (stopped) return;
    const child = spawn(pythonPath, [workerScript], { cwd, env });
    const worker = { id: slot, child, ready: false, current: null, buffer: '' };
    workers[slot] = worker;

    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      worker.buffer += chunk;
      const lines = worker.buffer.split('\n');
      worker.buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (msg.event === 'ready') {
          worker.ready = true;
          logger.info({ worker: slot }, 'ocr worker ready');
          dispatch();
        } else if (worker.current && msg.id === worker.current.id) {
          if (msg.event === 'progress') {
            worker.current.onProgress?.(msg.data);
          } else if (msg.event === 'result' || msg.event === 'error') {
            const job = worker.current;
            worker.current = null;
            clearTimeout(job.timer);
            if (msg.event === 'result') job.resolve(msg.data);
            else job.reject(new Error(msg.error || 'OCR worker error'));
            dispatch();
          }
        }
      }
    });

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => {
      const text = chunk.trim();
      if (text) logger.debug({ worker: slot, stderr: text.slice(0, 500) }, 'ocr worker stderr');
    });

    child.on('error', (err) => {
      logger.error({ worker: slot, err: err.message }, 'ocr worker spawn failed');
    });

    child.on('close', (code) => {
      const job = worker.current;
      worker.current = null;
      worker.ready = false;
      failJob(job, `OCR worker exited (code ${code})`);
      if (!stopped) {
        logger.warn({ worker: slot, code }, 'ocr worker exited, restarting');
        setTimeout(() => startWorker(slot), RESTART_DELAY_MS).unref();
      }
    });
  };

  for (let i = 0; i < size; i += 1) startWorker(i);

  return {
    run: (imagePath, onProgress) => new Promise((resolve, reject) => {
      if (stopped) {
        reject(new Error('OCR worker pool stopped'));
        return;
      }
      queue.push({ id: crypto.randomUUID(), imagePath, onProgress, resolve, reject, timer: null });
      dispatch();
    }),
    isReady: () => workers.some((w) => w?.ready),
    stop: () => {
      stopped = true;
      for (const worker of workers) {
        if (!worker) continue;
        failJob(worker.current, 'OCR worker pool stopped');
        worker.current = null;
        worker.child.kill();
      }
      while (queue.length) failJob(queue.shift(), 'OCR worker pool stopped');
    }
  };
};

module.exports = { createOcrWorkerPool };
