import { BrowserWindow } from 'electron';

/** 给所有窗口广播事件（设置窗、聊天窗、气泡共用） */
export function broadcast(channel: string, payload?: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    win.webContents.send(channel, payload);
  }
}
