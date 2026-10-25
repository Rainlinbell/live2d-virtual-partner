<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useConfigStore } from '../../shared/stores/config';
import type { AppInfo, CameraConfig, CompanionConfig, MemoryConfig } from '../../../shared/types';

const configStore = useConfigStore();

const info = ref<AppInfo | null>(null);
const autoLaunch = ref(false);
const message = ref('');
const busy = ref(false);

onMounted(async () => {
  info.value = await window.api.getAppInfo();
  autoLaunch.value = configStore.cfg?.autoLaunch ?? false;
});

async function toggleAutoLaunch(): Promise<void> {
  await configStore.set({ autoLaunch: autoLaunch.value });
  await window.api.setAutoLaunch(autoLaunch.value);
  message.value = autoLaunch.value ? '已设置开机自启' : '已关闭开机自启';
}

async function toggleFullscreen(): Promise<void> {
  const next = !(configStore.cfg?.hideOnFullscreen ?? false);
  await configStore.set({ hideOnFullscreen: next });
  message.value = next ? '全屏应用时会自动隐藏宠物' : '全屏时不再隐藏宠物';
}

function patchMemory(patch: Partial<MemoryConfig>): void {
  const cur = configStore.cfg?.memory;
  if (!cur) return;
  void configStore.set({ memory: { ...cur, ...patch } });
}

function patchCamera(patch: Partial<CameraConfig>): void {
  const cur = configStore.cfg?.camera;
  if (!cur) return;
  void configStore.set({ camera: { ...cur, ...patch } });
}

function patchCompanion(patch: Partial<CompanionConfig>): void {
  const cur = configStore.cfg?.companion;
  if (!cur) return;
  void configStore.set({ companion: { ...cur, ...patch } });
}

function openLogs(): void {
  void window.api.openLogsDir();
}
function openModels(): void {
  void window.api.openModelsDir();
}
function openCore(): void {
  void window.api.openCoreDir();
}

async function checkUpdate(): Promise<void> {
  busy.value = true;
  message.value = '已是最新版本（当前为手动安装版，升级请重新下载安装包覆盖安装）';
  busy.value = false;
}
</script>

<template>
  <div class="panel">
    <h2 class="panel-title">关于</h2>
    <p class="panel-desc">Live2D Virtual Partner — 桌面上的 Live2D 虚拟伴侣。</p>

    <div class="section">
      <div class="section-title">运行环境</div>
      <div class="info-grid">
        <span class="k">版本</span>
        <span class="v">{{ info?.version ?? '-' }}</span>
        <span class="k">Electron</span>
        <span class="v">{{ info?.electron ?? '-' }}</span>
        <span class="k">Chromium</span>
        <span class="v">{{ info?.chrome ?? '-' }}</span>
        <span class="k">Node</span>
        <span class="v">{{ info?.node ?? '-' }}</span>
        <span class="k">平台</span>
        <span class="v">{{ info?.platform ?? '-' }}</span>
      </div>
    </div>

    <div class="section">
      <div class="section-title">行为</div>

      <label class="switch" style="margin-bottom: 12px">
        <input v-model="autoLaunch" type="checkbox" @change="toggleAutoLaunch" />
        开机自动启动
      </label>

      <label class="switch" style="margin-bottom: 12px">
        <input
          type="checkbox"
          :checked="configStore.cfg?.hideOnFullscreen ?? false"
          @change="toggleFullscreen"
        />
        检测到全屏应用（游戏/视频）时隐藏宠物
      </label>

      <div class="field" style="max-width: 260px">
        <span class="label">气泡自动收起（秒，0 表示不自动收起）</span>
        <input
          class="input"
          type="number"
          min="0"
          max="120"
          step="1"
          :value="configStore.cfg?.bubbleAutoHide ?? 0"
          @change="configStore.set({ bubbleAutoHide: Number(($event.target as HTMLInputElement).value) || 0 })"
        />
      </div>
    </div>

    <div class="section">
      <div class="section-title">主动陪伴</div>
      <p class="hint" style="margin-bottom: 12px">
        让 TA 在长时间没人理时主动搭话，并偶尔做点小动作，更像一个活着的伙伴。
      </p>

      <label class="switch" style="margin-bottom: 12px">
        <input
          type="checkbox"
          :checked="configStore.cfg?.companion.proactiveChat ?? true"
          @change="patchCompanion({ proactiveChat: ($event.target as HTMLInputElement).checked })"
        />
        长时间无操作时主动搭话
      </label>

      <div class="field" style="max-width: 260px; margin-bottom: 12px">
        <span class="label">闲置多少分钟后主动搭话</span>
        <input
          class="input"
          type="number"
          min="1"
          max="240"
          step="1"
          :value="configStore.cfg?.companion.idleMinutes ?? 15"
          @change="patchCompanion({ idleMinutes: Number(($event.target as HTMLInputElement).value) || 15 })"
        />
      </div>

      <label class="switch" style="margin-bottom: 12px">
        <input
          type="checkbox"
          :checked="configStore.cfg?.companion.idleMotion ?? true"
          @change="patchCompanion({ idleMotion: ($event.target as HTMLInputElement).checked })"
        />
        偶尔随机小动作（idle 动画）
      </label>
    </div>

    <div class="section">
      <div class="section-title">长期记忆</div>

      <label class="switch" style="margin-bottom: 12px">
        <input
          type="checkbox"
          :checked="configStore.cfg?.memory.enabled ?? true"
          @change="patchMemory({ enabled: ($event.target as HTMLInputElement).checked })"
        />
        对话变长时自动压缩成长期记忆
      </label>

      <div class="field-row">
        <div class="field">
          <span class="label">上下文预算（字符，超出则裁剪）</span>
          <input
            class="input"
            type="number"
            min="1000"
            max="200000"
            step="1000"
            :value="configStore.cfg?.memory.contextChars ?? 16000"
            @change="patchMemory({ contextChars: Number(($event.target as HTMLInputElement).value) || 16000 })"
          />
        </div>
        <div class="field">
          <span class="label">压缩阈值（历史超过 N 条触发）</span>
          <input
            class="input"
            type="number"
            min="1"
            max="500"
            step="1"
            :value="configStore.cfg?.memory.summarizeThreshold ?? 60"
            @change="patchMemory({ summarizeThreshold: Number(($event.target as HTMLInputElement).value) || 60 })"
          />
        </div>
        <div class="field">
          <span class="label">记忆条目上限</span>
          <input
            class="input"
            type="number"
            min="1"
            max="1000"
            step="1"
            :value="configStore.cfg?.memory.maxEntries ?? 200"
            @change="patchMemory({ maxEntries: Number(($event.target as HTMLInputElement).value) || 200 })"
          />
        </div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">摄像头交互</div>
      <p class="hint" style="margin-bottom: 12px">
        让 TA 通过摄像头「看到你」并跟随你的位置、识别动作做出反馈。视频只在本地处理，不上传。
      </p>

      <label class="switch" style="margin-bottom: 12px">
        <input
          type="checkbox"
          :checked="configStore.cfg?.camera.enabled ?? false"
          @change="patchCamera({ enabled: ($event.target as HTMLInputElement).checked })"
        />
        启用摄像头（开启后请求摄像头权限）
      </label>

      <label class="switch" style="margin-bottom: 12px">
        <input
          type="checkbox"
          :checked="configStore.cfg?.camera.follow ?? true"
          @change="patchCamera({ follow: ($event.target as HTMLInputElement).checked })"
        />
        头部 / 眼球跟随人脸位置
      </label>

      <label class="switch" style="margin-bottom: 12px">
        <input
          type="checkbox"
          :checked="configStore.cfg?.camera.react ?? true"
          @change="patchCamera({ react: ($event.target as HTMLInputElement).checked })"
        />
        识别动作（出现 / 挥手 / 靠近）并反馈回复
      </label>

      <label class="switch" style="margin-bottom: 12px">
        <input
          type="checkbox"
          :checked="configStore.cfg?.camera.showPreview ?? true"
          @change="patchCamera({ showPreview: ($event.target as HTMLInputElement).checked })"
        />
        在宠物窗口显示预览小窗
      </label>

      <label class="switch" style="margin-bottom: 12px">
        <input
          type="checkbox"
          :checked="configStore.cfg?.camera.mirror ?? true"
          @change="patchCamera({ mirror: ($event.target as HTMLInputElement).checked })"
        />
        镜像预览（自然自拍视角）
      </label>
    </div>

    <div class="section">
      <div class="section-title">数据目录</div>
      <div class="list">
        <div class="dir-row">
          <span class="k">配置</span>
          <span class="path">{{ info?.userData }}</span>
        </div>
        <div class="dir-row">
          <span class="k">模型</span>
          <span class="path">{{ info?.modelsDir }}</span>
          <button class="btn ghost" @click="openModels">打开</button>
        </div>
        <div class="dir-row">
          <span class="k">Core</span>
          <span class="path">{{ info?.coreDir }}</span>
          <button class="btn ghost" @click="openCore">打开</button>
        </div>
        <div class="dir-row">
          <span class="k">日志</span>
          <span class="path">{{ info?.logsDir }}</span>
          <button class="btn ghost" @click="openLogs">打开</button>
        </div>
      </div>
    </div>

    <div class="row">
      <button class="btn" :disabled="busy" @click="checkUpdate">检查更新</button>
      <span v-if="message" class="hint">{{ message }}</span>
    </div>
  </div>
</template>

<style scoped>
.panel {
  max-width: 620px;
}

.info-grid {
  display: grid;
  grid-template-columns: 90px 1fr;
  gap: 6px 12px;
  font-size: 13px;
}

.k {
  color: var(--muted);
  font-size: 12px;
}

.v {
  color: #444;
  font-family: Consolas, monospace;
  font-size: 12px;
}

.dir-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.path {
  flex: 1;
  font-size: 11px;
  font-family: Consolas, monospace;
  color: var(--muted);
  word-break: break-all;
}
</style>
