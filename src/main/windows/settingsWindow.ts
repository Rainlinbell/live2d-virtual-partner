import { BrowserWindow } from 'electron';
import { loadRendererPage, getPreloadPath } from './util';

let settingsWin: BrowserWindow | null = null;

export function openSettingsWindow(): void {
  if (settingsWin) {
    settingsWin.focus();
    return;
  }

  settingsWin = new BrowserWindow({
    width: 760,
    height: 580,
    minWidth: 560,
    minHeight: 480,
    title: '设置',
    autoHideMenuBar: true,
    webPreferences: {
      preload: getPreloadPath(),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  loadRendererPage(settingsWin, 'settings');

  settingsWin.on('closed', () => {
    settingsWin = null;
  });
}

export function getSettingsWindow(): BrowserWindow | null {
  return settingsWin;
}
