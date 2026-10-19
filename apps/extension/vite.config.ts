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
         background:resolve(__dirname,'src/background/index.ts'),
         'page-reader': resolve(__dirname, 'src/features/page-context/pageContentScript.ts'),
      },
      output:{
        // 注入网页的是普通脚本，包在函数中以支持反复读取，避免顶层 const 重复声明。
        banner: (chunk) => chunk.name === 'page-reader' ? '(() => {' : '',
        footer: (chunk) => chunk.name === 'page-reader' ? '})();' : '',
        entryFileNames: (chunk) => ['background', 'page-reader'].includes(chunk.name) ? '[name].js' : 'asset/[name]-[hash].js',
      },
    },
  },
});

