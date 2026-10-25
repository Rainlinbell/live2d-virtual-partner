import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

/** 单个日志文件上限，超过就轮转成 main.old.log */
const MAX_LOG_SIZE = 2 * 1024 * 1024;

let stream: fs.WriteStream | null = null;
export let logFilePath = '';

export function logsDir(): string {
  return path.join(app.getPath('userData'), 'logs');
}

function format(arg: unknown): string {
  if (typeof arg === 'string') return arg;
  if (arg instanceof Error) return `${arg.name}: ${arg.message}\n${arg.stack ?? ''}`;
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

function write(level: string, args: unknown[]): void {
  if (!stream) return;
  const line = `${new Date().toISOString()} [${level}] ${args.map(format).join(' ')}\n`;
  try {
    stream.write(line);
  } catch {
    /* 日志写失败不能影响主流程 */
  }
}

/**
 * 把 console.* 同时写进 userData/logs/main.log。
 * 打包后没有终端，出问题只能靠这个文件排查。
 */
export function initLogger(): void {
  try {
    const dir = logsDir();
    fs.mkdirSync(dir, { recursive: true });
    logFilePath = path.join(dir, 'main.log');
    try {
      if (fs.statSync(logFilePath).size > MAX_LOG_SIZE) {
        fs.renameSync(logFilePath, path.join(dir, 'main.old.log'));
      }
    } catch {
      /* 文件还不存在 */
    }
    stream = fs.createWriteStream(logFilePath, { flags: 'a' });
  } catch (e) {
    console.error('[logger] 初始化失败:', e);
    return;
  }

  const origLog = console.log.bind(console);
  const origWarn = console.warn.bind(console);
  const origError = console.error.bind(console);
  const origDebug = console.debug.bind(console);

  console.log = (...args: unknown[]) => {
    write('INFO', args);
    origLog(...args);
  };
  console.debug = (...args: unknown[]) => {
    write('DEBUG', args);
    origDebug(...args);
  };
  console.warn = (...args: unknown[]) => {
    write('WARN', args);
    origWarn(...args);
  };
  console.error = (...args: unknown[]) => {
    write('ERROR', args);
    origError(...args);
  };

  // 崩溃前至少把原因落到文件里
  process.on('uncaughtException', (err) => {
    write('FATAL', ['uncaughtException', err]);
    origError(err);
  });
  process.on('unhandledRejection', (reason) => {
    write('FATAL', ['unhandledRejection', reason]);
    origError(reason);
  });

  console.log('[logger] 日志文件:', logFilePath);
}

export function closeLogger(): void {
  try {
    stream?.end();
  } catch {
    /* ignore */
  }
  stream = null;
}
