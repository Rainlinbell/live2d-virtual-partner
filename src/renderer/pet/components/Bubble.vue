<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue';
import { useChatStore } from '../../shared/stores/chat';
import { useConfigStore } from '../../shared/stores/config';
import { startWavRecording, type WavRecorder } from '../wavRecorder';
import { stopVoice } from '../live2d/lipsync';
import DragHandle from './DragHandle.vue';

defineEmits<{ (e: 'close'): void }>();

const chatStore = useChatStore();
const configStore = useConfigStore();

const input = ref('');
const recording = ref(false);
const recSeconds = ref(0);
const voiceError = ref('');
const transcribing = ref(false);

const characterName = computed(() => configStore.currentCharacter?.name ?? '');
const replyText = computed(() => {
  if (chatStore.streaming) return chatStore.streamingText || '正在思考…';
  return chatStore.lastReply || '想聊点什么？点下面的输入框，或者按「语音」说话。';
});
const placeholder = computed(() => !chatStore.streaming && !chatStore.lastReply);

function send(): void {
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  stopVoice();
  chatStore.send(text);
}

function onEnter(event: KeyboardEvent): void {
  if (event.isComposing) return; // 中文输入法回车确认不该发送
  send();
}

/* ---------- 语音输入 ---------- */

let recorder: MediaRecorder | null = null;
let wav: WavRecorder | null = null;
let chunks: Blob[] = [];
let recStart = 0;
let recTimer: ReturnType<typeof setInterval> | null = null;
let maxTimer: ReturnType<typeof setTimeout> | null = null;
let mime = '';

const localStt = computed(() => configStore.cfg?.stt.engine === 'sapi');

function cleanupRecorder(): void {
  if (recTimer) {
    clearInterval(recTimer);
    recTimer = null;
  }
  if (maxTimer) {
    clearTimeout(maxTimer);
    maxTimer = null;
  }
  if (recorder) {
    recorder.stream.getTracks().forEach((t) => t.stop());
    recorder = null;
  }
  if (wav) {
    wav.cancel();
    wav = null;
  }
  recording.value = false;
}

function startTimers(): void {
  recStart = Date.now();
  recording.value = true;
  recSeconds.value = 0;
  recTimer = setInterval(() => {
    recSeconds.value = Math.floor((Date.now() - recStart) / 1000);
  }, 200);
  // 单次录音上限 60s，避免一直占着麦克风
  maxTimer = setTimeout(() => stopRec(), 60_000);
}

async function startRec(): Promise<void> {
  if (recording.value || transcribing.value) return;
  stopVoice();
  voiceError.value = '';
  if (!configStore.cfg?.stt.enabled) {
    voiceError.value = '语音识别未启用，请到设置 → 语音里开启';
    return;
  }
  try {
    if (localStt.value) {
      wav = await startWavRecording();
    } else {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';
      recorder = new MediaRecorder(stream, { mimeType: mime });
      chunks = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      recorder.onstop = () => {
        void finishApiRec();
      };
      recorder.start();
    }
    startTimers();
  } catch (e) {
    voiceError.value = `麦克风不可用：${(e as Error).message}`;
    cleanupRecorder();
  }
}

function stopRec(): void {
  if (!recording.value) return;
  recording.value = false;
  if (recTimer) {
    clearInterval(recTimer);
    recTimer = null;
  }
  if (maxTimer) {
    clearTimeout(maxTimer);
    maxTimer = null;
  }
  if (wav) {
    void finishLocalRec();
    return;
  }
  if (recorder && recorder.state === 'recording') recorder.stop();
}

/** 共享的识别入口 */
async function transcribeAudio(data: ArrayBuffer, mimeType: string): Promise<void> {
  const duration = Date.now() - recStart;
  if (duration < 500) {
    voiceError.value = '说话时间太短了，再试一次吧';
    return;
  }
  transcribing.value = true;
  try {
    const text = await window.api.sttTranscribe(data, mimeType);
    if (text.trim()) chatStore.send(text);
    else voiceError.value = '没有识别到内容，请靠近麦克风再说一次';
  } catch (e) {
    voiceError.value = (e as Error).message;
  } finally {
    transcribing.value = false;
  }
}

/** 接口路径：MediaRecorder 的 webm */
async function finishApiRec(): Promise<void> {
  const data = new Blob(chunks, { type: mime });
  chunks = [];
  cleanupRecorder();
  await transcribeAudio(await data.arrayBuffer(), mime);
}

/** 本地路径：WAV 采集 */
async function finishLocalRec(): Promise<void> {
  const rec = wav;
  wav = null;
  try {
    const data = await rec?.stop();
    cleanupRecorder();
    if (!data) return;
    await transcribeAudio(data, 'audio/wav');
  } catch (e) {
    cleanupRecorder();
    voiceError.value = (e as Error).message;
  }
}

function toggleRec(): void {
  if (recording.value) stopRec();
  else void startRec();
}

function openChat(): void {
  void window.api.openChat();
}

function openSettings(): void {
  void window.api.openSettings();
}

onBeforeUnmount(() => {
  if (recording.value && recorder) {
    try {
      recorder.stop();
    } catch {
      /* ignore */
    }
  }
  cleanupRecorder();
});
</script>

<template>
  <div class="bubble" data-interactive>
    <div class="head">
      <span class="name">{{ characterName }}</span>
      <span v-if="chatStore.streaming" class="status">输入中…</span>
    </div>

    <div class="reply" :class="{ placeholder }">{{ replyText }}</div>

    <div v-if="chatStore.error" class="error-line">{{ chatStore.error }}</div>
    <div v-if="voiceError" class="error-line">{{ voiceError }}</div>

    <div class="input-row">
      <button
        class="mic"
        :class="{ recording }"
        :title="recording ? '点击结束录音' : '点击开始说话'"
        :disabled="transcribing"
        @click="toggleRec"
      >
        {{ recording ? `停 ${recSeconds}s` : transcribing ? '识别中' : '语音' }}
      </button>
      <input
        v-model="input"
        type="text"
        :placeholder="chatStore.streaming ? '可直接输入打断当前回复' : '说点什么…'"
        @keydown.enter.exact.prevent="onEnter"
      />
      <button v-if="chatStore.streaming" class="stop" title="停止生成" @click="chatStore.abort()">
        停止
      </button>
      <button v-else class="send" :disabled="!input.trim()" @click="send">发送</button>
    </div>

    <div class="tool-row">
      <button title="聊天记录" @click="openChat">聊天</button>
      <button title="设置" @click="openSettings">设置</button>
      <DragHandle />
      <button title="收起气泡" @click="$emit('close')">收起</button>
    </div>
  </div>
</template>

<style scoped>
.bubble {
  background: rgba(255, 255, 255, 0.96);
  border-radius: 14px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.22);
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 7px;
  backdrop-filter: blur(6px);
  max-height: 60vh;
}

.head {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.name {
  font-size: 12px;
  color: #6495ed;
  font-weight: 600;
}
.status {
  font-size: 11px;
  color: #aaa;
}

.reply {
  max-height: 130px;
  overflow-y: auto;
  font-size: 13px;
  line-height: 1.6;
  color: #333;
  white-space: pre-wrap;
  word-break: break-word;
}
.reply.placeholder {
  color: #999;
}

.error-line {
  font-size: 12px;
  color: #d03050;
  line-height: 1.4;
}

.input-row {
  display: flex;
  gap: 6px;
}
.input-row input {
  flex: 1;
  min-width: 0;
  border: 1px solid #ddd;
  border-radius: 8px;
  padding: 6px 10px;
  font-size: 13px;
  outline: none;
  background: #fff;
}
.input-row input:focus {
  border-color: #6495ed;
}

.mic,
.send,
.stop {
  border: none;
  border-radius: 8px;
  padding: 6px 10px;
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
}
.mic {
  background: #f0f0f0;
  color: #555;
}
.mic.recording {
  background: #ff5b5b;
  color: #fff;
}
.mic:disabled {
  opacity: 0.6;
  cursor: default;
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

.tool-row {
  display: flex;
  justify-content: flex-end;
  gap: 4px;
}
.tool-row button {
  border: none;
  background: transparent;
  color: #999;
  font-size: 12px;
  cursor: pointer;
  padding: 2px 6px;
}
.tool-row button:hover {
  color: #6495ed;
}
</style>
