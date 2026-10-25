import type { AppConfig, ChatMessage, Character } from '../../shared/types';
import { endpoint, isLocalhostUrl, normalizeBase, shortUrl } from './endpoint';
import { buildSystemPrompt } from './promptBuilder';

export interface ChatHandlers {
  onChunk?(text: string): void;
  onDone?(full: string): void;
  onError?(err: string): void;
  onAbort?(full: string): void;
}

export interface ChatRequest {
  cfg: AppConfig;
  character: Character;
  /** 除当前这条之外的上下文 */
  history: ChatMessage[];
  userText: string;
  /** 不传则用 promptBuilder 生成 */
  systemPrompt?: string;
  signal?: AbortSignal;
}

/** 流式请求总超时：卡死的连接不能一直占着“正在输入”状态 */
const STREAM_TIMEOUT = 180_000;

type WireMessage = { role: string; content: string };

/** 把 HTTP 错误翻译成用户能看懂的中文 */
export function describeHttpError(status: number, body: string): string {
  const detail = body.replace(/\s+/g, ' ').trim().slice(0, 200);
  if (status === 401 || status === 403) {
    return `认证失败（HTTP ${status}）：API Key 无效、过期或没有该模型权限`;
  }
  if (status === 404) {
    return `接口不存在（HTTP 404）：请检查 Base URL，通常应形如 https://api.deepseek.com/v1${detail ? `；${detail}` : ''}`;
  }
  if (status === 429) {
    return '请求过于频繁或额度不足（HTTP 429）：请稍后再试，或检查账户余额';
  }
  if (status >= 500) {
    return `服务端错误（HTTP ${status}）：请稍后重试${detail ? `；${detail}` : ''}`;
  }
  return `API 错误 ${status}${detail ? `：${detail}` : ''}`;
}

/** 配置是否足以发起请求；返回 null 表示没问题 */
function configError(cfg: AppConfig): string | null {
  if (!cfg.llm.baseURL.trim()) return '请先在设置中填写 Base URL';
  if (!cfg.llm.provider || cfg.llm.provider !== 'local') {
    const local = isLocalhostUrl(cfg.llm.baseURL);
    if (!local && !cfg.llm.apiKey.trim()) return '请先在设置中填写 API Key';
  }
  if (!cfg.llm.model.trim()) return '请先在设置中填写模型名';
  return null;
}

/** 组装 messages：跳过错误与空内容，摘要以 system 身份注入 */
function toMessages(req: ChatRequest): WireMessage[] {
  const system = (req.systemPrompt ?? buildSystemPrompt(req.character)).trim();
  const out: WireMessage[] = [];
  if (system) out.push({ role: 'system', content: system });

  for (const m of req.history) {
    const content = (m.content ?? '').trim();
    if (!content || m.error) continue;
    if (m.summary) {
      out.push({ role: 'system', content: `（早前对话摘要）${content}` });
      continue;
    }
    out.push({ role: m.role, content });
  }

  const user = req.userText.trim();
  if (user) out.push({ role: 'user', content: user });
  return out;
}

function buildBody(cfg: AppConfig, messages: WireMessage[], stream: boolean): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: cfg.llm.model,
    messages,
    stream,
    temperature: cfg.llm.temperature,
    top_p: cfg.llm.topP,
  };
  // 0 表示交给服务端默认
  if (cfg.llm.maxTokens > 0) body.max_tokens = cfg.llm.maxTokens;
  return body;
}

function authHeaders(cfg: AppConfig): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (cfg.llm.apiKey.trim()) headers.Authorization = `Bearer ${cfg.llm.apiKey.trim()}`;
  return headers;
}

/**
 * OpenAI 兼容 chat completions，SSE 流式。
 * 返回完整文本；出错时通过 onError 回调并返回已收到的部分。
 */
export async function streamChat(req: ChatRequest, handlers: ChatHandlers): Promise<string> {
  const { cfg } = req;
  const invalid = configError(cfg);
  if (invalid) {
    handlers.onError?.(invalid);
    return '';
  }

  let url: string;
  try {
    url = endpoint(cfg.llm.baseURL, 'chat/completions');
  } catch (e) {
    handlers.onError?.((e as Error).message);
    return '';
  }

  const messages = toMessages(req);
  if (messages.filter((m) => m.role !== 'system').length === 0) {
    handlers.onError?.('没有可发送的对话内容');
    return '';
  }

  const timeout = AbortSignal.timeout(STREAM_TIMEOUT);
  const signal = req.signal ? AbortSignal.any([req.signal, timeout]) : timeout;

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: authHeaders(cfg),
      body: JSON.stringify(buildBody(cfg, messages, true)),
      signal,
    });
  } catch (e) {
    const err = e as Error;
    if (req.signal?.aborted) {
      handlers.onAbort?.('');
      return '';
    }
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      handlers.onError?.(`请求超时（${STREAM_TIMEOUT / 1000}s）：${shortUrl(url)}`);
      return '';
    }
    handlers.onError?.(`网络请求失败：${err.message}（${shortUrl(url)}）`);
    return '';
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    handlers.onError?.(describeHttpError(res.status, detail));
    return '';
  }

  // 有些兼容网关无视 stream:true，直接返回整包 JSON
  const contentType = (res.headers.get('content-type') ?? '').toLowerCase();
  if (!contentType.includes('event-stream')) {
    try {
      const json = (await res.json()) as any;
      const text = String(json?.choices?.[0]?.message?.content ?? '').trim();
      if (!text) {
        handlers.onError?.(describeHttpError(res.status, JSON.stringify(json).slice(0, 200)));
        return '';
      }
      handlers.onChunk?.(text);
      handlers.onDone?.(text);
      return text;
    } catch (e) {
      handlers.onError?.(`响应解析失败：${(e as Error).message}`);
      return '';
    }
  }

  if (!res.body) {
    handlers.onError?.('服务端没有返回流式内容');
    return '';
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let idx: number;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).replace(/\r$/, '').trim();
        buffer = buffer.slice(idx + 1);
        if (!line || line.startsWith(':')) continue;
        if (!line.startsWith('data:')) continue;

        const data = line.slice(5).trim();
        if (data === '[DONE]') {
          handlers.onDone?.(full);
          return full;
        }
        try {
          const json = JSON.parse(data);
          if (json?.error) {
            handlers.onError?.(String(json.error.message ?? json.error));
            return full;
          }
          const delta =
            json?.choices?.[0]?.delta?.content ?? json?.choices?.[0]?.message?.content ?? '';
          if (delta) {
            full += delta;
            handlers.onChunk?.(String(delta));
          }
        } catch {
          // 半行 JSON，等下一块数据补齐
        }
      }
    }
  } catch (e) {
    const err = e as Error;
    if (req.signal?.aborted) {
      handlers.onAbort?.(full);
      return full;
    }
    if (err.name === 'TimeoutError') {
      handlers.onError?.(`响应超时（${STREAM_TIMEOUT / 1000}s）：已收到 ${full.length} 字`);
      return full;
    }
    handlers.onError?.(`流式读取中断：${err.message}`);
    return full;
  } finally {
    void reader.cancel().catch(() => undefined);
  }

  handlers.onDone?.(full);
  return full;
}

/** 非流式补全，用于长期记忆摘要等一次性任务 */
export async function complete(
  cfg: AppConfig,
  messages: Array<{ role: string; content: string }>,
  opts: { maxTokens?: number; temperature?: number; timeoutMs?: number; model?: string } = {},
): Promise<string> {
  const invalid = configError(cfg);
  if (invalid) throw new Error(invalid);

  const url = endpoint(cfg.llm.baseURL, 'chat/completions');
  const body: Record<string, unknown> = {
    model: opts.model || cfg.llm.model,
    messages,
    stream: false,
    temperature: opts.temperature ?? 0.3,
  };
  if (opts.maxTokens) body.max_tokens = opts.maxTokens;

  const res = await fetch(url, {
    method: 'POST',
    headers: authHeaders(cfg),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(opts.timeoutMs ?? 60_000),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(describeHttpError(res.status, detail));
  }

  const json = (await res.json()) as any;
  const text = String(json?.choices?.[0]?.message?.content ?? '').trim();
  if (!text) throw new Error('模型返回了空内容');
  return text;
}

/** 非流式简单调用，用于连通性测试 */
export async function testConnection(cfg: AppConfig): Promise<string> {
  const invalid = configError(cfg);
  if (invalid) return invalid;
  if (!normalizeBase(cfg.llm.baseURL)) return '未填写 Base URL';

  try {
    const url = endpoint(cfg.llm.baseURL, 'chat/completions');
    const res = await fetch(url, {
      method: 'POST',
      headers: authHeaders(cfg),
      body: JSON.stringify({
        model: cfg.llm.model,
        messages: [{ role: 'user', content: '用两个字回答：你好' }],
        max_tokens: 8,
        stream: false,
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      return `失败：${describeHttpError(res.status, detail)}`;
    }
    const json = (await res.json()) as any;
    const text = json?.choices?.[0]?.message?.content;
    return text ? `连接成功：${String(text).slice(0, 40)}` : '响应格式异常，但接口可达';
  } catch (e) {
    return `失败：${(e as Error).message}`;
  }
}
