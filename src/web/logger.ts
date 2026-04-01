/**
 * Simple server logger — writes to terminal AND a log file.
 *
 * Usage:
 *   import { log } from './logger.js';
 *   log.info('server', 'Listening on port 3000');
 *   log.warn('free-tier', 'Blocked fp=abc ip=1.2.3.4');
 *   log.error('refine', 'LLM call failed', err);
 *
 * Log file: logs/server-YYYY-MM-DD.log (rotates daily)
 * Format:  2026-04-01T14:30:00.123Z [INFO] [refine] Message here
 */

import { appendFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const LOGS_DIR = join(__dirname, '..', '..', 'logs');

// Ensure logs directory exists
if (!existsSync(LOGS_DIR)) {
  mkdirSync(LOGS_DIR, { recursive: true });
}

type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

function getLogFile(): string {
  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return join(LOGS_DIR, `server-${date}.log`);
}

function formatMessage(level: LogLevel, tag: string, message: string, extra?: any): string {
  const ts = new Date().toISOString();
  const base = `${ts} [${level}] [${tag}] ${message}`;
  if (extra !== undefined) {
    const extraStr = extra instanceof Error
      ? `${extra.message}\n${extra.stack}`
      : (typeof extra === 'string' ? extra : JSON.stringify(extra, null, 2));
    return `${base}\n  ${extraStr}`;
  }
  return base;
}

function write(level: LogLevel, tag: string, message: string, extra?: any): void {
  const formatted = formatMessage(level, tag, message, extra);

  // Terminal (with color)
  switch (level) {
    case 'ERROR': console.error(`\x1b[31m${formatted}\x1b[0m`); break;
    case 'WARN':  console.warn(`\x1b[33m${formatted}\x1b[0m`); break;
    case 'DEBUG': console.debug(`\x1b[90m${formatted}\x1b[0m`); break;
    default:      console.log(formatted);
  }

  // File (no color codes)
  try {
    appendFileSync(getLogFile(), formatted + '\n');
  } catch {
    // Don't crash the server if logging fails
  }
}

export const log = {
  debug: (tag: string, message: string, extra?: any) => write('DEBUG', tag, message, extra),
  info:  (tag: string, message: string, extra?: any) => write('INFO', tag, message, extra),
  warn:  (tag: string, message: string, extra?: any) => write('WARN', tag, message, extra),
  error: (tag: string, message: string, extra?: any) => write('ERROR', tag, message, extra),
};
