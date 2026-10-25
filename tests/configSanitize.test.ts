import { describe, expect, it } from 'vitest';
import { sanitizeConfigPartial, sanitizeLlm, sanitizeTts } from '../src/main/services/configSanitize';

describe('sanitizeConfigPartial', () => {
  it('只保留白名单顶层键，丢弃 modelsDir / characters 等敏感字段', () => {
    const out = sanitizeConfigPartial({
      llm: { model: 'deepseek-chat' },
      modelsDir: 'C:\\evil',
      characters: [{ id: 'x', name: 'hack' }],
      schemaVersion: 999,
    });
    expect(out.llm).toBeDefined();
    expect('modelsDir' in out).toBe(false);
    expect('characters' in out).toBe(false);
    expect('schemaVersion' in out).toBe(false);
  });

  it('布尔键强转布尔', () => {
    const out = sanitizeConfigPartial({ autoLaunch: 'yes' as unknown, hideOnFullscreen: 1 as unknown });
    expect(out.autoLaunch).toBe(false);
    expect(out.hideOnFullscreen).toBe(false);
  });

  it('bubbleAutoHide 夹到 0~120', () => {
    expect(sanitizeConfigPartial({ bubbleAutoHide: 9999 }).bubbleAutoHide).toBe(120);
    expect(sanitizeConfigPartial({ bubbleAutoHide: -5 }).bubbleAutoHide).toBe(0);
  });
});

describe('sanitizeLlm', () => {
  it('provider 只接受 local，其余回落 cloud', () => {
    expect(sanitizeLlm({ provider: 'local' }).provider).toBe('local');
    expect(sanitizeLlm({ provider: 'evil' }).provider).toBe('cloud');
  });

  it('temperature / topP / maxTokens 夹取范围', () => {
    const r = sanitizeLlm({ temperature: 99, topP: -1, maxTokens: -3 });
    expect(r.temperature).toBe(2);
    expect(r.topP).toBe(0.1);
    expect(r.maxTokens).toBe(0);
  });

  it('apiKey 原样保留（脱敏占位符交给 setFromRenderer 处理）', () => {
    expect(sanitizeLlm({ apiKey: '••••••••' }).apiKey).toBe('••••••••');
    expect(sanitizeLlm({ apiKey: 'sk-abc' }).apiKey).toBe('sk-abc');
  });
});

describe('sanitizeTts', () => {
  it('format 白名单外回落 mp3，speed 夹取', () => {
    expect(sanitizeTts({ format: 'exe' }).format).toBe('mp3');
    expect(sanitizeTts({ format: 'wav' }).format).toBe('wav');
    expect(sanitizeTts({ speed: 100 }).speed).toBe(4);
    expect(sanitizeTts({ speed: 0.01 }).speed).toBe(0.25);
  });
});
