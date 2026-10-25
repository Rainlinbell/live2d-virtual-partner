/**
 * OpenAI 兼容端点的 URL 归一化。
 *
 * 历史实现里每个 service 各自拼 `"/v1/..."`，而 normalizeBase 只去掉末尾斜杠，
 * 于是用户填 `https://api.openai.com/v1` 时会拼成 `/v1/v1/audio/speech`。
 * 这里统一成一条规则：
 *   - base 已带版本段（/v1、/v1beta、/api/v1 ...）→ 直接接 path
 *   - base 不带版本段 → 补 /v1 再接 path
 *   - base 本身就是完整端点（.../chat/completions）→ 原样返回
 */

/** 末尾版本段：/v1、/v1beta、/api/v1、/openai/v1beta1 ... */
const VERSION_SUFFIX = /\/v\d+(?:beta\d*)?$/i;

const KNOWN_PATHS = [
  'chat/completions',
  'audio/speech',
  'audio/transcriptions',
  'models',
];

/** 去掉首尾空白与末尾斜杠，缺少协议时补 https:// */
export function normalizeBase(raw: string): string {
  let base = (raw || '').trim().replace(/\/+$/, '');
  if (!base) return '';
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(base)) base = 'https://' + base;
  return base;
}

/** 是否已包含版本段 */
export function hasVersionSegment(base: string): boolean {
  return VERSION_SUFFIX.test(base);
}

/** 本地推理服务一般不需要 API Key */
export function isLocalhostUrl(url: string): boolean {
  return /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\]|0\.0\.0\.0|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(
    url.trim(),
  );
}

/** 拼出完整端点；base 为空时抛出可直接展示给用户的错误 */
export function endpoint(base: string, path: string): string {
  const b = normalizeBase(base);
  if (!b) throw new Error('接口地址为空，请在设置里填写 Base URL');
  const clean = path.replace(/^\/+/, '');
  const lower = b.toLowerCase();
  // 用户把完整端点直接填进了 Base URL
  if (lower.endsWith('/' + clean.toLowerCase())) return b;
  if (KNOWN_PATHS.some((p) => lower.endsWith('/' + p))) {
    // 填的是别的已知端点（例如把 transcriptions 地址填到了 TTS 里）→ 回退到根再拼
    for (const p of KNOWN_PATHS) {
      if (lower.endsWith('/' + p)) {
        const root = b.slice(0, b.length - p.length - 1);
        return hasVersionSegment(root) ? `${root}/${clean}` : `${root}/v1/${clean}`;
      }
    }
  }
  return hasVersionSegment(b) ? `${b}/${clean}` : `${b}/v1/${clean}`;
}

/** 展示用的简短地址（日志与错误信息里用） */
export function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return url;
  }
}
