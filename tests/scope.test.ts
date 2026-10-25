import { describe, expect, it } from 'vitest';
import { desktopScope, qqScope, scopeFileName, sessionScope } from '../src/shared/scope';

describe('scope', () => {
  it('桌面对话作用域直接复用角色 id（兼容旧历史文件）', () => {
    expect(desktopScope('char_abc')).toBe('char_abc');
  });

  it('QQ 会话按角色 + 私聊/群聊 + 对方 id 隔离', () => {
    const a = qqScope('char_1', 'private', '1001');
    const b = qqScope('char_1', 'private', '1002');
    const g = qqScope('char_1', 'group', '8888');
    expect(a).not.toBe(b);
    expect(a).not.toBe(g);
    expect(a).toBe('char_1#qq#private#1001');
  });

  it('不同角色之间的作用域互不重叠', () => {
    expect(qqScope('char_1', 'private', '1001')).not.toBe(qqScope('char_2', 'private', '1001'));
  });

  it('默认会话复用角色 id，显式会话按会话隔离', () => {
    expect(sessionScope('char_1', 'default')).toBe('char_1');
    expect(sessionScope('char_1', 'sess_1')).toBe('char_1#session#sess_1');
    expect(sessionScope('char_1', 'sess_1')).not.toBe(sessionScope('char_1', 'sess_2'));
  });

  it('scope 转文件名时去除 Windows 不允许的字符', () => {
    expect(scopeFileName('char_1#qq#private#1001')).toBe('char_1#qq#private#1001');
    expect(scopeFileName('a:b/c\\d')).toBe('a_b_c_d');
  });
});
