/** 主进程 / preload / 渲染进程共享的契约类型 */

/** 配置结构版本，用于迁移（configStore 与此保持一致，勿单独修改） */
export const SCHEMA_VERSION = 4;

/**
 * 下发到渲染进程的 API Key 脱敏占位符。
 * 渲染层拿到的 config 里 Key 一律是它，真实 Key 只能通过 `getSecrets()` 显式获取；
 * 提交配置时若 Key 仍为该占位符，主进程会保留原值、不覆盖。
 */
export const REDACTED_KEY = '••••••••';

/** 明文密钥，仅供设置窗口在需要编辑时显式拉取 */
export interface Secrets {
  llm: string;
  tts: string;
  stt: string;
}

export type LlmProvider = 'cloud' | 'local';

/** 常用本地推理服务预设（都兼容 OpenAI /v1/chat/completions） */
export const LOCAL_PRESETS: Array<{
  key: string;
  name: string;
  hint: string;
  defaultBase: string;
  defaultModel: string;
}> = [
  {
    key: 'ollama',
    name: 'Ollama',
    hint: 'ollama serve（默认端口 11434）',
    defaultBase: 'http://127.0.0.1:11434/v1',
    defaultModel: 'qwen2.5:7b',
  },
  {
    key: 'lmstudio',
    name: 'LM Studio',
    hint: 'Load 模型后开启 Local Server（默认端口 1234）',
    defaultBase: 'http://127.0.0.1:1234/v1',
    defaultModel: 'local-model',
  },
  {
    key: 'llamacpp',
    name: 'llama.cpp server',
    hint: './server -m model.gguf -p 8080',
    defaultBase: 'http://127.0.0.1:8080/v1',
    defaultModel: 'local-model',
  },
  {
    key: 'vllm',
    name: 'vLLM',
    hint: 'python -m vllm.entrypoints.openai.api_server --model ...',
    defaultBase: 'http://127.0.0.1:8000/v1',
    defaultModel: 'Qwen/Qwen2.5-7B-Instruct',
  },
];

export interface LlmConfig {
  provider: LlmProvider;
  /** 本地预设 key（'ollama' | 'lmstudio' | 'llamacpp' | 'vllm' | '' 表示自定义） */
  localPreset: string;
  baseURL: string;
  apiKey: string;
  model: string;
  /** 采样温度，0 ~ 2 */
  temperature: number;
  /** 单次回复最大 token 数，0 表示交给服务端默认值 */
  maxTokens: number;
  /** 核采样，0 < topP <= 1 */
  topP: number;
}

export type AudioFormat = 'mp3' | 'wav' | 'opus' | 'aac' | 'flac';

/** 语音合成引擎：OpenAI 兼容接口 / Windows 本地 SAPI */
export type TtsEngine = 'api' | 'sapi';
/** 语音识别引擎：OpenAI 兼容接口 / Windows 本地 SAPI */
export type SttEngine = 'api' | 'sapi';

/** 音频格式与 MIME 的对应关系（TTS 播放与 STT 上传共用） */
export const AUDIO_MIME: Record<AudioFormat, string> = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  opus: 'audio/ogg',
  aac: 'audio/aac',
  flac: 'audio/flac',
};

export interface TtsConfig {
  enabled: boolean;
  /** 合成引擎：api = OpenAI 兼容接口，sapi = Windows 本地离线 */
  engine: TtsEngine;
  /** 为空时回落到 llm.baseURL */
  baseURL: string;
  /** 为空时回落到 llm.apiKey */
  apiKey: string;
  model: string;
  /** 默认音色，角色可通过 character.voice 覆盖；sapi 引擎下为 Windows 语音名 */
  voice: string;
  /** 语速，0.25 ~ 4 */
  speed: number;
  /** 期望返回的音频格式 */
  format: AudioFormat;
}

export interface SttConfig {
  enabled: boolean;
  /** 识别引擎：api = OpenAI 兼容接口，sapi = Windows 本地离线 */
  engine: SttEngine;
  baseURL: string;
  apiKey: string;
  model: string;
  /** 界面语言提示，如 zh */
  language: string;
}

/** OneBot v11 连接配置（一个角色可绑定一个 QQ 号） */
export interface OneBotConfig {
  /** 是否启用 QQ 自动回复 */
  enabled: boolean;
  /** OneBot 服务端正向 WebSocket 地址，如 ws://127.0.0.1:3001 */
  wsUrl: string;
  /** 该角色绑定的 QQ 号（仅用于标识，实际登录由 OneBot 协议端完成） */
  qq: string;
  /** 是否自动回复收到的消息 */
  autoReply: boolean;
  /** 群聊中只有被 @ 或私聊时才回复 */
  requireAt: boolean;
  /** 允许自动回复的好友 QQ 号列表；空数组表示全部允许 */
  allowedFriends: string[];
  /** 允许自动回复的群号列表；空数组表示全部允许 */
  allowedGroups: string[];
}

/** 表情情绪，模型表情/动作按此映射；未知情绪回落 neutral */
export const EMOTION_KEYS = [
  'neutral',
  'happy',
  'sad',
  'angry',
  'surprised',
  'shy',
  'thinking',
  'sleepy',
  'excited',
  'confused',
] as const;
export type EmotionKey = (typeof EMOTION_KEYS)[number];

export const EMOTION_LABELS: Record<EmotionKey, string> = {
  neutral: '平静',
  happy: '开心',
  sad: '难过',
  angry: '生气',
  surprised: '惊讶',
  shy: '害羞',
  thinking: '思考',
  sleepy: '困倦',
  excited: '兴奋',
  confused: '困惑',
};

/** 情绪 → 模型表情名（用户在角色面板里可改，留空则按内置候选名猜测） */
export type EmotionMap = Partial<Record<EmotionKey, string>>;

/** 世界书条目：关键词触发注入的设定片段 */
export interface WorldBookEntry {
  /** 触发关键词列表 */
  keys: string[];
  content: string;
}

export interface Character {
  id: string;
  name: string;
  /** 性格描述 */
  personality: string;
  /** 高级模式：非空时直接作为 system prompt 使用 */
  systemPrompt: string;
  /** 该角色使用的 Live2D 模型目录名 */
  activeModel: string;
  /** QQ 绑定配置 */
  onebot: OneBotConfig;
  /** 音色覆盖，为空时用全局 tts.voice */
  voice: string;
  /** 开场白；新会话或清空历史后自动说出 */
  greeting: string;
  /** 角色头像（data URL），用于角色卡与聊天窗 */
  avatar: string;
  /** 模型显示缩放，1 为自适应 */
  modelScale: number;
  /** 模型垂直偏移（像素） */
  modelOffsetY: number;
  /** 情绪 → 表情名 */
  emotionMap: EmotionMap;
  /** 是否启用长期记忆 */
  memoryEnabled: boolean;
  /** 世界书（关键词触发注入） */
  worldBook: WorldBookEntry[];
  /** 备用开场白（新建会话时随机选用） */
  alternateGreetings: string[];
  /** 标签 */
  tags: string[];
}

export interface PetWindowState {
  x: number;
  y: number;
  width: number;
  height: number;
  clickThrough: boolean;
}

/** 一个桌面会话（多会话支持：同一角色的不同对话分支） */
export interface SessionInfo {
  id: string;
  characterId: string;
  name: string;
  createdAt: number;
}

/** 摄像头交互配置（视频/人脸追踪/动作反馈全部本地处理，不上传） */
export interface CameraConfig {
  /** 总开关，开启后请求摄像头权限 */
  enabled: boolean;
  /** 预览镜像（自然自拍视角，左右跟随预览一致） */
  mirror: boolean;
  /** 在宠物窗口显示预览小窗 */
  showPreview: boolean;
  /** 头部/眼球跟随人脸位置 */
  follow: boolean;
  /** 识别动作（出现/挥手/靠近/远离）并作出反馈与回复 */
  react: boolean;
}

export interface MemoryConfig {
  /** 全局开关（角色也可单独关闭） */
  enabled: boolean;
  /** 最多保留的记忆条目数 */
  maxEntries: number;
  /** 历史超过多少条时触发滚动摘要 */
  summarizeThreshold: number;
  /** 送进模型的历史 token 预算（超出则裁剪，含系统提示与记忆占用） */
  contextChars: number;
  /** 独立摘要/记忆模型名，空则复用主对话模型 */
  summaryModel: string;
}

/** 主动陪伴（proactive）相关设置 */
export interface CompanionConfig {
  /** 长时间无操作时主动搭话 */
  proactiveChat: boolean;
  /** 闲置多少分钟后触发主动搭话 */
  idleMinutes: number;
  /** 随机小动作（idle 动作） */
  idleMotion: boolean;
}

/** 长期记忆分类 */
export type MemoryCategory = 'identity' | 'preference' | 'agreement' | 'event' | 'fact';

export const MEMORY_CATEGORIES: Record<MemoryCategory, string> = {
  identity: '身份',
  preference: '偏好',
  agreement: '约定',
  event: '事件',
  fact: '事实',
};

export const MEMORY_CATEGORY_KEYS = Object.keys(MEMORY_CATEGORIES) as MemoryCategory[];

/** 各分类的默认重要度 */
export const MEMORY_IMPORTANCE: Record<MemoryCategory, number> = {
  identity: 0.9,
  agreement: 0.8,
  preference: 0.7,
  event: 0.6,
  fact: 0.5,
};

/** 一条长期记忆（结构化，可编辑、可按重要度/时效排序） */
export interface MemoryEntry {
  id: string;
  text: string;
  category: MemoryCategory;
  /** 重要度 0~1，影响注入优先级 */
  importance: number;
  createdAt: number;
  /** 最近一次被注入 prompt 的时间，0 表示从未使用 */
  lastUsedAt: number;
}

export interface AppConfig {
  /** 配置结构版本，用于迁移 */
  schemaVersion: number;
  llm: LlmConfig;
  tts: TtsConfig;
  stt: SttConfig;
  characters: Character[];
  /** 当前桌面显示的角色 id */
  currentCharacterId: string;
  /** 桌面会话列表 */
  sessions: SessionInfo[];
  /** 当前桌面会话 id（'default' 为默认会话，兼容旧历史文件） */
  currentSessionId: string;
  petWindow: PetWindowState;
  /** Live2D 模型库目录，空表示使用默认目录（userData/models） */
  modelsDir: string;
  /** 长期记忆设置 */
  memory: MemoryConfig;
  /** 主动陪伴设置 */
  companion: CompanionConfig;
  /** 摄像头交互设置 */
  camera: CameraConfig;
  /** 开机自启动 */
  autoLaunch: boolean;
  /** 全屏应用时自动隐藏宠物 */
  hideOnFullscreen: boolean;
  /** 气泡自动收起秒数，0 表示不自动收起 */
  bubbleAutoHide: number;
}

export interface ModelInfo {
  name: string;
  /** .model3.json / .model.json（相对模型目录） */
  entryFile: string;
  cubism: 2 | 3 | 4;
  /** 是否有缩略图（live2d://thumbnail/<name>） */
  hasThumbnail: boolean;
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  ts: number;
  /** 稳定 id，供前端 key 与"重生成"定位 */
  id: string;
  /** 本条回复的情绪标签 */
  emotion?: string;
  /** 错误提示，不进入上下文 */
  error?: boolean;
  /** 滚动摘要，不显示在聊天记录里 */
  summary?: boolean;
  /** 消息来源：桌面输入或 QQ；QQ 消息在聊天记录里会打标 */
  source?: ChatSource;
}

export type CoreStatus = {
  cubism4: boolean;
  cubism2: boolean;
  modelsDir: string;
  coreDir: string;
};

export type OneBotConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

/** TTS 返回结构：音频本体 + 精确 MIME，避免渲染层猜格式 */
export interface TtsResult {
  audio: ArrayBuffer;
  mime: string;
}

export interface AppInfo {
  version: string;
  electron: string;
  chrome: string;
  node: string;
  platform: string;
  userData: string;
  modelsDir: string;
  coreDir: string;
  logsDir: string;
}

/** 对话事件载荷：统一带 characterId，桌面窗口与 QQ 渠道共用同一套广播 */
export type ChatSource = 'desktop' | 'qq';

export interface ChatUserEvent {
  characterId: string;
  message: ChatMessage;
  source: ChatSource;
}

export interface ChatChunkEvent {
  characterId: string;
  delta: string;
}

export interface ChatDoneEvent {
  characterId: string;
  message: ChatMessage;
  /** 来自桌面输入还是 QQ；QQ 的回复不触发语音播报 */
  source?: ChatSource;
}

export interface ChatErrorEvent {
  characterId: string;
  message: string;
}

/** preload contextBridge 暴露的 API 形状 */
export interface IpcApi {
  /** 返回的 config 中 API Key 已脱敏（REDACTED_KEY），明文需用 getSecrets */
  getConfig(): Promise<AppConfig>;
  setConfig(partial: Partial<AppConfig>): Promise<void>;
  onConfigChanged(cb: (cfg: AppConfig) => void): () => void;
  /** 显式取明文密钥（仅设置窗口编辑时调用） */
  getSecrets(): Promise<Secrets>;

  /* ---- 角色管理 ---- */
  addCharacter(char: Omit<Character, 'id'>): Promise<Character>;
  updateCharacter(id: string, partial: Partial<Character>): Promise<void>;
  deleteCharacter(id: string): Promise<void>;
  setCurrentCharacter(id: string): Promise<void>;
  /** 导入傻酒馆角色卡（.png/.json），返回新建的角色 */
  importCharacterCard(): Promise<Character | null>;
  /** 导出当前角色为 .json 角色卡 */
  exportCharacterCard(id: string): Promise<boolean>;

  /* ---- 模型 ---- */
  listModels(): Promise<ModelInfo[]>;
  importModelZip(): Promise<ModelInfo | null>;
  importModelFolder(): Promise<ModelInfo | null>;
  deleteModel(name: string): Promise<void>;
  activateModel(name: string): Promise<void>;
  getCoreStatus(): Promise<CoreStatus>;
  openCoreDir(): Promise<void>;
  openModelsDir(): Promise<void>;
  /** 手动选择本地 Cubism Core 文件并安装到 userData */
  chooseCoreFile(cubism: 4 | 2): Promise<boolean>;
  /** 选择模型库目录，返回新目录（取消返回 null） */
  chooseModelsDir(): Promise<string | null>;

  /* ---- 对话 ---- */
  sendChat(text: string): Promise<void>;
  /** 重新生成最后一条回复 */
  regenerate(): Promise<void>;
  /** 中止当前生成 */
  abortChat(): Promise<void>;
  /** 主动陪伴：长时间无操作时让角色主动搭话 */
  proactiveChat(): Promise<{ reply: string; error?: string }>;
  onChatUser(cb: (payload: ChatUserEvent) => void): () => void;
  onChatChunk(cb: (payload: ChatChunkEvent) => void): () => void;
  onChatDone(cb: (payload: ChatDoneEvent) => void): () => void;
  onChatError(cb: (payload: ChatErrorEvent) => void): () => void;
  /** 生成状态，跨窗口同步 */
  onChatState(cb: (payload: { characterId: string; streaming: boolean }) => void): () => void;
  /** 回复里的情绪标签 */
  onChatEmotion(cb: (payload: { characterId: string; emotion: string }) => void): () => void;
  /** 重生成前截断到某条用户消息 */
  onChatTruncate(cb: (payload: { characterId: string; keepMessageId: string }) => void): () => void;
  onChatHistoryCleared(cb: (payload: { characterId: string }) => void): () => void;
  /** 长期记忆变化（压缩完成后），聊天窗实时刷新记忆列表 */
  onChatMemory(cb: (payload: { characterId: string; memories: MemoryEntry[] }) => void): () => void;
  getHistory(): Promise<ChatMessage[]>;
  clearHistory(): Promise<void>;
  /** 导出当前角色的聊天记录为 Markdown（弹出保存对话框） */
  exportChat(): Promise<boolean>;
  /** 长期记忆条目（滚动摘要产生，也可手动增删改） */
  getMemories(): Promise<MemoryEntry[]>;
  addMemory(text: string, category?: MemoryCategory): Promise<MemoryEntry[]>;
  updateMemory(
    id: string,
    patch: Partial<Pick<MemoryEntry, 'text' | 'category' | 'importance'>>,
  ): Promise<void>;
  deleteMemory(id: string): Promise<void>;
  clearMemories(): Promise<void>;

  /* ---- 语音 ---- */
  ttsSpeak(text: string, voice?: string): Promise<TtsResult>;
  sttTranscribe(audio: ArrayBuffer, mime: string): Promise<string>;
  testLlm(): Promise<string>;
  testTts(): Promise<string>;

  /* ---- OneBot ---- */
  onebotConnect(characterId: string): Promise<OneBotConnectionStatus>;
  onebotDisconnect(characterId: string): Promise<void>;
  onebotStatus(characterId: string): Promise<OneBotConnectionStatus>;
  onOneBotStatus(cb: (payload: { characterId: string; status: OneBotConnectionStatus }) => void): () => void;
  onOneBotMessage(cb: (payload: { characterId: string; from: string; content: string; reply: string }) => void): () => void;

  /* ---- 会话（多会话） ---- */
  listSessions(): Promise<SessionInfo[]>;
  newSession(name: string): Promise<SessionInfo | null>;
  switchSession(id: string): Promise<void>;
  deleteSession(id: string): Promise<void>;

  /* ---- 窗口 ---- */
  setIgnoreMouse(ignore: boolean): void;
  petGetPosition(): Promise<{ x: number; y: number }>;
  petSetPosition(x: number, y: number): void;
  petSetClickThrough(on: boolean): Promise<boolean>;
  petGetClickThrough(): Promise<boolean>;
  toggleBubble(): void;
  onToggleBubble(cb: () => void): () => void;
  /** 显示/隐藏宠物，返回隐藏后的可见状态 */
  petToggleVisible(): Promise<boolean>;

  openChat(): void;
  openSettings(): void;

  /* ---- 应用 ---- */
  getAppInfo(): Promise<AppInfo>;
  setAutoLaunch(enabled: boolean): Promise<boolean>;
  openLogsDir(): Promise<void>;
}

function genId(): string {
  return 'char_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

/** 生成一个新角色的默认值 */
export function defaultCharacter(overrides: Partial<Character> = {}): Character {
  return {
    id: genId(),
    name: '新角色',
    personality: '温柔体贴、善解人意的虚拟伴侣，说话简短口语化，会关心用户的日常。',
    systemPrompt: '',
    activeModel: '',
    onebot: {
      enabled: false,
      wsUrl: 'ws://127.0.0.1:3001',
      qq: '',
      autoReply: true,
      requireAt: true,
      allowedFriends: [],
      allowedGroups: [],
    },
    voice: '',
    greeting: '',
    avatar: '',
    modelScale: 1,
    modelOffsetY: 0,
    emotionMap: {},
    memoryEnabled: true,
    worldBook: [],
    alternateGreetings: [],
    tags: [],
    ...overrides,
  };
}

export const DEFAULT_CONFIG: AppConfig = {
  schemaVersion: SCHEMA_VERSION,
  llm: {
    provider: 'cloud',
    localPreset: '',
    baseURL: 'https://api.deepseek.com/v1',
    apiKey: '',
    model: 'deepseek-chat',
    temperature: 0.8,
    maxTokens: 0,
    topP: 0.95,
  },
  tts: {
    enabled: true,
    engine: 'api',
    baseURL: '',
    apiKey: '',
    model: 'tts-1',
    voice: 'alloy',
    speed: 1,
    format: 'mp3',
  },
  stt: {
    enabled: true,
    engine: 'api',
    baseURL: '',
    apiKey: '',
    model: 'whisper-1',
    language: 'zh',
  },
  characters: [],
  currentCharacterId: '',
  sessions: [],
  currentSessionId: 'default',
  petWindow: {
    x: -1,
    y: -1,
    width: 360,
    height: 560,
    clickThrough: true,
  },
  modelsDir: '',
  memory: {
    enabled: true,
    maxEntries: 200,
    summarizeThreshold: 60,
    contextChars: 16000,
    summaryModel: '',
  },
  companion: {
    proactiveChat: true,
    idleMinutes: 15,
    idleMotion: true,
  },
  camera: {
    enabled: false,
    mirror: true,
    showPreview: true,
    follow: true,
    react: true,
  },
  autoLaunch: false,
  hideOnFullscreen: false,
  bubbleAutoHide: 0,
};
