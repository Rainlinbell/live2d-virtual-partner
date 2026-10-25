<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { useChatStore } from '../../shared/stores/chat';
import { EMOTION_LABELS } from '../../../shared/types';
import type { ChatMessage, EmotionKey } from '../../../shared/types';

const props = defineProps<{ query?: string }>();

const chatStore = useChatStore();
const listEl = ref<HTMLElement | null>(null);

/** 搜索词只在本地过滤，不影响主进程历史 */
const visibleMessages = computed(() => {
  const q = (props.query ?? '').trim().toLowerCase();
  if (!q) return chatStore.messages;
  return chatStore.messages.filter((m) => m.content.toLowerCase().includes(q));
});

/** 贴底时才自动滚动，用户往上翻历史时不打断阅读 */
let stickToBottom = true;

function onScroll(): void {
  const el = listEl.value;
  if (!el) return;
  stickToBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
}

async function scrollToBottom(force = false): Promise<void> {
  if (!force && !stickToBottom) return;
  await nextTick();
  const el = listEl.value;
  if (el) el.scrollTop = el.scrollHeight;
}

watch(
  () => [visibleMessages.value.length, chatStore.streamingText, chatStore.streaming],
  () => void scrollToBottom(),
);

function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function emotionLabel(m: ChatMessage): string {
  if (!m.emotion) return '';
  return EMOTION_LABELS[m.emotion as EmotionKey] ?? '';
}

const lastAssistantId = computed(() => {
  for (let i = chatStore.messages.length - 1; i >= 0; i -= 1) {
    const m = chatStore.messages[i];
    if (m.role === 'assistant' && !m.error) return m.id ?? '';
  }
  return '';
});

async function copyMessage(m: ChatMessage): Promise<void> {
  try {
    await navigator.clipboard.writeText(m.content);
  } catch {
    /* 剪贴板不可用时忽略 */
  }
}

function regenerate(): void {
  chatStore.regenerate();
}
</script>

<template>
  <div ref="listEl" class="message-list" @scroll="onScroll">
    <div v-if="!chatStore.messages.length && !chatStore.streaming" class="empty">
      还没有对话，说第一句话吧
    </div>
    <div v-else-if="!visibleMessages.length" class="empty">
      没有匹配「{{ props.query }}」的消息
    </div>

    <div
      v-for="(m, i) in visibleMessages"
      :key="m.id || i"
      class="msg-row"
      :class="[m.role, { failed: m.error }]"
    >
      <div class="bubble-wrap">
        <div class="msg">{{ m.content }}</div>
        <div class="meta">
          <span v-if="m.source === 'qq'" class="tag">QQ</span>
          <span v-if="emotionLabel(m)" class="tag">{{ emotionLabel(m) }}</span>
          <span class="time">{{ formatTime(m.ts) }}</span>
          <button class="op" title="复制" @click="copyMessage(m)">复制</button>
          <button
            v-if="m.role === 'assistant' && m.id === lastAssistantId && !chatStore.streaming"
            class="op"
            title="重新生成这一条"
            @click="regenerate"
          >
            重说
          </button>
        </div>
      </div>
    </div>

    <div v-if="chatStore.streaming" class="msg-row assistant">
      <div class="bubble-wrap">
        <div class="msg streaming">{{ chatStore.streamingText || '正在输入…' }}</div>
      </div>
    </div>

    <div v-if="chatStore.error" class="error-row">
      <span>{{ chatStore.error }}</span>
      <button class="op" @click="chatStore.abort()">收起</button>
    </div>
  </div>
</template>

<style scoped>
.message-list {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.empty {
  text-align: center;
  color: #aaa;
  margin-top: 40px;
  font-size: 14px;
}

.msg-row {
  display: flex;
}
.msg-row.user {
  justify-content: flex-end;
}
.msg-row.assistant {
  justify-content: flex-start;
}

.bubble-wrap {
  max-width: 74%;
  display: flex;
  flex-direction: column;
  gap: 3px;
}
.user .bubble-wrap {
  align-items: flex-end;
}

.msg {
  padding: 9px 13px;
  border-radius: 12px;
  font-size: 14px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}

.user .msg {
  background: #6495ed;
  color: #fff;
  border-bottom-right-radius: 4px;
}
.assistant .msg {
  background: #fff;
  color: #333;
  border-bottom-left-radius: 4px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
}
.failed .msg {
  background: #fff2f0;
  color: #b4453a;
}
.msg.streaming {
  opacity: 0.85;
}

.meta {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: #b0b0b0;
  padding: 0 4px;
}
.tag {
  background: #eef3fe;
  color: #7a9be0;
  border-radius: 8px;
  padding: 0 6px;
}
.time {
  color: #c0c0c0;
}
.op {
  border: none;
  background: transparent;
  color: #b0b0b0;
  font-size: 11px;
  cursor: pointer;
  padding: 0 2px;
}
.op:hover {
  color: #6495ed;
}

.error-row {
  align-self: center;
  display: flex;
  gap: 8px;
  align-items: center;
  font-size: 12px;
  color: #b4453a;
  background: #fff2f0;
  border-radius: 8px;
  padding: 6px 12px;
}
</style>
