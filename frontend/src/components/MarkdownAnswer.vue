<script setup>
import { computed } from "vue";
import { renderMarkdown } from "../lib/markdown.js";

const props = defineProps({
  content: { type: String, default: "" },
  loading: { type: Boolean, default: false },
});

// Reparse the accumulated source so Markdown split across stream events resolves.
const renderedHtml = computed(() => renderMarkdown(props.content));
</script>

<template>
  <div class="markdown-answer" :aria-busy="loading">
    <div v-if="content" v-html="renderedHtml"></div>
    <p v-else>{{ loading ? "正在思考并生成回答…" : "暂无回答" }}</p>
  </div>
</template>

<style scoped>
.markdown-answer {
  min-width: 0;
  max-width: 100%;
  white-space: normal;
  overflow-wrap: anywhere;
}

.markdown-answer :deep(p),
.markdown-answer :deep(ul),
.markdown-answer :deep(ol),
.markdown-answer :deep(pre),
.markdown-answer :deep(blockquote),
.markdown-answer :deep(.markdown-table) {
  margin: 0 0 12px;
}

.markdown-answer :deep(h1),
.markdown-answer :deep(h2),
.markdown-answer :deep(h3),
.markdown-answer :deep(h4),
.markdown-answer :deep(h5),
.markdown-answer :deep(h6) {
  display: block;
  margin: 20px 0 10px;
  color: var(--text);
  font-weight: 800;
  line-height: 1.4;
  letter-spacing: normal;
}

.markdown-answer :deep(h1) { font-size: 1.5em; }
.markdown-answer :deep(h2) { font-size: 1.3em; }
.markdown-answer :deep(h3) { font-size: 1.15em; }
.markdown-answer :deep(h4),
.markdown-answer :deep(h5),
.markdown-answer :deep(h6) { font-size: 1em; }

.markdown-answer :deep(ul),
.markdown-answer :deep(ol) {
  padding-left: 24px;
}

.markdown-answer :deep(li + li) {
  margin-top: 4px;
}

.markdown-answer :deep(li > ul),
.markdown-answer :deep(li > ol) {
  margin: 4px 0 0;
}

.markdown-answer :deep(code) {
  padding: 2px 4px;
  border-radius: 4px;
  background: var(--canvas);
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 0.9em;
}

.markdown-answer :deep(pre) {
  max-width: 100%;
  padding: 12px;
  overflow-x: auto;
  white-space: pre;
  overflow-wrap: normal;
  background: var(--canvas);
  border: 1px solid var(--line);
  border-radius: 6px;
  line-height: 1.6;
}

.markdown-answer :deep(pre code) {
  padding: 0;
  background: transparent;
}

.markdown-answer :deep(blockquote) {
  padding-left: 12px;
  border-left: 3px solid var(--primary);
  color: var(--muted);
}

.markdown-answer :deep(a) {
  color: var(--primary);
  text-decoration: underline;
  text-underline-offset: 3px;
}

.markdown-answer :deep(.markdown-table) {
  max-width: 100%;
  overflow-x: auto;
}

.markdown-answer :deep(.markdown-table:focus-visible) {
  outline: 3px solid var(--primary);
  outline-offset: -3px;
}

.markdown-answer :deep(table) {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.95em;
}

.markdown-answer :deep(th),
.markdown-answer :deep(td) {
  min-width: 100px;
  padding: 8px 12px;
  border: 1px solid var(--line);
}

.markdown-answer :deep(th) {
  background: var(--canvas);
}

.markdown-answer :deep(img) {
  max-width: 100%;
  height: auto;
}

.markdown-answer :deep(hr) {
  margin: 16px 0;
  border: 0;
  border-top: 1px solid var(--line);
}

.markdown-answer :deep(div > :first-child) {
  margin-top: 0;
}

.markdown-answer :deep(div > :last-child) {
  margin-bottom: 0;
}
</style>
