import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'kolophon',
    description: 'Inspect, load, and copy any font on any page.',
    version: '0.1.0',
    permissions: ['activeTab', 'scripting', 'storage', 'clipboardWrite'],
  },
});
