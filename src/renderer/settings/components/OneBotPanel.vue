<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';
import { useConfigStore } from '../../shared/stores/config';
import type { OneBotConfig, OneBotConnectionStatus } from '../../../shared/types';

const props = defineProps<{ characterId: string }>();
const configStore = useConfigStore();

const enabled = ref(false);
const wsUrl = ref('ws://127.0.0.1:3001');
const qq = ref('');
const autoReply = ref(true);
const requireAt = ref(true);
const allowedFriends = ref('');
const allowedGroups = ref('');

const status = ref<OneBotConnectionStatus>('disconnected');
const logs = ref<Array<{ from: string; content: string; reply: string; ts: number }>>([]);
const message = ref('');

let offStatus: (() => void) | null = null;
let offMessage: (() => void) | null = null;
let syncedId = '';
let dirty = false;

watch(
  () => props.characterId,
  async (id) => {
    const c = configStore.cfg?.characters.find((x) => x.id === id);
    if (!c) return;
    syncedId = c.id;
    dirty = false;
    enabled.value = c.onebot.enabled;
    wsUrl.value = c.onebot.wsUrl || 'ws://127.0.0.1:3001';
    qq.value = c.onebot.qq;
    autoReply.value = c.onebot.autoReply;
    requireAt.value = c.onebot.requireAt !== false;
    allowedFriends.value = c.onebot.allowedFriends.join(', ');
    allowedGroups.value = c.onebot.allowedGroups.join(', ');
    logs.value = [];
    if (id) status.value = await window.api.onebotStatus(id);
  },
  { immediate: true },
);

watch(
  () => configStore.cfg?.characters.find((c) => c.id === props.characterId),
  (c) => {
    if (!c || dirty || c.id !== syncedId) return;
  },
);

function parseList(input: string): string[] {
  return input
    .split(/[,，\s]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

async function save(): Promise<void> {
  if (!props.characterId) return;
  dirty = false;
  const onebot: OneBotConfig = {
    enabled: enabled.value,
    wsUrl: wsUrl.value.trim() || 'ws://127.0.0.1:3001',
    qq: qq.value.trim(),
    autoReply: autoReply.value,
    requireAt: requireAt.value,
    allowedFriends: parseList(allowedFriends.value),
    allowedGroups: parseList(allowedGroups.value),
  };
  await window.api.updateCharacter(props.characterId, { onebot });
}

async function connect(): Promise<void> {
  if (!props.characterId) return;
  await save();
  message.value = '';
  try {
    status.value = await window.api.onebotConnect(props.characterId);
    if (status.value === 'error') message.value = '连接失败，请确认协议端已启动并开启正向 WebSocket';
  } catch (e) {
    message.value = (e as Error).message;
  }
}

async function disconnect(): Promise<void> {
  if (!props.characterId) return;
  await window.api.onebotDisconnect(props.characterId);
  status.value = 'disconnected';
}

watch(
  () => props.characterId,
  (id) => {
    offStatus?.();
    offMessage?.();
    offStatus = window.api.onOneBotStatus((e) => {
      if (e.characterId === id) status.value = e.status;
    });
    offMessage = window.api.onOneBotMessage((e) => {
      if (e.characterId !== id) return;
      logs.value.unshift({ ...e, ts: Date.now() });
      if (logs.value.length > 30) logs.value.pop();
    });
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  offStatus?.();
  offMessage?.();
});

const statusLabel: Record<OneBotConnectionStatus, string> = {
  connected: '已连接',
  connecting: '连接中…',
  disconnected: '未连接',
  error: '连接错误',
};

const statusColor: Record<OneBotConnectionStatus, string> = {
  connected: '#2e9e6b',
  connecting: '#d9a200',
  disconnected: '#999',
  error: '#d03050',
};

function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(
    d.getSeconds(),
  ).padStart(2, '0')}`;
}
</script>

<template>
  <div class="panel">
    <h2 class="panel-title">QQ 接入</h2>
    <p class="panel-desc">
      通过 OneBot v11 正向 WebSocket 接入 QQ。需要先自行运行协议端（NapCat、LLOneBot 等），
      在协议端里开启 WebSocket 服务，再把地址填到这里。一个角色绑定一个 QQ 号。
    </p>

    <div class="section">
      <div class="section-title">
        <span>连接设置</span>
        <label class="switch">
          <input v-model="enabled" type="checkbox" @change="dirty = true; save()" />
          启用
        </label>
      </div>

      <template v-if="enabled">
        <div class="field-row">
          <div class="field">
            <span class="label">WebSocket 地址</span>
            <input
              v-model="wsUrl"
              class="input"
              placeholder="ws://127.0.0.1:3001"
              @input="dirty = true"
              @change="save"
            />
          </div>
          <div class="field">
            <span class="label">绑定的 QQ 号（仅作标识，可留空）</span>
            <input
              v-model="qq"
              class="input"
              placeholder="123456789"
              @input="dirty = true"
              @change="save"
            />
          </div>
        </div>

        <label class="switch" style="margin-bottom: 10px">
          <input v-model="autoReply" type="checkbox" @change="dirty = true; save()" />
          收到消息后自动用 AI 回复（关闭则只记录不回复）
        </label>

        <label class="switch" style="margin-bottom: 10px">
          <input v-model="requireAt" type="checkbox" @change="dirty = true; save()" />
          群聊里只有 @ 我 才回复（防止刷屏，推荐开启）
        </label>

        <div class="field-row">
          <div class="field">
            <span class="label">允许自动回复的好友 QQ（留空 = 全部）</span>
            <input
              v-model="allowedFriends"
              class="input"
              placeholder="123456, 789012"
              @input="dirty = true"
              @change="save"
            />
          </div>
          <div class="field">
            <span class="label">允许自动回复的群号（留空 = 全部）</span>
            <input
              v-model="allowedGroups"
              class="input"
              placeholder="10086, 10010"
              @input="dirty = true"
              @change="save"
            />
          </div>
        </div>

        <div class="conn-row">
          <span class="dot" :style="{ background: statusColor[status] }" />
          <span class="status-text" :style="{ color: statusColor[status] }">
            {{ statusLabel[status] }}
          </span>
          <button
            v-if="status !== 'connected' && status !== 'connecting'"
            class="btn primary"
            @click="connect"
          >
            连接
          </button>
          <button v-else class="btn" @click="disconnect">断开</button>
        </div>
        <p v-if="message" class="err" style="margin-top: 8px">{{ message }}</p>
      </template>
    </div>

    <div v-if="enabled" class="section">
      <div class="section-title">
        <span>最近消息</span>
        <button v-if="logs.length" class="btn ghost" @click="logs = []">清空</button>
      </div>

      <div v-if="logs.length" class="list log-list">
        <div v-for="(l, i) in logs" :key="i" class="log-item">
          <div class="log-head">
            <span class="log-from">{{ l.from || '未知' }}</span>
            <span class="log-time">{{ formatTime(l.ts) }}</span>
          </div>
          <div class="log-content">收：{{ l.content }}</div>
          <div class="log-reply">回：{{ l.reply }}</div>
        </div>
      </div>
      <div v-else class="empty">暂无消息。连接成功后，别人发给这个 QQ 的消息会显示在这里。</div>
    </div>
  </div>
</template>

<style scoped>
.panel {
  max-width: 620px;
}

.conn-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 14px;
  padding: 10px 12px;
  background: #f7f8fa;
  border-radius: 8px;
}

.dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
}

.status-text {
  font-size: 13px;
  flex: 1;
}

.log-list {
  max-height: 280px;
  overflow-y: auto;
}

.log-item {
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 8px 10px;
  font-size: 12px;
  background: #fff;
}

.log-head {
  display: flex;
  justify-content: space-between;
  margin-bottom: 3px;
}

.log-from {
  color: var(--brand);
  font-weight: 600;
}

.log-time {
  color: var(--muted);
}

.log-content {
  color: #555;
  word-break: break-word;
}

.log-reply {
  color: var(--ok);
  margin-top: 2px;
  word-break: break-word;
}

.empty {
  color: #aaa;
  font-size: 13px;
  padding: 10px 0;
  line-height: 1.6;
}
</style>
