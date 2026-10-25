import { defineConfig } from 'electron-vite';
import vue from '@vitejs/plugin-vue';
import { resolve } from 'path';

export default defineConfig({
  main: {
    build: {
      outDir: 'out/main',
    },
  },
  preload: {
    build: {
      outDir: 'out/preload',
    },
  },
  renderer: {
    plugins: [vue()],
    build: {
      outDir: 'out/renderer',
      rollupOptions: {
        input: {
          pet: resolve(__dirname, 'src/renderer/pet/index.html'),
          chat: resolve(__dirname, 'src/renderer/chat/index.html'),
          settings: resolve(__dirname, 'src/renderer/settings/index.html'),
        },
      },
    },
  },
});
