import type { MemoryCategory, MemoryEntry } from '../../shared/types';
import { MEMORY_IMPORTANCE } from '../../shared/types';

/**
 * 长期记忆排序（纯函数，便于单测）。
 *
 * 目标：重要的事优先记住，同时新记忆和最近用过的记忆有加成，
 * 避免早期一条高重要度的记忆永远霸占 prompt。
 */

/** 单条记忆的排序分 */
export function memoryScore(m: MemoryEntry, now = Date.now()): number {
  const ageDays = Math.max(0, (now - m.createdAt) / 86_400_000);
  const recency = 1 / (1 + ageDays / 30); // 30 天半衰
  const used = m.lastUsedAt > 0 ? 1 / (1 + Math.max(0, now - m.lastUsedAt) / 86_400_000 / 14) : 0;
  return m.importance * 0.6 + recency * 0.3 + used * 0.1;
}

/** 按分数取前 limit 条；query 存在时叠加关键词重叠加成（轻量语义召回） */
export function rankMemories(
  entries: MemoryEntry[],
  limit: number,
  now = Date.now(),
  query?: string,
): MemoryEntry[] {
  const scored = entries.map((m) => {
    let score = memoryScore(m, now);
    if (query) score += keywordOverlap(query, m.text) * 0.1;
    return { m, score };
  });
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(0, limit))
    .map((x) => x.m);
}

/** 粗略估算 token 数：CJK 字符按 1 token，其余按 4 字符 1 token */
export function estimateTokens(text: string): number {
  let cjk = 0;
  let other = 0;
  for (const ch of text) {
    if (/[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(ch)) cjk += 1;
    else other += 1;
  }
  return cjk + Math.ceil(other / 4);
}

function bigrams(text: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length - 1; i += 1) out.push(text.slice(i, i + 2));
  return out;
}

/** 两条文本的 2-gram 重叠数（归一化后） */
export function keywordOverlap(a: string, b: string): number {
  const sa = new Set(bigrams(normalizeMemoryText(a)));
  let n = 0;
  for (const g of bigrams(normalizeMemoryText(b))) {
    if (sa.has(g)) n += 1;
  }
  return n;
}

/** 归一化文本，用于去重（忽略大小写、空白与常见标点） */
export function normalizeMemoryText(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[\s，。、；：！？,.!?;:"'“”‘’（）()【】[\]]+/g, '');
}

const CATEGORY_MAP: Record<string, MemoryCategory> = {
  身份: 'identity',
  偏好: 'preference',
  约定: 'agreement',
  事件: 'event',
  事实: 'fact',
};

export interface ParsedMemory {
  text: string;
  category: MemoryCategory;
  importance: number;
}

/**
 * 把摘要模型输出的 `[类别] 内容` 解析成结构化记忆。
 * 兼容旧格式（没有类别前缀时按「事实」处理）。
 */
export function parseMemoryLines(summary: string, limit = 3): ParsedMemory[] {
  const out: ParsedMemory[] = [];
  for (const raw of summary.split('\n')) {
    const line = raw.replace(/^[-*•\s]+/, '').trim();
    if (!line) continue;
    const m = line.match(/^[[【]\s*(身份|偏好|约定|事件|事实)\s*[\]】]\s*(.+)$/);
    if (m) {
      const category = CATEGORY_MAP[m[1]] ?? 'fact';
      out.push({ text: m[2].trim(), category, importance: MEMORY_IMPORTANCE[category] });
    } else {
      out.push({ text: line, category: 'fact', importance: MEMORY_IMPORTANCE.fact });
    }
    if (out.length >= limit) break;
  }
  return out;
}
