/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent<object, object, unknown>;
  export default component;
}

// 该插件未自带 TypeScript 声明，仅补充我们实际使用的表格转换接口。
declare module 'turndown-plugin-gfm' {
  import type TurndownService from 'turndown';
  export const tables: TurndownService.Plugin;
}

