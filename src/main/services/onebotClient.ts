import WebSocket from 'ws';
import { broadcast } from './bus';
import type { OneBotConnectionStatus } from '../../shared/types';

/** 断线重连退避：1s → 30s */
const RECONNECT_BASE = 1000;
const RECONNECT_MAX = 30_000;
/** 心跳间隔，超过一个周期没收到 pong 就判定连接已死 */
const HEARTBEAT_MS = 30_000;

export interface OneBotMessagePayload {
  characterId: string;
  messageType: 'private' | 'group';
  userId: string;
  groupId?: string;
  content: string;
  /** 群消息里是否 @ 了机器人 */
  atMe: boolean;
}

/** 解析 OneBot 消息段数组中的纯文本内容 */
export function extractText(message: unknown): { text: string; atMe: boolean } {
  if (typeof message === 'string') {
    // 字符串格式可能夹带 CQ 码；只有 @ 了机器人自己（或全体）才算 atMe
    const atMe = /\[CQ:at,qq=(all|self)\]/.test(message);
    const text = message
      .replace(/\[CQ:[^\]]+\]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    return { text, atMe };
  }
  if (!Array.isArray(message)) return { text: '', atMe: false };
  let atMe = false;
  const text = message
    .map((seg) => {
      if (!seg || typeof seg !== 'object') return '';
      const type = (seg as { type?: string }).type;
      const data = (seg as { data?: Record<string, unknown> }).data ?? {};
      if (type === 'text') return String(data['text'] ?? '');
      if (type === 'at' && String(data['qq'] ?? '') === 'self') atMe = true;
      return '';
    })
    .join('')
    .trim();
  return { text, atMe };
}

/** 非文本消息（图片/表情/语音等）返回一个占位提示，让角色能自然回应 */
function nonTextHint(message: unknown): string {
  if (typeof message === 'string') {
    if (/\[CQ:image/.test(message)) return '[图片]';
    if (/\[CQ:face/.test(message)) return '[表情]';
    if (/\[CQ:record/.test(message)) return '[语音]';
    if (/\[CQ:video/.test(message)) return '[视频]';
    return '';
  }
  if (!Array.isArray(message)) return '';
  for (const seg of message) {
    if (!seg || typeof seg !== 'object') continue;
    const type = (seg as { type?: string }).type;
    if (type === 'image') return '[图片]';
    if (type === 'face') return '[表情]';
    if (type === 'record') return '[语音]';
    if (type === 'video') return '[视频]';
  }
  return '';
}

/**
 * 单个角色的 OneBot v11 正向 WebSocket 客户端。
 *
 * 用 `ws` 而不是全局 WebSocket：Electron 33 的主进程（Node 20.18）没有全局
 * WebSocket，旧代码里 `new WebSocketCtor(...)` 一直是抛错被吞掉的。
 */
export class OneBotClient {
  private ws: WebSocket | null = null;
  private status: OneBotConnectionStatus = 'disconnected';
  private selfId = '';
  private attempt = 0;
  private manualClose = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private alive = false;
  private echoSeq = 0;
  private pending = new Map<
    string,
    { timer: NodeJS.Timeout; resolve: (data: unknown) => void; reject: (e: Error) => void }
  >();

  constructor(
    public readonly characterId: string,
    private wsUrl: string,
    private onMessage: (payload: OneBotMessagePayload) => void,
  ) {}

  getStatus(): OneBotConnectionStatus {
    return this.status;
  }

  connect(): void {
    this.manualClose = false;
    this.open();
  }

  private open(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }
    this.setStatus('connecting');

    let ws: WebSocket;
    try {
      ws = new WebSocket(this.wsUrl, { handshakeTimeout: 10_000 });
    } catch (e) {
      console.error(`[OneBot ${this.characterId}] 创建连接失败:`, (e as Error).message);
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;

    ws.on('open', () => {
      this.attempt = 0;
      this.alive = true;
      this.setStatus('connected');
      this.startHeartbeat();
      console.log(`[OneBot ${this.characterId}] 已连接 ${this.wsUrl}`);
    });

    ws.on('pong', () => {
      this.alive = true;
    });

    ws.on('message', (raw: WebSocket.RawData) => {
      this.handleData(raw.toString());
    });

    ws.on('error', (e: Error) => {
      // 协议端没启动时每次重连都会报错，只在前几次打印，避免日志被刷满
      if (this.attempt < 2) console.error(`[OneBot ${this.characterId}] 连接错误:`, e.message);
      this.setStatus('error');
    });

    ws.on('close', (code: number) => {
      if (code !== 1006) console.log(`[OneBot ${this.characterId}] 连接关闭: ${code}`);
      this.ws = null;
      this.stopHeartbeat();
      this.rejectAll('OneBot 连接已断开');
      if (this.manualClose) {
        this.setStatus('disconnected');
        return;
      }
      this.setStatus('error');
      this.scheduleReconnect();
    });
  }

  private scheduleReconnect(): void {
    if (this.manualClose || this.reconnectTimer) return;
    const delay = Math.min(RECONNECT_BASE * Math.pow(1.6, this.attempt), RECONNECT_MAX);
    this.attempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.manualClose) this.open();
    }, delay);
    if (this.attempt <= 2 || this.attempt % 10 === 0) {
      console.log(`[OneBot ${this.characterId}] ${Math.round(delay / 1000)}s 后重连（第 ${this.attempt} 次）`);
    }
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      const ws = this.ws;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      if (!this.alive) {
        console.warn(`[OneBot ${this.characterId}] 心跳超时，主动断开重连`);
        ws.terminate();
        return;
      }
      this.alive = false;
      try {
        ws.ping();
      } catch {
        ws.terminate();
      }
    }, HEARTBEAT_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  disconnect(): void {
    this.manualClose = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopHeartbeat();
    this.rejectAll('已断开连接');
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.removeAllListeners();
      try {
        ws.close();
      } catch {
        ws.terminate();
      }
    }
    this.setStatus('disconnected');
  }

  getSelfId(): string {
    return this.selfId;
  }

  async sendPrivateMsg(userId: string, message: string): Promise<void> {
    await this.callAction('send_private_msg', { user_id: Number(userId), message });
  }

  /** 群消息；atUserId 有值时用消息段数组 @ 对方 */
  async sendGroupMsg(groupId: string, message: string, atUserId?: string): Promise<void> {
    const payload: Record<string, unknown> = { group_id: Number(groupId) };
    if (atUserId) {
      payload['message'] = [
        { type: 'at', data: { qq: atUserId } },
        { type: 'text', data: { text: ` ${message}` } },
      ];
    } else {
      payload['message'] = message;
    }
    await this.callAction('send_group_msg', payload);
  }

  private callAction(action: string, params: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const ws = this.ws;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        reject(new Error('OneBot 未连接'));
        return;
      }
      const echo = `${this.characterId}-${++this.echoSeq}`;
      const timer = setTimeout(() => {
        this.pending.delete(echo);
        reject(new Error('OneBot 操作超时'));
      }, 10_000);
      timer.unref?.();
      this.pending.set(echo, { timer, resolve, reject });
      try {
        ws.send(JSON.stringify({ action, params, echo }));
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(echo);
        reject(e as Error);
      }
    });
  }

  private rejectAll(reason: string): void {
    for (const [echo, p] of this.pending) {
      clearTimeout(p.timer);
      p.reject(new Error(reason));
      this.pending.delete(echo);
    }
  }

  private handleData(raw: string): void {
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }

    // 事件里都会带 self_id
    if (json['self_id'] !== undefined) this.selfId = String(json['self_id']);

    // action 响应
    if (typeof json['echo'] === 'string') {
      const echo = json['echo'] as string;
      const p = this.pending.get(echo);
      if (p) {
        clearTimeout(p.timer);
        this.pending.delete(echo);
        if (json['retcode'] === 0) p.resolve(json['data']);
        else p.reject(new Error(String(json['status'] ?? 'action failed')));
      }
      return;
    }

    // 事件推送
    if (json['post_type'] === 'message') {
      if (String(json['user_id'] ?? '') === this.selfId) return; // 自己的消息不处理
      const messageType = json['message_type'] === 'group' ? 'group' : 'private';
      const { text, atMe } = extractText(json['message']);
      const content = text || nonTextHint(json['message']);
      if (!content) return;
      this.onMessage({
        characterId: this.characterId,
        messageType,
        userId: String(json['user_id'] ?? ''),
        groupId: messageType === 'group' ? String(json['group_id'] ?? '') : undefined,
        content,
        atMe: atMe || messageType === 'private',
      });
    }
  }

  private setStatus(s: OneBotConnectionStatus): void {
    if (this.status === s) return;
    this.status = s;
    broadcast('onebot:status', { characterId: this.characterId, status: s });
  }
}
