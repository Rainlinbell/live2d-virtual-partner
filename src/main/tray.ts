import { app, Menu, Tray, nativeImage, shell } from 'electron';
import { openChatWindow } from './windows/chatWindow';
import { openSettingsWindow } from './windows/settingsWindow';
import {
  getPetWindow,
  persistPetPosition,
  setPetClickThrough,
  togglePetVisibility,
} from './windows/petWindow';
import { configStore } from './services/configStore';
import { getCoreStatus } from './services/modelManager';
import { isAutoLaunchEnabled, setAutoLaunch } from './services/autolaunch';
import { logsDir } from './logger';

/** 内嵌 PNG 托盘图标（蓝色圆脸），避免依赖外部资源路径 */
const TRAY_ICON_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAKBSURBVFhH1VcxaxRBFE5pmdLSn2CZMj/B0u5CdsDYiGCTUhsbiytuJlEQU1hEQYlYJKCIKZSDgCgoJNgEQyDE3bmNieeex5mV7+3d5O7N7O5NkhX84Gtuvn1v3pud791OTPyvEAvRVNAIp4fJNeeKmty/KFQ4J1S0JpRO8xhI3QxkOH9tMb7EY5wKtXo8GSh9W0id8GRlDGRrERvnMccG2ipUFPPAXpQ6mW18v8pjl0LIaOY0VecRXeQ5ckHJHUHOykDpOs9lgdp+jpXbDOd4ToPsTT/jmZcRxcn9yzw3AS2yHqiCUq/w3Fn1Ba2/9+KQeP1+y1rjHEvLuwDzsERKU5Ct3W46wF6rl9546A7so4VHsA3oJheBavXIBBzgybu2pfPVCqX3THK4nUNAfPTmJ4+ZPm+6g/poiYNjwGCxFvu8tRSnB+0/JmC3d5zeeXpg6Xy1oHHIWRVe4Ys88MuNX8SigL5a0YhuZh2gKecQVExjz2gFX/wXxM3LbgBNPVtQOWU0k90CsmCHoGouRFP9i0gTcNsSVEmpk9rS9gWzgaI5AIeDyfDfi/jg1RHdCP67IZ8HMAVL1E++E/boXiMoX3cR1w8e0O4c51oxrv7IBrJN6BUuBB+vZw6HoHC2osrghkgMrH5IrHUwUPojz03I6wIIYxnGxtffxnDA9S+dNDo8ccHP37q509BZ/QB5UxG8++xH+n6zQ53IA6y46H2xpqALQrWW+YPDxLniWFD5608JjWAcTZn1YuKOvPl5gKhsE76k5PV4kucqBH2QOIL5kj5Qxqnchb5Nv+VBx2Gg9GbhC+eDbGS3lov+N54wWjM+XwXoa1iG8ziiETbCad9W/wVBP51kZuz+BAAAAABJRU5ErkJggg==';

let tray: Tray | null = null;
let lastSignature = '';

function makeTrayIcon() {
  return nativeImage.createFromDataURL(TRAY_ICON_DATA_URL);
}

/** 只在这些配置变化时才需要重建菜单 */
function menuSignature(): string {
  const cfg = configStore.get();
  const core = getCoreStatus();
  return [
    cfg.petWindow.clickThrough,
    cfg.autoLaunch,
    cfg.hideOnFullscreen,
    cfg.currentCharacterId,
    cfg.characters.length,
    core.cubism4,
    core.cubism2,
  ].join('|');
}

function rebuildMenu(): void {
  if (!tray) return;
  lastSignature = menuSignature();

  const pet = getPetWindow();
  const cfg = configStore.get();
  const clickThrough = cfg.petWindow.clickThrough;
  const core = getCoreStatus();
  const missing: string[] = [];
  if (!core.cubism4) missing.push('Cubism 4 Core');
  if (!core.cubism2) missing.push('Cubism 2 Core');
  tray.setToolTip(
    missing.length
      ? `Live2D 虚拟伴侣 — 缺少 ${missing.join(' / ')}`
      : `Live2D 虚拟伴侣 — ${cfg.characters.length} 个角色`,
  );

  const menu = Menu.buildFromTemplate([
    {
      label: clickThrough ? '当前：穿透模式' : '当前：交互模式',
      enabled: false,
    },
    {
      label: clickThrough ? '切换为交互模式' : '切换为穿透模式',
      click: () => setPetClickThrough(!configStore.get().petWindow.clickThrough),
    },
    {
      label: pet?.isVisible() ? '隐藏宠物' : '显示宠物',
      click: () => togglePetVisibility(),
    },
    { type: 'separator' },
    {
      label: '快速对话',
      click: () => {
        const win = getPetWindow();
        if (win) {
          win.showInactive();
          win.webContents.send('pet:toggle-bubble');
        }
      },
    },
    { label: '聊天记录', click: openChatWindow },
    { label: '设置', click: openSettingsWindow },
    { type: 'separator' },
    {
      label: '开机自启',
      type: 'checkbox',
      checked: isAutoLaunchEnabled(),
      click: (item) => setAutoLaunch(item.checked),
    },
    {
      label: '打开日志目录',
      click: () => {
        void shell.openPath(logsDir());
      },
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        persistPetPosition();
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(menu);
}

export function createTray(): Tray {
  tray = new Tray(makeTrayIcon());
  rebuildMenu();

  // 拖动宠物会写配置，用签名过滤掉无关变更，避免菜单被反复重建
  configStore.onChange(() => {
    if (menuSignature() !== lastSignature) rebuildMenu();
  });

  tray.on('click', () => {
    const win = getPetWindow();
    if (win) {
      win.showInactive();
      win.webContents.send('pet:toggle-bubble');
    }
  });

  return tray;
}

export function getTray(): Tray | null {
  return tray;
}

export function destroyTray(): void {
  tray?.destroy();
  tray = null;
}
