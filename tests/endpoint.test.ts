import { describe, expect, it } from 'vitest';
import { endpoint, hasVersionSegment, isLocalhostUrl, normalizeBase, shortUrl } from '../src/main/services/endpoint';

describe('endpoint', () => {
  it('base 已带 /v1 时不再重复补版本段（P0 回归）', () => {
    expect(endpoint('https://api.deepseek.com/v1', 'chat/completions')).toBe(
      'https://api.deepseek.com/v1/chat/completions',
    );
    expect(endpoint('https://api.deepseek.com/v1', 'audio/speech')).toBe(
      'https://api.deepseek.com/v1/audio/speech',
    );
  });

  it('base 不带版本段时补 /v1', () => {
    expect(endpoint('https://api.openai.com', 'chat/completions')).toBe('https://api.openai.com/v1/chat/completions');
    expect(endpoint('api.deepseek.com', 'audio/speech')).toBe('https://api.deepseek.com/v1/audio/speech');
  });

  it('去掉末尾多余斜杠', () => {
    expect(normalizeBase('https://api.deepseek.com/v1///')).toBe('https://api.deepseek.com/v1');
    expect(endpoint('https://api.deepseek.com/v1/', '/audio/speech')).toBe(
      'https://api.deepseek.com/v1/audio/speech',
    );
  });

  it('用户直接填完整端点时原样返回', () => {
    expect(endpoint('https://api.deepseek.com/v1/audio/speech', 'audio/speech')).toBe(
      'https://api.deepseek.com/v1/audio/speech',
    );
  });

  it('把别的端点填进来时回退到根再拼', () => {
    expect(endpoint('https://api.deepseek.com/v1/audio/transcriptions', 'audio/speech')).toBe(
      'https://api.deepseek.com/v1/audio/speech',
    );
  });

  it('本地推理服务保留端口', () => {
    expect(endpoint('http://127.0.0.1:11434/v1', 'chat/completions')).toBe(
      'http://127.0.0.1:11434/v1/chat/completions',
    );
    expect(endpoint('http://localhost:1234', 'models')).toBe('http://localhost:1234/v1/models');
  });

  it('base 为空时给出可展示的错误', () => {
    expect(() => endpoint('   ', 'chat/completions')).toThrow('接口地址为空');
  });

  it('识别版本段', () => {
    expect(hasVersionSegment('https://x.com/v1')).toBe(true);
    expect(hasVersionSegment('https://x.com/v1beta')).toBe(true);
    expect(hasVersionSegment('https://x.com/api/v1')).toBe(true);
    expect(hasVersionSegment('https://x.com/api')).toBe(false);
  });

  it('本地地址判断', () => {
    expect(isLocalhostUrl('http://127.0.0.1:11434/v1')).toBe(true);
    expect(isLocalhostUrl('http://192.168.1.8:8000/v1')).toBe(true);
    expect(isLocalhostUrl('https://api.deepseek.com/v1')).toBe(false);
  });

  it('shortUrl 去掉查询串', () => {
    expect(shortUrl('https://api.x.com/v1/chat?key=1')).toBe('https://api.x.com/v1/chat');
    expect(shortUrl('not a url')).toBe('not a url');
  });
});
