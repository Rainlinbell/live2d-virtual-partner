import { defineStore } from 'pinia';
import type { AppConfig, Character } from '../../../shared/types';

/** 配置变更订阅只注册一次，重复 load() 不会叠加监听 */
let offConfig: (() => void) | null = null;

export const useConfigStore = defineStore('config', {
  state: () => ({
    cfg: null as AppConfig | null,
    loading: false,
  }),

  getters: {
    currentCharacter(state): Character | null {
      const cfg = state.cfg;
      if (!cfg) return null;
      return (
        cfg.characters.find((c) => c.id === cfg.currentCharacterId) ?? cfg.characters[0] ?? null
      );
    },
    ttsEnabled(state): boolean {
      return Boolean(state.cfg?.tts.enabled);
    },
  },

  actions: {
    async load(): Promise<void> {
      if (this.loading) return;
      this.loading = true;
      try {
        this.cfg = await window.api.getConfig();
        if (!offConfig) {
          offConfig = window.api.onConfigChanged((cfg) => {
            this.cfg = cfg;
          });
        }
      } finally {
        this.loading = false;
      }
    },

    async set(partial: Partial<AppConfig>): Promise<void> {
      await window.api.setConfig(partial);
    },

    async updateCharacter(id: string, partial: Partial<Character>): Promise<void> {
      await window.api.updateCharacter(id, partial);
    },

    async addCharacter(char: Omit<Character, 'id'>): Promise<Character> {
      return window.api.addCharacter(char);
    },

    async deleteCharacter(id: string): Promise<void> {
      await window.api.deleteCharacter(id);
    },

    async setCurrentCharacter(id: string): Promise<void> {
      await window.api.setCurrentCharacter(id);
    },

    async testLlm(): Promise<string> {
      return window.api.testLlm();
    },
  },
});
