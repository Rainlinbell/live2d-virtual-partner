<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useConfigStore } from '../shared/stores/config';
import { useChatStore } from '../shared/stores/chat';
import { createStage } from './live2d/stage';
import {
  disposeModel,
  loadModel,
  setFitOptions,
  type AnyLive2DModel,
  type FitOptions,
} from './live2d/modelLoader';
import { applyEmotion } from './live2d/expression';
import { playEmotionMotion, speakWithLipsync, stopVoice } from './live2d/lipsync';
import { SentenceTts } from './live2d/sentenceTts';
import { setGazeEnabled, setGazeModel } from './live2d/gaze';
import { setIdleModel, setIdleStreaming, startIdle, stopIdle } from './live2d/idle';
import { CameraController, type CameraEvent, type TrackUpdate } from './camera';
import { initIgnoreMouse } from './ignoreMouse';
import Bubble from './components/Bubble.vue';

const canvasEl = ref<HTMLCanvasElement | null>(null);
const bubbleVisible = ref(false);
const loadError = ref('');

const configStore = useConfigStore();
const chatStore = useChatStore();
const currentCharacter = computed(() => configStore.currentCharacter);

let app: ReturnType<typeof createStage> | null = null;
let model: AnyLive2DModel | null = null;
let loadedKey = '';
let loadToken = 0;
let hideTimer: ReturnType<typeof setTimeout> | null = null;
let offToggle: (() => void) | null = null;
let offDone: (() => void) | null = null;
let offState: (() => void) | null = null;
let offEmotion: (() => void) | null = null;
let offConfig: (() => void) | null = null;
let offChunk: (() => void) | null = null;
let offUser: (() => void) | null = null;
let offError: (() => void) | null = null;
let greetingShown = false;

/** 分句流式 TTS 控制器 */
let sentenceTts: SentenceTts | null = null;
/** 主动陪伴：记录最后一次交互时间，超时触发主动搭话 */
let proactiveTimer: ReturnType<typeof setInterval> | null = null;
let lastInteractionAt = Date.now();

/* ---------- 摄像头交互 ---------- */

const cameraVideoEl = ref<HTMLVideoElement | null>(null);
const cameraCanvasEl = ref<HTMLCanvasElement | null>(null);
const cameraActive = ref(false);
const cameraStatus = ref('');
const cameraCfg = computed(() => configStore.cfg?.camera ?? null);
const cameraPanelVisible = computed(
  () => cameraActive.value && (cameraCfg.value?.showPreview ?? false),
);
const cameraVideoClass = computed(() => ({
  show: cameraPanelVisible.value,
  mirrored: cameraCfg.value?.mirror ?? false,
}));

let camera: CameraController | null = null;
let cameraStatusTimer: ReturnType<typeof setTimeout> | null = null;

const CAMERA_REACTIONS: Record<CameraEvent, { emotion: string; motion?: boolean; text: string }> = {
  hello: { emotion: 'happy', text: '我看到你啦～' },
  wave: { emotion: 'excited', motion: true, text: '你在跟我挥手吗？' },
  near: { emotion: 'surprised', text: '哇，你凑得好近' },
  far: { emotion: 'sad', text: '别走呀，再陪陪我' },
};

function flushCameraStatus(text: string): void {
  cameraStatus.value = text;
  if (cameraStatusTimer) clearTimeout(cameraStatusTimer);
  cameraStatusTimer = setTimeout(() => {
    cameraStatus.value = '';
  }, 4000);
}

function stopCamera(): void {
  camera?.stop();
  camera = null;
  cameraActive.value = false;
}

async function ensureCamera(): Promise<void> {
  const cfg = cameraCfg.value;
  if (!cfg || !cfg.enabled) {
    stopCamera();
    return;
  }
  if (camera) return;
  const video = cameraVideoEl.value;
  const canvas = cameraCanvasEl.value;
  if (!video || !canvas) return;

  const controller = new CameraController({
    video,
    canvas,
    mirror: cfg.mirror,
    onTrack: (t) => handleCameraTrack(t),
    onEvent: (e) => handleCameraEvent(e),
  });
  camera = controller;
  try {
    await controller.start();
    cameraActive.value = true;
  } catch (e) {
    camera = null;
    cameraActive.value = false;
    flushCameraStatus(`摄像头不可用：${(e as Error).message}`);
  }
}

/** 人脸/动作位置 → 模型注视跟随（世界坐标点，模型中心为原点方向） */
function handleCameraTrack(t: TrackUpdate): void {
  if (!model) return;
  if (cameraCfg.value?.follow === false) return;
  const cx = window.innerWidth / 2;
  const cy = window.innerHeight / 2;
  model.focus(cx + t.x * (window.innerWidth / 2), cy + t.y * (window.innerHeight / 2));
}

/** 动作 → 表情 / 动作 / 气泡文字 / 语音回复 */
function handleCameraEvent(e: CameraEvent): void {
  if (cameraCfg.value?.react === false) return;
  const r = CAMERA_REACTIONS[e];
  if (!r) return;
  applyEmotionIfPossible(r.emotion);
  if (r.motion && model) playEmotionMotion(model);
  flushCameraStatus(r.text);
  void speakReply(r.text);
}

function hideCameraPreview(): void {
  const cur = configStore.cfg?.camera;
  if (!cur) return;
  void configStore.set({ camera: { ...cur, showPreview: false } });
}

/* ---------- 气泡显隐 ---------- */

function clearHideTimer(): void {
  if (hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
}

/** 生成结束后按配置自动收起气泡（0 表示不自动收起） */
function scheduleAutoHide(): void {
  clearHideTimer();
  const seconds = configStore.cfg?.bubbleAutoHide ?? 0;
  if (!seconds || seconds <= 0) return;
  hideTimer = setTimeout(() => {
    if (!chatStore.streaming) bubbleVisible.value = false;
  }, seconds * 1000);
}

function showBubble(): void {
  bubbleVisible.value = true;
  clearHideTimer();
}

function toggleBubble(): void {
  bubbleVisible.value = !bubbleVisible.value;
  clearHideTimer();
}

/* ---------- 模型 ---------- */

function fitOptionsFor(scale: number, offsetY: number): FitOptions {
  return { scale: scale > 0 ? scale : 1, offsetY: offsetY || 0 };
}

/** 卸载当前模型（清空 activeModel 或模型被删时用，避免旧模型继续挂在舞台上） */
function unloadModel(): void {
  if (!model) return;
  disposeModel();
  model = null;
  loadedKey = '';
  setGazeModel(null);
  setIdleModel(null);
}

async function tryLoadModel(): Promise<void> {
  const cfg = configStore.cfg;
  const char = currentCharacter.value;
  if (!cfg) return;

  if (!char) {
    unloadModel();
    loadError.value = '还没有角色，请在设置里新建一个角色';
    return;
  }
  if (!char.activeModel) {
    unloadModel();
    loadError.value = `角色「${char.name}」尚未启用模型\n请打开设置 → 模型，导入并启用`;
    return;
  }

  const token = ++loadToken;

  try {
    const models = await window.api.listModels();
    const info = models.find((m) => m.name === char.activeModel);
    if (!info) {
      if (token === loadToken) {
        unloadModel();
        loadError.value = `模型「${char.activeModel}」不存在，请重新导入`;
      }
      return;
    }

    const key = `${info.name}:${info.cubism ?? 0}`;
    if (model && loadedKey === key) {
      loadError.value = '';
      return;
    }

    if (!app) {
      const canvas = canvasEl.value;
      if (!canvas) return;
      app = createStage(canvas);
    }

    const next = await loadModel(app, info, fitOptionsFor(char.modelScale, char.modelOffsetY));
    if (token !== loadToken) return;
    model = next;
    loadedKey = key;
    loadError.value = '';
    setGazeModel(next);
    setIdleModel(next);
    showGreeting();
  } catch (e) {
    if (token !== loadToken) return;
    loadError.value = `模型加载失败：${(e as Error).message}\n请检查 Cubism Core 是否已安装（设置 → 模型）`;
    console.error('[pet] 模型加载失败', e);
  }
}

/** 历史为空时用角色开场白，让第一次打开不至于冷场（并说出开场白） */
function showGreeting(): void {
  if (greetingShown) return;
  greetingShown = true;
  const char = currentCharacter.value;
  if (!char?.greeting) return;
  if (chatStore.messages.length > 0) return;
  showBubble();
  scheduleAutoHide();
  void speakReply(char.greeting);
}

function applyEmotionIfPossible(emotion: string | undefined): void {
  if (!model || !emotion) return;
  applyEmotion(model, emotion, currentCharacter.value?.emotionMap ?? {});
}

/* ---------- 语音 ---------- */

/** 单句打断式播报（开场白、摄像头反应等短句） */
async function speakReply(text: string): Promise<void> {
  if (!model || !text.trim()) return;
  try {
    const result = await window.api.ttsSpeak(text, currentCharacter.value?.voice || undefined);
    if (!model) return;
    await speakWithLipsync(model, result.audio, result.mime);
  } catch (e) {
    console.warn('[pet] 语音播报失败：', (e as Error).message);
  }
}

/* ---------- 主动陪伴 ---------- */

function startProactive(): void {
  if (proactiveTimer) return;
  proactiveTimer = setInterval(() => {
    const cfg = configStore.cfg;
    if (!cfg?.companion?.proactiveChat) return;
    if (chatStore.streaming) return;
    const idleMinutes = (Date.now() - lastInteractionAt) / 60_000;
    if (idleMinutes >= cfg.companion.idleMinutes) {
      lastInteractionAt = Date.now();
      void window.api.proactiveChat();
    }
  }, 30_000);
}

/* ---------- 生命周期 ---------- */

function openSettings(): void {
  void window.api.openSettings();
}

onMounted(async () => {
  await configStore.load();
  await chatStore.init();

  sentenceTts = new SentenceTts(
    () => model,
    () => currentCharacter.value?.voice || undefined,
  );

  offToggle = window.api.onToggleBubble(() => toggleBubble());
  initIgnoreMouse(() => configStore.cfg?.petWindow.clickThrough ?? true);

  offChunk = window.api.onChatChunk(({ characterId, delta }) => {
    if (characterId !== chatStore.characterId) return;
    sentenceTts?.push(delta);
  });

  offUser = window.api.onChatUser(({ characterId }) => {
    if (characterId !== chatStore.characterId) return;
    lastInteractionAt = Date.now();
    sentenceTts?.stop();
  });

  offDone = window.api.onChatDone(({ characterId, message, source }) => {
    if (characterId !== chatStore.characterId) return;
    showBubble();
    if (source === 'qq') return;
    applyEmotionIfPossible(message.emotion);
    sentenceTts?.flush();
    scheduleAutoHide();
  });

  offError = window.api.onChatError(({ characterId }) => {
    if (characterId !== chatStore.characterId) return;
    sentenceTts?.stop();
  });

  offState = window.api.onChatState(({ characterId, streaming }) => {
    if (characterId !== chatStore.characterId) return;
    setIdleStreaming(streaming);
    if (streaming) {
      showBubble();
    } else {
      scheduleAutoHide();
    }
  });

  offEmotion = window.api.onChatEmotion(({ characterId, emotion }) => {
    if (characterId !== chatStore.characterId) return;
    applyEmotionIfPossible(emotion);
  });

  // 缩放参数变化只需要调整尺寸，不必重新加载模型
  offConfig = window.api.onConfigChanged((next) => {
    const char = next.characters.find((c) => c.id === next.currentCharacterId) ?? next.characters[0];
    if (!char) return;
    setFitOptions(fitOptionsFor(char.modelScale, char.modelOffsetY));
  });

  watch(
    () => [configStore.cfg?.currentCharacterId, currentCharacter.value?.activeModel],
    () => {
      greetingShown = false;
      void tryLoadModel();
    },
  );

  // 摄像头：随配置启停，镜像/开启状态实时同步；与鼠标视线跟随互斥
  watch(
    cameraCfg,
    (c) => {
      if (!c) return;
      camera?.setMirror(c.mirror);
      setGazeEnabled(!(c.enabled && c.follow));
      if (c.enabled) void ensureCamera();
      else stopCamera();
    },
    { deep: true },
  );

  const cam = configStore.cfg?.camera;
  setGazeEnabled(!(cam?.enabled && cam?.follow));

  await ensureCamera();
  await tryLoadModel();
  if (configStore.cfg?.companion.idleMotion !== false) startIdle();
  startProactive();
});

onBeforeUnmount(() => {
  clearHideTimer();
  if (cameraStatusTimer) clearTimeout(cameraStatusTimer);
  if (proactiveTimer) {
    clearInterval(proactiveTimer);
    proactiveTimer = null;
  }
  stopIdle();
  setGazeModel(null);
  stopCamera();
  stopVoice();
  sentenceTts?.stop();
  disposeModel();
  model = null;
  offToggle?.();
  offDone?.();
  offState?.();
  offEmotion?.();
  offConfig?.();
  offChunk?.();
  offUser?.();
  offError?.();
});
</script>

<template>
  <div class="pet-root">
    <div class="bubble-area">
      <Bubble v-if="bubbleVisible" @close="bubbleVisible = false" />
    </div>

    <canvas ref="canvasEl" class="stage"></canvas>

    <!-- camera: local-only capture and preview -->
    <video
      ref="cameraVideoEl"
      class="camera-video"
      :class="cameraVideoClass"
      autoplay
      playsinline
      muted
      data-interactive
    ></video>
    <canvas ref="cameraCanvasEl" class="camera-canvas"></canvas>
    <div v-if="cameraPanelVisible" class="camera-panel" data-interactive>
      <span v-if="cameraStatus" class="camera-status">{{ cameraStatus }}</span>
      <button class="camera-close" title="hide preview" @click="hideCameraPreview">x</button>
    </div>

    <div v-if="loadError" class="load-error" data-interactive>
      <div class="load-error-text">{{ loadError }}</div>
      <button class="load-error-btn" @click="openSettings">打开设置</button>
    </div>
  </div>
</template>

<style scoped>
.pet-root {
  position: relative;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
}

.stage {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.bubble-area {
  position: absolute;
  top: 8px;
  left: 8px;
  right: 8px;
  z-index: 10;
}

.load-error {
  position: absolute;
  top: 45%;
  left: 50%;
  transform: translate(-50%, -50%);
  background: rgba(255, 255, 255, 0.94);
  color: #555;
  font-size: 12px;
  line-height: 1.7;
  padding: 12px 16px;
  border-radius: 10px;
  text-align: center;
  z-index: 5;
}

.load-error-text {
  white-space: pre-wrap;
}

.load-error-btn {
  margin-top: 8px;
  border: none;
  border-radius: 6px;
  background: #6495ed;
  color: #fff;
  font-size: 12px;
  padding: 5px 12px;
  cursor: pointer;
}

.camera-video {
  position: absolute;
  right: 10px;
  bottom: 10px;
  width: 140px;
  height: 105px;
  object-fit: cover;
  border-radius: 10px;
  background: #1e1e1e;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.35);
  display: none;
  z-index: 6;
}
.camera-video.show {
  display: block;
}
.camera-video.mirrored {
  transform: scaleX(-1);
}
.camera-canvas {
  display: none;
}
.camera-panel {
  position: absolute;
  right: 10px;
  bottom: 122px;
  display: flex;
  align-items: center;
  gap: 6px;
  z-index: 7;
}
.camera-status {
  background: rgba(255, 255, 255, 0.92);
  color: #555;
  font-size: 11px;
  padding: 4px 9px;
  border-radius: 10px;
  max-width: 150px;
  text-align: center;
}
.camera-close {
  border: none;
  background: rgba(0, 0, 0, 0.45);
  color: #fff;
  border-radius: 50%;
  width: 22px;
  height: 22px;
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
}
</style>
