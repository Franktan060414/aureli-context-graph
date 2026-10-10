<script setup>
import { computed, reactive, ref, nextTick } from "vue";
import { Pencil, Trash2, Plus, LoaderCircle, Check, Minus } from "@lucide/vue";
import { commonLabelId, labelStyle } from "../lib/labels.js";
const props = defineProps({
  labels: { type: Array, default: () => [] },
  tiles: { type: Array, default: () => [] },
  tileIds: { type: Array, default: () => [] },
  saveLabel: Function, removeLabel: Function, assignLabel: Function,
});
const emit = defineEmits(["busy"]);
const targets = computed(() => props.tiles.filter(tile => props.tileIds.includes(tile.id)));
const chosen = ref(commonLabelId(targets.value));
const initialMixed = commonLabelId(targets.value) === "mixed";
const busy = ref(false), error = ref(""), editing = ref(null), formOpen = ref(false), deleting = ref(null);
const draft = reactive({ name: "", colorHex: "#E8F2FF" });
const presets = ["#E8F2FF", "#DCFCE7", "#FEF3C7", "#FCE7F3", "#EDE9FE", "#FEE2E2"];
function choose(value, event) {
  chosen.value = chosen.value === value ? "" : value;
  // Native radios do not clear themselves; keep the DOM aligned after reselecting a label.
  nextTick(() => { event.target.checked = chosen.value === value; });
}
async function run(action) {
  if (busy.value) return;
  busy.value = true; emit("busy", true); error.value = "";
  try { await action(); }
  catch (failure) { error.value = failure.message || "保存失败，请重试"; }
  finally { busy.value = false; emit("busy", false); }
}
async function edit(label = null) {
  editing.value = label?.id ?? null;
  draft.name = label?.name || ""; draft.colorHex = label?.colorHex || presets[0];
  deleting.value = null; error.value = ""; formOpen.value = true;
  await nextTick(); document.getElementById("label-name")?.focus();
}
async function save() {
  if (!draft.name.trim()) { error.value = "请输入标签名称"; return; }
  if (!/^#[0-9a-f]{6}$/i.test(draft.colorHex)) { error.value = "颜色请输入 #RRGGBB 格式，例如 #E8F2FF"; return; }
  await run(async () => {
    const label = await props.saveLabel({ ...draft }, editing.value);
    chosen.value = String(label.id); formOpen.value = false;
  });
}
async function remove(id) {
  await run(async () => {
    await props.removeLabel(id);
    if (chosen.value === String(id) || chosen.value === "mixed") chosen.value = commonLabelId(targets.value);
    deleting.value = null;
    if (editing.value === id) formOpen.value = false;
  });
}
async function apply() {
  const label = chosen.value === "" ? null : props.labels.find(item => String(item.id) === chosen.value);
  if (chosen.value !== "" && !label) { error.value = "请先选择一个标签或清除标签"; return; }
  await run(() => props.assignLabel(label?.id ?? null));
}
</script>

<template>
  <div class="label-panel" :aria-busy="busy">
    <p class="label-selection-summary" role="status">{{ tileIds.length ? `已选择 ${tileIds.length} 个 Tile` : '尚未选择 Tile，可先管理标签' }}</p>
    <p class="field-help">{{ tileIds.length ? '应用后会替换所选 Tile 的原标签。搜索隐藏的已选 Tile 也包含在内。' : '通过 Tile 上的“选择关联”选中一个或多个 Tile，再打开标签面板。' }}</p>
    <fieldset class="label-options" :disabled="busy">
      <legend>当前图谱的标签</legend>
      <div class="label-options-list" role="radiogroup" aria-label="选择 Tile 标签">
        <label v-if="initialMixed && chosen === 'mixed'" class="label-option label-option-mixed">
          <input type="radio" name="tile-label" value="mixed" checked disabled />
          <span class="label-choice-box" aria-hidden="true"><Minus :size="15" /></span>
          <span class="label-option-name">多个标签（请选择统一标签）</span>
        </label>
        <label class="label-option label-option-clear" :class="{ 'is-chosen': chosen === '' }">
          <input type="radio" name="tile-label" value="" :checked="chosen === ''" @click="choose('', $event)" />
          <span class="label-choice-box" aria-hidden="true"><Check :size="15" /></span>
          <span class="label-option-name">清除标签</span>
        </label>
        <div v-for="label in labels" :key="label.id" class="label-option-row" :class="{ 'is-chosen': chosen === String(label.id) }">
          <label class="label-option" :class="{ 'is-chosen': chosen === String(label.id) }">
            <input type="radio" name="tile-label" :value="String(label.id)" :checked="chosen === String(label.id)" @click="choose(String(label.id), $event)" />
            <span class="label-choice-box" aria-hidden="true"><Check :size="15" /></span>
            <span class="label-swatch" :style="{ backgroundColor: label.colorHex }" aria-hidden="true"></span>
            <span class="label-option-name" :title="label.name">{{ label.name }}</span>
          </label>
          <div class="label-row-actions">
            <button type="button" class="icon-button" :aria-label="`编辑标签 ${label.name}`" @click="edit(label)"><Pencil :size="16" /></button>
            <button type="button" class="icon-button danger-icon" :aria-label="`删除标签 ${label.name}`" @click="deleting = label.id"><Trash2 :size="16" /></button>
          </div>
          <div v-if="deleting === label.id" class="label-delete-confirm">
            <p>删除「{{ label.name }}」后，使用它的 Tile 将恢复默认背景，Tile 会保留。</p>
            <button type="button" class="secondary" @click="deleting = null">保留标签</button>
            <button type="button" class="danger" @click="remove(label.id)">确认删除标签</button>
          </div>
        </div>
      </div>
      <p v-if="!labels.length" class="field-help label-empty">当前图谱还没有标签，先创建一个。</p>
      <div v-if="!formOpen" class="label-create-row">
        <button type="button" class="secondary label-create" :disabled="busy" @click="edit()"><Plus :size="16" />新建标签</button>
      </div>
    </fieldset>
    <form v-if="formOpen" class="label-editor" @submit.prevent="save">
      <strong>{{ editing == null ? '新建标签' : '编辑标签' }}</strong>
      <label for="label-name">标签名称</label>
      <input id="label-name" v-model="draft.name" required maxlength="100" :disabled="busy" />
      <label for="label-color">颜色 HEX</label>
      <div class="label-color-input">
        <input type="color" aria-label="选择标签颜色" :value="/^#[0-9a-f]{6}$/i.test(draft.colorHex) ? draft.colorHex : '#E8F2FF'"
          @input="draft.colorHex = $event.target.value.toUpperCase()" :disabled="busy" />
        <input id="label-color" v-model="draft.colorHex" required maxlength="7" spellcheck="false" :disabled="busy" />
      </div>
      <div class="label-presets" role="group" aria-label="预设标签颜色">
        <button v-for="color in presets" :key="color" type="button" class="label-swatch" :style="{ backgroundColor: color }"
          :aria-label="`使用颜色 ${color}`" :aria-pressed="draft.colorHex.toUpperCase() === color" :disabled="busy" @click="draft.colorHex = color"></button>
      </div>
      <span class="tile-label-badge" :style="labelStyle(draft)">{{ draft.name.trim() || '标签预览' }}</span>
      <p v-if="editing != null" class="field-help">名称和颜色更新后，所有使用此标签的 Tile 都会同步更新。</p>
      <div class="label-editor-actions">
        <button type="button" class="secondary" :disabled="busy" @click="formOpen = false">取消编辑</button>
        <button type="submit" class="primary" :disabled="busy">保存标签</button>
      </div>
    </form>
    <p v-if="error" class="inline-error" role="alert">{{ error }}</p>
    <button type="button" class="primary label-apply" :disabled="busy || !tileIds.length || chosen === 'mixed' || formOpen" @click="apply">
      <LoaderCircle v-if="busy" :size="16" class="spinning" aria-hidden="true" />
      {{ busy ? '保存中…' : chosen === '' ? `清除 ${tileIds.length} 个 Tile 的标签` : `应用到 ${tileIds.length} 个 Tile` }}
    </button>
  </div>
</template>
