import { describe, expect, it } from 'vitest';
import {
  estimateTokens,
  keywordOverlap,
  normalizeMemoryText,
  parseMemoryLines,
  rankMemories,
} from '../src/main/services/memoryRank';
import type { MemoryEntry } from '../src/shared/types';

const NOW = Date.parse('2026-10-23T12:00:00+08:00');

function mem(p: Partial<MemoryEntry>): MemoryEntry {
  return {
    id: 'm',
    text: 't',
    category: 'fact',
    importance: 0.5,
    createdAt: NOW,
    lastUsedAt: 0,
    ...p,
  };
}

describe('normalizeMemoryText', () => {
  it('忽略大小写、空白与常见标点', () => {
    expect(normalizeMemoryText('喜欢 喝咖啡。')).toBe('喜欢喝咖啡');
    expect(normalizeMemoryText('ABC')).toBe('abc');
    expect(normalizeMemoryText('  a，b！ ')).toBe('ab');
  });
});

describe('rankMemories', () => {
  it('重要度高的排在前面', () => {
    const low = mem({ id: 'low', importance: 0.2 });
    const high = mem({ id: 'high', importance: 0.95 });
    expect(rankMemories([low, high], 2, NOW)[0].id).toBe('high');
  });

  it('同重要度时新记忆优先', () => {
    const older = mem({ id: 'old', createdAt: NOW - 90 * 86_400_000 });
    const newer = mem({ id: 'new', createdAt: NOW });
    expect(rankMemories([older, newer], 2, NOW)[0].id).toBe('new');
  });

  it('limit 生效', () => {
    const list = [mem({ id: 'a' }), mem({ id: 'b' }), mem({ id: 'c' })];
    expect(rankMemories(list, 2, NOW)).toHaveLength(2);
  });

  it('query 命中关键词时获得语义召回加成', () => {
    const hit = mem({ id: 'hit', text: '我的猫叫豆豆', importance: 0.5 });
    const miss = mem({ id: 'miss', text: '喜欢喝美式咖啡', importance: 0.6 });
    const ranked = rankMemories([miss, hit], 2, NOW, '豆豆今天在干嘛');
    expect(ranked[0].id).toBe('hit');
  });
});

describe('estimateTokens', () => {
  it('CJK 字符按 1 token，英文按约 4 字符 1 token', () => {
    expect(estimateTokens('你好世界')).toBe(4);
    expect(estimateTokens('hello world')).toBe(3); // 11 字符 / 4 向上取整
  });
});

describe('keywordOverlap', () => {
  it('归一化后计算 2-gram 重叠数', () => {
    expect(keywordOverlap('喜欢猫', '我喜欢猫')).toBeGreaterThan(0);
    expect(keywordOverlap('喜欢猫', '天气预报')).toBe(0);
  });
});

describe('parseMemoryLines', () => {
  it('解析分类前缀并按分类给重要度', () => {
    const r = parseMemoryLines('[偏好] 喜欢喝美式咖啡\n[约定] 每晚十点提醒睡觉');
    expect(r[0]).toMatchObject({ text: '喜欢喝美式咖啡', category: 'preference' });
    expect(r[1]).toMatchObject({ text: '每晚十点提醒睡觉', category: 'agreement' });
    expect(r[1].importance).toBeGreaterThan(r[0].importance);
  });

  it('兼容全角括号与旧格式', () => {
    const r = parseMemoryLines('【身份】用户叫小林\n- 喜欢猫', 5);
    expect(r[0]).toMatchObject({ text: '用户叫小林', category: 'identity' });
    expect(r[1]).toMatchObject({ text: '喜欢猫', category: 'fact' });
  });

  it('遵守条数上限并跳过空行', () => {
    const r = parseMemoryLines('\n\n[事实] a\n[事实] b\n[事实] c\n', 2);
    expect(r).toHaveLength(2);
  });
});
