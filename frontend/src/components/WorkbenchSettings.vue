<script setup>
import { ref } from 'vue';
import { Upload, LoaderCircle, AlertCircle } from '@lucide/vue';
import { parseGraphImport } from '../lib/graph-import.js';

const props = defineProps({ busy: Boolean, importHistory: { type: Function, required: true } });
const input = ref(null), importing = ref(false), error = ref('');
async function chooseHistory(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file || importing.value || props.busy) return;
  importing.value = true;
  error.value = '';
  try {
    if (file.size > 10 * 1024 * 1024) throw new Error('JSON 文件大小不能超过 10 MB。');
    const graph = parseGraphImport(await file.text());
    const name = file.name.replace(/\.json$/i, '').trim().slice(0, 90) || '历史记录';
    await props.importHistory({ name: `${name}（导入）`, ...graph });
  } catch (reason) {
    error.value = `导入失败：${reason.message || '无法读取文件，请重试。'}`;
  } finally { importing.value = false; }
}
</script>

<template>
  <section class="surface workbench-settings-panel" aria-labelledby="history-import-title" :aria-busy="importing">
    <h2 id="history-import-title">历史记录导入</h2>
    <p class="field-help">选择本应用导出的 JSON 聊天记录，恢复问题、回答、关联、标签和布局。导入后将创建新图谱并自动打开。</p>
    <p class="field-help">JSON 文件最大 10 MB。文件节点可恢复文字和文件信息，附件原文件需要重新上传。</p>
    <input ref="input" class="sr-only" type="file" accept=".json,application/json" aria-label="选择历史记录 JSON 文件"
      tabindex="-1" :disabled="busy || importing" @change="chooseHistory" />
    <button type="button" class="primary" :disabled="busy || importing" @click="input?.click()">
      <LoaderCircle v-if="importing" class="spinning" :size="17" aria-hidden="true" />
      <Upload v-else :size="17" aria-hidden="true" />{{ importing ? '正在导入…' : '历史记录导入' }}
    </button>
    <p v-if="error" class="inline-error" role="alert"><AlertCircle :size="18" aria-hidden="true" />{{ error }}</p>
  </section>
</template>

<style scoped>
.workbench-settings-panel { padding: 28px; display: grid; gap: 18px; }
.workbench-settings-panel h2, .workbench-settings-panel p { margin: 0; }
.workbench-settings-panel .primary { justify-self: start; }
@media (max-width: 767px) { .workbench-settings-panel { padding: 20px; } }
</style>
