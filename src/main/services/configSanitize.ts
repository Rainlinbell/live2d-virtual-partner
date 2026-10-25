import type { AppConfig, AudioFormat } from '../../shared/types';

/**
 * 渲染进程 config:set 的输入清洗（纯函数，便于单测）。
 *
 * 主进程内部的 configStore.set 是全量可信路径；但从渲染层来的 partial 不做校验，
 * 任意窗口都能写 modelsDir / characters 等敏感字段。这里：
 * 1. 白名单顶层键，其余一律丢弃；
 * 2. 对每个白名单字段做类型/范围矫正。
 */

const ALLOWED_KEYS = [
  'llm',
  'tts',
  'stt',
  'memory',
  'companion',
  'camera',
  'autoLaunch',
  'hideOnFullscreen',
  'bubbleAutoHide',
] as const;

const AUDIO_FORMATS: ReadonlySet<string> = new Set(['mp3', 'wav', 'opus', 'aac', 'flac']);

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function clamp(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function bool(v: unknown): boolean {
  return v === true;
}

export function sanitizeLlm(raw: unknown): AppConfig['llm'] {
  const r = asRecord(raw);
  return {
    provider: r['provider'] === 'local' ? 'local' : 'cloud',
    localPreset: str(r['localPreset']),
    baseURL: str(r['baseURL']),
    apiKey: str(r['apiKey']),
    model: str(r['model']),
    temperature: clamp(r['temperature'], 0, 2, 0.8),
    maxTokens: Math.max(0, Math.round(clamp(r['maxTokens'], 0, 131072, 0))),
    topP: clamp(r['topP'], 0.1, 1, 0.95),
  };
}

export function sanitizeTts(raw: unknown): AppConfig['tts'] {
  const r = asRecord(raw);
  const format = str(r['format']);
  return {
    enabled: r['enabled'] !== false,
    engine: r['engine'] === 'sapi' ? 'sapi' : 'api',
    baseURL: str(r['baseURL']),
    apiKey: str(r['apiKey']),
    model: str(r['model']),
    voice: str(r['voice']),
    speed: clamp(r['speed'], 0.25, 4, 1),
    format: (AUDIO_FORMATS.has(format) ? format : 'mp3') as AudioFormat,
  };
}

export function sanitizeStt(raw: unknown): AppConfig['stt'] {
  const r = asRecord(raw);
  return {
    enabled: r['enabled'] !== false,
    engine: r['engine'] === 'sapi' ? 'sapi' : 'api',
    baseURL: str(r['baseURL']),
    apiKey: str(r['apiKey']),
    model: str(r['model']),
    language: str(r['language']),
  };
}

export function sanitizeMemory(raw: unknown): AppConfig['memory'] {
  const r = asRecord(raw);
  return {
    enabled: r['enabled'] !== false,
    maxEntries: Math.max(1, Math.round(clamp(r['maxEntries'], 1, 1000, 200))),
    summarizeThreshold: Math.max(1, Math.round(clamp(r['summarizeThreshold'], 1, 500, 60))),
    contextChars: Math.max(1, Math.round(clamp(r['contextChars'], 1, 200000, 16000))),
    summaryModel: str(r['summaryModel']),
  };
}

export function sanitizeCompanion(raw: unknown): AppConfig['companion'] {
  const r = asRecord(raw);
  return {
    proactiveChat: r['proactiveChat'] !== false,
    idleMinutes: Math.max(1, Math.round(clamp(r['idleMinutes'], 1, 240, 15))),
    idleMotion: r['idleMotion'] !== false,
  };
}

export function sanitizeCamera(raw: unknown): AppConfig['camera'] {
  const r = asRecord(raw);
  return {
    enabled: r['enabled'] === true,
    mirror: r['mirror'] !== false,
    showPreview: r['showPreview'] !== false,
    follow: r['follow'] !== false,
    react: r['react'] !== false,
  };
}

/** 白名单 + 逐字段矫正，返回干净的 Partial<AppConfig>（不含 modelsDir/characters 等） */
export function sanitizeConfigPartial(input: unknown): Partial<AppConfig> {
  const src = asRecord(input);
  const out: Partial<AppConfig> = {};

  for (const key of ALLOWED_KEYS) {
    if (!(key in src)) continue;
    switch (key) {
      case 'llm':
        out.llm = sanitizeLlm(src[key]);
        break;
      case 'tts':
        out.tts = sanitizeTts(src[key]);
        break;
      case 'stt':
        out.stt = sanitizeStt(src[key]);
        break;
      case 'memory':
        out.memory = sanitizeMemory(src[key]);
        break;
      case 'companion':
        out.companion = sanitizeCompanion(src[key]);
        break;
      case 'camera':
        out.camera = sanitizeCamera(src[key]);
        break;
      case 'autoLaunch':
        out.autoLaunch = bool(src[key]);
        break;
      case 'hideOnFullscreen':
        out.hideOnFullscreen = bool(src[key]);
        break;
      case 'bubbleAutoHide':
        out.bubbleAutoHide = Math.max(0, Math.round(clamp(src[key], 0, 120, 0)));
        break;
    }
  }

  return out;
}
