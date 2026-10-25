import { describe, expect, it } from 'vitest';
import { EmotionStripper, extractEmotion, normalizeEmotion } from '../src/main/services/emotionTag';

describe('normalizeEmotion', () => {
  it('中文别名映射到内部 key', () => {
    expect(normalizeEmotion('开心')).toBe('happy');
    expect(normalizeEmotion('难过')).toBe('sad');
    expect(normalizeEmotion('害羞')).toBe('shy');
    expect(normalizeEmotion('困')).toBe('sleepy');
  });

  it('英文 key 原样保留（小写）', () => {
    expect(normalizeEmotion('Happy')).toBe('happy');
    expect(normalizeEmotion('pout')).toBe('pout');
  });

  it('空值与无法识别时返回 null', () => {
    expect(normalizeEmotion('')).toBeNull();
    expect(normalizeEmotion(undefined)).toBeNull();
    expect(normalizeEmotion('莫名其妙')).toBeNull();
  });
});

describe('extractEmotion', () => {
  it('摘掉中文标签并返回情绪', () => {
    const r = extractEmotion('今天看到你真好\n【情绪:开心】');
    expect(r.text).toBe('今天看到你真好');
    expect(r.emotion).toBe('happy');
  });

  it('支持英文标签与半角括号', () => {
    const r = extractEmotion('hmm... [emotion: thinking]');
    expect(r.text).toBe('hmm...');
    expect(r.emotion).toBe('thinking');
  });

  it('没有标签时原样返回', () => {
    const r = extractEmotion('普通一句话');
    expect(r.text).toBe('普通一句话');
    expect(r.emotion).toBeNull();
  });
});

describe('EmotionStripper', () => {
  it('标签被拆到两个 chunk 时不会漏出半个标签', () => {
    const s = new EmotionStripper();
    expect(s.push('你好呀【情')).toBe('你好呀');
    expect(s.push('绪:害羞】嘿嘿')).toBe('嘿嘿');
    expect(s.detectedEmotion).toBe('shy');
    expect(s.flush()).toBe('');
  });

  it('多个 chunk 拼接后的完整标签也能吞掉', () => {
    const s = new EmotionStripper();
    let out = '';
    for (const part of ['说', '点', '什么', '【情绪', ':开心', '】']) out += s.push(part);
    expect(out).toBe('说点什么');
    expect(s.detectedEmotion).toBe('happy');
  });

  it('未闭合的半截标签在 flush 时原样吐出，不吞用户内容', () => {
    const s = new EmotionStripper();
    expect(s.push('abc【情绪:开')).toBe('abc');
    expect(s.flush()).toBe('【情绪:开');
  });

  it('不是标签的方括号内容照常输出', () => {
    const s = new EmotionStripper();
    expect(s.push('[笑]好的')).toBe('[笑]好的');
  });
});
