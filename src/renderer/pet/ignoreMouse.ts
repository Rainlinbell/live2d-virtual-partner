/**
 * 点击穿透的命中检测。
 *
 * 旧实现把 `ignoring` 藏在闭包里，拖动时 DragHandle 直接调 setIgnoreMouse(false)
 * 绕过了它：窗口实际变成可交互、变量却还是 true，之后再也发不出「恢复穿透」的
 * IPC —— 拖一次模型就永远挡鼠标。
 *
 * 现在所有改变穿透状态的地方都走这里，`ignoring` 严格跟随真实状态。
 */

let ignoring = true;
let lastMoveAt = 0;
let initialized = false;
let readClickThrough: () => boolean = () => true;

/** 节流：mousemove 很密集，没必要每帧都做 elementFromPoint */
const THROTTLE_MS = 40;

function apply(next: boolean): void {
  if (next === ignoring) return;
  ignoring = next;
  void window.api.setIgnoreMouse(next);
}

/** 指针下是否是可交互元素 */
function hitInteractive(x: number, y: number): boolean {
  const el = document.elementFromPoint(x, y);
  if (!el) return false;
  return Boolean((el as HTMLElement).closest?.('[data-interactive]'));
}

function onMouseMove(event: MouseEvent): void {
  if (!readClickThrough()) {
    apply(false);
    return;
  }
  const now = performance.now();
  if (now - lastMoveAt < THROTTLE_MS) return;
  lastMoveAt = now;
  apply(!hitInteractive(event.clientX, event.clientY));
}

/** 拖动等场景临时强制可交互 */
export function forceInteractive(): void {
  apply(false);
}

/** 拖动结束后交还给命中检测 */
export function resumeHitTest(): void {
  apply(true);
}

/** 初始化，返回清理函数 */
export function initIgnoreMouse(getClickThrough: () => boolean): () => void {
  readClickThrough = getClickThrough;
  if (initialized) return () => undefined;
  initialized = true;

  // 初始状态与主进程保持一致
  ignoring = !getClickThrough();
  void window.api.setIgnoreMouse(ignoring);

  document.addEventListener('mousemove', onMouseMove, { passive: true });

  return () => {
    document.removeEventListener('mousemove', onMouseMove);
    initialized = false;
  };
}
