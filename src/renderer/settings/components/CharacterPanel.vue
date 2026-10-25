<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useConfigStore } from '../../shared/stores/config';
import { EMOTION_KEYS, EMOTION_LABELS } from '../../../shared/types';
import type { EmotionKey, EmotionMap } from '../../../shared/types';

const props = defineProps<{ characterId: string }>();
const configStore = useConfigStore();

const character = computed(() =>
  configStore.cfg?.characters.find((c) => c.id === props.characterId),
);

const name = ref('');
const personality = ref('');
const greeting = ref('');
const voice = ref('');
const systemPrompt = ref('');
const advanced = ref(false);
const modelScale = ref(1);
const modelOffsetY = ref(0);
const memoryEnabled = ref(true);
const emotions = ref<EmotionMap>({});

const message = ref('');
const isError = ref(false);
const saved = ref('');

let syncedId = '';
let dirty = false;

function syncFrom(id: string): void {
  const c = configStore.cfg?.characters.find((x) => x.id === id);
  if (!c) return;
  syncedId = c.id;
  dirty = false;
  name.value = c.name;
  personality.value = c.personality;
  greeting.value = c.greeting ?? '';
  voice.value = c.voice ?? '';
  systemPrompt.value = c.systemPrompt;
  advanced.value = Boolean(c.systemPrompt);
  modelScale.value = c.modelScale > 0 ? c.modelScale : 1;
  modelOffsetY.value = c.modelOffsetY || 0;
  memoryEnabled.value = c.memoryEnabled !== false;
  emotions.value = { ...(c.emotionMap ?? {}) };
}

watch(
  () => props.characterId,
  (id) => {
    if (id) syncFrom(id);
  },
  { immediate: true },
);

watch(
  () => configStore.cfg?.characters.find((c) => c.id === props.characterId),
  (c) => {
    // 自己在编辑时不要被广播覆盖；角色被切换时无条件同步
    if (!c || dirty) return;
    if (c.id !== syncedId) syncFrom(c.id);
  },
);

function touch(): void {
  dirty = true;
  saved.value = '';
  message.value = '';
}

async function save(): Promise<void> {
  if (!props.characterId) return;
  dirty = false;
  try {
    await window.api.updateCharacter(props.characterId, {
      name: name.value.trim() || '未命名角色',
      personality: personality.value.trim(),
      greeting: greeting.value.trim(),
      voice: voice.value.trim(),
      systemPrompt: advanced.value ? systemPrompt.value : '',
      modelScale: Number(modelScale.value) || 1,
      modelOffsetY: Number(modelOffsetY.value) || 0,
      memoryEnabled: memoryEnabled.value,
      emotionMap: emotions.value,
    });
    saved.value = '已保存';
    setTimeout(() => {
      if (saved.value === '已保存') saved.value = '';
    }, 2000);
  } catch (e) {
    isError.value = true;
    message.value = (e as Error).message;
  }
}

function setEmotion(key: EmotionKey, value: string): void {
  emotions.value = { ...emotions.value, [key]: value.trim() };
  touch();
}

async function exportCard(): Promise<void> {
  try {
    const ok = await window.api.exportCharacterCard(props.characterId);
    message.value = ok ? '角色卡已导出' : '';
    isError.value = false;
  } catch (e) {
    isError.value = true;
    message.value = `导出失败：${(e as Error).message}`;
  }
}

const avatarUrl = computed(() => character.value?.avatar ?? '');
</script>

<template>
  <div v-if="character" class="panel">
    <div class="head">
      <img v-if="avatarUrl" class="avatar" :src="avatarUrl" alt="角色头像" />
      <div v-else class="avatar avatar-empty">{{ character.name.slice(0, 1) }}</div>
      <div class="head-main">
        <h2 class="panel-title">{{ character.name }}</h2>
        <p class="panel-desc" style="margin: 0">角色的名字、性格、开场白与表情映射。</p>
      </div>
      <button class="btn" title="导出为角色卡 JSON" @click="exportCard">导出角色卡</button>
    </div>

    <div class="section">
      <div class="section-title">基本设定</div>

      <div class="field">
        <span class="label">角色名</span>
        <input v-model="name" class="input" placeholder="小爱" @input="touch" @change="save" />
      </div>

      <div class="field">
        <span class="label">开场白（历史为空时显示在气泡里）</span>
        <input
          v-model="greeting"
          class="input"
          placeholder="你来啦，今天过得怎么样？"
          @input="touch"
          @change="save"
        />
      </div>

      <div class="field">
        <span class="label">性格描述</span>
        <textarea
          v-model="personality"
          class="textarea"
          rows="4"
          placeholder="温柔体贴、有点小傲娇，喜欢听你讲今天发生的事…"
          @input="touch"
          @change="save"
        ></textarea>
        <span class="hint">会被写成「你是{角色名}，{性格描述}」，越具体越像本人。</span>
      </div>

      <div class="field">
        <span class="label">专属音色（留空则用语音面板里的默认音色）</span>
        <input
          v-model="voice"
          class="input"
          placeholder="alloy / zh-CN-XiaoxiaoNeural / 自定义音色 id"
          @input="touch"
          @change="save"
        />
      </div>
    </div>

    <div class="section">
      <div class="section-title">模型表现</div>
      <div class="field-row">
        <div class="field">
          <span class="label">缩放（{{ Number(modelScale).toFixed(2) }}×）</span>
          <input
            v-model.number="modelScale"
            class="range"
            type="range"
            min="0.4"
            max="1.8"
            step="0.05"
            @input="touch"
            @change="save"
          />
        </div>
        <div class="field">
          <span class="label">垂直偏移（{{ modelOffsetY }} px）</span>
          <input
            v-model.number="modelOffsetY"
            class="range"
            type="range"
            min="-200"
            max="200"
            step="4"
            @input="touch"
            @change="save"
          />
        </div>
      </div>
      <span class="hint">模型太大/太小或位置偏了，用这两项微调。</span>
    </div>

    <div class="section">
      <div class="section-title">表情映射</div>
      <p class="hint" style="margin-bottom: 10px">
        模型的表情文件名（不含后缀）。留空则按常见名字自动尝试；都可以在模型的
        <code>*.model3.json</code> 的 Expressions 里找到。
      </p>
      <div class="emo-grid">
        <div v-for="key in EMOTION_KEYS" :key="key" class="emo-row">
          <span class="emo-label">{{ EMOTION_LABELS[key] }}</span>
          <input
            class="input"
            :value="emotions[key] ?? ''"
            placeholder="例如 exp_02"
            @input="setEmotion(key, ($event.target as HTMLInputElement).value)"
            @change="save"
          />
        </div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">记忆与高级</div>
      <label class="switch">
        <input v-model="memoryEnabled" type="checkbox" @change="touch(); save()" />
        参与长期记忆压缩（关掉后这个角色不写入记忆）
      </label>

      <label class="switch" style="margin-top: 10px">
        <input v-model="advanced" type="checkbox" @change="touch(); save()" />
        高级模式：直接编辑完整 system prompt
      </label>

      <div v-if="advanced" class="field" style="margin-top: 10px">
        <textarea
          v-model="systemPrompt"
          class="textarea mono"
          rows="12"
          placeholder="你是…&#10;（这里的内容会完全替代自动生成的提示词）"
          @input="touch"
          @change="save"
        ></textarea>
        <span class="hint">留空或关闭高级模式则使用「角色名 + 性格描述」自动生成。</span>
      </div>
    </div>

    <div class="row">
      <button class="btn primary" @click="save">保存</button>
      <span v-if="saved" class="ok">{{ saved }}</span>
      <span v-if="message" :class="isError ? 'err' : 'ok'">{{ message }}</span>
    </div>
  </div>
</template>

<style scoped>
.panel {
  max-width: 640px;
}

.head {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 20px;
}

.head-main {
  flex: 1;
}

.avatar {
  width: 56px;
  height: 56px;
  border-radius: 14px;
  object-fit: cover;
  background: var(--brand-soft);
}

.avatar-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--brand);
  font-size: 22px;
  font-weight: 600;
}

.emo-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px 14px;
}

.emo-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.emo-label {
  width: 40px;
  font-size: 12px;
  color: #666;
  flex: none;
}

.range {
  width: 100%;
  accent-color: var(--brand);
}

.mono {
  font-family: Consolas, 'Courier New', monospace;
  font-size: 12px;
}

code {
  background: #f2f4f7;
  border-radius: 4px;
  padding: 1px 4px;
}
</style>
