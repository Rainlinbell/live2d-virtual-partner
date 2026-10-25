<script setup lang="ts">
import { forceInteractive, resumeHitTest } from '../ignoreMouse';

/**
 * 拖动把手。
 *
 * 旧实现有三个问题：无条件 setIgnoreMouse(false) 让穿透状态变量失真；
 * 每次 mousedown 都往 window 上挂 listener；松手后又用配置广播保存位置，
 * 引起全窗口重渲染。现在改为 pointer 事件 + 主进程落盘位置。
 */

let dragging = false;
let startScreen = { x: 0, y: 0 };
let startWindow = { x: 0, y: 0 };
let pointerId: number | null = null;

async function onPointerDown(event: PointerEvent): Promise<void> {
  if (dragging) return;
  event.preventDefault();

  forceInteractive();
  dragging = true;
  pointerId = event.pointerId;
  startScreen = { x: event.screenX, y: event.screenY };
  startWindow = await window.api.petGetPosition();

  (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerUp);
}

function onPointerMove(event: PointerEvent): void {
  if (!dragging) return;
  void window.api.petSetPosition(
    Math.round(startWindow.x + event.screenX - startScreen.x),
    Math.round(startWindow.y + event.screenY - startScreen.y),
  );
}

function onPointerUp(): void {
  if (!dragging) return;
  dragging = false;
  if (pointerId !== null) pointerId = null;
  window.removeEventListener('pointermove', onPointerMove);
  window.removeEventListener('pointerup', onPointerUp);
  window.removeEventListener('pointercancel', onPointerUp);
  // 位置已由主进程在拖动停止后写入配置，这里只恢复穿透检测
  resumeHitTest();
}
</script>

<template>
  <button class="drag-handle" title="按住拖动我" @pointerdown="onPointerDown">拖动</button>
</template>

<style scoped>
.drag-handle {
  border: none;
  background: transparent;
  color: #999;
  cursor: grab;
  font-size: 12px;
  padding: 2px 6px;
  touch-action: none;
}
.drag-handle:active {
  cursor: grabbing;
  color: #6495ed;
}
</style>
