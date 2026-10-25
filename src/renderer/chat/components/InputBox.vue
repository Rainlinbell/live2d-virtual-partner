<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import { useChatStore } from '../../shared/stores/chat';

const chatStore = useChatStore();
const input = ref('');
const textareaEl = ref<HTMLTextAreaElement | null>(null);

const canSend = computed(() => input.value.trim().length > 0);

function send(): void {
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  chatStore.send(text);
  void nextTick(() => textareaEl.value?.focus());
}

/** 输入法组合中按回车是在确认候选词，不能当发送 */
function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing) return;
  event.preventDefault();
  send();
}

async function clearHistory(): Promise<void> {
  if (!confirm('确定清空全部聊天记录吗？（不影响长期记忆）')) return;
  await chatStore.clear();
}
</script>

<template>
  <div class="input-box">
    <button class="clear" title="清空聊天记录" @click="clearHistory">清空</button>

    <textarea
      ref="textareaEl"
      v-model="input"
      rows="2"
      :placeholder="
        chatStore.streaming ? '回复中，输入后回车会打断并重新提问' : '输入消息，Enter 发送，Shift+Enter 换行'
      "
      @keydown="onKeydown"
    ></textarea>

    <button v-if="chatStore.streaming" class="stop" title="停止生成" @click="chatStore.abort()">
      停止
    </button>
    <button v-else class="send" :disabled="!canSend" @click="send">发送</button>
  </div>
</template>

<style scoped>
.input-box {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  padding: 12px 16px;
  background: #fff;
  border-top: 1px solid #eee;
}

textarea {
  flex: 1;
  resize: none;
  border: 1px solid #ddd;
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 14px;
  font-family: inherit;
  line-height: 1.5;
  outline: none;
  max-height: 140px;
}
textarea:focus {
  border-color: #6495ed;
}

.send,
.stop,
.clear {
  border: none;
  border-radius: 8px;
  padding: 9px 16px;
  font-size: 14px;
  cursor: pointer;
  white-space: nowrap;
}
.send {
  background: #6495ed;
  color: #fff;
}
.send:disabled {
  background: #b8c8e8;
  cursor: default;
}
.stop {
  background: #ffb020;
  color: #fff;
}
.clear {
  background: #f0f0f0;
  color: #888;
}
</style>
