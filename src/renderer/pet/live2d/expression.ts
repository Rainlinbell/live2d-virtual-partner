import type { AnyLive2DModel } from './modelLoader';
import type { EmotionKey, EmotionMap } from '../../../shared/types';

interface ExpressionCapable {
  expression?: (id?: number | string) => Promise<boolean> | boolean;
  motion?: (group?: string, index?: number, priority?: number) => Promise<boolean>;
}

/** 常见模型的默认表情名，用户没配映射时按顺序试一遍 */
const GUESS_NAMES: Record<EmotionKey, string[]> = {
  neutral: ['neutral', 'normal', 'default', 'exp_01'],
  happy: ['happy', 'smile', 'joy', 'fun', '笑'],
  sad: ['sad', 'sorrow', 'cry'],
  angry: ['angry', 'anger', 'mad'],
  surprised: ['surprised', 'surprise', 'shock'],
  shy: ['shy', 'blush', 'embarrassed'],
  thinking: ['thinking', 'think', 'serious'],
  sleepy: ['sleepy', 'sleep', 'tired'],
  excited: ['excited', 'star', 'love'],
  confused: ['confused', 'confuse', 'question'],
};

const warned = new Set<string>();

/**
 * 应用情绪表情：优先用角色配置的 emotionMap，其次按常见名字猜，
 * 都没有就做一个轻微动作，至少让用户感到被回应。
 */
export function applyEmotion(
  model: AnyLive2DModel,
  emotion: string,
  map: EmotionMap,
): void {
  const key = (emotion || 'neutral') as EmotionKey;
  const m = model as unknown as ExpressionCapable;
  const explicit = map[key];
  const candidates = explicit ? [explicit] : (GUESS_NAMES[key] ?? []);

  if (typeof m.expression === 'function') {
    for (const name of candidates) {
      try {
        const result = m.expression(name);
        // 库在不同版本里可能返回 boolean 或 Promise<boolean>
        if (result && typeof (result as Promise<boolean>).then === 'function') {
          (result as Promise<boolean>).catch(() => undefined);
        }
        return;
      } catch {
        // 名字不存在，继续试下一个
      }
    }
  }

  if (typeof m.motion === 'function') {
    const group = key === 'excited' || key === 'happy' ? 'tap_body' : 'idle';
    void Promise.resolve(m.motion(group, undefined, 1)).catch(() => undefined);
  }

  if (!warned.has(key)) {
    warned.add(key);
    console.info(`[emotion] 模型没有匹配「${key}」的表情，建议在角色设置里配置 emotionMap`);
  }
}

/** 回到平静表情 */
export function resetEmotion(model: AnyLive2DModel, map: EmotionMap): void {
  applyEmotion(model, 'neutral', map);
}
