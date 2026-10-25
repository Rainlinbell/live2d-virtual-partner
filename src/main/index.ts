import { app, globalShortcut, session } from 'electron';
import { configStore } from './services/configStore';
import { historyStore } from './services/historyStore';
import { ensureModelsDir, migrateLegacyModelsDir } from './services/modelManager';
import { registerSchemePrivileges, installProtocolHandler } from './services/protocol';
import { createPetWindow, applyVisibilityPolicy, persistPetPosition } from './windows/petWindow';
import { createTray, destroyTray } from './tray';
import { registerIpc } from './ipc';
import { onebotManager } from './services/onebotManager';
import { chatPipeline } from './services/chatPipeline';
import { applyAutoLaunch } from './services/autolaunch';
import { initLogger, closeLogger } from './logger';

// Electron 允许自动播放音频（TTS 无需用户手势）
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// Windows 任务栏/通知分组用，缺失会导致通知不显示应用名
if (process.platform === 'win32') {
  app.setAppUserModelId('com.live2d.virtualpartner');
}

// 自定义协议特权必须在 app ready 之前注册
registerSchemePrivileges();

/** 全局热键：唤出宠物气泡（方便快速对话） */
function registerGlobalShortcut(): void {
  try {
    const ok = globalShortcut.register('CommandOrControl+Alt+P', () => {
      const pet = createPetWindow();
      if (!pet.isVisible()) pet.showInactive();
      pet.webContents.send('pet:toggle-bubble');
    });
    if (!ok) console.warn('[hotkey] 全局热键注册失败（可能已被其他应用占用）');
  } catch (e) {
    console.warn('[hotkey] 全局热键注册失败:', (e as Error).message);
  }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  initLogger();

  app.on('second-instance', () => {
    const pet = createPetWindow();
    if (!pet.isVisible()) pet.showInactive();
    pet.webContents.send('pet:toggle-bubble');
  });

  app.whenReady().then(() => {
    configStore.init();
    historyStore.init();
    ensureModelsDir();
    migrateLegacyModelsDir();
    installProtocolHandler();
    registerIpc();
    createPetWindow();
    createTray();
    registerGlobalShortcut();

    // 配置变化时的副作用：OneBot 连接、全屏可见性、开机自启
    configStore.onChange(() => {
      onebotManager.syncAll();
      applyVisibilityPolicy();
      applyAutoLaunch(configStore.get().autoLaunch);
    });
    onebotManager.syncAll();
    applyAutoLaunch(configStore.get().autoLaunch);

    // 打包后收紧 CSP（开发模式下 Vite 需要 eval/inline，故只对正式包生效）
    if (app.isPackaged) {
      session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
        callback({
          responseHeaders: {
            ...details.responseHeaders,
            'Content-Security-Policy': [
              "default-src 'self'; script-src 'self' live2d:; style-src 'self' 'unsafe-inline'; " +
                "img-src 'self' data: blob: live2d:; media-src 'self' data: blob: live2d:; " +
                "connect-src 'self' live2d:; font-src 'self' data:",
            ],
          },
        });
      });
    }

    // 不允许渲染层开新窗口或跳走
    app.on('web-contents-created', (_e, contents) => {
      contents.setWindowOpenHandler(() => ({ action: 'deny' }));
      contents.on('will-navigate', (event, url) => {
        const devUrl = process.env['ELECTRON_RENDERER_URL'];
        if (devUrl && url.startsWith(devUrl)) return;
        if (url.startsWith('file://')) return;
        event.preventDefault();
      });
    });

    app.on('activate', () => {
      createPetWindow();
    });
  });

  app.on('before-quit', () => {
    try {
      persistPetPosition();
      chatPipeline.abort();
      onebotManager.disconnectAll();
      historyStore.flush();
      destroyTray();
    } catch (e) {
      console.error('[app] 退出清理失败:', e);
    }
    globalShortcut.unregisterAll();
    closeLogger();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
