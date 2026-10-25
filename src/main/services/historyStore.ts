import { app, safeStorage } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import type { ChatMessage, ChatSource, MemoryCategory, MemoryEntry } from '../../shared/types';
import { MEMORY_CATEGORY_KEYS } from '../../shared/types';
import { scopeFileName } from '../../shared/scope';
import { estimateTokens, memoryScore, normalizeMemoryText } from './memoryRank';

/** 单个作用域最多保留的消息条数（超出后由记忆压缩接管） */
const MAX_MESSAGES = 400;
/** 送进模型的历史 token 预算（约 2000~3000 tokens，长回复也不会把上下文顶爆） */
const DEFAULT_CONTEXT_TOKENS = 8000;
/** 至少保留最近 N 条，避免极长消息把历史挤空 */
const MIN_CONTEXT_MESSAGES = 6;
/** 记忆条目默认上限（可被 memory.maxEntries 覆盖） */
const DEFAULT_MAX_MEMORIES = 40;
/** 写盘防抖间隔：合并高频追加，避免每条消息一次全文件 IO */
const PERSIST_DEBOUNCE_MS = 300;

const ENC_PREFIX = 'enc:v1:';

/** 整份历史用系统凭据（DPAPI）加密落盘；不可用时退化为明文 */
function sealFile(json: string): string {
  try {
    if (!safeStorage.isEncryptionAvailable()) return json;
    return ENC_PREFIX + safeStorage.encryptString(json).toString('base64');
  } catch {
    return json;
  }
}

/** 解密；非加密格式（旧版明文）原样返回 */
function unsealFile(stored: string): string {
  if (!stored.startsWith(ENC_PREFIX)) return stored;
  try {
    return safeStorage.decryptString(Buffer.from(stored.slice(ENC_PREFIX.length), 'base64'));
  } catch {
    return stored;
  }
}

interface HistoryFile {
  version: number;
  messages: ChatMessage[];
  /** 长期记忆：结构化条目（分类 / 重要度 / 时间） */
  memories: MemoryEntry[];
}

/** 写入新记忆时的输入 */
export interface NewMemory {
  text: string;
  category?: MemoryCategory;
  importance?: number;
}

function asCategory(v: unknown): MemoryCategory {
  return typeof v === 'string' && (MEMORY_CATEGORY_KEYS as string[]).includes(v)
    ? (v as MemoryCategory)
    : 'fact';
}

/** 兼容旧版 string[] 记忆，统一成 MemoryEntry */
function normalizeMemory(raw: unknown, now: number): MemoryEntry | null {
  if (typeof raw === 'string') {
    const text = raw.trim();
    if (!text) return null;
    return { id: randomUUID(), text, category: 'fact', importance: 0.5, createdAt: now, lastUsedAt: 0 };
  }
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<MemoryEntry>;
  const text = String(r.text ?? '').trim();
  if (!text) return null;
  return {
    id: typeof r.id === 'string' && r.id ? r.id : randomUUID(),
    text,
    category: asCategory(r.category),
    importance:
      typeof r.importance === 'number' ? Math.min(1, Math.max(0, r.importance)) : 0.5,
    createdAt: typeof r.createdAt === 'number' ? r.createdAt : now,
    lastUsedAt: typeof r.lastUsedAt === 'number' ? r.lastUsedAt : 0,
  };
}

export interface AppendInput {
  role: ChatMessage['role'];
  content: string;
  emotion?: string;
  error?: boolean;
  summary?: boolean;
  source?: ChatSource;
}

/**
 * 按「作用域」存聊天记录。
 *
 * 作用域（scope）来自 shared/scope：
 * - 桌面 = characterId（旧版历史文件 `${characterId}.json` 无缝兼容）
 * - QQ   = `${characterId}#qq#private|group#对方id`，好友/群聊相互隔离
 *
 * 相比旧实现：
 * - 内存缓存 + 写盘，不再每条消息都整文件读改写
 * - 消息带 id / emotion / error 标记
 * - 上下文按字符预算裁剪，而不是固定条数
 * - 长期记忆（memories）与消息一起存，供 prompt 注入
 * - 整份文件 DPAPI 加密，敏感对话不再明文落盘
 */
class HistoryStore {
  private dir = '';
  private cache = new Map<string, HistoryFile>();
  private dirty = new Set<string>();
  private writeTimer: NodeJS.Timeout | null = null;

  init(): void {
    this.dir = path.join(app.getPath('userData'), 'history');
    fs.mkdirSync(this.dir, { recursive: true });
  }

  private file(scope: string): string {
    return path.join(this.dir, `${scopeFileName(scope)}.json`);
  }

  private load(scope: string): HistoryFile {
    const cached = this.cache.get(scope);
    if (cached) return cached;

    let rawMessages: ChatMessage[] = [];
    let rawMemories: unknown[] = [];
    try {
      const f = this.file(scope);
      if (fs.existsSync(f)) {
        const raw = JSON.parse(unsealFile(fs.readFileSync(f, 'utf-8'))) as unknown;
        if (Array.isArray(raw)) {
          // 旧格式：纯消息数组
          rawMessages = raw as ChatMessage[];
        } else if (raw && typeof raw === 'object') {
          const obj = raw as { messages?: unknown; memories?: unknown };
          rawMessages = Array.isArray(obj.messages) ? (obj.messages as ChatMessage[]) : [];
          rawMemories = Array.isArray(obj.memories) ? obj.memories : [];
        }
      }
    } catch (e) {
      console.error('[historyStore] 读取失败:', e);
    }

    const data: HistoryFile = { version: 3, messages: [], memories: [] };
    // 补齐老消息缺失的字段
    data.messages = rawMessages.map((m) => ({
      id: m.id ?? randomUUID(),
      role: m.role === 'user' || m.role === 'system' ? m.role : 'assistant',
      content: String(m.content ?? ''),
      ts: m.ts ?? Date.now(),
      ...(m.emotion ? { emotion: m.emotion } : {}),
      ...(m.error ? { error: true } : {}),
      ...(m.summary ? { summary: true } : {}),
    }));
    // 兼容旧版 string[] 记忆并补字段
    const now = Date.now();
    data.memories = rawMemories
      .map((m) => normalizeMemory(m, now))
      .filter((m): m is MemoryEntry => m !== null)
      .slice(-DEFAULT_MAX_MEMORIES);
    this.cache.set(scope, data);
    return data;
  }

  private persist(scope: string, _data: HistoryFile): void {
    this.dirty.add(scope);
    if (!this.writeTimer) {
      this.writeTimer = setTimeout(() => this.flush(), PERSIST_DEBOUNCE_MS);
    }
  }

  /** 立即把待写的脏作用域落盘（退出前调用，避免丢失） */
  flush(): void {
    if (this.writeTimer) {
      clearTimeout(this.writeTimer);
      this.writeTimer = null;
    }
    const scopes = [...this.dirty];
    this.dirty.clear();
    for (const scope of scopes) {
      const data = this.cache.get(scope);
      if (!data) continue;
      try {
        if (data.messages.length > MAX_MESSAGES) {
          data.messages.splice(0, data.messages.length - MAX_MESSAGES);
        }
        fs.writeFileSync(this.file(scope), sealFile(JSON.stringify(data, null, 2)), 'utf-8');
      } catch (e) {
        console.error('[historyStore] 写入失败:', e);
      }
    }
  }

  getAll(scope: string): ChatMessage[] {
    return this.load(scope).messages.slice();
  }

  count(scope: string): number {
    return this.load(scope).messages.length;
  }

  append(scope: string, input: AppendInput): ChatMessage {
    const data = this.load(scope);
    const msg: ChatMessage = {
      id: randomUUID(),
      role: input.role,
      content: input.content,
      ts: Date.now(),
      ...(input.emotion ? { emotion: input.emotion } : {}),
      ...(input.error ? { error: true } : {}),
      ...(input.summary ? { summary: true } : {}),
      ...(input.source ? { source: input.source } : {}),
    };
    data.messages.push(msg);
    this.persist(scope, data);
    return msg;
  }

  /** 删除某条消息（错误气泡重试时用） */
  remove(scope: string, messageId: string): void {
    const data = this.load(scope);
    data.messages = data.messages.filter((m) => m.id !== messageId);
    this.persist(scope, data);
  }

  /** 取出最近的对话上下文，按 token 预算裁剪（跳过错误提示与空消息） */
  getContext(scope: string, budget = DEFAULT_CONTEXT_TOKENS): ChatMessage[] {
    const usable = this.load(scope).messages.filter((m) => !m.error && m.content.trim());
    const picked: ChatMessage[] = [];
    let tokens = 0;
    for (let i = usable.length - 1; i >= 0; i -= 1) {
      const m = usable[i];
      const cost = estimateTokens(m.content);
      if (picked.length >= MIN_CONTEXT_MESSAGES && tokens + cost > budget) break;
      picked.push(m);
      tokens += cost;
      if (tokens >= budget * 1.5) break;
    }
    return picked.reverse();
  }

  /** 最后一条用户消息（重生成时用） */
  lastUserMessage(scope: string): ChatMessage | undefined {
    const msgs = this.load(scope).messages;
    for (let i = msgs.length - 1; i >= 0; i -= 1) {
      if (msgs[i].role === 'user' && !msgs[i].summary) return msgs[i];
    }
    return undefined;
  }

  /** 删掉最后一条用户消息之后的所有消息，返回该用户消息（重生成） */
  truncateAfterLastUser(scope: string): ChatMessage | undefined {
    const data = this.load(scope);
    let idx = -1;
    for (let i = data.messages.length - 1; i >= 0; i -= 1) {
      if (data.messages[i].role === 'user' && !data.messages[i].summary) {
        idx = i;
        break;
      }
    }
    if (idx < 0) return undefined;
    const keep = data.messages.slice(0, idx + 1);
    data.messages = keep;
    this.persist(scope, data);
    return keep[idx];
  }

  getMemories(scope: string): MemoryEntry[] {
    return this.load(scope).memories.slice();
  }

  /** 追加记忆（按文本去重），返回最新列表 */
  addMemories(scope: string, items: NewMemory[], max = DEFAULT_MAX_MEMORIES): MemoryEntry[] {
    const data = this.load(scope);
    const seen = new Set(data.memories.map((m) => normalizeMemoryText(m.text)));
    const now = Date.now();
    for (const item of items) {
      const text = (item.text ?? '').trim();
      if (!text) continue;
      const norm = normalizeMemoryText(text);
      if (!norm || seen.has(norm)) continue;
      const category = item.category ?? 'fact';
      data.memories.push({
        id: randomUUID(),
        text,
        category,
        importance:
          typeof item.importance === 'number' ? Math.min(1, Math.max(0, item.importance)) : 0.5,
        createdAt: now,
        lastUsedAt: 0,
      });
      seen.add(norm);
    }
    if (data.memories.length > max) {
      // 超上限时按排序分淘汰最低分，而不是按插入顺序丢最旧（避免误删高重要度旧记忆）
      const keep = new Set(
        [...data.memories]
          .sort((a, b) => memoryScore(b, now) - memoryScore(a, now))
          .slice(0, max)
          .map((m) => m.id),
      );
      data.memories = data.memories.filter((m) => keep.has(m.id));
    }
    this.persist(scope, data);
    return data.memories.slice();
  }

  /** 编辑一条记忆（文本 / 分类 / 重要度） */
  updateMemory(
    scope: string,
    id: string,
    patch: Partial<Pick<MemoryEntry, 'text' | 'category' | 'importance'>>,
  ): void {
    const data = this.load(scope);
    const entry = data.memories.find((m) => m.id === id);
    if (!entry) return;
    if (typeof patch.text === 'string' && patch.text.trim()) entry.text = patch.text.trim();
    if (patch.category) entry.category = asCategory(patch.category);
    if (typeof patch.importance === 'number') {
      entry.importance = Math.min(1, Math.max(0, patch.importance));
    }
    this.persist(scope, data);
  }

  removeMemory(scope: string, id: string): void {
    const data = this.load(scope);
    data.memories = data.memories.filter((m) => m.id !== id);
    this.persist(scope, data);
  }

  clearMemories(scope: string): void {
    const data = this.load(scope);
    data.memories = [];
    this.persist(scope, data);
  }

  /**
   * 标记记忆被使用（用于排序加成）。
   * 只有超过 minIntervalMs 没更新过才写盘，避免每条消息都刷 IO。
   */
  touchMemories(scope: string, ids: string[], minIntervalMs = 6 * 3600_000): void {
    if (ids.length === 0) return;
    const data = this.load(scope);
    const set = new Set(ids);
    const now = Date.now();
    let changed = false;
    for (const m of data.memories) {
      if (!set.has(m.id)) continue;
      if (now - m.lastUsedAt < minIntervalMs) continue;
      m.lastUsedAt = now;
      changed = true;
    }
    if (changed) this.persist(scope, data);
  }

  /** 取最早的一批消息（用于滚动摘要） */
  oldest(scope: string, count: number): ChatMessage[] {
    return this.load(scope)
      .messages.filter((m) => !m.summary)
      .slice(0, count);
  }

  /** 丢弃最早的一批消息（摘要完成之后） */
  dropOldest(scope: string, count: number): void {
    const data = this.load(scope);
    let removed = 0;
    data.messages = data.messages.filter((m) => {
      if (removed >= count) return true;
      if (m.summary) return true;
      removed += 1;
      return false;
    });
    this.persist(scope, data);
  }

  clear(scope: string): void {
    const data = this.load(scope);
    data.messages = [];
    this.persist(scope, data);
  }

  /** 删除单个作用域的历史与记忆（删除会话时用） */
  removeScope(scope: string): void {
    this.cache.delete(scope);
    try {
      fs.rmSync(this.file(scope), { force: true });
    } catch (e) {
      console.error('[historyStore] 删除失败:', e);
    }
  }

  /** 删除某角色的全部历史（含 QQ 各会话的隔离历史与记忆），删角色时调用 */
  removeAllScopes(characterId: string): void {
    // 清理内存缓存里属于该角色的所有 scope（桌面 + QQ 各会话）
    for (const key of [...this.cache.keys()]) {
      if (key === characterId || key.startsWith(`${characterId}#`)) this.cache.delete(key);
    }
    try {
      const prefix = scopeFileName(characterId);
      for (const name of fs.readdirSync(this.dir)) {
        if (name === `${prefix}.json` || name.startsWith(`${prefix}#`)) {
          fs.rmSync(path.join(this.dir, name));
        }
      }
    } catch (e) {
      console.error('[historyStore] 删除失败:', e);
    }
  }
}

export const historyStore = new HistoryStore();
