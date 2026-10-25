import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import pluginVue from 'eslint-plugin-vue';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['out/**', 'dist/**', 'node_modules/**', '.vitest-tmp/**', 'build/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...pluginVue.configs['flat/recommended'],
  {
    files: ['src/renderer/**/*.{ts,vue}', 'src/shared/**/*.ts'],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['src/main/**/*.ts', 'src/preload/**/*.ts', 'tests/**/*.ts', 'scripts/**/*.mjs'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['**/*.vue'],
    languageOptions: {
      parserOptions: { parser: tseslint.parser },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-useless-escape': 'off',
      'preserve-caught-error': 'off',
      'vue/multi-word-component-names': 'off',
    },
  },
  prettier,
);
