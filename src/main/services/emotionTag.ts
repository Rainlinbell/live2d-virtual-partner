/**
 * 情绪标签解析。
 *
 * 模型被要求在回复末尾单独一行输出 `【情绪:开心】`。流式输出时不能把半个标签
 * 直接吐给界面，所以这里边收边滤：完整标签摘掉，未闭合的尾巴先攒着。
 */

const TAG_RE = /[【\[]\s*(?:情绪|心情|emotion|emo)\s*[:：]\s*([^】\]\s]{1,16})\s*[】\]]/gi;

/** 中文情绪词 → 内部 key */
const ALIASES: Record<string, string> = {
  平静: 'neutral',
  中性: 'neutral',
  普通: 'neutral',
  开心: 'happy',
  高兴: 'happy',
  快乐: 'happy',
  喜悦: 'happy',
  兴奋: 'excited',
  激动: 'excited',
  难过: 'sad',
  伤心: 'sad',
  悲伤: 'sad',
  委屈: 'sad',
  生气: 'angry',
  愤怒: 'angry',
  恼火: 'angry',
  惊讶: 'surprised',
  吃惊: 'surprised',
  震惊: 'surprised',
  害羞: 'shy',
  脸红: 'shy',
  羞涩: 'shy',
  思考: 'thinking',
  思索: 'thinking',
  困倦: 'sleepy',
  困: 'sleepy',
  疲惫: 'sleepy',
  困惑: 'confused',
  疑惑: 'confused',
  迷茫: 'confused',
};

export function normalizeEmotion(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const key = raw.trim().toLowerCase();
  if (!key) return null;
  if (ALIASES[key]) return ALIASES[key];
  if (/^[a-z_]+$/.test(key)) return key;
  return ALIASES[raw.trim()] ?? null;
}

/** 从完整文本里摘掉情绪标签，返回干净文本与情绪 */
export function extractEmotion(text: string): { text: string; emotion: string | null } {
  let emotion: string | null = null;
  TAG_RE.lastIndex = 0;
  const clean = text.replace(TAG_RE, (_m, name: string) => {
    emotion = normalizeEmotion(name) ?? emotion;
    return '';
  });
  return { text: clean.replace(/[ \t]+\n/g, '\n').trim(), emotion };
}

/**
 * 流式过滤器：完整标签直接吞掉，未闭合的 `【情绪:开` 先留在内部缓冲，
 * 避免界面上一闪而过的半个标签。
 */
export class EmotionStripper {
  private buf = '';
  private emotion: string | null = null;

  /** 喂入一段增量，返回可以安全展示的部分 */
  push(chunk: string): string {
    if (!chunk) return '';
    this.buf += chunk;
    // drain 内部已经消费并改写了 buf，这里不要再按返回长度二次截断
    return this.drain(false);
  }

  /** 流结束，把剩余缓冲吐出来 */
  flush(): string {
    const out = this.drain(true);
    this.buf = '';
    return out;
  }

  get detectedEmotion(): string | null {
    return this.emotion;
  }

  private drain(final: boolean): string {
    let result = '';
    let guard = 0;
    while (this.buf.length > 0 && guard++ < 500) {
      TAG_RE.lastIndex = 0;
      const m = TAG_RE.exec(this.buf);
      if (m) {
        result += this.buf.slice(0, m.index);
        this.emotion = normalizeEmotion(m[1]) ?? this.emotion;
        this.buf = this.buf.slice(m.index + m[0].length);
        continue;
      }
      if (!final) {
        // 存在未闭合的标签起始符 → 从那里截断，留到下一轮
        const open = Math.max(this.buf.lastIndexOf('【'), this.buf.lastIndexOf('['));
        const close = Math.max(this.buf.lastIndexOf('】'), this.buf.lastIndexOf(']'));
        if (open > close) {
          result += this.buf.slice(0, open);
          this.buf = this.buf.slice(open);
          // 缓冲过长说明不是标签，直接放行，避免卡住输出
          if (this.buf.length > 48) {
            result += this.buf;
            this.buf = '';
          }
          break;
        }
      }
      result += this.buf;
      this.buf = '';
      break;
    }
    return result;
  }
}
