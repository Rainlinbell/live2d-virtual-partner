import { app } from 'electron';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { AppConfig, AudioFormat } from '../../shared/types';
import { AUDIO_MIME } from '../../shared/types';
import { describeHttpError } from './llmService';
import { endpoint, isLocalhostUrl } from './endpoint';
import { sapiSpeak } from './sapi';

export interface TtsOutput {
  buffer: Buffer;
  mime: string;
  format: AudioFormat;
}

/** 相同文本重复合成时直接复用（气泡重播、测试音、同一句话） */
const cache = new Map<string, TtsOutput>();
const MAX_CACHE = 24;
/** 落盘缓存上限（个），超出删最旧 */
const MAX_DISK_CACHE = 100;

const FORMAT_EXT: Record<AudioFormat, string> = {
  mp3: 'mp3',
  wav: 'wav',
  opus: 'ogg',
  aac: 'aac',
  flac: 'flac',
};

function cacheDir(): string {
  return path.join(app.getPath('userData'), 'tts-cache');
}

function hashKey(key: string): string {
  return crypto.createHash('sha1').update(key).digest('hex');
}

function diskCachePath(key: string, format: AudioFormat): string {
  return path.join(cacheDir(), `${hashKey(key)}.${FORMAT_EXT[format]}`);
}

function pruneDiskCache(): void {
  try {
    const dir = cacheDir();
    const files = fs
      .readdirSync(dir)
      .map((name) => path.join(dir, name))
      .filter((p) => fs.statSync(p).isFile())
      .sort((a, b) => fs.statSync(a).mtimeMs - fs.statSync(b).mtimeMs);
    while (files.length > MAX_DISK_CACHE) {
      const oldest = files.shift();
      if (oldest) fs.rmSync(oldest, { force: true });
    }
  } catch {
    /* ignore */
  }
}

/** 从落盘读缓存（命中则返回，并回填内存） */
function readDiskCache(key: string, format: AudioFormat): TtsOutput | null {
  try {
    const p = diskCachePath(key, format);
    if (!fs.existsSync(p)) return null;
    const buffer = fs.readFileSync(p);
    if (buffer.byteLength === 0) return null;
    return { buffer, mime: AUDIO_MIME[format], format };
  } catch {
    return null;
  }
}

function writeDiskCache(key: string, out: TtsOutput): void {
  try {
    const dir = cacheDir();
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(diskCachePath(key, out.format), out.buffer);
    pruneDiskCache();
  } catch {
    /* 缓存写失败不影响主流程 */
  }
}

function isLocalBase(base: string): boolean {
  return isLocalhostUrl(base);
}

function detectMime(contentType: string | null, format: AudioFormat): string {
  const ct = (contentType ?? '').split(';')[0].trim().toLowerCase();
  if (ct.startsWith('audio/') || ct === 'application/ogg') {
    if (ct === 'audio/mp3') return 'audio/mpeg';
    return ct;
  }
  return AUDIO_MIME[format];
}

function cacheKey(cfg: AppConfig, text: string, voice: string, base: string): string {
  return JSON.stringify([
    base,
    cfg.tts.model,
    voice,
    cfg.tts.speed,
    cfg.tts.format,
    text,
  ]);
}

/** 请求一次语音合成，返回音频与 MIME */
async function requestSpeech(
  cfg: AppConfig,
  text: string,
  voice: string,
  base: string,
  key: string,
  minimal: boolean,
): Promise<TtsOutput> {
  const body: Record<string, unknown> = {
    model: cfg.tts.model || 'tts-1',
    voice,
    input: text,
  };
  if (!minimal) {
    body.response_format = cfg.tts.format;
    if (cfg.tts.speed && cfg.tts.speed !== 1) body.speed = cfg.tts.speed;
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (key) headers.Authorization = `Bearer ${key}`;

  const res = await fetch(endpoint(base, 'audio/speech'), {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90_000),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    // 有的兼容实现不认 response_format / speed，退化成最小请求体再试一次
    if (!minimal && res.status === 400) return requestSpeech(cfg, text, voice, base, key, true);
    throw new Error(`语音合成失败：${describeHttpError(res.status, detail)}`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  if (buffer.byteLength === 0) throw new Error('语音合成返回了空音频');
  return {
    buffer,
    mime: detectMime(res.headers.get('content-type'), cfg.tts.format),
    format: cfg.tts.format,
  };
}

/** OpenAI 兼容 TTS：POST /v1/audio/speech → 音频；sapi 引擎走 Windows 本地离线合成 */
export async function speak(
  cfg: AppConfig,
  text: string,
  voiceOverride?: string,
): Promise<TtsOutput> {
  if (!cfg.tts.enabled) {
    throw new Error('语音播报已关闭，请在设置中开启');
  }

  const clean = text.trim().slice(0, 2000);
  if (!clean) throw new Error('没有可合成的文本');

  const voice = voiceOverride?.trim() || cfg.tts.voice || 'alloy';

  // Windows 本地离线合成，无需 Base URL / Key
  if (cfg.tts.engine === 'sapi') {
    const { buffer } = await sapiSpeak(clean, voice);
    return { buffer, mime: 'audio/wav', format: 'wav' };
  }

  const base = cfg.tts.baseURL || cfg.llm.baseURL;
  if (!base) throw new Error('请先在设置里填写 TTS 的 Base URL（或复用模型接口地址）');
  const key = cfg.tts.apiKey || cfg.llm.apiKey;
  if (!key && !isLocalBase(base)) {
    throw new Error('请先在设置里配置 TTS（或 LLM）的 API Key');
  }

  const ck = cacheKey(cfg, clean, voice, base);
  const hit = cache.get(ck);
  if (hit) {
    // 命中后移到队尾，维持 LRU
    cache.delete(ck);
    cache.set(ck, hit);
    return hit;
  }

  // 落盘缓存：重启后重复短句（"好的""嗯嗯"）零延迟
  const diskHit = readDiskCache(ck, cfg.tts.format);
  if (diskHit) {
    cache.set(ck, diskHit);
    return diskHit;
  }

  const out = await requestSpeech(cfg, clean, voice, base, key, false);
  cache.set(ck, out);
  writeDiskCache(ck, out);
  while (cache.size > MAX_CACHE) {
    const first = cache.keys().next().value;
    if (first === undefined) break;
    cache.delete(first);
  }
  return out;
}

/** 测试语音合成是否可用 */
export async function testSpeech(cfg: AppConfig): Promise<string> {
  try {
    const out = await speak(cfg, '你好，我是你的桌面伴侣。');
    const kb = Math.round(out.buffer.byteLength / 1024);
    return `合成成功：${kb} KB，格式 ${out.mime}`;
  } catch (e) {
    return `合成失败：${(e as Error).message}`;
  }
}

/** 清空合成缓存（切换音色/模型时可调用） */
export function clearSpeechCache(): void {
  cache.clear();
}
