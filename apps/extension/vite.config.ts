import { resolve } from 'node:path';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  plugins: [vue()],
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
         sidepanel: resolve(__dirname,'sidepanel.html'),
         background:resolve(__dirname,'src/background/index.ts')
      },
      output:{
        entryFileNames: (chunk) =>  chunk.name === 'background' ? 'background.js' : 'asset/[name]-[hash].js'
      },
    },
  },
});

