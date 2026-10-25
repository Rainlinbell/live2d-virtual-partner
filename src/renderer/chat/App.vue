<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useConfigStore } from '../shared/stores/config';
import { useChatStore } from '../shared/stores/chat';
import { MEMORY_CATEGORIES, MEMORY_CATEGORY_KEYS } from '../../shared/types';
import type { MemoryCategory, MemoryEntry, SessionInfo } from '../../shared/types';
import MessageList from './components/MessageList.vue';
import InputBox from './components/InputBox.vue';

const configStore = useConfigStore();
const chatStore = useChatStore();

const showMemory = ref(false);
const query = ref('');
const notice = ref('');
const newMemory = ref('');
const newMemoryCategory = ref<MemoryCategory>('preference');
const editingId = ref('');
const editingText = ref('');
let noticeTimer: ReturnType<typeof setTimeout> | undefined;

const characters = computed(() => configStore.cfg?.characters ?? []);
const currentId = computed(() => configStore.cfg?.currentCharacterId ?? '');
const currentName = computed(() => configStore.currentCharacter?.name ?? '');

const sessions = ref<SessionInfo[]>([]);
const currentSessionId = computed(() => configStore.cfg?.currentSessionId || 'default');

async function refreshSessions(): Promise<void> {
  sessions.value = await window.api.listSessions();
}

async function newSession(): Promise<void> {
  const name = window.prompt('新会话名称（留空自动命名）') ?? '';
  await window.api.newSession(name);
  await refreshSessions();
}

async function switchSession(id: string): Promise<void> {
  await window.api.switchSession(id);
}

async function removeSession(id: string): Promise<void> {
  if (!window.confirm('删除该会话及其聊天记录？此操作不可恢复。')) return;
  await window.api.deleteSession(id);
  await refreshSessions();
}

const matchCount = computed(() => {
  const q = query.value.trim().toLowerCase();
  if (!q) return 0;
  return chatStore.messages.filter((m) => m.content.toLowerCase().includes(q)).length;
});

function flash(text: string): void {
  notice.value = text;
  if (noticeTimer) clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => {
    notice.value = '';
  }, 2600);
}

async function exportChat(): Promise<void> {
  if (!chatStore.messages.length) {
    flash('还没有聊天记录可导出');
    return;
  }
  try {
    const ok = await window.api.exportChat();
    if (ok) flash('已导出为 Markdown');
  } catch {
    flash('导出失败，请查看日志');
  }
}

async function switchCharacter(event: Event): Promise<void> {
  const id = (event.target as HTMLSelectElement).value;
  if (id && id !== currentId.value) await configStore.setCurrentCharacter(id);
}

async function clearMemories(): Promise<void> {
  if (!confirm('确定清空这个角色的长期记忆吗？')) return;
  await chatStore.clearMemories();
}

function categoryLabel(c: MemoryCategory): string {
  return MEMORY_CATEGORIES[c] ?? '事实';
}

async function addMemory(): Promise<void> {
  const text = newMemory.value.trim();
  if (!text) return;
  await chatStore.addMemory(text, newMemoryCategory.value);
  newMemory.value = '';
}

function startEdit(m: MemoryEntry): void {
  editingId.value = m.id;
  editingText.value = m.text;
}

async function saveEdit(): Promise<void> {
  const id = editingId.value;
  const text = editingText.value.trim();
  if (!id) return;
  if (text) await chatStore.updateMemory(id, { text });
  editingId.value = '';
  editingText.value = '';
}

function cancelEdit(): void {
  editingId.value = '';
  editingText.value = '';
}

async function removeMemory(id: string): Promise<void> {
  await chatStore.deleteMemory(id);
}

/** 模板里不能直接访问 window */
function openSettings(): void {
  void window.api.openSettings();
}

onMounted(async () => {
  await configStore.load();
  await chatStore.init();
  await refreshSessions();
});

watch(currentSessionId, () => {
  void refreshSessions();
});

onBeforeUnmount(() => {
  if (noticeTimer) clearTimeout(noticeTimer);
});
</script>

<template>
  <div class="chat-root">
    <header class="bar">
      <select
        v-if="characters.length"
        class="char-select"
        :value="currentId"
        @change="switchCharacter"
      >
        <option v-for="c in characters" :key="c.id" :value="c.id">{{ c.name }}</option>
      </select>
      <span v-else class="no-char">还没有角色，请到设置里新建</span>

      <select
        v-if="characters.length"
        class="char-select"
        :value="currentSessionId"
        @change="switchSession(($event.target as HTMLSelectElement).value)"
      >
        <option value="default">默认会话</option>
        <option v-for="s in sessions" :key="s.id" :value="s.id">{{ s.name }}</option>
      </select>
      <button v-if="characters.length" class="link" title="新建会话" @click="newSession">+会话</button>
      <button
        v-if="currentSessionId !== 'default'"
        class="link"
        title="删除当前会话"
        @click="removeSession(currentSessionId)"
      >
        删会话
      </button>

      <span v-if="chatStore.streaming" class="badge">回复中…</span>

      <input v-model="query" class="search" type="search" placeholder="搜索消息" />
      <span v-if="query.trim()" class="match">{{ matchCount }} 条</span>

      <div class="spacer" />

      <span v-if="notice" class="notice">{{ notice }}</span>
      <button class="link" title="导出为 Markdown" @click="exportChat">导出</button>
      <button class="link" :class="{ active: showMemory }" title="长期记忆" @click="showMemory = !showMemory">
        记忆{{ chatStore.memories.length ? `(${chatStore.memories.length})` : '' }}
      </button>
      <button class="link" title="设置" @click="openSettings">设置</button>
    </header>

    <section v-if="showMemory && characters.length" class="memory">
      <div class="memory-head">
        <span>
          关于「{{ currentName }}」的长期记忆{{
            chatStore.memories.length ? `（${chatStore.memories.length}）` : ''
          }}
        </span>
        <button v-if="chatStore.memories.length" class="link" @click="clearMemories">清空全部</button>
      </div>

      <div class="memory-add">
        <select v-model="newMemoryCategory" class="mem-cat">
          <option v-for="c in MEMORY_CATEGORY_KEYS" :key="c" :value="c">
            {{ MEMORY_CATEGORIES[c] }}
          </option>
        </select>
        <input
          v-model="newMemory"
          class="mem-input"
          placeholder="手动记一笔，比如：喜欢喝美式咖啡"
          @keydown.enter="addMemory"
        />
        <button class="link" :disabled="!newMemory.trim()" @click="addMemory">记下</button>
      </div>

      <ul v-if="chatStore.memories.length" class="memory-list">
        <li v-for="m in chatStore.memories" :key="m.id" class="mem-item">
          <span class="mem-tag">{{ categoryLabel(m.category) }}</span>
          <template v-if="editingId === m.id">
            <input v-model="editingText" class="mem-edit" @keydown.enter="saveEdit" />
            <button class="op" @click="saveEdit">保存</button>
            <button class="op" @click="cancelEdit">取消</button>
          </template>
          <template v-else>
            <span class="mem-text">{{ m.text }}</span>
            <span class="mem-imp" :title="`重要度 ${Math.round(m.importance * 100)}%`">
              {{ '●'.repeat(Math.max(1, Math.round(m.importance * 5))) }}
            </span>
            <button class="op" @click="startEdit(m)">改</button>
            <button class="op danger" @click="removeMemory(m.id)">删</button>
          </template>
        </li>
      </ul>
      <p v-else class="memory-empty">
        暂无记忆。对话变长后会自动压缩成记忆；也可以在上面手动记一条。
      </p>
    </section>

    <MessageList :query="query" />
    <InputBox />
  </div>
</template>

<style scoped>
.chat-root {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  background: #f5f6f8;
}

.bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  background: #fff;
  border-bottom: 1px solid #eee;
}

.char-select {
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  padding: 4px 8px;
  font-size: 13px;
  background: #fff;
  outline: none;
}

.no-char {
  font-size: 12px;
  color: #b4453a;
  background: #fff2f0;
  border-radius: 6px;
  padding: 3px 8px;
}

.badge {
  font-size: 11px;
  color: #6495ed;
  background: #eef3fe;
  border-radius: 10px;
  padding: 2px 8px;
}

.search {
  width: 150px;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  padding: 4px 8px;
  font-size: 12px;
  outline: none;
}
.search:focus {
  border-color: #a9c0f5;
}

.match {
  font-size: 11px;
  color: #9aa4b2;
}

.notice {
  font-size: 11px;
  color: #3a8a5a;
  background: #eef8f1;
  border-radius: 8px;
  padding: 2px 8px;
}

.spacer {
  flex: 1;
}

.link {
  border: none;
  background: transparent;
  color: #888;
  font-size: 12px;
  cursor: pointer;
  padding: 2px 6px;
}
.link:hover,
.link.active {
  color: #6495ed;
}

.memory {
  background: #fffdf5;
  border-bottom: 1px solid #f0e6c8;
  padding: 10px 14px;
  max-height: 240px;
  overflow-y: auto;
}

.memory-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 12px;
  color: #8a7a4a;
}

.memory-add {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
}

.mem-cat {
  flex: none;
  border: 1px solid #e6d9b8;
  border-radius: 6px;
  background: #fff;
  font-size: 11px;
  color: #8a7a4a;
  padding: 3px 4px;
  outline: none;
}

.mem-input {
  flex: 1;
  min-width: 0;
  border: 1px solid #e6d9b8;
  border-radius: 6px;
  padding: 3px 8px;
  font-size: 12px;
  background: #fff;
  outline: none;
}
.mem-input:focus {
  border-color: #c9b37a;
}

.memory-list {
  margin: 8px 0 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 12px;
  color: #6b6350;
}

.mem-item {
  display: flex;
  align-items: center;
  gap: 6px;
  line-height: 1.5;
}

.mem-tag {
  flex: none;
  background: #f3ead2;
  color: #8a7a4a;
  border-radius: 6px;
  padding: 0 6px;
  font-size: 11px;
}

.mem-text {
  flex: 1;
  min-width: 0;
  word-break: break-word;
}

.mem-imp {
  flex: none;
  color: #d9b44a;
  font-size: 9px;
  letter-spacing: 1px;
}

.mem-edit {
  flex: 1;
  min-width: 0;
  border: 1px solid #c9b37a;
  border-radius: 6px;
  padding: 2px 6px;
  font-size: 12px;
  outline: none;
}

.op {
  flex: none;
  border: none;
  background: transparent;
  color: #a8986a;
  font-size: 11px;
  cursor: pointer;
  padding: 0 2px;
}
.op:hover {
  color: #7a6a3a;
}
.op.danger {
  color: #c46a6a;
}
.op:disabled {
  opacity: 0.5;
  cursor: default;
}

.memory-empty {
  margin: 8px 0 0;
  font-size: 12px;
  color: #b3a888;
  line-height: 1.6;
}
</style>
