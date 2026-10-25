import * as PIXI from 'pixi.js';
import { install as installUnsafeEval } from '@pixi/unsafe-eval';

// 生产构建注入了 CSP（禁止 unsafe-eval），PIXI 7 需要这个补丁才能编译着色器
installUnsafeEval(PIXI);

// pixi-live2d-display 内部从全局 PIXI 取对象，必须先挂上
(window as unknown as { PIXI: typeof PIXI }).PIXI = PIXI;

export function createStage(canvas: HTMLCanvasElement): PIXI.Application {
  return new PIXI.Application({
    view: canvas,
    resizeTo: window,
    backgroundAlpha: 0,
    autoDensity: true,
    antialias: true,
    resolution: window.devicePixelRatio || 1,
  });
}
