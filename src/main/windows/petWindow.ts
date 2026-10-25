import { BrowserWindow, screen } from 'electron';
import { configStore } from '../services/configStore';
import { loadRendererPage, getPreloadPath } from './util';

let petWin: BrowserWindow | null = null;
let saveTimer: NodeJS.Timeout | null = null;

/** 允许露在屏幕外的边距，防止把宠物拖丢 */
const MIN_VISIBLE = 96;

/** 把窗口位置夹到最近的显示器工作区内（多屏、拔掉副屏都安全） */
export function clampToWorkArea(
  x: number,
  y: number,
  width: number,
  height: number,
): { x: number; y: number } {
  const center = { x: Math.round(x + width / 2), y: Math.round(y + height / 2) };
  const displays = screen.getAllDisplays();
  const display =
    displays.find((d) => {
      const wa = d.workArea;
      return (
        center.x >= wa.x &&
        center.x <= wa.x + wa.width &&
        center.y >= wa.y &&
        center.y <= wa.y + wa.height
      );
    }) ?? screen.getDisplayNearestPoint(center);

  const wa = display.workArea;
  const minX = wa.x - width + MIN_VISIBLE;
  const maxX = wa.x + wa.width - MIN_VISIBLE;
  const minY = wa.y;
  const maxY = wa.y + wa.height - MIN_VISIBLE;

  return {
    x: Math.round(Math.min(Math.max(x, minX), Math.max(minX, maxX))),
    y: Math.round(Math.min(Math.max(y, minY), Math.max(minY, maxY))),
  };
}

export function createPetWindow(): BrowserWindow {
  if (petWin && !petWin.isDestroyed()) {
    if (!petWin.isVisible()) petWin.show();
    return petWin;
  }

  const cfg = configStore.get().petWindow;
  const width = cfg.width || 360;
  const height = cfg.height || 560;
  const { workArea } = screen.getPrimaryDisplay();

  // x/y 为 -1 或越界时回到右下角
  const fallback = {
    x: workArea.x + workArea.width - width - 60,
    y: workArea.y + workArea.height - height - 40,
  };
  const pos =
    cfg.x < 0 || cfg.y < 0
      ? fallback
      : clampToWorkArea(cfg.x, cfg.y, width, height);

  petWin = new BrowserWindow({
    x: pos.x,
    y: pos.y,
    width,
    height,
    transparent: true,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    alwaysOnTop: true,
    show: false,
    // 置顶但不抢焦点，避免点宠物时把用户正在用的窗口顶掉
    focusable: true,
    acceptFirstMouse: true,
    webPreferences: {
      preload: getPreloadPath(),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  petWin.setAlwaysOnTop(true, 'screen-saver');
  if (!configStore.get().hideOnFullscreen) {
    petWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }

  if (cfg.clickThrough) {
    petWin.setIgnoreMouseEvents(true, { forward: true });
    petWin.setFocusable(false);
  }

  petWin.once('ready-to-show', () => petWin?.showInactive());

  // 拖动过程中频繁触发，合并成一次写盘
  const scheduleSave = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      persistPetPosition();
    }, 400);
  };
  petWin.on('move', scheduleSave);
  petWin.on('resize', scheduleSave);

  petWin.on('closed', () => {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    petWin = null;
  });

  loadRendererPage(petWin, 'pet');
  return petWin;
}

export function getPetWindow(): BrowserWindow | null {
  return petWin && !petWin.isDestroyed() ? petWin : null;
}

/** 移动宠物（带多屏夹取） */
export function movePet(x: number, y: number): void {
  const win = getPetWindow();
  if (!win) return;
  const [w, h] = win.getSize();
  const pos = clampToWorkArea(x, y, w, h);
  win.setPosition(pos.x, pos.y);
}

/** 设置点击穿透；forward 让渲染进程仍收到 mousemove 做命中检测 */
export function setPetIgnoreMouse(ignore: boolean): void {
  const win = getPetWindow();
  if (!win) return;
  if (ignore) win.setIgnoreMouseEvents(true, { forward: true });
  else win.setIgnoreMouseEvents(false);
  // 穿透时窗口不该被激活（否则 Alt+Tab / 点桌面会切到宠物）；
  // 非穿透说明用户要和气泡交互，恢复可聚焦，但不主动 focus 去抢焦点。
  if (win.isFocusable() === ignore) win.setFocusable(!ignore);
}

/** 气泡展开时把焦点给宠物窗，让输入框能直接打字 */
export function focusPetWindow(): void {
  const win = getPetWindow();
  if (!win) return;
  if (!win.isFocusable()) win.setFocusable(true);
  if (!win.isVisible()) win.showInactive();
  win.focus();
}

/** 切换穿透模式并写回配置（托盘用） */
export function setPetClickThrough(on: boolean): void {
  configStore.patchPetWindow({ clickThrough: on }, false);
  setPetIgnoreMouse(on);
}

export function togglePetVisibility(): boolean {
  const win = getPetWindow() ?? createPetWindow();
  if (win.isVisible()) {
    win.hide();
    return false;
  }
  win.showInactive();
  return true;
}

/** 保存当前窗口位置到配置（不广播，避免拖动时全窗口重渲染） */
export function persistPetPosition(): void {
  const win = getPetWindow();
  if (!win) return;
  const [x, y] = win.getPosition();
  configStore.patchPetWindow({ x, y }, true);
}

/** 应用 hideOnFullscreen 配置 */
export function applyVisibilityPolicy(): void {
  const win = getPetWindow();
  if (!win) return;
  const hide = configStore.get().hideOnFullscreen;
  win.setVisibleOnAllWorkspaces(!hide, { visibleOnFullScreen: !hide });
}

export function destroyPetWindow(): void {
  if (petWin && !petWin.isDestroyed()) petWin.destroy();
  petWin = null;
}
