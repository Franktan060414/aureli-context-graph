<script setup>
import { X } from "@lucide/vue";
defineProps({ related: { type: Array, required: true }, contextTiles: { type: Array, default: null }, disabled: Boolean });
const emit = defineEmits(["toggle", "clear"]);
</script>

<template>
    <div class="context-picker">
      <div>
        <span>关联上下文</span>
        <button type="button" class="text-button" @click="emit('clear')"
          :disabled="disabled || !related.length">清空</button>
      </div>
      <div class="chips" v-if="related.length">
        <button type="button" v-for="id in related" :key="id" @click="emit('toggle', id)"
          :disabled="disabled" :aria-label="`移除关联 ${id}`">
          {{ id }}<X :size="12" />
        </button>
      </div>
      <p v-else>未选择关联，将创建独立节点。</p>
      <details v-if="contextTiles" class="question-context-picker">
        <summary>选择已有节点（{{ contextTiles.length }}）</summary>
        <div v-if="contextTiles.length" class="question-context-options">
          <label v-for="tile in contextTiles" :key="tile.id" class="question-context-option">
            <input type="checkbox" :checked="related.includes(tile.id)" :disabled="disabled"
              @change="emit('toggle', tile.id)" />
            <span><strong>{{ tile.message }}</strong><small class="mono">{{ tile.id }}</small>
              <small v-if="tile.tileType === 'FILE'">{{ tile.content?.trim() ? '已提取正文，可用于提问' : '暂无可读取正文，仅建立关联' }}</small>
            </span>
          </label>
        </div>
        <p v-else>暂无可关联的节点。</p>
      </details>
    </div>
</template>
