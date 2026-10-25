import type { Character, MemoryEntry, WorldBookEntry } from '../../shared/types';
import { MEMORY_CATEGORIES } from '../../shared/types';

/** 情绪标签说明：让模型在回复末尾输出可解析的情绪 */
const EMOTION_RULE = [
  '【情绪标签】每次回复的最后单独一行输出一个情绪标签，格式必须是：【情绪:开心】。',
  '可用情绪只有：平静、开心、难过、生气、惊讶、害羞、思考、困倦、兴奋、困惑。',
  '标签之外不要再解释它。',
].join('\n');

const STYLE_RULE =
  '回复要求：用简短、口语化的中文，像真人聊天一样自然，一般不超过三句话；不要用列表、标题或 markdown 格式。';

export interface PromptOptions {
  /** 长期记忆条目（已按重要度/时效排序，前面更重要） */
  memories?: MemoryEntry[];
  /** 当前时间，用于"知道今天几号" */
  now?: Date;
  /** QQ 等窄带渠道用更短的风格 */
  compact?: boolean;
  /** 当前用户输入，用于世界书关键词触发 */
  userText?: string;
}

function formatNow(d: Date): string {
  const week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()];
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}（${week}）`;
}

/** 组装 system prompt：自定义提示词优先，其次用性格描述拼装 */
export function buildSystemPrompt(character: Character, opts: PromptOptions = {}): string {
  const base = character.systemPrompt.trim()
    ? character.systemPrompt.trim()
    : [
        `你是${character.name}，${character.personality}`,
        '',
        STYLE_RULE,
      ].join('\n');

  const parts = [base];

  // 自定义提示词里已经交代过情绪规则的不要重复
  if (!/【\s*情绪/.test(base)) parts.push('', EMOTION_RULE);
  if (!/【\s*情绪/.test(base) && opts.compact) {
    parts.push('这次是 QQ 聊天，回复要更短，控制在一两句话内。');
  }

  const memories = (opts.memories ?? []).filter((m) => m.text.trim());
  if (memories.length > 0) {
    parts.push('', '你记得和对方有关的这些事（越靠前越重要）：');
    for (const m of memories.slice(0, 10)) {
      const label = MEMORY_CATEGORIES[m.category] ?? '事实';
      parts.push(`- [${label}] ${m.text.trim()}`);
    }
  }

  // 世界书：当前话题命中关键词时注入相关设定
  const worldBook = matchWorldBook(character.worldBook, opts.userText ?? '');
  if (worldBook.length > 0) {
    parts.push('', '与当前话题相关的补充设定：');
    for (const entry of worldBook) parts.push(`- ${entry.content.trim()}`);
  }

  parts.push('', `当前时间：${formatNow(opts.now ?? new Date())}。`);
  return parts.join('\n');
}

/** 关键词匹配世界书条目（大小写不敏感，命中数上限防爆上下文） */
function matchWorldBook(entries: WorldBookEntry[] | undefined, text: string): WorldBookEntry[] {
  if (!entries?.length || !text) return [];
  const t = text.toLowerCase();
  const hits: WorldBookEntry[] = [];
  for (const entry of entries) {
    if (!entry?.content?.trim()) continue;
    const keys = Array.isArray(entry.keys) ? entry.keys : [];
    if (keys.some((k) => k && t.includes(String(k).toLowerCase()))) {
      hits.push(entry);
      if (hits.length >= 5) break;
    }
  }
  return hits;
}
