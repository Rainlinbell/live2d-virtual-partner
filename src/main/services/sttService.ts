import type { AppConfig } from '../../shared/types';
import { describeHttpError } from './llmService';
import { endpoint } from './endpoint';
import { sapiTranscribe } from './sapi';

function extOf(mime: string): string {
  const m = (mime || '').toLowerCase();
  if (m.includes('webm')) return 'webm';
  if (m.includes('ogg') || m.includes('opus')) return 'ogg';
  if (m.includes('mp4') || m.includes('aac') || m.includes('m4a')) return 'm4a';
  if (m.includes('wav')) return 'wav';
  if (m.includes('mpeg') || m.includes('mp3')) return 'mp3';
  return 'webm';
}

function isLocalBase(base: string): boolean {
  return /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\]|0\.0\.0\.0)/i.test(base);
}

/** OpenAI 兼容 STT：POST /v1/audio/transcriptions (multipart) → 文本；sapi 引擎走 Windows 本地离线识别 */
export async function transcribe(cfg: AppConfig, audio: Buffer, mime: string): Promise<string> {
  // Windows 本地离线识别（audio 为 16kHz 单声道 PCM WAV）
  if (cfg.stt.engine === 'sapi') {
    if (audio.byteLength < 4000) throw new Error('录音太短，没有识别到内容');
    const text = await sapiTranscribe(audio, cfg.stt.language);
    if (!text) {
      throw new Error('没有识别到内容（本地识别，请确认 Windows 已安装对应语言的语音识别功能）');
    }
    return text;
  }

  const base = cfg.stt.baseURL || cfg.llm.baseURL;
  if (!base) throw new Error('请先在设置里填写 STT 的 Base URL（或复用模型接口地址）');
  const key = cfg.stt.apiKey || cfg.llm.apiKey;
  if (!key && !isLocalBase(base)) throw new Error('请先在设置里配置 STT（或 LLM）的 API Key');
  if (audio.byteLength < 1200) throw new Error('录音太短，没有识别到内容');

  const form = new FormData();
  const type = mime || 'audio/webm';
  form.append('file', new Blob([new Uint8Array(audio)], { type }), `audio.${extOf(type)}`);
  form.append('model', cfg.stt.model || 'whisper-1');
  if (cfg.stt.language) form.append('language', cfg.stt.language);

  const headers: Record<string, string> = {};
  if (key) headers.Authorization = `Bearer ${key}`;

  const res = await fetch(endpoint(base, 'audio/transcriptions'), {
    method: 'POST',
    headers,
    body: form,
    signal: AbortSignal.timeout(120_000),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`语音识别失败：${describeHttpError(res.status, detail)}`);
  }
  const json = (await res.json()) as { text?: string; error?: { message?: string } };
  if (json.error?.message) throw new Error(`语音识别失败：${json.error.message}`);
  return (json.text ?? '').trim();
}
