/// <reference types="vite/client" />
import type { IpcApi } from '../shared/types';

declare global {
  interface Window {
    api: IpcApi;
    /** Cubism 4 Core，由 live2d://core/live2dcubismcore.min.js 动态加载 */
    Live2DCubismCore?: unknown;
    /** Cubism 2 Core，由 live2d://core/live2d.min.js 动态加载 */
    Live2D?: unknown;
    PIXI?: unknown;
  }
}

export {};
