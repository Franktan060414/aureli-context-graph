<script setup>
import { computed, ref } from "vue";
import { Database, LoaderCircle, Send } from "@lucide/vue";

import ContextPicker from "./ContextPicker.vue";
import { relationTypeForDirection } from "../lib/tile-relations.js";

const props = defineProps({
  form: { type: Object, required: true },
  related: { type: Array, required: true },
  contextTiles: { type: Array, default: null },
  generating: Boolean,
  loading: Boolean,
  demo: Boolean,
  error: String,
  formId: { type: String, default: "inspector-question-form" },
  showActions: { type: Boolean, default: true },
});
const emit = defineEmits(["change", "toggle", "clear-related", "submit", "blank"]);
const questionInput = ref(null);
const disabled = computed(() => props.generating || props.loading);
const errorId = computed(() => `${props.formId}-error`);
const change = (field, value) => emit("change", { [field]: value });
defineExpose({ focus: () => questionInput.value?.focus() });
</script>

<template>
  <form :id="formId" class="compose-form" @submit.prevent="emit('submit')">
    <div class="compose-intro">
      <h2>连接你的下一个问题</h2>
      <p>从空白处提问，或选择已有节点作为上下文。</p>
    </div>
    <label :for="`${formId}-message`">
      提问内容 <span class="required">*</span>
      <textarea
        :id="`${formId}-message`" ref="questionInput" :value="form.message"
        @input="change('message', $event.target.value)" rows="5" required
        :disabled="disabled" placeholder="你想探索什么？"
        :aria-describedby="error ? errorId : undefined"
      ></textarea>
    </label>
    <label :for="`${formId}-tile-id`">
      当前 Tile ID <span class="required">*</span>
      <input :id="`${formId}-tile-id`" :value="form.tileId" required maxlength="128"
        @input="change('tileId', $event.target.value.trim())" :disabled="disabled"
        :aria-describedby="error ? errorId : undefined" />
    </label>
    <ContextPicker :related="related" :context-tiles="contextTiles" :disabled="disabled"
      @toggle="emit('toggle', $event)" @clear="emit('clear-related')" />
    <div class="form-two">
      <label :for="`${formId}-direction`">边方向
        <select :id="`${formId}-direction`" :value="form.edgeDirection"
          @change="change('edgeDirection', $event.target.value)" :disabled="disabled">
          <option value="DIRECTED">单向 →</option>
          <option value="UNDIRECTED">双向 ↔</option>
        </select>
      </label>
      <label :for="`${formId}-relation`">关系类型
        <input :id="`${formId}-relation`" :value="relationTypeForDirection(form.edgeDirection)" readonly
          aria-readonly="true" />
      </label>
    </div>
    <label :for="`${formId}-description`">关系备注 <span class="optional">选填</span>
      <input :id="`${formId}-description`" :value="form.edgeDescription"
        @input="change('edgeDescription', $event.target.value)" :disabled="disabled" placeholder="描述这次连接的含义" />
    </label>
    <div class="form-info"><Database :size="15" /><span>共享 RAG · 记忆深度 3 层 · 边权重 1</span></div>
    <p :id="errorId" v-if="error" class="inline-error" role="alert">{{ error }}</p>
    <template v-if="showActions">
      <button class="primary full-width" :disabled="disabled">
        <LoaderCircle v-if="generating" class="spinning" :size="16" /><Send v-else :size="16" />
        {{ generating ? "正在生成…" : demo ? "生成示例 Tile" : "发送并生成 Tile" }}
      </button>
      <button type="button" class="text-button full-width" @click="emit('blank')" :disabled="disabled">空白处提问</button>
    </template>
  </form>
</template>
