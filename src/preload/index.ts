import { contextBridge, ipcRenderer } from 'electron';
import type {
  AppConfig,
  AppInfo,
  Character,
  ChatChunkEvent,
  ChatDoneEvent,
  ChatErrorEvent,
  ChatUserEvent,
  IpcApi,
  MemoryCategory,
  MemoryEntry,
  OneBotConnectionStatus,
} from '../shared/types';

/** 订阅主进程事件，返回取消订阅函数（渲染层组件卸载时必须调用） */
function subscribe<T>(channel: string) {
  return (cb: (payload: T) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, payload: T) => cb(payload);
    ipcRenderer.on(channel, listener);
    return () => {
      ipcRenderer.removeListener(channel, listener);
    };
  };
}

const invoke = ipcRenderer.invoke.bind(ipcRenderer);

const api: IpcApi = {
  /* ---- 配置 ---- */
  getConfig: () => invoke('config:get'),
  setConfig: (partial: Partial<AppConfig>) => invoke('config:set', partial),
  getSecrets: () => invoke('config:get-secrets'),
  onConfigChanged: subscribe<AppConfig>('config:changed'),

  /* ---- 角色 ---- */
  addCharacter: (char: Omit<Character, 'id'>) => invoke('character:add', char),
  updateCharacter: (id: string, partial: Partial<Character>) =>
    invoke('character:update', id, partial),
  deleteCharacter: (id: string) => invoke('character:delete', id),
  setCurrentCharacter: (id: string) => invoke('character:set-current', id),
  importCharacterCard: () => invoke('character:import-card'),
  exportCharacterCard: (id: string) => invoke('character:export-card', id),

  /* ---- 模型 ---- */
  listModels: () => invoke('models:list'),
  importModelZip: () => invoke('models:importZip'),
  importModelFolder: () => invoke('models:importFolder'),
  deleteModel: (name: string) => invoke('models:delete', name),
  activateModel: (name: string) => invoke('models:activate', name),
  getCoreStatus: () => invoke('models:core-status'),
  openCoreDir: () => invoke('models:open-core-dir'),
  openModelsDir: () => invoke('models:open-models-dir'),
  chooseCoreFile: (cubism: 4 | 2) => invoke('models:choose-core', cubism),
  chooseModelsDir: () => invoke('models:choose-dir'),

  /* ---- 对话 ---- */
  sendChat: (text: string) => invoke('chat:send', text),
  regenerate: () => invoke('chat:regenerate'),
  abortChat: () => invoke('chat:abort'),
  proactiveChat: () => invoke('chat:proactive'),
  onChatUser: subscribe<ChatUserEvent>('chat:user'),
  onChatChunk: subscribe<ChatChunkEvent>('chat:chunk'),
  onChatDone: subscribe<ChatDoneEvent>('chat:done'),
  onChatError: subscribe<ChatErrorEvent>('chat:error'),
  onChatState: subscribe<{ characterId: string; streaming: boolean }>('chat:state'),
  onChatEmotion: subscribe<{ characterId: string; emotion: string }>('chat:emotion'),
  onChatTruncate: subscribe<{ characterId: string; keepMessageId: string }>('chat:truncate'),
  onChatHistoryCleared: subscribe<{ characterId: string }>('chat:history-cleared'),
  onChatMemory: subscribe<{ characterId: string; memories: MemoryEntry[] }>('chat:memory'),
  getHistory: () => invoke('chat:history:get'),
  clearHistory: () => invoke('chat:history:clear'),
  exportChat: () => invoke('chat:export'),
  getMemories: () => invoke('chat:memory:get'),
  addMemory: (text: string, category?: MemoryCategory) => invoke('chat:memory:add', text, category),
  updateMemory: (
    id: string,
    patch: Partial<Pick<MemoryEntry, 'text' | 'category' | 'importance'>>,
  ) => invoke('chat:memory:update', id, patch),
  deleteMemory: (id: string) => invoke('chat:memory:delete', id),
  clearMemories: () => invoke('chat:memory:clear'),

  /* ---- 语音与模型测试 ---- */
  ttsSpeak: (text: string, voice?: string) => invoke('tts:speak', text, voice),
  sttTranscribe: (audio: ArrayBuffer, mime: string) => invoke('stt:transcribe', audio, mime),
  testLlm: () => invoke('llm:test'),
  testTts: () => invoke('tts:test'),

  /* ---- OneBot ---- */
  onebotConnect: (characterId: string) => invoke('onebot:connect', characterId),
  onebotDisconnect: (characterId: string) => invoke('onebot:disconnect', characterId),
  onebotStatus: (characterId: string) => invoke('onebot:status', characterId),
  onOneBotStatus: subscribe<{ characterId: string; status: OneBotConnectionStatus }>(
    'onebot:status',
  ),
  onOneBotMessage: subscribe<{
    characterId: string;
    from: string;
    content: string;
    reply: string;
  }>('onebot:message'),

  /* ---- 会话（多会话） ---- */
  listSessions: () => invoke('session:list'),
  newSession: (name: string) => invoke('session:new', name),
  switchSession: (id: string) => invoke('session:switch', id),
  deleteSession: (id: string) => invoke('session:delete', id),

  /* ---- 窗口 ---- */
  setIgnoreMouse: (ignore: boolean) => invoke('window:setIgnoreMouseEvents', ignore),
  petGetPosition: () => invoke('pet:get-position'),
  petSetPosition: (x: number, y: number) => {
    void invoke('pet:set-position', x, y);
  },
  petSetClickThrough: (on: boolean) => invoke('pet:click-through', on),
  petGetClickThrough: () => invoke('pet:get-click-through'),
  toggleBubble: () => invoke('pet:toggle-bubble'),
  onToggleBubble: subscribe<void>('pet:toggle-bubble'),
  petToggleVisible: () => invoke('pet:toggle-visible'),

  openChat: () => invoke('panel:openChat'),
  openSettings: () => invoke('panel:openSettings'),

  /* ---- 应用信息 ---- */
  getAppInfo: (): Promise<AppInfo> => invoke('app:get-info'),
  setAutoLaunch: (enabled: boolean) => invoke('app:set-auto-launch', enabled),
  openLogsDir: () => invoke('app:open-logs-dir'),
};

contextBridge.exposeInMainWorld('api', api);
