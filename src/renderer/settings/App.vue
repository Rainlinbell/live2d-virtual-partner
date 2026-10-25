<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useConfigStore } from '../shared/stores/config';
import { defaultCharacter } from '../../shared/types';
import { CHARACTER_PRESETS, type CharacterPreset } from '../../shared/presets';
import type { Character } from '../../shared/types';
import ApiPanel from './components/ApiPanel.vue';
import CharacterPanel from './components/CharacterPanel.vue';
import VoicePanel from './components/VoicePanel.vue';
import ModelPanel from './components/ModelPanel.vue';
import OneBotPanel from './components/OneBotPanel.vue';
import AboutPanel from './components/AboutPanel.vue';

const configStore = useConfigStore();

type TabKey = 'character' | 'model' | 'voice' | 'api' | 'onebot' | 'about';

const tabs: Array<{ key: TabKey; label: string; icon: string }> = [
  { key: 'character', label: '角色', icon: '🎭' },
  { key: 'model', label: '模型', icon: '🧩' },
  { key: 'voice', label: '语音', icon: '🔊' },
  { key: 'api', label: '对话', icon: '💬' },
  { key: 'onebot', label: 'QQ', icon: '📱' },
  { key: 'about', label: '关于', icon: 'ℹ️' },
];

const tab = ref<TabKey>('character');
const selectedId = ref('');
const notice = ref('');

onMounted(async () => {
  await configStore.load();
  selectedId.value = configStore.cfg?.currentCharacterId ?? '';
});

// 角色被删除时回退到当前角色
watch(
  () => configStore.cfg?.characters.map((c) => c.id).join(','),
  () => {
    const cfg = configStore.cfg;
    if (!cfg) return;
    if (!cfg.characters.some((c) => c.id === selectedId.value)) {
      selectedId.value = cfg.currentCharacterId || cfg.characters[0]?.id || '';
    }
  },
);

const selectedCharacter = computed<Character | undefined>(() =>
  configStore.cfg?.characters.find((c) => c.id === selectedId.value),
);

async function selectCharacter(id: string): Promise<void> {
  selectedId.value = id;
  await configStore.setCurrentCharacter(id);
}

async function newCharacter(): Promise<void> {
  const cfg = configStore.cfg;
  if (!cfg) return;
  const draft = defaultCharacter({ name: `角色${cfg.characters.length + 1}` });
  const { id, ...rest } = draft;
  void id;
  const created = await configStore.addCharacter(rest);
  if (created) {
    selectedId.value = created.id;
    tab.value = 'character';
  }
}

async function deleteCharacter(): Promise<void> {
  const target = selectedCharacter.value;
  if (!target) return;
  if (!confirm(`确定删除角色「${target.name}」吗？聊天记录和记忆也会一起删除。`)) return;
  await configStore.deleteCharacter(target.id);
  notice.value = `已删除「${target.name}」`;
}

async function importCard(): Promise<void> {
  notice.value = '';
  try {
    const created = await window.api.importCharacterCard();
    if (created) {
      selectedId.value = created.id;
      tab.value = 'character';
      notice.value = `已导入角色「${created.name}」`;
    }
  } catch (e) {
    notice.value = `导入失败：${(e as Error).message}`;
  }
}

async function addPreset(preset: CharacterPreset): Promise<void> {
  try {
    const created = await configStore.addCharacter(preset.build());
    if (created) {
      selectedId.value = created.id;
      tab.value = 'character';
      notice.value = `已添加预设角色「${created.name}」`;
    }
  } catch (e) {
    notice.value = `添加失败：${(e as Error).message}`;
  }
}

const modelMissing = computed(
  () => Boolean(selectedCharacter.value) && !selectedCharacter.value?.activeModel,
);
</script>

<template>
  <div class="settings-root">
    <aside class="side">
      <div class="brand">
        <span class="brand-name">虚拟伴侣</span>
        <span class="brand-sub">设置</span>
      </div>

      <nav class="nav">
        <button
          v-for="t in tabs"
          :key="t.key"
          class="nav-item"
          :class="{ active: tab === t.key }"
          @click="tab = t.key"
        >
          <span class="nav-icon">{{ t.icon }}</span>
          {{ t.label }}
        </button>
      </nav>

      <div v-if="configStore.cfg" class="char-block">
        <span class="char-label">当前角色</span>
        <select
          v-if="configStore.cfg.characters.length"
          class="select"
          :value="selectedId"
          @change="selectCharacter(($event.target as HTMLSelectElement).value)"
        >
          <option v-for="c in configStore.cfg.characters" :key="c.id" :value="c.id">
            {{ c.name }}
          </option>
        </select>
        <span v-else class="char-empty-hint">还没有角色，新建一个吧</span>
        <div class="char-ops">
          <button class="btn ghost" @click="newCharacter">新建</button>
          <button class="btn ghost" @click="importCard">导入卡</button>
          <button
            class="btn ghost danger-text"
            @click="deleteCharacter"
          >
            删除
          </button>
        </div>

        <div class="preset-block">
          <span class="char-label">预设角色</span>
          <button
            v-for="p in CHARACTER_PRESETS"
            :key="p.key"
            class="preset-btn"
            :title="p.tagline"
            @click="addPreset(p)"
          >
            <span class="preset-name">{{ p.name }}</span>
            <span class="preset-src">{{ p.source }}</span>
          </button>
        </div>

        <button
          v-if="modelMissing"
          class="warn"
          @click="tab = 'model'"
        >
          这个角色还没有模型，点此去选择
        </button>
      </div>
    </aside>

    <main v-if="configStore.cfg" class="panel-wrap">
      <div v-if="notice" class="notice" @click="notice = ''">{{ notice }}</div>

      <div v-if="!configStore.cfg.characters.length" class="empty-chars">
        <h2 class="panel-title">还没有角色</h2>
        <p class="panel-desc">
          新建一个角色，或导入角色卡 / 预设角色开始。每个角色都有独立的人格、音色和 Live2D 模型。
        </p>
        <div class="row">
          <button class="btn primary" @click="newCharacter">新建角色</button>
          <button class="btn" @click="importCard">导入角色卡</button>
        </div>
      </div>

      <template v-else>
        <CharacterPanel v-if="tab === 'character'" :character-id="selectedId" />
        <ModelPanel v-else-if="tab === 'model'" :character-id="selectedId" />
        <VoicePanel v-else-if="tab === 'voice'" />
        <ApiPanel v-else-if="tab === 'api'" />
        <OneBotPanel v-else-if="tab === 'onebot'" :character-id="selectedId" />
        <AboutPanel v-else-if="tab === 'about'" />
      </template>
    </main>

    <main v-else class="panel-wrap loading">加载中…</main>
  </div>
</template>

<style scoped>
.settings-root {
  display: flex;
  height: 100vh;
  background: #f7f8fa;
}

.side {
  width: 184px;
  flex: none;
  display: flex;
  flex-direction: column;
  background: #fff;
  border-right: 1px solid var(--line);
  padding: 14px 10px;
}

.brand {
  padding: 4px 8px 14px;
  display: flex;
  align-items: baseline;
  gap: 6px;
}

.brand-name {
  font-size: 14px;
  font-weight: 700;
  color: #333;
}

.brand-sub {
  font-size: 11px;
  color: var(--muted);
}

.nav {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 8px;
  border: none;
  background: transparent;
  text-align: left;
  padding: 9px 10px;
  border-radius: 8px;
  font-size: 13px;
  color: #555;
  cursor: pointer;
}

.nav-item:hover {
  background: #f3f5f9;
}

.nav-item.active {
  background: var(--brand);
  color: #fff;
}

.nav-icon {
  width: 16px;
  text-align: center;
}

.char-block {
  margin-top: auto;
  padding: 12px 6px 0;
  border-top: 1px solid var(--line);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.char-label {
  font-size: 11px;
  color: var(--muted);
}

.char-empty-hint {
  font-size: 11px;
  color: var(--muted);
  padding: 2px 0;
}

.empty-chars {
  max-width: 520px;
  padding-top: 8px;
}

.char-ops {
  display: flex;
  gap: 2px;
}

.char-ops .btn {
  flex: 1;
  padding: 4px 2px;
  font-size: 11px;
}

.preset-block {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 6px;
  padding-top: 8px;
  border-top: 1px dashed var(--line);
}

.preset-btn {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 6px;
  border: 1px solid #e2e6ee;
  border-radius: 8px;
  background: #fafbfc;
  padding: 6px 8px;
  cursor: pointer;
  text-align: left;
}
.preset-btn:hover {
  border-color: var(--brand);
  background: var(--brand-soft);
}
.preset-name {
  font-size: 12px;
  color: #333;
}
.preset-src {
  font-size: 10px;
  color: var(--muted);
}

.danger-text {
  color: var(--danger);
}

.warn {
  border: 1px solid #f0d9a8;
  background: #fffaf0;
  color: #a0760a;
  font-size: 11px;
  text-align: left;
  padding: 6px 8px;
  border-radius: 7px;
  cursor: pointer;
  line-height: 1.5;
}

.panel-wrap {
  flex: 1;
  overflow-y: auto;
  padding: 22px 28px;
  position: relative;
}

.loading {
  color: #aaa;
}

.notice {
  position: sticky;
  top: 0;
  z-index: 5;
  margin-bottom: 12px;
  background: #eef7ef;
  color: #2e7d4f;
  border: 1px solid #cfe8d8;
  border-radius: 8px;
  padding: 8px 12px;
  font-size: 12px;
  cursor: pointer;
}
</style>
