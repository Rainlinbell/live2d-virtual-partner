import type { ChatMessage, Character } from '../../shared/types';

/** 把一段对话渲染成可读的 Markdown（导出功能与单测共用） */
export function chatToMarkdown(character: Character, messages: ChatMessage[]): string {
  const lines: string[] = [
    `# ${character.name} 的聊天记录`,
    '',
    `- 角色：${character.name}`,
    `- 消息数：${messages.length}`,
    `- 导出时间：${new Date().toLocaleString('zh-CN')}`,
    '',
    '---',
    '',
  ];

  for (const m of messages) {
    if (m.error) continue;
    const who = m.role === 'user' ? '我' : m.role === 'assistant' ? character.name : '系统';
    const suffix = m.source === 'qq' ? '（QQ）' : '';
    const time = new Date(m.ts).toLocaleString('zh-CN');
    const emotion = m.emotion ? ` · ${m.emotion}` : '';
    lines.push(`### ${who}${suffix} · ${time}${emotion}`, '', m.content.trim(), '');
  }

  return lines.join('\n');
}
