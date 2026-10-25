import type { AnyLive2DModel } from './modelLoader';

/**
 * 语音播放 + 口型。
 *
 * 优先用 pixi-live2d-display-lipsyncpatch 的 model.speak()：它每帧读取音频振幅写
 * ParamMouthOpenY，且我们传入 HTMLAudioElement 后可以随时 pause()，实现打断。
 * MIME 由主进程按响应头给出，不再写死 audio/mpeg（旧实现的 P0）。
 *
 * 代际（generation）机制：所有语音播放在一个全局计数下进行。`stopVoice()` 让计数 +1
 * 并停掉正在播的那一句；分句流式 TTS（SentenceTts）按代际判断自己是否已过期，
 * 从而支持「打断」与「顺序排队」两种模式共存。
 */

let currentAudio: HTMLAudioElement | null = null;
let generation = 0;
const stoppedWaiters = new Set<() => void>();

function notifyStopped(): void {
  for (const resolve of stoppedWaiters) resolve();
  stoppedWaiters.clear();
}

/** 立即停止当前语音（新回复/用户输入打断旧播报） */
export function stopVoice(): void {
  generation += 1;
  if (currentAudio) {
    try {
      currentAudio.pause();
      currentAudio.currentTime = 0;
    } catch {
      /* ignore */
    }
  }
  currentAudio = null;
  notifyStopped();
}

/** 当前代际（供 SentenceTts 判断是否已过期） */
export function speechGeneration(): number {
  return generation;
}

/** 等待代际变化（用于让排队播放能被 stopVoice 立即打断） */
function whenStopped(gen: number): Promise<void> {
  if (gen !== generation) return Promise.resolve();
  return new Promise((resolve) => {
    stoppedWaiters.add(resolve);
  });
}

export interface SpeakOptions {
  /** 音量 0-1，默认 1 */
  volume?: number;
}

/** 兜底：直接播 HTMLAudioElement，不驱动口型 */
function playFallback(element: HTMLAudioElement): Promise<void> {
  return new Promise<void>((resolve) => {
    const done = (): void => {
      element.onended = null;
      element.onerror = null;
      resolve();
    };
    element.onended = done;
    element.onerror = done;
    void element.play().catch(done);
  });
}

/**
 * 不打断式播放一段音频并驱动口型（分句流式 TTS 的队列逐段调用）。
 * 传 gen 为开始播放时的代际；期间若 stopVoice() 使代际变化，会立即返回。
 */
export async function playSegment(
  model: AnyLive2DModel,
  audio: ArrayBuffer,
  mime: string,
  gen: number,
  volume = 1,
): Promise<void> {
  if (!audio || audio.byteLength === 0) return;
  if (gen !== generation) return;

  const blob = new Blob([audio], { type: mime || 'audio/mpeg' });
  const url = URL.createObjectURL(blob);
  const element = new Audio(url);
  element.volume = volume;
  currentAudio = element;

  let play: Promise<void>;
  try {
    const speak = (
      model as unknown as {
        speak(
          audio: string | HTMLAudioElement,
          opts?: { volume?: number; onFinish?: () => void; onError?: (e: unknown) => void },
        ): Promise<void>;
      }
    ).speak;
    if (typeof speak === 'function') {
      play = speak.call(model, element, { volume });
    } else {
      play = playFallback(element);
    }
  } catch (e) {
    console.warn('[lipsync] model.speak 失败，改用兜底播放:', e);
    play = playFallback(element);
  }

  try {
    // 被 stopVoice 打断时 whenStopped 先行 resolve，避免排队链卡住
    await Promise.race([play, whenStopped(gen)]);
  } catch (e) {
    console.warn('[lipsync] 播放中断:', e);
  } finally {
    URL.revokeObjectURL(url);
    if (currentAudio === element) currentAudio = null;
  }
}

/** 播放一段语音并驱动口型；被 stopVoice() 或后续调用打断时正常返回（单句打断式） */
export async function speakWithLipsync(
  model: AnyLive2DModel,
  audio: ArrayBuffer,
  mime: string,
  options: SpeakOptions = {},
): Promise<void> {
  if (!audio || audio.byteLength === 0) return;
  stopVoice();
  await playSegment(model, audio, mime, generation, options.volume ?? 1);
}

/** 说话时给模型一点头部/身体动作，配合情绪表现 */
export function playEmotionMotion(model: AnyLive2DModel): void {
  interface MotionCapable {
    motion?: (group?: string, index?: number, priority?: number) => Promise<boolean>;
  }
  const m = model as unknown as MotionCapable;
  if (typeof m.motion !== 'function') return;
  // 失败（模型没有该动作组）时静默忽略
  void Promise.resolve(m.motion('tap_body', undefined, 1)).catch(() => undefined);
}
