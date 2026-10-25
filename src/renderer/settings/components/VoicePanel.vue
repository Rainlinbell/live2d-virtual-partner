<script setup lang="ts">
import { onMounted, ref, watch } from 'vue';
import { useConfigStore } from '../../shared/stores/config';
import { AUDIO_MIME } from '../../../shared/types';
import type { AudioFormat, SttConfig, TtsConfig } from '../../../shared/types';

const configStore = useConfigStore();

const tts = ref<TtsConfig>({
  enabled: true,
  engine: 'api',
  baseURL: '',
  apiKey: '',
  model: 'tts-1',
  voice: 'alloy',
  speed: 1,
  format: 'mp3',
});

const stt = ref<SttConfig>({
  enabled: true,
  engine: 'api',
  baseURL: '',
  apiKey: '',
  model: 'whisper-1',
  language: 'zh',
});

const message = ref('');
const isError = ref(false);
const testing = ref(false);
const previewing = ref(false);

let dirty = false;
/** 是否已取到明文 Key（取到后广播里的脱敏值不再覆盖输入框） */
let keyLoaded = false;

watch(
  () => configStore.cfg,
  (cfg) => {
    if (!cfg || dirty) return;
    const prevTtsKey = tts.value.apiKey;
    const prevSttKey = stt.value.apiKey;
    tts.value = { ...cfg.tts };
    stt.value = { ...cfg.stt };
    if (keyLoaded) {
      tts.value.apiKey = prevTtsKey;
      stt.value.apiKey = prevSttKey;
    }
  },
  { immediate: true, deep: true },
);

onMounted(async () => {
  try {
    const secrets = await window.api.getSecrets();
    tts.value.apiKey = secrets.tts;
    stt.value.apiKey = secrets.stt;
  } catch {
    // 取明文失败时保留脱敏占位符，提交时主进程会保留原 Key
  }
  keyLoaded = true;
});

function touch(): void {
  dirty = true;
  message.value = '';
}

async function save(): Promise<void> {
  dirty = false;
  await configStore.set({ tts: { ...tts.value }, stt: { ...stt.value } });
  message.value = '已保存';
  isError.value = false;
  setTimeout(() => {
    if (message.value === '已保存') message.value = '';
  }, 2000);
}

/** 试听：直接用真实 TTS 链路播一段，能听到即配置正确 */
async function preview(): Promise<void> {
  previewing.value = true;
  message.value = '';
  try {
    await save();
    const result = await window.api.ttsSpeak('你好呀，我是你的虚拟伴侣，很高兴见到你。');
    const blob = new Blob([result.audio], { type: result.mime || 'audio/mpeg' });
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.onended = () => URL.revokeObjectURL(url);
    audio.onerror = () => URL.revokeObjectURL(url);
    await audio.play();
    message.value = `正在播放（${result.mime}）`;
    isError.value = false;
  } catch (e) {
    isError.value = true;
    message.value = `试听失败：${(e as Error).message}`;
  } finally {
    previewing.value = false;
  }
}

async function testConnection(): Promise<void> {
  testing.value = true;
  message.value = '';
  try {
    await save();
    const result = await window.api.testTts();
    message.value = result;
    isError.value = !/成功|正常|可用|ok/i.test(result);
  } catch (e) {
    isError.value = true;
    message.value = (e as Error).message;
  } finally {
    testing.value = false;
  }
}

const formats: AudioFormat[] = ['mp3', 'wav', 'opus', 'aac', 'flac'];
</script>

<template>
  <div class="panel">
    <h2 class="panel-title">语音</h2>
    <p class="panel-desc">
      语音合成（TTS）与识别（STT）都走 OpenAI 兼容接口。地址和密钥留空时复用「AI 接口」里的配置，
      接口路径会自动补全，不需要自己写 <code>/v1/audio/speech</code>。
    </p>

    <div class="section">
      <div class="section-title">
        <span>语音合成（TTS）</span>
        <label class="switch">
          <input v-model="tts.enabled" type="checkbox" @change="touch(); save()" />
          启用播报
        </label>
      </div>

      <template v-if="tts.enabled">
        <div class="field">
          <span class="label">合成引擎</span>
          <div class="seg">
            <button :class="{ active: tts.engine === 'api' }" @click="tts.engine = 'api'; save()">
              OpenAI 接口
            </button>
            <button :class="{ active: tts.engine === 'sapi' }" @click="tts.engine = 'sapi'; save()">
              Windows 本地
            </button>
          </div>
        </div>

        <template v-if="tts.engine === 'api'">
          <div class="field-row">
            <div class="field">
              <span class="label">Base URL（留空复用 AI 接口）</span>
              <input
                v-model="tts.baseURL"
                class="input"
                placeholder="https://api.openai.com/v1"
                @input="touch"
                @change="save"
              />
            </div>
            <div class="field">
              <span class="label">API Key（留空复用）</span>
              <input
                v-model="tts.apiKey"
                class="input"
                type="password"
                placeholder="sk-..."
                autocomplete="off"
                @input="touch"
                @change="save"
              />
            </div>
          </div>

          <div class="field-row">
            <div class="field">
              <span class="label">模型</span>
              <input
                v-model="tts.model"
                class="input"
                placeholder="tts-1 / speech-01 / cosyvoice-v1"
                @input="touch"
                @change="save"
              />
            </div>
            <div class="field">
              <span class="label">默认音色</span>
              <input
                v-model="tts.voice"
                class="input"
                placeholder="alloy / zh-CN-XiaoxiaoNeural"
                @input="touch"
                @change="save"
              />
            </div>
          </div>

          <div class="field-row">
            <div class="field">
              <span class="label">语速（{{ tts.speed.toFixed(2) }}×）</span>
              <input
                v-model.number="tts.speed"
                class="range"
                type="range"
                min="0.5"
                max="2"
                step="0.05"
                @input="touch"
                @change="save"
              />
            </div>
            <div class="field">
              <span class="label">音频格式</span>
              <select v-model="tts.format" class="select" @change="touch(); save()">
                <option v-for="f in formats" :key="f" :value="f">{{ f }}（{{ AUDIO_MIME[f] }}）</option>
              </select>
              <span class="hint">部分服务只支持 mp3，报错时可换成 wav 试试。</span>
            </div>
          </div>
        </template>

        <template v-else>
          <div class="field">
            <span class="label">Windows 语音名（留空用系统默认）</span>
            <input
              v-model="tts.voice"
              class="input"
              placeholder="Microsoft Huihui Desktop"
              @input="touch"
              @change="save"
            />
            <span class="hint">
              离线合成，无需联网或 API Key，结果以 WAV 返回并驱动口型。音色名可在 Windows
              「设置 → 时间和语言 → 语音」里查看；填错时自动回落到默认语音。
            </span>
          </div>
        </template>
      </template>
    </div>

    <div class="section">
      <div class="section-title">
        <span>语音识别（STT）</span>
        <label class="switch">
          <input v-model="stt.enabled" type="checkbox" @change="touch(); save()" />
          启用语音输入
        </label>
      </div>

      <template v-if="stt.enabled">
        <div class="field">
          <span class="label">识别引擎</span>
          <div class="seg">
            <button :class="{ active: stt.engine === 'api' }" @click="stt.engine = 'api'; save()">
              OpenAI 接口
            </button>
            <button :class="{ active: stt.engine === 'sapi' }" @click="stt.engine = 'sapi'; save()">
              Windows 本地
            </button>
          </div>
        </div>

        <template v-if="stt.engine === 'api'">
          <div class="field-row">
            <div class="field">
              <span class="label">Base URL（留空复用 AI 接口）</span>
              <input
                v-model="stt.baseURL"
                class="input"
                placeholder="https://api.openai.com/v1"
                @input="touch"
                @change="save"
              />
            </div>
            <div class="field">
              <span class="label">API Key（留空复用）</span>
              <input
                v-model="stt.apiKey"
                class="input"
                type="password"
                placeholder="sk-..."
                autocomplete="off"
                @input="touch"
                @change="save"
              />
            </div>
          </div>

          <div class="field-row">
            <div class="field">
              <span class="label">模型</span>
              <input
                v-model="stt.model"
                class="input"
                placeholder="whisper-1 / SenseVoiceSmall"
                @input="touch"
                @change="save"
              />
            </div>
            <div class="field">
              <span class="label">识别语言</span>
              <input
                v-model="stt.language"
                class="input"
                placeholder="zh"
                @input="touch"
                @change="save"
              />
              <span class="hint">留空则自动检测，中文填 zh 更准。</span>
            </div>
          </div>
        </template>

        <template v-else>
          <p class="hint">
            离线识别，无需联网或 API Key。需要 Windows 已安装对应语言的语音识别（中文系统通常自带）。
            识别准确度取决于系统语音识别引擎，复杂语句可能不如云端模型。
          </p>
        </template>
      </template>
    </div>

    <div class="row">
      <button class="btn primary" :disabled="previewing" @click="preview">
        {{ previewing ? '合成中…' : '试听一句' }}
      </button>
      <button class="btn" :disabled="testing" @click="testConnection">
        {{ testing ? '检测中…' : '检测接口' }}
      </button>
      <button class="btn" @click="save">保存</button>
      <span v-if="message" :class="isError ? 'err' : 'ok'">{{ message }}</span>
    </div>
  </div>
</template>

<style scoped>
.panel {
  max-width: 640px;
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
