<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useConfigStore } from '../../shared/stores/config';
import type { CoreStatus, ModelInfo } from '../../../shared/types';

const props = defineProps<{ characterId: string }>();
const configStore = useConfigStore();

const character = computed(() =>
  configStore.cfg?.characters.find((c) => c.id === props.characterId),
);

const models = ref<ModelInfo[]>([]);
const core = ref<CoreStatus | null>(null);
const message = ref('');
const busy = ref(false);

async function refresh(): Promise<void> {
  try {
    models.value = await window.api.listModels();
    core.value = await window.api.getCoreStatus();
  } catch (e) {
    message.value = (e as Error).message;
  }
}

async function run(task: () => Promise<string>): Promise<void> {
  busy.value = true;
  message.value = '';
  try {
    message.value = await task();
  } catch (e) {
    message.value = (e as Error).message;
  } finally {
    busy.value = false;
    await refresh();
  }
}

async function importZip(): Promise<void> {
  await run(async () => {
    const info = await window.api.importModelZip();
    if (!info) return '';
    await activate(info.name, false);
    return `已导入并启用「${info.name}」（入口 ${info.entryFile}）`;
  });
}

async function importFolder(): Promise<void> {
  await run(async () => {
    const info = await window.api.importModelFolder();
    if (!info) return '';
    await activate(info.name, false);
    return `已导入并启用「${info.name}」（入口 ${info.entryFile}）`;
  });
}

async function activate(name: string, report = true): Promise<void> {
  if (!props.characterId) return;
  await window.api.activateModel(name);
  if (report) message.value = `已启用「${name}」`;
  await refresh();
}

async function remove(name: string): Promise<void> {
  if (!confirm(`确定删除模型「${name}」吗？文件会从模型目录移除。`)) return;
  await run(async () => {
    await window.api.deleteModel(name);
    if (character.value?.activeModel === name && props.characterId) {
      await window.api.updateCharacter(props.characterId, { activeModel: '' });
    }
    return `已删除「${name}」`;
  });
}

async function installCore(cubism: 4 | 2): Promise<void> {
  await run(async () => {
    const ok = await window.api.chooseCoreFile(cubism);
    return ok ? `已安装 Cubism ${cubism === 2 ? '2' : '3/4'} Core` : '';
  });
}

async function chooseDir(): Promise<void> {
  await run(async () => {
    const dir = await window.api.chooseModelsDir();
    return dir ? `模型目录已切换到 ${dir}` : '';
  });
}

function openCoreDir(): void {
  void window.api.openCoreDir();
}
function openModelsDir(): void {
  void window.api.openModelsDir();
}

function thumbnail(m: ModelInfo): string | null {
  return m.hasThumbnail ? `live2d://thumbnail/${encodeURIComponent(m.name)}` : null;
}

onMounted(refresh);
</script>

<template>
  <div class="panel">
    <h2 class="panel-title">模型</h2>
    <p class="panel-desc">
      支持 Live2D（Cubism 2/3/4）模型，导入后立即生效。
      Cubism Core 因授权限制不随程序分发，需要自行下载一次。
    </p>

    <div class="section">
      <div class="section-title">Cubism Core</div>
      <div class="core-grid">
        <div class="core-item" :class="{ ready: core?.cubism4 }">
          <span class="dot" />
          <div class="core-main">
            <div class="core-name">Cubism 3 / 4 Core</div>
            <div class="core-file">live2dcubismcore.min.js</div>
          </div>
          <button class="btn" :disabled="busy" @click="installCore(4)">
            {{ core?.cubism4 ? '重新选择' : '选择文件安装' }}
          </button>
        </div>

        <div class="core-item" :class="{ ready: core?.cubism2 }">
          <span class="dot" />
          <div class="core-main">
            <div class="core-name">Cubism 2 Core（旧模型才需要）</div>
            <div class="core-file">live2d.min.js</div>
          </div>
          <button class="btn" :disabled="busy" @click="installCore(2)">
            {{ core?.cubism2 ? '重新选择' : '选择文件安装' }}
          </button>
        </div>
      </div>
      <div class="row" style="margin-top: 10px">
        <button class="btn ghost" @click="openCoreDir">打开 Core 目录</button>
        <span class="hint">
          下载地址：live2d.com/sdk/download/web/（任选一种 Core 的 zip，解压后选 js 文件）
        </span>
      </div>
    </div>

    <div class="section">
      <div class="section-title">模型库</div>
      <div class="row between wrap">
        <span class="path">{{ core?.modelsDir || '加载中…' }}</span>
        <div class="row">
          <button class="btn" :disabled="busy" @click="chooseDir">更改目录</button>
          <button class="btn ghost" @click="openModelsDir">打开目录</button>
        </div>
      </div>

      <div class="row" style="margin-top: 12px">
        <button class="btn primary" :disabled="busy" @click="importZip">导入 zip 模型包</button>
        <button class="btn" :disabled="busy" @click="importFolder">导入模型文件夹</button>
        <button class="btn ghost" :disabled="busy" @click="refresh">刷新</button>
      </div>
      <p v-if="message" class="hint" style="margin-top: 10px">{{ message }}</p>
    </div>

    <div class="section">
      <div class="section-title">
        <span>模型列表（{{ models.length }}）</span>
        <span v-if="character" class="hint">当前角色：{{ character.name }}</span>
      </div>

      <div v-if="models.length" class="list">
        <div
          v-for="m in models"
          :key="m.name"
          class="model-item"
          :class="{ active: character?.activeModel === m.name }"
        >
          <img v-if="thumbnail(m)" class="thumb" :src="thumbnail(m)!" :alt="m.name" />
          <div v-else class="thumb thumb-empty">{{ m.name.slice(0, 1) }}</div>

          <div class="model-main">
            <div class="model-name">
              {{ m.name }}
              <span v-if="character?.activeModel === m.name" class="badge">使用中</span>
            </div>
            <div class="model-meta">
              {{ m.entryFile }} · Cubism {{ m.cubism === 2 ? '2' : '3/4' }}
            </div>
          </div>

          <div class="row">
            <button
              v-if="character?.activeModel !== m.name"
              class="btn"
              :disabled="busy"
              @click="activate(m.name)"
            >
              启用
            </button>
            <button class="btn danger" :disabled="busy" @click="remove(m.name)">删除</button>
          </div>
        </div>
      </div>
      <div v-else class="empty">
        还没有模型。把模型文件夹拖进来，或用上方按钮导入 zip。
      </div>
    </div>
  </div>
</template>

<style scoped>
.panel {
  max-width: 660px;
}

.core-grid {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.core-item {
  display: flex;
  align-items: center;
  gap: 10px;
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 10px 12px;
  background: #fff;
}

.dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #e0a0a8;
  flex: none;
}

.core-item.ready .dot {
  background: var(--ok);
}

.core-main {
  flex: 1;
}

.core-name {
  font-size: 13px;
  color: #333;
}

.core-file {
  font-size: 11px;
  color: var(--muted);
  font-family: Consolas, monospace;
}

.path {
  font-size: 12px;
  color: var(--muted);
  font-family: Consolas, monospace;
  word-break: break-all;
}

.model-item {
  display: flex;
  align-items: center;
  gap: 12px;
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 10px 12px;
  background: #fff;
}

.model-item.active {
  border-color: var(--brand);
  background: #f7faff;
}

.thumb {
  width: 48px;
  height: 48px;
  border-radius: 10px;
  object-fit: cover;
  background: var(--brand-soft);
  flex: none;
}

.thumb-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--brand);
  font-weight: 600;
}

.model-main {
  flex: 1;
  min-width: 0;
}

.model-name {
  font-size: 14px;
  color: #333;
  display: flex;
  align-items: center;
  gap: 8px;
}

.badge {
  font-size: 11px;
  color: var(--brand);
  background: var(--brand-soft);
  border-radius: 8px;
  padding: 1px 7px;
}

.model-meta {
  font-size: 12px;
  color: var(--muted);
  margin-top: 2px;
  word-break: break-all;
}

.empty {
  color: #aaa;
  font-size: 13px;
  padding: 12px 0;
}
</style>
