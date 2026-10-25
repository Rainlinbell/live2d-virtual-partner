<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useConfigStore } from '../../shared/stores/config';
import { LOCAL_PRESETS } from '../../../shared/types';
import type { LlmConfig } from '../../../shared/types';

const configStore = useConfigStore();

const form = ref<LlmConfig>({
  provider: 'cloud',
  localPreset: '',
  baseURL: '',
  apiKey: '',
  model: '',
  temperature: 0.8,
  maxTokens: 0,
  topP: 0.95,
});

const testResult = ref('');
const testOk = ref(false);
const testing = ref(false);
const saved = ref('');

/** 正在编辑时不接受广播覆盖，避免打字被 config:changed 冲掉 */
let dirty = false;
/** 是否已从主进程取到明文 Key（取到后，广播里脱敏的值不再覆盖输入框） */
let keyLoaded = false;

watch(
  () => configStore.cfg?.llm,
  (llm) => {
    if (!llm || dirty) return;
    const prevKey = form.value.apiKey;
    form.value = { ...llm };
    if (keyLoaded) form.value.apiKey = prevKey;
  },
  { immediate: true, deep: true },
);

onMounted(async () => {
  try {
    const secrets = await window.api.getSecrets();
    form.value.apiKey = secrets.llm;
  } catch {
    // 取明文失败时保留脱敏占位符，提交时主进程会保留原 Key
  }
  keyLoaded = true;
});

function touch(): void {
  dirty = true;
  saved.value = '';
}

async function save(): Promise<void> {
  dirty = false;
  await configStore.set({
    llm: {
      ...form.value,
      baseURL: form.value.baseURL.trim(),
      apiKey: form.value.apiKey.trim(),
      model: form.value.model.trim(),
    },
  });
  saved.value = '已保存';
  setTimeout(() => {
    if (saved.value === '已保存') saved.value = '';
  }, 2000);
}

async function setProvider(provider: 'cloud' | 'local'): Promise<void> {
  form.value.provider = provider;
  await save();
}

async function applyPreset(key: string): Promise<void> {
  const p = LOCAL_PRESETS.find((x) => x.key === key);
  if (!p) return;
  form.value.provider = 'local';
  form.value.localPreset = key;
  form.value.baseURL = p.defaultBase;
  form.value.model = p.defaultModel;
  form.value.apiKey = '';
  await save();
}

function useCustomPreset(): void {
  form.value.localPreset = '';
  touch();
}

async function test(): Promise<void> {
  testing.value = true;
  testResult.value = '';
  testOk.value = false;
  try {
    await save();
    const result = await window.api.testLlm();
    testResult.value = result;
    testOk.value = /成功|ok|正常|可用/i.test(result);
  } catch (e) {
    testResult.value = (e as Error).message;
  } finally {
    testing.value = false;
  }
}

const hintText = computed(() =>
  form.value.provider === 'cloud'
    ? '云端：DeepSeek、OpenAI、通义千问、硅基流动、火山方舟等所有 OpenAI 兼容接口。'
    : '本地：Ollama、LM Studio、llama.cpp、vLLM 等兼容 OpenAI 的推理服务，无需 API Key。',
);

const basePlaceholder = computed(() =>
  form.value.provider === 'local' ? 'http://127.0.0.1:11434/v1' : 'https://api.deepseek.com/v1',
);
</script>

<template>
  <div class="panel">
    <h2 class="panel-title">AI 接口</h2>
    <p class="panel-desc">
      填写兼容 OpenAI 的接口地址与密钥。保存后立即生效，密钥会使用系统凭据加密存储。
    </p>

    <div class="section">
      <div class="section-title">运行方式</div>
      <div class="seg">
        <button :class="{ active: form.provider === 'cloud' }" @click="setProvider('cloud')">
          云端 API
        </button>
        <button :class="{ active: form.provider === 'local' }" @click="setProvider('local')">
          本地模型
        </button>
      </div>
      <p class="hint" style="margin-top: 8px">{{ hintText }}</p>
    </div>

    <div v-if="form.provider === 'local'" class="section">
      <div class="section-title">本地服务预设</div>
      <div class="presets">
        <button
          v-for="p in LOCAL_PRESETS"
          :key="p.key"
          class="preset"
          :class="{ active: form.localPreset === p.key }"
          @click="applyPreset(p.key)"
        >
          <div class="preset-name">{{ p.name }}</div>
          <div class="preset-hint">{{ p.hint }}</div>
        </button>
        <button
          class="preset"
          :class="{ active: form.localPreset === '' }"
          @click="useCustomPreset"
        >
          <div class="preset-name">自定义</div>
          <div class="preset-hint">自己填写地址和模型名</div>
        </button>
      </div>
    </div>

    <div class="section">
      <div class="section-title">连接信息</div>

      <div class="field">
        <span class="label">Base URL</span>
        <input
          v-model="form.baseURL"
          class="input"
          :placeholder="basePlaceholder"
          @input="touch"
          @change="save"
        />
        <span class="hint">
          填到 <code>/v1</code> 或只填域名都可以，会自动补全（不会出现 /v1/v1）。真正请求的地址：
          <code>{{ form.baseURL || basePlaceholder }}/chat/completions</code>
        </span>
      </div>

      <div v-if="form.provider === 'cloud'" class="field">
        <span class="label">API Key</span>
        <input
          v-model="form.apiKey"
          class="input"
          type="password"
          placeholder="sk-..."
          autocomplete="off"
          @input="touch"
          @change="save"
        />
        <span class="hint">仅保存在本机，不会写入日志；聊天记录里不含密钥。</span>
      </div>

      <div class="field">
        <span class="label">模型名</span>
        <input
          v-model="form.model"
          class="input"
          :placeholder="form.provider === 'local' ? 'qwen2.5:7b' : 'deepseek-chat'"
          @input="touch"
          @change="save"
        />
      </div>
    </div>

    <div class="section">
      <div class="section-title">生成参数</div>
      <div class="field-row">
        <div class="field">
          <span class="label">温度 temperature（{{ form.temperature.toFixed(2) }}）</span>
          <input
            v-model.number="form.temperature"
            class="range"
            type="range"
            min="0"
            max="1.5"
            step="0.05"
            @input="touch"
            @change="save"
          />
          <span class="hint">越高越发散，角色扮演建议 0.8～1.0。</span>
        </div>
        <div class="field">
          <span class="label">top_p（{{ form.topP.toFixed(2) }}）</span>
          <input
            v-model.number="form.topP"
            class="range"
            type="range"
            min="0.1"
            max="1"
            step="0.05"
            @input="touch"
            @change="save"
          />
          <span class="hint">越低越保守，一般 0.9～1.0。</span>
        </div>
      </div>

      <div class="field">
        <span class="label">单次回复上限 max_tokens（0 表示不限制）</span>
        <input
          v-model.number="form.maxTokens"
          class="input"
          type="number"
          min="0"
          max="8192"
          step="64"
          @input="touch"
          @change="save"
        />
        <span class="hint">桌面宠物回复通常很短，限制在 256～512 可以省钱并加快响应。</span>
      </div>
    </div>

    <div class="row">
      <button class="btn primary" :disabled="testing" @click="test">
        {{ testing ? '测试中…' : '保存并测试连接' }}
      </button>
      <span v-if="saved" class="ok">{{ saved }}</span>
      <span
        v-if="testResult"
        :class="testOk ? 'ok' : 'err'"
        style="max-width: 320px; line-height: 1.5"
      >
        {{ testResult }}
      </span>
    </div>
  </div>
</template>

<style scoped>
.panel {
  max-width: 620px;
}

.presets {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 8px;
}

.preset {
  text-align: left;
  border: 1px solid #dcdfe6;
  border-radius: 8px;
  background: #fafbfc;
  padding: 8px 10px;
  cursor: pointer;
}

.preset.active {
  border-color: var(--brand);
  background: var(--brand-soft);
}

.preset-name {
  font-size: 13px;
  font-weight: 600;
  color: #222;
}

.preset-hint {
  font-size: 11px;
  color: var(--muted);
  margin-top: 2px;
  line-height: 1.4;
}

.range {
  width: 100%;
  accent-color: var(--brand);
}

code {
  background: #f2f4f7;
  border-radius: 4px;
  padding: 1px 4px;
  font-size: 11px;
}
</style>
