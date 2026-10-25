import { app, BrowserWindow, safeStorage } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import type { AppConfig, Character, Secrets, SessionInfo } from '../../shared/types';
import { DEFAULT_CONFIG, REDACTED_KEY, SCHEMA_VERSION, defaultCharacter } from '../../shared/types';
import { sanitizeConfigPartial } from './configSanitize';

/** 旧版本用过的模型库路径，升级时如果存在就继续沿用 */
const LEGACY_MODELS_DIR = 'D:\\Developer\\AImodels\\live2d-models';

const ENC_PREFIX = 'enc:v1:';

/** 用系统凭据（Windows DPAPI）加密 API Key，避免明文躺在 config.json 里 */
function seal(plain: string): string {
  if (!plain) return '';
  try {
    if (!safeStorage.isEncryptionAvailable()) return plain;
    return ENC_PREFIX + safeStorage.encryptString(plain).toString('base64');
  } catch {
    return plain;
  }
}

function unseal(stored: string | undefined): string {
  if (!stored) return '';
  if (!stored.startsWith(ENC_PREFIX)) return stored;
  try {
    return safeStorage.decryptString(Buffer.from(stored.slice(ENC_PREFIX.length), 'base64'));
  } catch {
    return '';
  }
}

/** 默认模型库：优先沿用老路径，否则放到用户数据目录下，换机器不会失效 */
function defaultModelsDir(saved: string | undefined): string {
  if (saved && saved.trim()) return saved.trim();
  try {
    if (fs.existsSync(LEGACY_MODELS_DIR)) return LEGACY_MODELS_DIR;
  } catch {
    // ignore
  }
  return path.join(app.getPath('userData'), 'models');
}

/** 旧版本内置的默认角色（v3 及以前自动创建），v4 起不再自带 */
const LEGACY_BUILTIN_NAME = '小爱';

/** 判断是否是「从未被使用过」的原始内置角色 */
function isPristineBuiltin(c: Character): boolean {
  return (
    c.name === LEGACY_BUILTIN_NAME &&
    !c.systemPrompt &&
    !c.activeModel &&
    !c.voice &&
    !c.greeting &&
    !c.avatar &&
    c.modelScale === 1 &&
    c.modelOffsetY === 0 &&
    Object.keys(c.emotionMap ?? {}).length === 0
  );
}

/** 该角色是否已有聊天记录（桌面或 QQ 会话），有则保守保留，绝不误删用户数据 */
function hasHistory(characterId: string): boolean {
  const dir = path.join(app.getPath('userData'), 'history');
  try {
    if (!fs.existsSync(dir)) return false;
    const target = `${characterId}.json`;
    for (const name of fs.readdirSync(dir)) {
      if (name !== target && !name.startsWith(`${characterId}#`)) continue;
      try {
        if (fs.statSync(path.join(dir, name)).size > 0) return true;
      } catch {
        return true;
      }
    }
    return false;
  } catch {
    return true; // 无法判断时保守保留
  }
}

/** 一次性清理：移除未使用过的原始内置角色 */
function dropPristineBuiltins(cfg: AppConfig): AppConfig {
  const chars = cfg.characters.filter((c) => !(isPristineBuiltin(c) && !hasHistory(c.id)));
  if (chars.length === cfg.characters.length) return cfg;
  const currentCharacterId = chars.some((c) => c.id === cfg.currentCharacterId)
    ? cfg.currentCharacterId
    : chars[0]?.id ?? '';
  return { ...cfg, characters: chars, currentCharacterId };
}

/** 补齐单个角色的缺省字段 */
function normalizeCharacter(raw: Partial<Character> | undefined, fallbackName: string): Character {
  const d = defaultCharacter({});
  const r = raw ?? {};
  return {
    ...d,
    ...r,
    id: r.id || d.id,
    name: (r.name || fallbackName).slice(0, 40),
    personality: r.personality ?? d.personality,
    systemPrompt: r.systemPrompt ?? '',
    activeModel: r.activeModel ?? '',
    voice: r.voice ?? '',
    greeting: r.greeting ?? '',
    avatar: r.avatar ?? '',
    modelScale: typeof r.modelScale === 'number' && r.modelScale > 0 ? r.modelScale : 1,
    modelOffsetY: typeof r.modelOffsetY === 'number' ? r.modelOffsetY : 0,
    emotionMap: { ...d.emotionMap, ...(r.emotionMap ?? {}) },
    memoryEnabled: r.memoryEnabled !== false,
    worldBook: Array.isArray(r.worldBook) ? r.worldBook : [],
    alternateGreetings: Array.isArray(r.alternateGreetings) ? r.alternateGreetings : [],
    tags: Array.isArray(r.tags) ? r.tags : [],
    onebot: { ...d.onebot, ...(r.onebot ?? {}) },
  };
}

/** 把旧版配置（单 character + activeModel）迁移为多角色结构 */
function migrateLegacy(saved: Record<string, unknown>): Partial<AppConfig> {
  const result: Partial<AppConfig> = { ...saved };
  const oldChar = saved['character'] as Partial<Character> | undefined;
  const oldModel = saved['activeModel'] as string | undefined;

  if (!saved['characters'] && oldChar) {
    const migrated: Character = normalizeCharacter(
      { ...oldChar, activeModel: oldModel },
      oldChar.name || '小爱',
    );
    result.characters = [migrated];
    result.currentCharacterId = migrated.id;
  }
  return result;
}

/** 深合并默认值与用户配置，缺省字段自动补齐 */
function mergeConfig(saved: Partial<AppConfig> | null): AppConfig {
  const d = DEFAULT_CONFIG;
  const s = saved ?? {};

  const chars: Character[] = (s.characters ?? []).map((c, i) =>
    normalizeCharacter(c, `角色${i + 1}`),
  );
  // 不再自动创建内置角色：列表可以为空，由用户新建或导入
  let currentId = s.currentCharacterId || chars[0]?.id || '';
  if (!chars.some((c) => c.id === currentId)) currentId = chars[0]?.id ?? '';

  return {
    schemaVersion: SCHEMA_VERSION,
    llm: { ...d.llm, ...(s.llm ?? {}), apiKey: unseal(s.llm?.apiKey) },
    tts: {
      ...d.tts,
      ...(s.tts ?? {}),
      apiKey: unseal(s.tts?.apiKey),
      engine: s.tts?.engine === 'sapi' ? 'sapi' : 'api',
    },
    stt: {
      ...d.stt,
      ...(s.stt ?? {}),
      apiKey: unseal(s.stt?.apiKey),
      engine: s.stt?.engine === 'sapi' ? 'sapi' : 'api',
    },
    memory: {
      ...d.memory,
      ...(s.memory ?? {}),
      enabled: s.memory?.enabled !== false,
      maxEntries: typeof s.memory?.maxEntries === 'number' && s.memory.maxEntries > 0 ? s.memory.maxEntries : d.memory.maxEntries,
      summarizeThreshold: typeof s.memory?.summarizeThreshold === 'number' && s.memory.summarizeThreshold > 0 ? s.memory.summarizeThreshold : d.memory.summarizeThreshold,
      contextChars: typeof s.memory?.contextChars === 'number' && s.memory.contextChars > 0 ? s.memory.contextChars : d.memory.contextChars,
      summaryModel: s.memory?.summaryModel ?? d.memory.summaryModel,
    },
    companion: {
      ...d.companion,
      ...(s.companion ?? {}),
      proactiveChat: s.companion?.proactiveChat !== false,
      idleMinutes: typeof s.companion?.idleMinutes === 'number' && s.companion.idleMinutes > 0 ? s.companion.idleMinutes : d.companion.idleMinutes,
      idleMotion: s.companion?.idleMotion !== false,
    },
    camera: {
      ...d.camera,
      ...(s.camera ?? {}),
      enabled: s.camera?.enabled === true,
      mirror: s.camera?.mirror !== false,
      showPreview: s.camera?.showPreview !== false,
      follow: s.camera?.follow !== false,
      react: s.camera?.react !== false,
    },
    modelsDir: defaultModelsDir(s.modelsDir),
    autoLaunch: s.autoLaunch === true,
    hideOnFullscreen: s.hideOnFullscreen === true,
    bubbleAutoHide: typeof s.bubbleAutoHide === 'number' ? s.bubbleAutoHide : d.bubbleAutoHide,
    characters: chars,
    currentCharacterId: currentId,
    sessions: Array.isArray(s.sessions)
      ? s.sessions.filter((x) => x && typeof x.id === 'string' && typeof x.characterId === 'string')
      : [],
    currentSessionId: typeof s.currentSessionId === 'string' ? s.currentSessionId : 'default',
    petWindow: { ...d.petWindow, ...(s.petWindow ?? {}) },
  };
}

/** 序列化前把 Key 加密，其余字段原样落盘 */
function serialize(cfg: AppConfig): string {
  const clone: AppConfig = {
    ...cfg,
    llm: { ...cfg.llm, apiKey: seal(cfg.llm.apiKey) },
    tts: { ...cfg.tts, apiKey: seal(cfg.tts.apiKey) },
    stt: { ...cfg.stt, apiKey: seal(cfg.stt.apiKey) },
  };
  return JSON.stringify(clone, null, 2);
}

/** 明文 Key → 脱敏占位符（空 Key 保持空） */
function redactKey(v: string | undefined): string {
  return v ? REDACTED_KEY : '';
}

/** 渲染层提交里若 Key 仍是占位符，替换回当前真实值，避免覆盖 */
function resolveRedacted(cur: AppConfig, partial: Partial<AppConfig>): Partial<AppConfig> {
  const out = { ...partial };
  if (out.llm?.apiKey === REDACTED_KEY) out.llm = { ...out.llm, apiKey: cur.llm.apiKey };
  if (out.tts?.apiKey === REDACTED_KEY) out.tts = { ...out.tts, apiKey: cur.tts.apiKey };
  if (out.stt?.apiKey === REDACTED_KEY) out.stt = { ...out.stt, apiKey: cur.stt.apiKey };
  return out;
}

class ConfigStore {
  private cfg: AppConfig = DEFAULT_CONFIG;
  private file = '';
  private listeners: Array<(cfg: AppConfig) => void> = [];

  onChange(cb: (cfg: AppConfig) => void): void {
    this.listeners.push(cb);
  }

  init(): void {
    this.file = path.join(app.getPath('userData'), 'config.json');
    try {
      if (fs.existsSync(this.file)) {
        const raw = JSON.parse(fs.readFileSync(this.file, 'utf-8')) as Record<string, unknown>;
        const migrated = migrateLegacy(raw);
        this.cfg = mergeConfig(migrated);

        const prevVersion = typeof raw['schemaVersion'] === 'number' ? raw['schemaVersion'] : 0;
        // v4：去掉旧版自动创建的内置角色（仅限从未使用过、且没有聊天记录的）
        if (prevVersion < 4) this.cfg = dropPristineBuiltins(this.cfg);

        // 迁移过、或版本/Key 需要写回时持久化一次（顺带加密）
        if (raw['character'] && !raw['characters']) this.persist();
        else if (prevVersion !== SCHEMA_VERSION) this.persist();
      } else {
        this.cfg = mergeConfig(null);
        this.persist();
      }
    } catch (e) {
      console.error('[configStore] 读取失败，使用默认配置:', e);
      this.cfg = mergeConfig(null);
    }
  }

  get(): AppConfig {
    return this.cfg;
  }

  /** 下发给渲染进程的配置：API Key 脱敏 */
  publicConfig(): AppConfig {
    return {
      ...this.cfg,
      llm: { ...this.cfg.llm, apiKey: redactKey(this.cfg.llm.apiKey) },
      tts: { ...this.cfg.tts, apiKey: redactKey(this.cfg.tts.apiKey) },
      stt: { ...this.cfg.stt, apiKey: redactKey(this.cfg.stt.apiKey) },
    };
  }

  /** 明文密钥，供设置窗口显式拉取（仅主进程持有） */
  getSecrets(): Secrets {
    return {
      llm: this.cfg.llm.apiKey,
      tts: this.cfg.tts.apiKey,
      stt: this.cfg.stt.apiKey,
    };
  }

  set(partial: Partial<AppConfig>): void {
    this.cfg = mergeConfig({ ...this.cfg, ...resolveRedacted(this.cfg, partial) });
    this.persist();
    this.broadcast();
  }

  /**
   * 渲染进程写入：白名单 + 字段矫正，脱敏占位符/缺失字段回填为当前真实值。
   * 防止渲染层越权写 modelsDir、characters 等字段，也避免占位符覆盖真实 Key。
   */
  setFromRenderer(partial: Partial<AppConfig>): void {
    const clean = sanitizeConfigPartial(partial);

    // Key：占位符或原始输入里根本没带该字段 → 保留当前；否则用新值（含清空）
    const keepKey = (cur: string, incoming: string | undefined, hadField: boolean): string => {
      if (incoming === REDACTED_KEY) return cur;
      if (!hadField) return cur;
      return incoming ?? cur;
    };

    const rawLlm = partial.llm && typeof partial.llm === 'object' ? partial.llm : {};
    const rawTts = partial.tts && typeof partial.tts === 'object' ? partial.tts : {};
    const rawStt = partial.stt && typeof partial.stt === 'object' ? partial.stt : {};

    const llm = clean.llm
      ? { ...this.cfg.llm, ...clean.llm, apiKey: keepKey(this.cfg.llm.apiKey, clean.llm.apiKey, 'apiKey' in rawLlm) }
      : undefined;
    const tts = clean.tts
      ? { ...this.cfg.tts, ...clean.tts, apiKey: keepKey(this.cfg.tts.apiKey, clean.tts.apiKey, 'apiKey' in rawTts) }
      : undefined;
    const stt = clean.stt
      ? { ...this.cfg.stt, ...clean.stt, apiKey: keepKey(this.cfg.stt.apiKey, clean.stt.apiKey, 'apiKey' in rawStt) }
      : undefined;

    this.set({
      ...clean,
      ...(llm ? { llm } : {}),
      ...(tts ? { tts } : {}),
      ...(stt ? { stt } : {}),
    });
  }

  /** 当前角色；角色列表为空时返回 undefined（应用允许没有内置角色） */
  currentCharacter(): Character | undefined {
    const { characters, currentCharacterId } = this.cfg;
    return characters.find((c) => c.id === currentCharacterId) ?? characters[0] ?? undefined;
  }

  getCharacter(id: string): Character | undefined {
    return this.cfg.characters.find((c) => c.id === id);
  }

  addCharacter(char: Omit<Character, 'id'> & { id?: string }): Character {
    const newChar = normalizeCharacter(char as Partial<Character>, char.name || '新角色');
    if (char.id && !this.cfg.characters.some((c) => c.id === char.id)) newChar.id = char.id;
    const chars = [...this.cfg.characters, newChar];
    this.cfg = { ...this.cfg, characters: chars, currentCharacterId: newChar.id };
    this.persist();
    this.broadcast();
    return newChar;
  }

  updateCharacter(id: string, partial: Partial<Character>): void {
    const chars = this.cfg.characters.map((c) =>
      c.id === id ? normalizeCharacter({ ...c, ...partial }, c.name) : c,
    );
    this.cfg = { ...this.cfg, characters: chars };
    this.persist();
    this.broadcast();
  }

  deleteCharacter(id: string): void {
    const chars = this.cfg.characters.filter((c) => c.id !== id);
    let currentId = this.cfg.currentCharacterId;
    // 允许删到空列表，此时 currentCharacterId 置空
    if (id === currentId || !chars.some((c) => c.id === currentId)) {
      currentId = chars[0]?.id ?? '';
    }
    this.cfg = { ...this.cfg, characters: chars, currentCharacterId: currentId };
    this.persist();
    this.broadcast();
  }

  setCurrentCharacter(id: string): void {
    if (this.cfg.characters.some((c) => c.id === id)) {
      this.cfg = { ...this.cfg, currentCharacterId: id };
      this.persist();
      this.broadcast();
    }
  }

  /* ---- 会话（多会话） ---- */

  getSessions(characterId: string): SessionInfo[] {
    return this.cfg.sessions.filter((s) => s.characterId === characterId);
  }

  /** 当前角色当前会话 id（无显式会话时回落到 'default'） */
  currentSessionFor(characterId: string): string {
    const sid = this.cfg.currentSessionId;
    if (sid && sid !== 'default' && this.cfg.sessions.some((s) => s.id === sid && s.characterId === characterId)) {
      return sid;
    }
    return 'default';
  }

  addSession(characterId: string, name: string): SessionInfo {
    const id = 'sess_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
    const info: SessionInfo = { id, characterId, name, createdAt: Date.now() };
    this.cfg = { ...this.cfg, sessions: [...this.cfg.sessions, info], currentSessionId: id };
    this.persist();
    this.broadcast();
    return info;
  }

  setCurrentSession(characterId: string, id: string): void {
    const valid =
      id === 'default' || this.cfg.sessions.some((s) => s.id === id && s.characterId === characterId);
    if (!valid) return;
    this.cfg = { ...this.cfg, currentSessionId: id };
    this.persist();
    this.broadcast();
  }

  deleteSession(id: string): void {
    this.cfg = {
      ...this.cfg,
      sessions: this.cfg.sessions.filter((s) => s.id !== id),
      currentSessionId: this.cfg.currentSessionId === id ? 'default' : this.cfg.currentSessionId,
    };
    this.persist();
    this.broadcast();
  }

  /**
   * 只改窗口位置/大小这类高频字段。
   * 默认不广播，避免拖动时每 400ms 让所有窗口重渲染一遍配置。
   */
  patchPetWindow(patch: Partial<AppConfig['petWindow']>, silent = true): void {
    this.cfg = { ...this.cfg, petWindow: { ...this.cfg.petWindow, ...patch } };
    this.persist();
    if (!silent) this.broadcast();
  }

  private broadcast(): void {
    // 渲染进程只下发脱敏配置；内部监听器仍拿到完整对象
    const safe = this.publicConfig();
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed()) continue;
      win.webContents.send('config:changed', safe);
    }
    for (const cb of this.listeners) cb(this.cfg);
  }

  private persist(): void {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, serialize(this.cfg), 'utf-8');
      fs.renameSync(tmp, this.file);
    } catch (e) {
      console.error('[configStore] 写入失败:', e);
    }
  }
}

export const configStore = new ConfigStore();
