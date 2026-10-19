<script setup>
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue';
import { arrangeTiles } from '../../frontend/src/lib/graph-layout.js';
import Canvas from './Canvas.vue';
import { makeBridge, taskPrompt } from './bridge.js';

const workspace = ref({ conversation_id: null, nodes: [], edges: [], tasks: [] });
const roots = ref([]), excluded = ref([]), scope = ref('ancestors'), maxChars = ref(6000), question = ref('');
const selected = ref(null), tab = ref('context'), preview = ref(null), prepared = ref(null);
const error = ref(''), notice = ref(''), busy = ref(false), previewBusy = ref(false), ready = ref(false);
const canvas = ref(null);
const editTitle = ref(''), editContent = ref(''), editWeight = ref(1), relationSource = ref(''), direction = ref('DIRECTED');
const canMessage = ref(false);
const delivered = ref(false);
let timer, previewTimer, previewSequence = 0;
const selectedNode = computed(() => workspace.value.nodes.find(node => node.id === selected.value));
const incidentEdges = computed(() => workspace.value.edges.filter(edge => edge.source === selected.value || edge.target === selected.value));
const rootNodes = computed(() => workspace.value.nodes.filter(node => roots.value.includes(node.id)));
const audit = computed(() => preview.value?.audit ?? []);
const contextNodes = computed(() => preview.value?.packet.nodes ?? []);
const activeTasks = computed(() => workspace.value.tasks.filter(task => task.status === 'PENDING'));
const selectedTaskState = computed(() => workspace.value.tasks.find(task => task.id === prepared.value?.id)?.status ?? prepared.value?.status);
const pendingTask = computed(() => prepared.value && selectedTaskState.value === 'PENDING');
const submitDisabled = computed(() => busy.value || !ready.value || (pendingTask.value
  ? delivered.value : !question.value.trim() || previewBusy.value || !preview.value));
const submitLabel = computed(() => busy.value ? '处理中…' : pendingTask.value && delivered.value
  ? (canMessage.value ? '已发送，等待回写' : '任务指令已复制') : pendingTask.value
    ? (canMessage.value ? '发送到宿主聊天' : '复制任务指令')
    : (canMessage.value ? '冻结并发送到宿主' : '冻结并复制任务指令'));
const currentOptions = () => ({ conversation_id: workspace.value.conversation_id, sourceIds: [...roots.value], excludedIds: [...excluded.value],
  scope: scope.value, maxChars: maxChars.value, question: question.value });
const statusText = item => item.state === 'excluded' ? '手动排除' : item.state === 'outside' ? '不在读取范围'
  : item.state === 'budget' ? '预算未选入' : item.direct ? '直接选择' : `追溯 ${item.distance} 层`;
function applyResult(result) {
  if (result._meta?.workspace) {
    const incoming = result._meta.workspace;
    if (workspace.value.conversation_id && incoming.conversation_id !== workspace.value.conversation_id) {
      clearTimeout(previewTimer); previewSequence++;
      roots.value = []; excluded.value = []; selected.value = null; question.value = '';
      prepared.value = null; preview.value = null; delivered.value = false; notice.value = ''; error.value = '';
    }
    workspace.value = incoming;
  }
  if (result.structuredContent?.saved) {
    notice.value = '宿主结果已保存到图谱。'; refresh().catch(showError);
  }
}
const bridge = makeBridge(applyResult, theme => {
  if (theme) document.documentElement.dataset.theme = theme;
});
function showError(problem) { error.value = problem.message ?? String(problem); }
async function call(name, args = {}) { const result = await bridge.call(name, args); applyResult(result); return result; }
async function run(fn) {
  if (busy.value) return;
  busy.value = true; error.value = ''; notice.value = '';
  try { await fn(); } catch (problem) { showError(problem); } finally { busy.value = false; }
}
async function refresh() { await call('aureli_workspace', { conversation_id: workspace.value.conversation_id }); }
async function updatePreview() {
  const sequence = ++previewSequence;
  previewBusy.value = true;
  try {
    const result = await call('aureli_preview', currentOptions());
    if (sequence === previewSequence) preview.value = result._meta.preview;
  } catch (problem) { if (sequence === previewSequence) { preview.value = null; showError(problem); } }
  finally { if (sequence === previewSequence) previewBusy.value = false; }
}
watch([roots, excluded, scope, maxChars, question], () => {
  prepared.value = null; delivered.value = false; preview.value = null; previewSequence++;
  clearTimeout(previewTimer);
  if (ready.value) previewTimer = setTimeout(updatePreview, 180);
}, { deep: true });
watch(() => workspace.value.nodes.map(node => [node.id, node.title, node.content, node.weight]), () => {
  if (ready.value) { clearTimeout(previewTimer); previewTimer = setTimeout(updatePreview, 180); }
}, { deep: true });
watch(selected, () => {
  const node = selectedNode.value;
  editTitle.value = node?.title ?? ''; editContent.value = node?.content ?? ''; editWeight.value = node?.weight ?? 1;
  relationSource.value = ''; if (node) tab.value = 'node';
});
function toggleRoot(id) {
  if (!roots.value.includes(id) && roots.value.length >= 12) { error.value = '原型最多选择 12 个直接来源。'; return; }
  roots.value = roots.value.includes(id) ? roots.value.filter(value => value !== id) : [...roots.value, id];
  excluded.value = excluded.value.filter(value => value !== id); tab.value = 'context';
}
function toggleExclude(id) {
  roots.value = roots.value.filter(value => value !== id);
  excluded.value = excluded.value.includes(id) ? excluded.value.filter(value => value !== id) : [...excluded.value, id];
}
async function saveNote() { await run(async () => {
  await call('aureli_update_note', { id: selected.value, title: editTitle.value, content: editContent.value, weight: editWeight.value });
  prepared.value = null; notice.value = '节点已保存。';
}); }
async function moveNode(position) { await run(async () => {
  try { await call('aureli_move', { positions: [position] }); await refresh(); }
  finally { canvas.value.clearDraft(); }
}); }
async function arrange() { await run(async () => {
  const tiles = workspace.value.nodes.map(node => ({ ...node, relatedTileIds: [], width: 260, height: 180 }));
  const edges = workspace.value.edges.map(edge => ({ sourceTileId: edge.source, targetTileId: edge.target }));
  const positions = arrangeTiles(tiles, edges).map(({ id, x, y }) => ({ id, x, y }));
  if (positions.length) await call('aureli_move', { positions });
  await refresh(); await nextTick(); canvas.value.fit();
}); }
async function submitTask() {
  if (submitDisabled.value) return;
  await run(async () => {
    if (!pendingTask.value) {
      const result = await call('aureli_prepare', currentOptions());
      prepared.value = result._meta.task;
      preview.value = result._meta.task;
      delivered.value = false;
    }
    try {
      if (canMessage.value) {
        await bridge.send(taskPrompt(prepared.value.id, workspace.value.conversation_id));
        notice.value = '资料包已冻结并发送到宿主；生成和保存状态以任务回执为准。';
      } else {
        if (!navigator.clipboard) throw new Error('当前环境不能自动复制，请展开任务指令手动复制。');
        await navigator.clipboard.writeText(taskPrompt(prepared.value.id, workspace.value.conversation_id));
        notice.value = '资料包已冻结，任务指令已复制，请粘贴到已连接 Aureli 的宿主聊天。';
      }
      delivered.value = true;
    } catch (problem) {
      throw new Error(`资料包已冻结并保留。${problem.message ?? String(problem)}`);
    }
  });
}
async function copy(text, message) { await run(async () => {
  if (!navigator.clipboard) throw new Error('当前环境不能自动复制，请从下方文本框手动复制。');
  await navigator.clipboard.writeText(text); notice.value = message;
}); }
async function resume(task) { await run(async () => {
  const result = await call('aureli_get_context', { taskId: task.id });
  const frozen = result._meta.task.preview;
  question.value = frozen.packet.question;
  roots.value = [...frozen.packet.sourceIds];
  excluded.value = frozen.audit.filter(item => item.state === 'excluded').map(item => item.id);
  scope.value = frozen.packet.scope;
  maxChars.value = frozen.maxChars;
  await nextTick();
  clearTimeout(previewTimer);
  previewSequence++; previewBusy.value = false;
  prepared.value = { ...frozen, id: task.id, status: result._meta.task.status };
  delivered.value = false;
  preview.value = frozen; tab.value = 'context';
  notice.value = '已恢复冻结任务及其问题和来源，可继续发送。';
}); }
async function cancel(task) { await run(async () => {
  await call('aureli_cancel', { taskId: task.id }); await refresh();
  if (prepared.value?.id === task.id) prepared.value = null;
  notice.value = '任务已取消。';
}); }
onMounted(async () => {
  try {
    await bridge.connect(); canMessage.value = bridge.canMessage;
    workspace.value.conversation_id = await bridge.waitForConversation();
    await refresh(); ready.value = true; await updatePreview(); await nextTick(); canvas.value.fit();
    timer = setInterval(() => { if (!busy.value && (activeTasks.value.length || pendingTask.value)) refresh().catch(showError); }, 2500);
  } catch (problem) { showError(problem); }
});
onUnmounted(() => { clearInterval(timer); clearTimeout(previewTimer); });
</script>
<template>
  <main class="app-shell" aria-label="Aureli 上下文画布">
    <div v-if="error" role="alert" class="message error">{{ error }}<button aria-label="关闭错误" @click="error = ''">×</button></div>
    <div v-if="notice" role="status" class="message notice">{{ notice }}</div>
    <div class="workbench">
      <section class="graph-panel"><div class="graph-toolbar"><div><strong>当前对话图谱</strong><span>{{ workspace.nodes.length }} 节点 · {{ workspace.edges.length }} 关系</span></div>
        <div class="toolbar-buttons"><button v-if="!workspace.nodes.length" :disabled="busy || !ready" @click="run(async () => { await call('aureli_demo'); await nextTick(); canvas.fit(); })">加载实验图谱</button><button :disabled="busy || !ready" @click="run(refresh)">刷新</button><button :disabled="busy || !workspace.nodes.length" @click="arrange">整理布局</button></div></div>
        <Canvas ref="canvas" :nodes="workspace.nodes" :edges="workspace.edges" :selected="selected" :roots="roots" :audit="audit" :busy="busy"
          @select="selected = $event" @toggle="toggleRoot" @move="moveNode" />
      </section>
      <aside class="inspector" aria-label="上下文与节点检查器"><div class="inspector-tabs" role="tablist" aria-label="检查器视图"><button id="context-tab" role="tab" :aria-selected="tab === 'context'" aria-controls="context-panel" @click="tab = 'context'">上下文 <span>{{ contextNodes.length }}</span></button><button id="node-tab" role="tab" :aria-selected="tab === 'node'" aria-controls="node-panel" @click="tab = 'node'">节点详情</button></div>
        <div v-if="tab === 'context'" id="context-panel" role="tabpanel" aria-labelledby="context-tab" class="inspector-body context-body">
          <section class="task-composer" aria-labelledby="task-heading">
            <h2 id="task-heading">推演</h2>
            <label class="field">本次问题<textarea v-model="question" :disabled="busy" rows="5" maxlength="2000" placeholder="例如：根据这些来源，评估下一步应该先验证什么。"></textarea></label>
            <button type="button" class="primary full" :disabled="submitDisabled" @click="submitTask">{{ submitLabel }}</button>
          </section>
          <div v-if="prepared" class="prepared-task"><strong>{{ selectedTaskState === 'SAVED' ? '已保存' : selectedTaskState === 'CANCELLED' ? '已取消' : '资料包已冻结' }}</strong><code>{{ prepared.id }}</code><p>任务保存准备时的资料；修改图谱不会偷偷替换来源。</p>
            <button class="full" :disabled="busy || selectedTaskState !== 'PENDING'" @click="copy(taskPrompt(prepared.id, workspace.conversation_id), '任务指令已复制，请粘贴到已连接 Aureli 的宿主聊天。')">复制任务指令</button>
            <details><summary>任务指令</summary><textarea aria-label="宿主任务指令" readonly :value="taskPrompt(prepared.id, workspace.conversation_id)"></textarea></details>
            <small v-if="!canMessage">当前环境未提供宿主消息能力，使用复制指令继续。</small>
          </div>
          <details class="context-details"><summary>上下文资料 <span>{{ previewBusy ? '正在计算…' : preview ? `${contextNodes.length} 个节点 · ${preview.chars.toLocaleString()} 字符` : '等待有效预览' }}</span></summary>
            <div class="source-list"><span v-if="!rootNodes.length" class="muted">独立提问 · 没有直接来源</span><button v-for="node in rootNodes" :key="node.id" class="source-chip" :aria-label="`移除来源 ${node.title}`" :disabled="busy" @click="toggleRoot(node.id)">{{ node.title }} <span aria-hidden="true">×</span></button></div>
            <fieldset class="scope-options" :disabled="busy"><legend>读取范围</legend><label><input v-model="scope" type="radio" value="selected">仅选中节点</label><label><input v-model="scope" type="radio" value="ancestors">沿关系追溯来源</label></fieldset>
            <div class="audit-list"><div v-for="item in audit" :key="item.id" class="audit-row" :class="item.state"><div><strong>{{ item.title }}</strong><span>{{ statusText(item) }}{{ item.truncated ? ' · 已截取' : '' }}</span></div><button v-if="!item.direct && ['included','excluded','budget'].includes(item.state)" :aria-label="`${item.state === 'excluded' ? '恢复' : '排除'} ${item.title}`" :disabled="busy" @click="toggleExclude(item.id)">{{ item.state === 'excluded' ? '恢复' : '排除' }}</button></div></div>
            <details class="packet-details"><summary>查看精确资料包 JSON</summary><textarea aria-label="精确上下文资料包" readonly :value="preview?.contextText ?? ''"></textarea><button :disabled="!preview || busy" @click="copy(preview.contextText, '资料包已复制。')">复制资料包</button></details>
          </details>
          <div v-if="activeTasks.length" class="task-history"><h3>等待保存的任务</h3><div v-for="task in activeTasks" :key="task.id"><code>{{ task.id.slice(0, 8) }}</code><button :disabled="busy" @click="resume(task)">恢复</button><button :disabled="busy" @click="cancel(task)">取消</button></div></div>
          <footer class="context-settings"><label class="field">资料包字符预算 <span>{{ maxChars.toLocaleString() }}</span><input v-model.number="maxChars" :disabled="busy" type="range" min="1000" max="16000" step="500"></label><p class="boundary-note">字符预算不是模型 token 上限；仅控制插件资料，无法清除宿主已有上下文。</p></footer>
        </div>
        <div v-else id="node-panel" role="tabpanel" aria-labelledby="node-tab" class="inspector-body">
          <template v-if="selectedNode"><div class="section-heading"><span class="eyebrow">节点 / {{ selectedNode.kind }}</span><h2>{{ selectedNode.title }}</h2><p>查看内容不会自动把节点选为上下文。</p></div>
            <form @submit.prevent="saveNote"><label class="field">标题<input v-model="editTitle" required maxlength="120"></label><label class="field">正文<textarea v-model="editContent" required rows="7" maxlength="50000"></textarea></label><label class="field">重要程度<select v-model.number="editWeight"><option :value="1">普通</option><option :value="2">重要</option><option :value="3">非常重要</option></select></label><button class="full" :disabled="busy">保存修改</button></form>
            <button class="full" :aria-pressed="roots.includes(selected)" :disabled="busy" @click="toggleRoot(selected)">{{ roots.includes(selected) ? '取消作为直接来源' : '作为本次直接来源' }}</button>
            <div class="section-heading compact"><h3>建立来源关系</h3><p>选择一个来源，连接到当前节点。</p></div>
            <form @submit.prevent="run(async () => { await call('aureli_link', { source: relationSource, target: selected, direction }); prepared = null; notice = '关系已保存。'; })"><label class="field">来源节点<select v-model="relationSource" required><option value="" disabled>选择来源</option><template v-for="node in workspace.nodes" :key="node.id"><option v-if="node.id !== selected" :value="node.id">{{ node.title }}</option></template></select></label><label class="field">关系方向<select v-model="direction"><option value="DIRECTED">单向：来源 → 当前节点</option><option value="UNDIRECTED">双向：两端可互相读取</option></select></label><button class="full" :disabled="busy || !relationSource">建立关系</button></form>
            <div class="edge-list"><div v-for="edge in incidentEdges" :key="edge.id"><span>{{ workspace.nodes.find(n => n.id === edge.source)?.title }} {{ edge.direction === 'DIRECTED' ? '→' : '↔' }} {{ workspace.nodes.find(n => n.id === edge.target)?.title }}</span><button :disabled="busy" aria-label="移除这条关系" @click="run(async () => { await call('aureli_unlink', { id: edge.id }); prepared = null; })">移除</button></div></div>
          </template><div v-else class="section-heading"><h2>选择一个节点</h2><p>点击节点查看全文、编辑或建立关系。</p></div>
        </div>
      </aside>
    </div>

  </main>
</template>
