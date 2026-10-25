import { BrowserWindow } from 'electron';
import { loadRendererPage, getPreloadPath } from './util';

let chatWin: BrowserWindow | null = null;

export function openChatWindow(): void {
  if (chatWin) {
    chatWin.focus();
    return;
  }

  chatWin = new BrowserWindow({
    width: 780,
    height: 600,
    minWidth: 480,
    minHeight: 400,
    title: '聊天记录',
    autoHideMenuBar: true,
    webPreferences: {
      preload: getPreloadPath(),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  loadRendererPage(chatWin, 'chat');

  chatWin.on('closed', () => {
    chatWin = null;
  });
}
