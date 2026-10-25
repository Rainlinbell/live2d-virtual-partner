import { describe, expect, it } from 'vitest';
import { chatToMarkdown } from '../src/main/services/chatExport';
import type { Character, ChatMessage } from '../src/shared/types';

const character = { id: 'c1', name: '小夏' } as unknown as Character;

function msg(partial: Partial<ChatMessage>): ChatMessage {
  return { id: 'm', role: 'user', content: '', ts: Date.parse('2026-10-22T10:00:00+08:00'), ...partial };
}

describe('chatToMarkdown', () => {
  it('输出标题、消息与说话人', () => {
    const md = chatToMarkdown(character, [
      msg({ content: '在吗' }),
      msg({ id: 'm2', role: 'assistant', content: '在的呀', emotion: 'happy' }),
    ]);
    expect(md).toContain('# 小夏 的聊天记录');
    expect(md).toContain('### 我 ·');
    expect(md).toContain('### 小夏 ·');
    expect(md).toContain('在吗');
    expect(md).toContain('在的呀');
    expect(md).toContain('happy');
  });

  it('跳过错误条目（它们只用于界面提示）', () => {
    const md = chatToMarkdown(character, [
      msg({ content: '在吗' }),
      msg({ id: 'e', role: 'system', content: '⚠ API 错误 401', error: true }),
    ]);
    expect(md).toContain('在吗');
    expect(md).not.toContain('API 错误');
  });

  it('QQ 来源的消息带标记', () => {
    const md = chatToMarkdown(character, [msg({ content: '群里好热闹', source: 'qq' })]);
    expect(md).toContain('（QQ）');
  });

  it('空历史也能生成合法文档', () => {
    const md = chatToMarkdown(character, []);
    expect(md).toContain('# 小夏 的聊天记录');
    expect(md).toContain('消息数：0');
  });
});
