<script setup>
import { computed, ref } from "vue";
import { Check, ChevronDown, GitBranch, Layers3, Network } from "@lucide/vue";
import {
  SelectContent,
  SelectIcon,
  SelectItem,
  SelectItemIndicator,
  SelectItemText,
  SelectPortal,
  SelectRoot,
  SelectTrigger,
  SelectValue,
  SelectViewport,
} from "reka-ui";

const model = defineModel({ type: String, default: "graph" });
defineProps({
  motionEnabled: { type: Boolean, default: true },
  side: { type: String, default: "bottom" },
  compact: Boolean,
});
const open = ref(false);
const views = [
  { value: "graph", label: "图谱视图", icon: Network },
  { value: "list", label: "Tile 列表", icon: Layers3 },
  { value: "branch", label: "分支对话", icon: GitBranch },
];
const current = computed(() => views.find(view => view.value === model.value) || views[0]);
</script>

<template>
  <SelectRoot v-model="model" v-model:open="open">
    <SelectTrigger class="view-select-trigger" :class="{ 'is-compact': compact }" :title="compact ? `切换视图，当前：${current.label}` : undefined" :aria-label="`切换视图，当前：${current.label}`">
      <component :is="current.icon" :size="18" aria-hidden="true" />
      <SelectValue class="view-select-value">{{ current.label }}</SelectValue>
      <SelectIcon class="view-select-chevron" :class="{ 'is-open': open }">
        <ChevronDown :size="16" aria-hidden="true" />
      </SelectIcon>
    </SelectTrigger>
    <SelectPortal>
      <Transition name="view-select" :css="motionEnabled" :duration="{ enter: 220, leave: 180 }">
        <SelectContent
          v-if="open"
          force-mount
          class="view-select-content"
          :class="{ 'is-compact': compact }"
          position="popper"
          :side="side"
          align="start"
          :side-offset="8"
          :collision-padding="12"
          :body-lock="false"
          :disable-outside-pointer-events="false"
          :inert="!open"
          aria-label="视图选择"
        >
          <div class="view-select-drawer">
            <SelectViewport class="view-select-viewport">
              <SelectItem v-for="view in views" :key="view.value" :value="view.value" class="view-select-item">
                <component :is="view.icon" :size="18" aria-hidden="true" />
                <SelectItemText>{{ view.label }}</SelectItemText>
                <SelectItemIndicator class="view-select-check">
                  <Check :size="16" aria-hidden="true" />
                </SelectItemIndicator>
              </SelectItem>
            </SelectViewport>
          </div>
        </SelectContent>
      </Transition>
    </SelectPortal>
  </SelectRoot>
</template>

<style>
.view-select-trigger {
  min-width: 170px;
  height: 44px;
  padding: 0 12px;
  gap: 9px;
  border: 2px solid var(--primary);
  border-radius: 7px;
  background: var(--surface);
  color: var(--blue-ink);
  font-size: 14px;
  font-weight: 800;
  white-space: nowrap;
}
.view-select-trigger[data-state="open"] { background: var(--primary-soft); }
.view-select-trigger.is-compact { position: relative; width: 44px; min-width: 44px; padding: 10px; gap: 0; }
.view-select-trigger.is-compact .view-select-value { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.view-select-trigger.is-compact .view-select-chevron { position: absolute; right: 2px; bottom: 2px; margin: 0; }
.view-select-trigger.is-compact .view-select-chevron svg { width: 10px; height: 10px; }
.view-select-chevron {
  display: inline-flex;
  margin-left: auto;
  color: var(--primary);
  transition: transform 180ms var(--ease-out);
}
.view-select-chevron.is-open { transform: rotate(180deg); }
.view-select-content {
  z-index: 60;
  width: var(--reka-select-trigger-width);
  max-width: var(--reka-select-content-available-width);
  max-height: var(--reka-select-content-available-height);
  border-radius: 9px;
  overflow: clip;
}
.view-select-drawer {
  width: 100%;
  border: 1px solid var(--line);
  border-radius: inherit;
  background: var(--surface);
  transform: translate3d(0,0,0);
  transition: transform 220ms var(--ease-panel);
}
.view-select-content.is-compact { width: 190px; }
.view-select-viewport { padding: 5px; }
.view-select-item {
  display: flex;
  align-items: center;
  gap: 9px;
  min-height: 44px;
  padding: 0 9px;
  border-radius: 5px;
  color: var(--blue-ink);
  font-size: 14px;
  font-weight: 700;
  cursor: pointer;
  outline: none;
}
.view-select-item[data-state="checked"] { background: var(--primary-soft); }
.view-select-item[data-highlighted] { background: var(--yellow-soft); }
.view-select-check { display: inline-flex; margin-left: auto; color: var(--primary); }
.view-select-leave-active { pointer-events: none; }
.view-select-leave-active .view-select-content {
  pointer-events: none !important;
}
.view-select-leave-active .view-select-drawer { transition-duration: 180ms; }
.view-select-enter-from .view-select-drawer,
.view-select-leave-to .view-select-drawer { transform: translate3d(0,-100%,0); }
.view-select-content[data-side="top"] .view-select-drawer { transform: translate3d(0,0,0); }
.view-select-content[data-side="top"].view-select-enter-from .view-select-drawer,
.view-select-content[data-side="top"].view-select-leave-to .view-select-drawer,
.view-select-enter-from .view-select-content[data-side="top"] .view-select-drawer,
.view-select-leave-to .view-select-content[data-side="top"] .view-select-drawer { transform: translate3d(0,100%,0); }
@media (hover: hover) and (pointer: fine) {
  .view-select-trigger:hover { background: var(--primary-soft); }
}
@media (max-width: 767px) {
  .view-select-trigger { min-width: 158px; padding-inline: 10px; }
}
@media (prefers-reduced-motion: reduce) {
  .view-select-chevron { transition: none; }
  .view-select-drawer { transition: none; }
  .view-select-enter-from .view-select-drawer,
  .view-select-leave-to .view-select-drawer { transform: none; }
}
html[data-input="keyboard"] .view-select-chevron,
html[data-input="keyboard"] .view-select-drawer { transition: none; }
</style>
