// Journalisation sur la sortie standard (journald sous systemd, décision D8), avec les niveaux de
// LOG_MIN_LEVEL (winston 2 : error, warn, info, verbose, debug, silly) et COLOR_LOGS.
// Code d'origine : legacy/lib/logger.js (winston 2.4, horodatage `YYYY-MM-DD HH:mm:ss:SSS`, erreurs sur stderr).
import type { LoggerService } from '@nestjs/common';
import { inspect } from 'node:util';

const LEVELS = ['error', 'warn', 'info', 'verbose', 'debug', 'silly'] as const;
export type LogLevel = (typeof LEVELS)[number];

const COLORS: Record<LogLevel, string> = { error: '31', warn: '33', info: '32', verbose: '36', debug: '34', silly: '35' };

const pad = (n: number, width = 2): string => String(n).padStart(width, '0');
const timestamp = (d = new Date()) =>
  `${String(d.getFullYear())}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}:${pad(d.getMilliseconds(), 3)}`;

const format = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.stack ?? value.message;
  return inspect(value, { depth: 5, breakLength: 120 });
};

export class Logger implements LoggerService {
  private readonly max: number;

  constructor(level = 'info', private readonly color = false) {
    const index = LEVELS.indexOf(level as LogLevel);
    this.max = index < 0 ? LEVELS.indexOf('info') : index;
  }

  enabled(level: LogLevel): boolean {
    return LEVELS.indexOf(level) <= this.max;
  }

  private write(level: LogLevel, values: unknown[]): void {
    if (!this.enabled(level)) return;
    const label = this.color ? `\u001b[${COLORS[level]}m${level}\u001b[39m` : level;
    const line = `${timestamp()} - ${label}: ${values.map(format).join(' ')}\n`;
    (level === 'error' ? process.stderr : process.stdout).write(line);
  }

  error(...values: unknown[]): void { this.write('error', values); }
  warn(...values: unknown[]): void { this.write('warn', values); }
  info(...values: unknown[]): void { this.write('info', values); }
  log(...values: unknown[]): void { this.write('info', values); }
  verbose(...values: unknown[]): void { this.write('verbose', values); }
  debug(...values: unknown[]): void { this.write('debug', values); }
  silly(...values: unknown[]): void { this.write('silly', values); }
}
