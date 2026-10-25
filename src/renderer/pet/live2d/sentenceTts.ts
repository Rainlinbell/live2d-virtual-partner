import type { AnyLive2DModel } from './modelLoader';
import { playSegment, speechGeneration, stopVoice } from './lipsync';

/**
 * 分句流式 TTS。
 *
 * LLM 回复是流式的：与其等全文生成完再一次性合成、一次性播放，这里在收到每个
 * 增量时按句号/感叹号/问号/换行切句，凑够一句就立刻请求合成并入队顺序播放，
 * 首字出声延迟从「全文 LLM + 全文 TTS」降到「首句 LLM + 首句 TTS」。
 *
 * 打断：stop() 让代际 +1，排队中尚未开始播放的句子直接跳过，正在播的由 stopVoice 停掉。
 */

/** 句子结束标点（含换行，QQ/桌面通用的自然断句） */
const SENT_END = /[。！？!?；;\n]/;

export class SentenceTts {
  private buf = '';
  private chain: Promise<void> = Promise.resolve();

  constructor(
    private getModel: () => AnyLive2DModel | null,
    private getVoice: () => string | undefined,
  ) {}

  /** 喂入一段流式增量 */
  push(delta: string): void {
    if (!delta) return;
    this.buf += delta;
    this.drain(false);
  }

  /** 流结束，剩余缓冲作为最后一句 */
  flush(): void {
    this.drain(true);
    this.buf = '';
  }

  /** 打断：停止当前语音并清空缓冲与排队 */
  stop(): void {
    stopVoice();
    this.buf = '';
    // 让排队里的任务在检查代际后自动跳过
    this.chain = this.chain.catch(() => undefined);
  }

  private drain(final: boolean): void {
    for (;;) {
      SENT_END.lastIndex = 0;
      const m = SENT_END.exec(this.buf);
      if (!m) {
        if (final && this.buf.trim()) this.enqueue(this.buf.trim());
        if (final) this.buf = '';
        break;
      }
      const sentence = this.buf.slice(0, m.index + 1).trim();
      this.buf = this.buf.slice(m.index + 1);
      if (sentence) this.enqueue(sentence);
    }
  }

  private enqueue(text: string): void {
    const gen = speechGeneration();
    this.chain = this.chain.then(async () => {
      if (gen !== speechGeneration()) return; // 已被打断
      try {
        const r = await window.api.ttsSpeak(text, this.getVoice());
        if (gen !== speechGeneration()) return;
        const model = this.getModel();
        if (model) await playSegment(model, r.audio, r.mime, gen);
      } catch (e) {
        console.warn('[tts] 分句合成失败:', (e as Error).message);
      }
    });
  }
}
