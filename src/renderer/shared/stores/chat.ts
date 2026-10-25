import { defineStore } from 'pinia';
import type { ChatMessage, MemoryCategory, MemoryEntry } from '../../../shared/types';

/**
 * 聊天状态。
 *
 * 主进程是唯一真源：所有窗口订阅同一组广播，因此“正在生成”跨窗口一致，
 * 不再是每个窗口各存一个 streaming 标志。
 */
export const useChatStore = defineStore('chat', {
  state: () => ({
    characterId: '',
    /** 当前会话 id（'default' 为默认会话） */
    sessionId: 'default',
    messages: [] as ChatMessage[],
    /** 主进程广播的生成状态 */
    streaming: false,
    /** 当前流式累积文本（尚未入库） */
    streamingText: '',
    /** 最近一次失败原因 */
    error: '',
    /** 当前情绪标签（驱动表情） */
    emotion: '',
    /** 长期记忆 */
    memories: [] as MemoryEntry[],
    initialized: false,
  }),

  getters: {
    /** 气泡要显示的内容：流式时优先显示未完成的回复 */
    lastReply(state): string {
      if (state.streaming) return state.streamingText;
      for (let i = state.messages.length - 1; i >= 0; i -= 1) {
        const m = state.messages[i];
        if (m.role === 'assistant' && !m.error) return m.content;
      }
      return '';
    },
  },

  actions: {
    async init(): Promise<void> {
      if (this.initialized) return;
      this.initialized = true;

      const cfg = await window.api.getConfig();
      this.characterId = cfg.currentCharacterId;
      this.sessionId = cfg.currentSessionId || 'default';
      await this.reload();

      window.api.onConfigChanged((next) => {
        const sid = next.currentSessionId || 'default';
        if (next.currentCharacterId === this.characterId && sid === this.sessionId) return;
        this.characterId = next.currentCharacterId;
        this.sessionId = sid;
        this.reset();
        void this.reload();
      });

      window.api.onChatUser(({ characterId, message }) => {
        if (characterId !== this.characterId) return;
        this.messages.push(message);
        this.streaming = true;
        this.streamingText = '';
        this.error = '';
        this.emotion = '';
      });

      window.api.onChatChunk(({ characterId, delta }) => {
        if (characterId !== this.characterId) return;
        this.streamingText += delta;
      });

      window.api.onChatDone(({ characterId, message }) => {
        if (characterId !== this.characterId) return;
        this.messages.push(message);
        this.streamingText = '';
        this.streaming = false;
        if (message.emotion) this.emotion = message.emotion;
      });

      window.api.onChatError(({ characterId, message }) => {
        if (characterId !== this.characterId) return;
        this.error = message;
        this.streaming = false;
        this.streamingText = '';
      });

      window.api.onChatState(({ characterId, streaming }) => {
        if (characterId !== this.characterId) return;
        this.streaming = streaming;
        if (!streaming) this.streamingText = '';
      });

      window.api.onChatEmotion(({ characterId, emotion }) => {
        if (characterId !== this.characterId) return;
        this.emotion = emotion;
      });

      window.api.onChatTruncate(({ characterId, keepMessageId }) => {
        if (characterId !== this.characterId) return;
        const idx = this.messages.findIndex((m) => m.id === keepMessageId);
        if (idx >= 0) this.messages = this.messages.slice(0, idx + 1);
      });

      window.api.onChatHistoryCleared(({ characterId }) => {
        if (characterId !== this.characterId) return;
        this.messages = [];
        this.streamingText = '';
        this.streaming = false;
      });

      window.api.onChatMemory(({ characterId, memories }) => {
        if (characterId !== this.characterId) return;
        this.memories = memories;
      });
    },

    reset(): void {
      this.messages = [];
      this.streaming = false;
      this.streamingText = '';
      this.error = '';
      this.emotion = '';
      this.memories = [];
    },

    async reload(): Promise<void> {
      const all = await window.api.getHistory();
      // 失败条目只在界面上以错误条展示，不占消息流
      const failed = all.filter((m) => m.error);
      this.messages = all.filter((m) => !m.error);
      this.error = failed.length ? failed[failed.length - 1].content.replace(/^⚠\s*/, '') : '';
      this.memories = await window.api.getMemories();
    },

    /** 发送消息（正在生成时主进程会先中止上一条） */
    send(text: string): void {
      const t = text.trim();
      if (!t) return;
      if (!this.characterId) {
        this.error = '还没有角色，请先在设置里新建或导入';
        return;
      }
      this.error = '';
      void window.api.sendChat(t);
    },

    regenerate(): void {
      void window.api.regenerate();
    },

    abort(): void {
      void window.api.abortChat();
    },

    async clear(): Promise<void> {
      await window.api.clearHistory();
      this.messages = [];
      this.streamingText = '';
      this.streaming = false;
      this.error = '';
    },

    async addMemory(text: string, category: MemoryCategory = 'fact'): Promise<void> {
      const t = text.trim();
      if (!t) return;
      this.memories = await window.api.addMemory(t, category);
    },

    async updateMemory(
      id: string,
      patch: Partial<Pick<MemoryEntry, 'text' | 'category' | 'importance'>>,
    ): Promise<void> {
      await window.api.updateMemory(id, patch);
      this.memories = this.memories.map((m) => (m.id === id ? { ...m, ...patch } : m));
    },

    async deleteMemory(id: string): Promise<void> {
      await window.api.deleteMemory(id);
      this.memories = this.memories.filter((m) => m.id !== id);
    },

    async clearMemories(): Promise<void> {
      await window.api.clearMemories();
      this.memories = [];
    },

    /** 追加本地提示（不进主进程历史） */
    note(text: string): void {
      this.messages.push({
        id: `local_${Date.now()}`,
        role: 'assistant',
        content: text,
        ts: Date.now(),
        error: true,
      });
    },
  },
});
