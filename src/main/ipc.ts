import { BrowserWindow, app, dialog, ipcMain, shell } from 'electron';
import * as fs from 'fs';
import { configStore } from './services/configStore';
import { historyStore } from './services/historyStore';
import { chatPipeline } from './services/chatPipeline';
import { testConnection } from './services/llmService';
import { speak, testSpeech, clearSpeechCache } from './services/ttsService';
import { transcribe } from './services/sttService';
import {
  chooseModelsDir,
  coreDir,
  deleteModel,
  ensureModelsDir,
  getCoreStatus,
  importModelFolder,
  importModelZip,
  installCoreFile,
  listModels,
  modelsDir,
} from './services/modelManager';
import { onebotManager } from './services/onebotManager';
import { exportCharacterCardDialog, importCharacterCardDialog } from './services/characterCard';
import { chatToMarkdown } from './services/chatExport';
import {
  focusPetWindow,
  getPetWindow,
  movePet,
  persistPetPosition,
  setPetClickThrough,
  setPetIgnoreMouse,
  togglePetVisibility,
} from './windows/petWindow';
import { openChatWindow } from './windows/chatWindow';
import { getSettingsWindow, openSettingsWindow } from './windows/settingsWindow';
import { isAutoLaunchEnabled, setAutoLaunch } from './services/autolaunch';
import { logsDir } from './logger';
import { sessionScope } from '../shared/scope';
import { MEMORY_IMPORTANCE } from '../shared/types';
import type { AppConfig, AppInfo, Character, MemoryCategory, MemoryEntry } from '../shared/types';

/** 弹窗优先挂在当前聚焦窗口上 */
function dialogParent(): BrowserWindow | undefined {
  return BrowserWindow.getFocusedWindow() ?? getSettingsWindow() ?? getPetWindow() ?? undefined;
}

function requireParent(): BrowserWindow | null {
  return dialogParent() ?? null;
}

/** 当前角色；没有角色时返回 null（角色列表允许为空） */
function currentChar(): Character | null {
  return configStore.currentCharacter() ?? null;
}

/** 当前角色 + 当前会话的桌面作用域 */
function desktopScopeFor(characterId: string): string {
  return sessionScope(characterId, configStore.currentSessionFor(characterId));
}

export function registerIpc(): void {
  /* ---- 全局配置 ---- */
  ipcMain.handle('config:get', () => configStore.publicConfig());
  ipcMain.handle('config:get-secrets', () => configStore.getSecrets());
  ipcMain.handle('config:set', (_e, partial: Partial<AppConfig>) => {
    configStore.setFromRenderer(partial);
    // 语音服务参数变了，缓存里的音频可能对不上
    if (partial.tts) clearSpeechCache();
  });

  /* ---- 角色管理 ---- */
  ipcMain.handle('character:add', (_e, char: Omit<Character, 'id'>) =>
    configStore.addCharacter(char),
  );
  ipcMain.handle('character:update', (_e, id: string, partial: Partial<Character>) => {
    // 音色变化时清空 TTS 缓存，避免旧音色音频继续占用缓存
    const cur = configStore.getCharacter(id);
    if (partial.voice !== undefined && cur && partial.voice !== cur.voice) clearSpeechCache();
    configStore.updateCharacter(id, partial);
  });
  ipcMain.handle('character:delete', (_e, id: string) => {
    onebotManager.disconnect(id);
    configStore.deleteCharacter(id);
    historyStore.removeAllScopes(id);
  });
  ipcMain.handle('character:set-current', (_e, id: string) => configStore.setCurrentCharacter(id));
  ipcMain.handle('character:import-card', async () => {
    const parent = requireParent();
    if (!parent) return null;
    const data = await importCharacterCardDialog(parent);
    if (!data) return null;
    return configStore.addCharacter(data);
  });
  ipcMain.handle('character:export-card', async (_e, id: string) => {
    const parent = requireParent();
    const character = configStore.getCharacter(id);
    if (!parent || !character) return false;
    return exportCharacterCardDialog(parent, character);
  });

  /* ---- 模型 ---- */
  ipcMain.handle('models:list', () => listModels());
  ipcMain.handle('models:importZip', async () => {
    const parent = requireParent();
    if (!parent) return null;
    return importModelZip(parent);
  });
  ipcMain.handle('models:importFolder', async () => {
    const parent = requireParent();
    if (!parent) return null;
    return importModelFolder(parent);
  });
  ipcMain.handle('models:delete', (_e, name: string) => deleteModel(name));
  ipcMain.handle('models:activate', (_e, name: string) => {
    const cur = currentChar();
    if (!cur) return;
    configStore.updateCharacter(cur.id, { activeModel: name });
  });
  ipcMain.handle('models:core-status', () => getCoreStatus());
  ipcMain.handle('models:open-core-dir', async () => {
    await shell.openPath(coreDir());
  });
  ipcMain.handle('models:open-models-dir', async () => {
    await shell.openPath(ensureModelsDir());
  });
  ipcMain.handle('models:choose-core', async (_e, cubism: 4 | 2) => {
    const parent = requireParent();
    if (!parent) return false;
    return installCoreFile(parent, cubism);
  });
  ipcMain.handle('models:choose-dir', async () => {
    const parent = requireParent();
    if (!parent) return null;
    return chooseModelsDir(parent);
  });

  /* ---- 对话（当前角色 + 当前会话） ---- */
  ipcMain.handle('chat:send', (_e, text: string) => {
    const char = currentChar();
    if (!char) return { reply: '', error: '还没有角色，请先在设置里新建或导入' };
    return chatPipeline.send(char.id, text, 'desktop', desktopScopeFor(char.id));
  });
  ipcMain.handle('chat:regenerate', () => {
    const char = currentChar();
    if (!char) return { reply: '', error: '还没有角色' };
    return chatPipeline.regenerate(char.id, desktopScopeFor(char.id));
  });
  ipcMain.handle('chat:abort', () => {
    const char = currentChar();
    if (!char) return;
    chatPipeline.abort(desktopScopeFor(char.id));
  });
  ipcMain.handle('chat:proactive', () => {
    const char = currentChar();
    if (!char) return { reply: '' };
    return chatPipeline.proactive(char.id, desktopScopeFor(char.id));
  });
  ipcMain.handle('chat:history:get', () => {
    const char = currentChar();
    return char ? historyStore.getAll(desktopScopeFor(char.id)) : [];
  });
  ipcMain.handle('chat:history:clear', () => {
    const char = currentChar();
    if (char) historyStore.clear(desktopScopeFor(char.id));
  });
  ipcMain.handle('chat:export', async () => {
    const char = currentChar();
    if (!char) return false;
    const messages = historyStore.getAll(desktopScopeFor(char.id));
    if (messages.length === 0) return false;

    const parent = dialogParent();
    const stamp = new Date().toISOString().slice(0, 10);
    const result = parent
      ? await dialog.showSaveDialog(parent, {
          title: '导出聊天记录',
          defaultPath: `${char.name}-${stamp}.md`,
          filters: [{ name: 'Markdown', extensions: ['md'] }],
        })
      : await dialog.showSaveDialog({
          title: '导出聊天记录',
          defaultPath: `${char.name}-${stamp}.md`,
          filters: [{ name: 'Markdown', extensions: ['md'] }],
        });
    if (result.canceled || !result.filePath) return false;

    await fs.promises.writeFile(result.filePath, chatToMarkdown(char, messages), 'utf8');
    return true;
  });
  ipcMain.handle('chat:memory:get', () => {
    const char = currentChar();
    return char ? historyStore.getMemories(desktopScopeFor(char.id)) : [];
  });
  ipcMain.handle('chat:memory:add', (_e, text: string, category: MemoryCategory = 'fact') => {
    const char = currentChar();
    if (!char) return [];
    const cat = category ?? 'fact';
    return historyStore.addMemories(
      desktopScopeFor(char.id),
      [{ text, category: cat, importance: MEMORY_IMPORTANCE[cat] ?? 0.5 }],
      configStore.get().memory.maxEntries,
    );
  });
  ipcMain.handle(
    'chat:memory:update',
    (_e, id: string, patch: Partial<Pick<MemoryEntry, 'text' | 'category' | 'importance'>>) => {
      const char = currentChar();
      if (char) historyStore.updateMemory(desktopScopeFor(char.id), id, patch);
    },
  );
  ipcMain.handle('chat:memory:delete', (_e, id: string) => {
    const char = currentChar();
    if (char) historyStore.removeMemory(desktopScopeFor(char.id), id);
  });
  ipcMain.handle('chat:memory:clear', () => {
    const char = currentChar();
    if (char) historyStore.clearMemories(desktopScopeFor(char.id));
  });

  /* ---- 会话（多会话） ---- */
  ipcMain.handle('session:list', () => {
    const char = currentChar();
    return char ? configStore.getSessions(char.id) : [];
  });
  ipcMain.handle('session:new', (_e, name: string) => {
    const char = currentChar();
    if (!char) return null;
    return configStore.addSession(char.id, (name ?? '').trim() || `会话${configStore.getSessions(char.id).length + 1}`);
  });
  ipcMain.handle('session:switch', (_e, id: string) => {
    const char = currentChar();
    if (char) configStore.setCurrentSession(char.id, id);
  });
  ipcMain.handle('session:delete', (_e, id: string) => {
    const cfg = configStore.get();
    const target = cfg.sessions.find((s) => s.id === id);
    configStore.deleteSession(id);
    if (target) historyStore.removeScope(sessionScope(target.characterId, id));
  });

  ipcMain.handle('llm:test', () => testConnection(configStore.get()));

  /* ---- 语音 ---- */
  ipcMain.handle('tts:speak', async (_e, text: string, voice?: string) => {
    const out = await speak(configStore.get(), text, voice);
    // 只把 ArrayList 的字节拷出去，避免把 Node Buffer 的池化内存一起传过去
    const audio = out.buffer.buffer.slice(
      out.buffer.byteOffset,
      out.buffer.byteOffset + out.buffer.byteLength,
    ) as ArrayBuffer;
    return { audio, mime: out.mime };
  });
  ipcMain.handle('tts:test', () => testSpeech(configStore.get()));
  ipcMain.handle('stt:transcribe', (_e, arrayBuf: ArrayBuffer, mime: string) =>
    transcribe(configStore.get(), Buffer.from(new Uint8Array(arrayBuf)), mime),
  );

  /* ---- OneBot ---- */
  ipcMain.handle('onebot:connect', (_e, characterId: string) => onebotManager.connect(characterId));
  ipcMain.handle('onebot:disconnect', (_e, characterId: string) =>
    onebotManager.disconnect(characterId),
  );
  ipcMain.handle('onebot:status', (_e, characterId: string) => onebotManager.getStatus(characterId));

  /* ---- 窗口 ---- */
  ipcMain.handle('window:setIgnoreMouseEvents', (_e, ignore: boolean) => {
    setPetIgnoreMouse(ignore);
  });
  ipcMain.handle('pet:get-position', () => {
    const pet = getPetWindow();
    if (!pet) return { x: 0, y: 0 };
    const [x, y] = pet.getPosition();
    return { x, y };
  });
  ipcMain.handle('pet:set-position', (_e, x: number, y: number) => movePet(x, y));
  ipcMain.handle('pet:click-through', (_e, on: boolean) => {
    setPetClickThrough(on);
    return on;
  });
  ipcMain.handle('pet:get-click-through', () => configStore.get().petWindow.clickThrough);
  ipcMain.handle('pet:toggle-bubble', () => {
    const pet = getPetWindow();
    if (!pet) return;
    // 托盘里点「快速对话」时宠物窗可能处于不可聚焦状态，先恢复再展开
    focusPetWindow();
    pet.webContents.send('pet:toggle-bubble');
  });
  ipcMain.handle('pet:toggle-visible', () => togglePetVisibility());
  ipcMain.handle('pet:persist-position', () => persistPetPosition());

  ipcMain.handle('panel:openChat', () => openChatWindow());
  ipcMain.handle('panel:openSettings', () => openSettingsWindow());

  /* ---- 应用 ---- */
  ipcMain.handle('app:get-info', (): AppInfo => ({
    version: app.getVersion(),
    electron: process.versions.electron ?? '',
    chrome: process.versions.chrome ?? '',
    node: process.versions.node ?? '',
    platform: `${process.platform} ${process.arch}`,
    userData: app.getPath('userData'),
    modelsDir: modelsDir(),
    coreDir: coreDir(),
    logsDir: logsDir(),
  }));
  ipcMain.handle('app:set-auto-launch', (_e, enabled: boolean) => {
    setAutoLaunch(enabled);
    return isAutoLaunchEnabled();
  });
  ipcMain.handle('app:open-logs-dir', async () => {
    await shell.openPath(logsDir());
  });
}
