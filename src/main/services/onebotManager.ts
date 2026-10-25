import { broadcast } from './bus';
import { chatPipeline } from './chatPipeline';
import { configStore } from './configStore';
import { OneBotClient, type OneBotMessagePayload } from './onebotClient';
import { qqScope } from '../../shared/scope';
import type { OneBotConnectionStatus } from '../../shared/types';

/**
 * OneBot 连接与消息分发。
 *
 * 相比旧实现：
 * - 断线会退避重连（旧代码 close 后再也不会重连）
 * - 群聊可要求 @ 才回复
 * - 每个会话串行排队，避免两条消息同时调模型把历史写乱
 * - 不再自己碰 historyStore / streamChat，统一走 chatPipeline（顺带修掉用户消息重复入 prompt 的 bug）
 */
class OneBotManager {
  private clients = new Map<string, OneBotClient>();
  private urls = new Map<string, string>();
  private queues = new Map<string, Promise<void>>();

  getClient(characterId: string): OneBotClient | undefined {
    return this.clients.get(characterId);
  }

  connect(characterId: string): OneBotConnectionStatus {
    const char = configStore.getCharacter(characterId);
    if (!char || !char.onebot.enabled || !char.onebot.wsUrl) return 'disconnected';

    const existing = this.clients.get(characterId);
    if (existing) {
      const status = existing.getStatus();
      if (status === 'connected' || status === 'connecting') return status;
      // 处于 error/disconnected 时手动重连
      existing.connect();
      return 'connecting';
    }

    const client = new OneBotClient(characterId, char.onebot.wsUrl, (payload) => {
      void this.handleMessage(payload);
    });
    this.clients.set(characterId, client);
    this.urls.set(characterId, char.onebot.wsUrl);
    client.connect();
    return 'connecting';
  }

  disconnect(characterId: string): void {
    const client = this.clients.get(characterId);
    if (client) {
      client.disconnect();
      this.clients.delete(characterId);
      this.urls.delete(characterId);
    }
  }

  getStatus(characterId: string): OneBotConnectionStatus {
    return this.clients.get(characterId)?.getStatus() ?? 'disconnected';
  }

  /** 配置变更后同步连接：启用的连上（地址变了就重连），禁用的断开 */
  syncAll(): void {
    const cfg = configStore.get();
    const activeIds = new Set<string>();

    for (const c of cfg.characters) {
      const ob = c.onebot;
      if (!ob.enabled || !ob.wsUrl) continue;
      activeIds.add(c.id);
      const known = this.urls.get(c.id);
      if (known && known !== ob.wsUrl) {
        this.disconnect(c.id);
      }
      if (!this.clients.has(c.id)) this.connect(c.id);
    }

    for (const id of [...this.clients.keys()]) {
      if (!activeIds.has(id)) this.disconnect(id);
    }
  }

  disconnectAll(): void {
    for (const id of [...this.clients.keys()]) this.disconnect(id);
  }

  private enqueue(key: string, task: () => Promise<void>): void {
    const prev = this.queues.get(key) ?? Promise.resolve();
    const next = prev.then(task, task).catch((e: unknown) => {
      console.error('[OneBot] 处理消息失败:', (e as Error).message);
    });
    this.queues.set(key, next);
    void next.finally(() => {
      if (this.queues.get(key) === next) this.queues.delete(key);
    });
  }

  /** 处理收到的 QQ 消息 */
  private async handleMessage(payload: OneBotMessagePayload): Promise<void> {
    const char = configStore.getCharacter(payload.characterId);
    if (!char) return;
    const ob = char.onebot;
    if (!ob.enabled) return;

    if (payload.messageType === 'private') {
      if (ob.allowedFriends.length > 0 && !ob.allowedFriends.includes(payload.userId)) return;
    } else {
      if (ob.allowedGroups.length > 0 && !ob.allowedGroups.includes(payload.groupId ?? '')) return;
      if (ob.requireAt && !payload.atMe) return;
    }

    const chatKey = `${char.id}:${payload.messageType}:${payload.groupId || payload.userId}`;

    if (!ob.autoReply) {
      broadcast('onebot:message', {
        characterId: char.id,
        from: payload.messageType === 'private' ? payload.userId : `群${payload.groupId}`,
        content: payload.content,
        reply: '',
      });
      return;
    }

    this.enqueue(chatKey, async () => {
      const client = this.clients.get(char.id);
      if (!client) return;

      // 每个好友/群聊一个独立作用域，上下文与长期记忆互不串扰
      const scope = qqScope(char.id, payload.messageType, payload.groupId || payload.userId);
      const result = await chatPipeline.send(char.id, payload.content, 'qq', scope);
      if (result.error) {
        console.error(`[OneBot ${char.id}] 生成失败:`, result.error);
      }

      let reply = result.reply.trim();
      if (!reply) {
        broadcast('onebot:message', {
          characterId: char.id,
          from: payload.messageType === 'private' ? payload.userId : `群${payload.groupId}`,
          content: payload.content,
          reply: '',
        });
        return;
      }
      // QQ 里不适合长段落，压成一行
      reply = reply.replace(/\s*\n+\s*/g, ' ').slice(0, 500);

      try {
        if (payload.messageType === 'private') {
          await client.sendPrivateMsg(payload.userId, reply);
        } else {
          await client.sendGroupMsg(payload.groupId!, reply, ob.requireAt ? payload.userId : undefined);
        }
      } catch (e) {
        console.error(`[OneBot ${char.id}] 发送回复失败:`, (e as Error).message);
      }

      broadcast('onebot:message', {
        characterId: char.id,
        from: payload.messageType === 'private' ? payload.userId : `群${payload.groupId}`,
        content: payload.content,
        reply,
      });
    });
  }
}

export const onebotManager = new OneBotManager();
