'use strict';

const pino = require('pino');

const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  '*.passportPhoto',
  '*.password',
  '*.token',
  '*.sessionToken'
];

const createLogger = () => {
  const level = process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug');
  return pino({
    level,
    base: { pid: process.pid, service: 'checkin-app-server' },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: { paths: REDACT_PATHS, censor: '[REDACTED]' }
  });
};

module.exports = { createLogger };
