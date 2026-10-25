import { BrowserWindow } from 'electron';
import * as path from 'path';

/** 加载渲染进程页面（开发走 dev server，生产走打包文件） */
export function loadRendererPage(win: BrowserWindow, page: 'pet' | 'chat' | 'settings'): void {
  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (devUrl) {
    win.loadURL(`${devUrl}/${page}/index.html`);
  } else {
    win.loadFile(path.join(__dirname, `../renderer/${page}/index.html`));
  }
}

export function getPreloadPath(): string {
  return path.join(__dirname, '../preload/index.js');
}
