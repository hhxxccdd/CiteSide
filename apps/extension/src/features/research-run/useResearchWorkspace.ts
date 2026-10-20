import { onMounted, onUnmounted, ref, watch } from "vue";
import { loadResearchWorkspace, saveResearchWorkspace, type ResearchWorkspace } from "./researchSession";

export function useResearchWorkspace(options: {
  capture: () => ResearchWorkspace;
  restore: (workspace: ResearchWorkspace) => void;
}) {
  const restoring = ref(true);
  const notice = ref("");
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  let revision = 0;

  async function flush(): Promise<void> {
    clearTimeout(timer);
    if (restoring.value) return;
    const current = ++revision;
    try {
      await saveResearchWorkspace(options.capture());
      if (!disposed && current === revision) notice.value = "";
    } catch {
      if (!disposed && current === revision) notice.value = "草稿暂存失败，可能是会话空间不足。请保留侧栏并重试，关闭后可能无法恢复最新修改。";
    }
  }

  watch(options.capture, () => {
    if (restoring.value) return;
    clearTimeout(timer);
    timer = setTimeout(() => { void flush(); }, 200);
  }, { deep: true });

  const flushWhenHidden = () => { if (document.visibilityState === "hidden") void flush(); };
  onMounted(async () => {
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", flushWhenHidden);
    try {
      const saved = await loadResearchWorkspace();
      if (!disposed && saved) options.restore(saved);
    } catch {
      if (!disposed) notice.value = "上次草稿暂时无法恢复，请检查后再继续编辑。";
    } finally {
      if (!disposed) restoring.value = false;
    }
  });
  onUnmounted(() => {
    window.removeEventListener("pagehide", flush);
    document.removeEventListener("visibilitychange", flushWhenHidden);
    void flush();
    disposed = true;
  });
  return { restoring, notice, flush };
}
