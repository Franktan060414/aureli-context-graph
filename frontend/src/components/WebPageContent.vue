<script setup>
import { ExternalLink, RefreshCw, LoaderCircle } from '@lucide/vue';
import MarkdownAnswer from './MarkdownAnswer.vue';
import { webSourceUrl, webStatus, webFetchedAt } from '../lib/web-tiles.js';
defineProps({ tile: { type: Object, required: true }, busy: Boolean });
defineEmits(['refresh']);
</script>
<template>
  <div class="web-page-content">
    <div class="web-page-actions">
      <a v-if="webSourceUrl(tile.resolvedUrl || tile.sourceUrl)" class="secondary"
        :href="webSourceUrl(tile.resolvedUrl || tile.sourceUrl)" target="_blank" rel="noopener noreferrer">
        <ExternalLink :size="16" aria-hidden="true" />打开原网页
      </a>
      <button type="button" class="secondary" :disabled="busy" @click="$emit('refresh', tile)">
        <LoaderCircle v-if="busy" :size="16" class="spinning" aria-hidden="true" />
        <RefreshCw v-else :size="16" aria-hidden="true" />{{ busy ? '正在读取…' : tile.content?.trim() ? '更新正文' : '读取 / 重试' }}
      </button>
    </div>
    <p class="web-page-url">{{ tile.sourceUrl }}</p>
    <p class="field-help" role="status">{{ webStatus(tile) }} · 快照时间：{{ webFetchedAt(tile.fetchedAt) }}</p>
    <p v-if="tile.fetchError" class="inline-error" role="alert">{{ tile.fetchError }}</p>
    <p v-if="tile.content?.trim()" class="field-help">{{ tile.fetchStatus === 'FAILED' || tile.fetchStatus === 'FETCHING' ? '以下为上次成功保存的正文。' : '分析时使用这份正文快照。' }} 网页变化后可更新正文。</p>
    <MarkdownAnswer v-if="tile.content?.trim()" :content="tile.content" />
    <p v-else class="field-help">{{ busy ? '正在提取网页正文，请稍候…' : '尚无可读取正文。登录或受限网页可保存为 PDF 上传，或将文本添加为便签。' }}</p>
    <p v-if="tile.content?.length > 60000" class="field-help">正文较长，多个网页共享 AI 上下文长度限制；需要分析后面的章节时，请将相关段落另存为便签。</p>
  </div>
</template>
<style scoped>
.web-page-content { min-width: 0; }
.web-page-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.web-page-actions a { text-decoration: none; }
.web-page-url { overflow-wrap: anywhere; color: var(--muted); font-size: 13px; margin: 12px 0; }
</style>
