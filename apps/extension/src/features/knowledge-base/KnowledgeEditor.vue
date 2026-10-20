<script setup lang="ts">
import { watch } from "vue";
import { EditorContent, useEditor } from "@tiptap/vue-3";
import StarterKit from "@tiptap/starter-kit";
import { TableKit } from "@tiptap/extension-table";
import { Markdown } from "@tiptap/markdown";
import { webUrl } from "../research-run/answerMarkdown";

const props = defineProps<{ modelValue: string; id: string; disabled?: boolean }>();
const emit = defineEmits<{ "update:modelValue": [value: string] }>();
const editor = useEditor({
  injectCSS: false,
  extensions: [
    StarterKit.configure({ underline: false, link: { openOnClick: false, autolink: false,
      isAllowedUri: (url) => webUrl(url) !== null } }),
    TableKit.configure({ table: { resizable: false } }),
    Markdown.configure({ markedOptions: { gfm: true } }),
  ],
  content: props.modelValue,
  contentType: "markdown",
  editable: !props.disabled,
  editorProps: { attributes: { id: props.id, role: "textbox", "aria-label": "正文", "aria-multiline": "true" } },
  onUpdate: ({ editor }) => emit("update:modelValue", editor.isEmpty ? "" : editor.getMarkdown()),
});

watch(() => props.disabled, (disabled) => editor.value?.setEditable(!disabled));
watch(() => props.modelValue, (value) => {
  if (editor.value && editor.value.getMarkdown() !== value) {
    editor.value.commands.setContent(value, { contentType: "markdown", emitUpdate: false });
  }
});
</script>

<template>
  <div class="knowledge-editor" :class="{ disabled }">
    <div class="editor-toolbar" role="toolbar" aria-label="正文格式">
      <button type="button" :disabled="disabled || !editor" :aria-pressed="editor?.isActive('heading', { level: 2 })" @click="editor?.chain().focus().toggleHeading({ level: 2 }).run()">标题</button>
      <button type="button" :disabled="disabled || !editor" :aria-pressed="editor?.isActive('bold')" @click="editor?.chain().focus().toggleBold().run()">加粗</button>
      <button type="button" :disabled="disabled || !editor" :aria-pressed="editor?.isActive('bulletList')" @click="editor?.chain().focus().toggleBulletList().run()">列表</button>
      <button type="button" :disabled="disabled || !editor" :aria-pressed="editor?.isActive('codeBlock')" @click="editor?.chain().focus().toggleCodeBlock().run()">代码块</button>
      <button type="button" :disabled="disabled || !editor?.can().undo()" @click="editor?.chain().focus().undo().run()">撤销</button>
      <button type="button" :disabled="disabled || !editor?.can().redo()" @click="editor?.chain().focus().redo().run()">重做</button>
    </div>
    <EditorContent :editor="editor" class="editor-document" />
    <p class="editor-help">直接修改正文，格式和来源链接会随内容保留。</p>
  </div>
</template>

<style scoped>
.knowledge-editor { min-width: 0; overflow: hidden; border: 1px solid var(--border); border-radius: 10px; background: #fff; }
.knowledge-editor:focus-within { border-color: #72aa95; box-shadow: 0 0 0 2px #72aa9518; }
.editor-toolbar { display: flex; flex-wrap: wrap; gap: 4px; padding: 7px; border-bottom: 1px solid #e4ece6; background: #f5f8f5; }
.editor-toolbar button { padding: 5px 7px; border: 0; border-radius: 5px; background: transparent; color: #426b58; font-size: 11px; }
.editor-toolbar button[aria-pressed=true] { background: #deeee3; color: #176a55; }
.editor-toolbar button:disabled { opacity: .45; cursor: not-allowed; }
.editor-document { max-height: 420px; overflow: auto; }
.editor-document :deep(.tiptap) { min-height: 180px; padding: 13px; outline: none; color: #2e403b; font-size: 13px; line-height: 1.8; overflow-wrap: anywhere; }
.editor-document :deep(p) { margin: 8px 0; }
.editor-document :deep(h1), .editor-document :deep(h2), .editor-document :deep(h3), .editor-document :deep(h4), .editor-document :deep(h5), .editor-document :deep(h6) { margin: 14px 0 8px; font-size: 15px; line-height: 1.5; color: #254b3c; }
.editor-document :deep(ul), .editor-document :deep(ol) { padding-left: 22px; }
.editor-document :deep(blockquote) { margin: 10px 0; padding-left: 12px; border-left: 3px solid #99c4ac; }
.editor-document :deep(pre) { max-width: 100%; overflow: auto; padding: 10px; background: #edf3ef; border-radius: 6px; white-space: pre; }
.editor-document :deep(code) { font: .95em/1.65 Consolas, monospace; }
.editor-document :deep(a) { color: #176a55; text-decoration: underline; }
.editor-document :deep(.tableWrapper) { max-width: 100%; overflow-x: auto; }
.editor-document :deep(table) { border-collapse: collapse; table-layout: fixed; width: 100%; }
.editor-document :deep(th), .editor-document :deep(td) { min-width: 90px; border: 1px solid #dbe5de; padding: 6px; vertical-align: top; position: relative; }
.editor-document :deep(th) { background: #edf5ef; }
.editor-document :deep(.selectedCell) { background: #e1eee5; }
.editor-help { margin: 0; padding: 7px 12px; border-top: 1px solid #e8eee9; color: #7b9083; font-size: 10px; }
.disabled .editor-document { background: #f6f8f6; }
</style>
