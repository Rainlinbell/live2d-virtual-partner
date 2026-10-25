import { app } from 'electron';
import { configStore } from './configStore';

/**
 * 开机自启。开发模式下不写注册表，避免把 electron.exe 塞进启动项。
 */
export function applyAutoLaunch(enabled: boolean): void {
  if (!app.isPackaged) return;
  try {
    app.setLoginItemSettings({
      openAtLogin: enabled,
      path: process.execPath,
      args: [],
    });
  } catch (e) {
    console.warn('[autolaunch] 设置开机自启失败:', (e as Error).message);
  }
}

export function setAutoLaunch(enabled: boolean): void {
  configStore.set({ autoLaunch: enabled });
  applyAutoLaunch(enabled);
}

export function isAutoLaunchEnabled(): boolean {
  if (!app.isPackaged) return configStore.get().autoLaunch;
  try {
    return app.getLoginItemSettings().openAtLogin;
  } catch {
    return configStore.get().autoLaunch;
  }
}
