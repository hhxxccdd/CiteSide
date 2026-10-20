import { resolve } from 'node:path';
import vue from '@vitejs/plugin-vue';
import { build, defineConfig, type Plugin } from 'vite';

// 注入网页的脚本必须独立打包，不能引用侧栏的共享 chunk。
// 子构建复用 Vite；监听它的源码，dev --watch 时也会重新生成。
function pageReader(): Plugin {
  return {
    name: 'researchflow-page-reader',
    async buildStart() {
      const result = await build({
        configFile: false,
        root: __dirname,
        logLevel: 'error',
        build: {
          write: false,
          target: 'chrome116',
          minify: true,
          lib: { entry: resolve(__dirname, 'src/features/page-context/pageContentScript.ts'), formats: ['iife'], name: 'ResearchFlowPageReader' },
        },
      });
      for (const output of Array.isArray(result) ? result : [result]) {
        if (!('output' in output)) throw new Error('网页读取脚本打包失败');
        for (const chunk of output.output) {
          if (chunk.type !== 'chunk') continue;
          for (const id of Object.keys(chunk.modules)) if (!id.startsWith('\0')) this.addWatchFile(id);
          this.emitFile({ type: 'asset', fileName: 'page-reader.js', source: chunk.code });
        }
      }
    },
  };
}

export default defineConfig({
  base: './',
  plugins: [vue(), pageReader()],
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
         sidepanel: resolve(__dirname,'sidepanel.html'),
         background:resolve(__dirname,'src/background/index.ts'),
      },
      output:{
        entryFileNames: (chunk) => ['background', 'page-reader'].includes(chunk.name) ? '[name].js' : 'asset/[name]-[hash].js',
      },
    },
  },
});

