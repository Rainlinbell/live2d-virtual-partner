import type { ChatMessage, ChatSource, Character } from '../../shared/types';
import { desktopScope, type ConversationScope } from '../../shared/scope';
import { broadcast } from './bus';
import { configStore } from './configStore';
import { historyStore } from './historyStore';
import { complete, streamChat } from './llmService';
import { EmotionStripper, extractEmotion } from './emotionTag';
import { estimateTokens, parseMemoryLines, rankMemories } from './memoryRank';
import { buildSystemPrompt } from './promptBuilder';

/** 每次滚动摘要压缩掉多少条旧消息 */
const COMPACT_BATCH = 24;
const COMPACT_MIN = 8;
/** 单次注入 prompt 的记忆条数上限 */
const PROMPT_MEMORY_LIMIT = 10;
/** 系统提示的固定 token 预算预留（精确扣除前先粗扣） */
const SYSTEM_TOKEN_RESERVE = 1500;

export interface SendResult {
  reply: string;
  error?: string;
}

const COMPACT_SYSTEM = [
  '你负责把一段聊天记录压缩成关于"用户"的长期记忆。',
  '只输出 1-3 行，每行格式严格为：[类别] 内容',
  '类别只能是：身份、偏好、约定、事件、事实。',
  '写稳定、可复用的信息：称呼、喜好、身份、重要事件、约定；不要寒暄，不要复述对话。',
].join('\n');

/** 主动搭话时追加到 system prompt 的指令 */
const PROACTIVE_INSTRUCTION =
  '（系统）主人已经有一阵子没跟你说话了，请主动说一句关心或撒娇的话。语气自然，一两句话即可，不要提到"你很久没理我"这类字眼。';

/**
 * 对话流水线：单飞、可中止、情绪解析、长期记忆压缩、主动陪伴。
 */
class ChatPipeline {
  private running = new Map<string, AbortController>();
  private compacting = new Set<string>();

  isStreaming(scope: ConversationScope): boolean {
    return this.running.has(scope);
  }

  /** 中止指定作用域的生成（不传则中止全部，退出清理用） */
  abort(scope?: ConversationScope): void {
    if (scope) {
      const ctrl = this.running.get(scope);
      if (ctrl) {
        ctrl.abort();
        this.running.delete(scope);
      }
      return;
    }
    for (const ctrl of this.running.values()) ctrl.abort();
    this.running.clear();
  }

  /** 发送一条用户消息并等待回复。scope 默认桌面作用域 */
  async send(
    characterId: string,
    text: string,
    source: ChatSource = 'desktop',
    scope: ConversationScope = desktopScope(characterId),
  ): Promise<SendResult> {
    const content = text.trim();
    if (!content) return { reply: '' };
    const character = configStore.getCharacter(characterId);
    if (!character) {
      if (source === 'desktop') {
        broadcast('chat:error', { characterId, message: '角色不存在，可能已被删除' });
      }
      return { reply: '', error: '角色不存在' };
    }

    // 正在生成时，新消息抢占旧的（保留已生成的部分）
    this.abort(scope);

    const userMsg = historyStore.append(scope, { role: 'user', content, source });
    if (source === 'desktop') {
      broadcast('chat:user', { characterId, message: userMsg, source });
    }
    return this.run(characterId, character, source, scope);
  }

  /** 重新生成最后一条回复（仅桌面渠道） */
  async regenerate(
    characterId: string,
    scope: ConversationScope = desktopScope(characterId),
  ): Promise<SendResult> {
    const character = configStore.getCharacter(characterId);
    if (!character) return { reply: '', error: '角色不存在' };
    const lastUser = historyStore.truncateAfterLastUser(scope);
    if (!lastUser) {
      broadcast('chat:error', { characterId, message: '还没有可以重新生成的对话' });
      return { reply: '', error: '没有可重生成的消息' };
    }
    broadcast('chat:truncate', { characterId, keepMessageId: lastUser.id });
    this.abort(scope);
    return this.run(characterId, character, 'desktop', scope);
  }

  /** 主动陪伴：长时间无操作时主动搭一句话（不写入用户消息） */
  async proactive(
    characterId: string,
    scope: ConversationScope = desktopScope(characterId),
  ): Promise<SendResult> {
    const character = configStore.getCharacter(characterId);
    if (!character) return { reply: '', error: '角色不存在' };
    const cfg = configStore.get();
    if (!cfg.companion.proactiveChat) return { reply: '' };
    if (this.running.has(scope)) return { reply: '' };
    if (historyStore.count(scope) === 0) return { reply: '' };
    return this.run(characterId, character, 'desktop', scope, { proactive: true });
  }

  /** 取上下文并拆成「历史（不含当前用户消息）」+「当前用户文本」 */
  private resolveContext(
    scope: ConversationScope,
    budget: number,
    proactive: boolean,
  ): { history: ChatMessage[]; userText: string } {
    const ctx = historyStore.getContext(scope, budget);
    const last = ctx[ctx.length - 1];
    if (proactive) return { history: ctx, userText: '' };
    if (last?.role === 'user') return { history: ctx.slice(0, -1), userText: last.content };
    return { history: ctx, userText: historyStore.lastUserMessage(scope)?.content ?? '' };
  }

  private async run(
    characterId: string,
    character: Character,
    source: ChatSource,
    scope: ConversationScope,
    opts: { proactive?: boolean } = {},
  ): Promise<SendResult> {
    const cfg = configStore.get();
    const isDesktop = source === 'desktop';
    const proactive = opts.proactive === true;
    const ctrl = new AbortController();
    this.running.set(scope, ctrl);
    if (isDesktop) broadcast('chat:state', { characterId, streaming: true });

    // 先粗取上下文确定用户文本，用于记忆语义召回
    const now = new Date();
    const rough = this.resolveContext(scope, cfg.memory.contextChars, proactive);
    const selectedMemories = rankMemories(
      historyStore.getMemories(scope),
      PROMPT_MEMORY_LIMIT,
      now.getTime(),
      rough.userText || undefined,
    );
    if (selectedMemories.length > 0) {
      historyStore.touchMemories(scope, selectedMemories.map((m) => m.id));
    }

    let systemPrompt = buildSystemPrompt(character, {
      memories: selectedMemories,
      now,
      compact: source === 'qq',
      userText: rough.userText || undefined,
    });
    if (proactive) systemPrompt += '\n\n' + PROACTIVE_INSTRUCTION;

    // 精确预算：扣除系统提示与记忆占用的 token 后再取上下文
    const sysTokens = estimateTokens(systemPrompt) + SYSTEM_TOKEN_RESERVE;
    const budget = Math.max(1000, cfg.memory.contextChars - sysTokens);
    const { history, userText } = this.resolveContext(scope, budget, proactive);

    if (!userText && !proactive) {
      this.running.delete(scope);
      if (isDesktop) broadcast('chat:state', { characterId, streaming: false });
      return { reply: '', error: '没有可发送的内容' };
    }

    const stripper = new EmotionStripper();
    let lastEmotion = '';
    let failure = '';
    let aborted = false;

    const raw = await streamChat(
      {
        cfg,
        character,
        history,
        userText,
        systemPrompt,
        signal: ctrl.signal,
      },
      {
        onChunk: (chunk) => {
          const delta = stripper.push(chunk);
          if (!delta) return;
          if (isDesktop) broadcast('chat:chunk', { characterId, delta });
          const emo = stripper.detectedEmotion;
          if (emo && emo !== lastEmotion) {
            lastEmotion = emo;
            if (isDesktop) broadcast('chat:emotion', { characterId, emotion: emo });
          }
        },
        onError: (message) => {
          failure = message;
        },
        onAbort: () => {
          aborted = true;
        },
      },
    );

    const tail = stripper.flush();
    if (tail && isDesktop) broadcast('chat:chunk', { characterId, delta: tail });

    this.running.delete(scope);
    if (isDesktop) broadcast('chat:state', { characterId, streaming: false });

    if (failure && !aborted) {
      historyStore.append(scope, { role: 'system', content: `⚠ ${failure}`, error: true, source });
      if (isDesktop) broadcast('chat:error', { characterId, message: failure });
      return { reply: '', error: failure };
    }

    const parsed = extractEmotion(raw);
    const content = parsed.text.trim();
    const emotion = parsed.emotion ?? (stripper.detectedEmotion || undefined);

    if (!content) {
      if (!aborted) {
        const msg = '模型返回了空内容，请检查模型名是否可用';
        historyStore.append(scope, { role: 'system', content: `⚠ ${msg}`, error: true, source });
        if (isDesktop) broadcast('chat:error', { characterId, message: msg });
        return { reply: '', error: msg };
      }
      return { reply: '' };
    }

    const assistantMsg = historyStore.append(scope, {
      role: 'assistant',
      content,
      emotion,
      source,
    });
    if (isDesktop) broadcast('chat:done', { characterId, message: assistantMsg, source });

    if (!aborted) void this.maybeCompact(characterId, character, scope, isDesktop);
    return { reply: content };
  }

  /** 消息攒够之后，把最早一批压缩成长期记忆 */
  private async maybeCompact(
    characterId: string,
    character: Character,
    scope: ConversationScope,
    isDesktop: boolean,
  ): Promise<void> {
    const cfg = configStore.get();
    if (!cfg.memory.enabled || character.memoryEnabled === false) return;
    if (this.compacting.has(scope)) return;
    if (historyStore.count(scope) < cfg.memory.summarizeThreshold) return;

    this.compacting.add(scope);
    try {
      const batch = historyStore.oldest(scope, COMPACT_BATCH);
      if (batch.length < COMPACT_MIN) return;
      const transcript = batch
        .map((m) => `${m.role === 'user' ? '用户' : character.name}：${m.content}`)
        .join('\n')
        .slice(0, 6000);
      const summary = await complete(
        cfg,
        [
          { role: 'system', content: COMPACT_SYSTEM },
          { role: 'user', content: transcript },
        ],
        { maxTokens: 300, temperature: 0.3, timeoutMs: 60_000, model: cfg.memory.summaryModel || undefined },
      );
      const items = parseMemoryLines(summary, 3);
      if (items.length > 0) historyStore.addMemories(scope, items, cfg.memory.maxEntries);
      historyStore.dropOldest(scope, batch.length);
      if (isDesktop) {
        broadcast('chat:memory', { characterId, memories: historyStore.getMemories(scope) });
      }
    } catch (e) {
      console.warn('[memory] 记忆压缩失败:', (e as Error).message);
    } finally {
      this.compacting.delete(scope);
    }
  }
}

export const chatPipeline = new ChatPipeline();
