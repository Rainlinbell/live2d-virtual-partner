/**
 * 会话作用域（ConversationScope）。
 *
 * 不同渠道的对话必须隔离，避免 QQ 好友 / 群聊 / 桌面共用一个上下文与长期记忆，
 * 否则一个用户的聊天会污染另一个用户（模型串戏、记忆混入他人事实）。
 *
 * - 桌面：scope = characterId（与历史文件名 `${characterId}.json` 保持一致，向后兼容）
 * - QQ：scope = `${characterId}#qq#${messageType}#${id}`（好友/群聊各自独立）
 */

export type ConversationScope = string;

/** 桌面对话作用域，直接复用角色 id，保持既有历史文件兼容 */
export function desktopScope(characterId: string): ConversationScope {
  return characterId;
}

/** 桌面会话作用域：'default' 会话复用角色 id（兼容旧文件），其余按会话隔离 */
export function sessionScope(characterId: string, sessionId: string): ConversationScope {
  return sessionId === 'default' ? characterId : `${characterId}#session#${sessionId}`;
}

/** QQ 会话作用域：按「角色 + 私聊/群聊 + 对方 id」隔离 */
export function qqScope(
  characterId: string,
  messageType: 'private' | 'group',
  id: string,
): ConversationScope {
  return `${characterId}#qq#${messageType}#${id}`;
}

/** scope → 文件名。去掉 Windows 文件名不允许的字符（`#`、`-`、`_` 安全） */
export function scopeFileName(scope: ConversationScope): string {
  return scope.replace(/[^a-zA-Z0-9_#-]/g, '_');
}
