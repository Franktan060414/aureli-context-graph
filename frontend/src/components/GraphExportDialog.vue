<script setup>
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue';
import { Braces, FileText, LoaderCircle, X } from '@lucide/vue';
import GraphExportView from './GraphExportView.vue';
import { checkExportCancelled, createGraphPdf, downloadExport, exportFilename } from '../lib/graph-export.js';

const props = defineProps({ workspaceId: String });
const emit = defineEmits(['notify']);
const dialog = ref(null), view = ref(null), snapshot = shallowRef(null);
const format = ref('json'), busy = ref(false), error = ref(''), progress = ref('');
const pdfAvailable = computed(() => !!snapshot.value?.tiles.length);
let controller, origin;

async function open(data) {
  if (snapshot.value) return;
  origin = document.activeElement;
  snapshot.value = data;
  format.value = 'json';
  error.value = '';
  progress.value = '';
  await nextTick();
  dialog.value?.showModal();
}
function close() {
  controller?.abort();
  controller = null;
  busy.value = false;
  dialog.value?.close();
  snapshot.value = null;
  nextTick(() => {
    if (!dialog.value?.open && origin?.isConnected) origin.focus({ preventScroll: true });
  });
}
async function runExport() {
  if (busy.value || !snapshot.value || (format.value === 'pdf' && !pdfAvailable.value)) return;
  const data = snapshot.value, selected = format.value;
  const request = new AbortController();
  controller = request;
  busy.value = true;
  error.value = '';
  progress.value = '正在准备完整内容…';
  try {
    let blob;
    if (selected === 'json') {
      const { name, arrangementMode, ...workspace } = data;
      blob = new Blob([JSON.stringify(workspace, null, 2)], { type: 'application/json' });
    } else {
      await nextTick();
      const scene = await view.value.prepare({ signal: request.signal,
        onProgress: value => { if (!request.signal.aborted) progress.value = value; } });
      blob = await createGraphPdf(scene, { signal: request.signal,
        onProgress: value => { if (!request.signal.aborted) progress.value = value; } });
    }
    checkExportCancelled(request.signal);
    downloadExport(blob, selected === 'json' ? 'aureli-graph.json' : exportFilename(data.name, 'pdf'));
    close();
    emit('notify', selected === 'json' ? '图谱已导出为 JSON' : '完整图谱已导出为整页 PDF');
  } catch (reason) {
    if (!request.signal.aborted) error.value = `导出失败：${reason.message || '请重试。'}`;
  } finally {
    if (controller === request) { busy.value = false; controller = null; }
  }
}
watch(() => props.workspaceId, () => { if (snapshot.value) close(); });
watch(format, () => { error.value = ''; });
onBeforeUnmount(() => controller?.abort());
defineExpose({ open });
</script>

<template>
  <dialog v-if="snapshot" ref="dialog" class="modal arrange-modal export-modal" aria-labelledby="graph-export-title"
    aria-describedby="graph-export-description" @cancel.stop.prevent="close">
    <div class="modal-header">
      <h2 id="graph-export-title">导出图谱</h2>
      <button class="icon-button" @click="close" aria-label="关闭导出选择"><X :size="19" aria-hidden="true" /></button>
    </div>
    <div class="modal-body">
      <p id="graph-export-description" class="arrange-description">选择导出格式，保存当前图谱。</p>
      <fieldset class="arrange-options" :disabled="busy">
        <legend class="sr-only">导出格式</legend>
        <label class="arrange-option" :class="{ chosen: format === 'json' }">
          <input v-model="format" type="radio" name="graph-export-format" value="json" aria-label="JSON 格式" />
          <Braces :size="28" aria-hidden="true" />
          <span><strong>JSON</strong><small>保存节点、关联、标签与当前布局数据。</small></span>
        </label>
        <label class="arrange-option" :class="{ chosen: format === 'pdf' }">
          <input v-model="format" type="radio" name="graph-export-format" value="pdf" aria-label="PDF 格式" :disabled="!pdfAvailable" />
          <FileText :size="28" aria-hidden="true" />
          <span><strong>PDF<span class="arrange-badge">整页图谱</span></strong><small>完整展示问题、回答与标签，自动排布为一页。</small></span>
        </label>
      </fieldset>
      <p v-if="format === 'pdf'" class="arrange-layout-note">按当前{{ snapshot?.arrangementMode === 'layered' ? ' Layered ' : '树状' }}方式重新排布。仅保留正文与标签，卡片保持原有长宽比，随内容等比例增大。</p>
      <p v-if="!pdfAvailable" class="arrange-layout-note">当前图谱没有节点，添加内容后即可导出 PDF。</p>
      <p v-if="busy" class="arrange-progress" role="status"><LoaderCircle :size="16" aria-hidden="true" />{{ progress }}</p>
      <p v-if="error" class="inline-error" role="alert">{{ error }}</p>
    </div>
    <div class="modal-actions">
      <button class="secondary" @click="close" autofocus>取消</button>
      <button class="primary" @click="runExport" :disabled="busy || (format === 'pdf' && !pdfAvailable)">{{ busy ? '导出中…' : '导出' }}</button>
    </div>
  </dialog>
  <GraphExportView v-if="snapshot && busy && format === 'pdf'" ref="view" :snapshot="snapshot" />
</template>
