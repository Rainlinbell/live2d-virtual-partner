import type { AnyLive2DModel } from './modelLoader';

/**
 * 随机 idle 小动作，让角色不像一张静止贴图。
 *
 * 每 20~60s 随机播一次 idle / tap_body 动作；生成回复或说话期间暂停，避免与
 * 情绪/口型动作抢参数。
 */

const IDLE_GROUPS = ['idle', 'tap_body'];

let model: AnyLive2DModel | null = null;
let streaming = false;
let timer: number | null = null;

function nextDelay(): number {
  return 20_000 + Math.random() * 40_000;
}

function schedule(): void {
  if (timer) window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    timer = null;
    if (model && !streaming) playIdle();
    schedule();
  }, nextDelay());
}

function playIdle(): void {
  const m = model;
  if (!m) return;
  const group = IDLE_GROUPS[Math.floor(Math.random() * IDLE_GROUPS.length)];
  const motion = (m as unknown as { motion?: (g?: string, i?: number, p?: number) => Promise<boolean> }).motion;
  if (typeof motion === 'function') {
    void Promise.resolve(motion(group, undefined, 2)).catch(() => undefined);
  }
}

export function setIdleModel(m: AnyLive2DModel | null): void {
  model = m;
}

export function setIdleStreaming(v: boolean): void {
  streaming = v;
}

export function startIdle(): void {
  schedule();
}

export function stopIdle(): void {
  if (timer) window.clearTimeout(timer);
  timer = null;
  model = null;
  streaming = false;
}
