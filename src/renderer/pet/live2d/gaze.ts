import type { AnyLive2DModel } from './modelLoader';

/**
 * 视线跟随（鼠标）。
 *
 * 非摄像头模式下，宠物窗以 `setIgnoreMouseEvents(true, { forward: true })` 穿透，
 * 但渲染进程仍能收到 mousemove。把屏幕坐标喂给 model.focus()，让头部/眼球跟着
 * 鼠标走；鼠标静止约 3s 后回归「看镜头」。
 *
 * 摄像头开启并启用 follow 时会调用 setGazeEnabled(false) 关闭鼠标跟随，避免两者抢 focus。
 */

const IDLE_MS = 3000;

let model: AnyLive2DModel | null = null;
let enabled = false;
let lastMoveAt = 0;
let bound = false;

function bind(): void {
  if (bound) return;
  bound = true;
  window.addEventListener('mousemove', onMove, { passive: true });
  window.setInterval(checkIdle, 1000);
}

function onMove(event: MouseEvent): void {
  if (!enabled) return;
  lastMoveAt = performance.now();
  model?.focus(event.clientX, event.clientY);
}

function checkIdle(): void {
  if (!enabled || !model) return;
  if (performance.now() - lastMoveAt > IDLE_MS) {
    model.focus(window.innerWidth / 2, window.innerHeight / 2, true);
  }
}

export function setGazeModel(m: AnyLive2DModel | null): void {
  model = m;
}

export function setGazeEnabled(v: boolean): void {
  enabled = v;
  if (v) {
    bind();
    lastMoveAt = performance.now();
  }
}
