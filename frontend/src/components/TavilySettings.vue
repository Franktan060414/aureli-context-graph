<script setup>
import { reactive, ref, watch, nextTick } from 'vue';
import { Eye, EyeOff, RefreshCw, LoaderCircle, Check, CheckCircle2, AlertCircle, Send } from '@lucide/vue';
import { createApiClient } from '../lib/api.js';

const props = defineProps({ apiBase: String, busy: Boolean });
const emit = defineEmits(['notify']);
const defaultUrl = 'https://mcp.tavily.com/mcp/';
const config = reactive({ enabled: false, mcpUrl: defaultUrl, apiKey: '' });
const stored = ref(null), loaded = ref(false), loading = ref(false), saving = ref(false), testing = ref(false);
const showKey = ref(false), error = ref(''), fieldError = ref(''), feedback = ref(''), errorSummary = ref(null);
const testState = ref('idle');
const tavilyLogo = `${import.meta.env.BASE_URL}branding/tavily-mark.svg`;
let loadVersion = 0;

function hasStoredKey() {
  return Boolean(stored.value?.keyConfigured && config.mcpUrl.trim() === stored.value.mcpUrl);
}
function apply(value) {
  stored.value = value;
  Object.assign(config, value, { apiKey: '' });
  showKey.value = false;
}
async function load() {
  const version = ++loadVersion;
  loading.value = true; loaded.value = false; error.value = ''; fieldError.value = ''; feedback.value = '';
  testState.value = 'idle';
  stored.value = null;
  Object.assign(config, { enabled: false, mcpUrl: defaultUrl, apiKey: '' });
  try {
    const result = await createApiClient(props.apiBase || '').tavilySettings();
    if (version !== loadVersion) return;
    apply(result.data); loaded.value = true;
  } catch (e) {
    if (version === loadVersion) error.value = `无法读取联网搜索配置：${e.message}`;
  } finally {
    if (version === loadVersion) loading.value = false;
  }
}
watch(() => props.apiBase, load, { immediate: true });
function validate() {
  fieldError.value = '';
  try {
    const url = new URL(config.mcpUrl.trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash)
      throw new Error();
  } catch {
    fieldError.value = '请填写有效的 MCP HTTP / HTTPS 地址，密钥请填写在 API Key 中。';
  }
  if (!fieldError.value && config.enabled && !config.apiKey.trim() && !hasStoredKey())
    fieldError.value = '启用联网搜索前，请填写 Tavily API Key。';
  return !fieldError.value;
}
async function save() {
  error.value = ''; feedback.value = '';
  if (!validate()) {
    await nextTick(); errorSummary.value?.focus(); return;
  }
  saving.value = true;
  try {
    const result = await createApiClient(props.apiBase || '').saveTavilySettings({
      enabled: config.enabled, mcpUrl: config.mcpUrl.trim(), apiKey: config.apiKey.trim(),
    });
    apply(result.data);
    testState.value = 'idle';
    feedback.value = result.data.enabled ? '联网搜索已开启，AI 将按问题与上下文决定是否搜索。' : '联网搜索已关闭。';
    emit('notify', { message: feedback.value });
  } catch (e) { error.value = e.message; }
  finally { saving.value = false; }
}
async function testConnection() {
  error.value = ''; feedback.value = ''; testing.value = true;
  testState.value = 'idle';
  try {
    const result = await createApiClient(props.apiBase || '').testTavilySettings();
    feedback.value = result.data;
    testState.value = 'success';
  } catch (e) { error.value = e.message; testState.value = 'error'; }
  finally { testing.value = false; }
}
</script>

<template>
  <section class="tavily-settings model-config-section" aria-labelledby="tavily-title">
    <div class="model-config-heading">
      <img class="tavily-logo" :src="tavilyLogo" width="32" height="32" alt="" aria-hidden="true" />
      <div><h3 id="tavily-title">联网搜索 · Tavily MCP</h3>
        <p>根据当前问题和关联节点，按需搜索互联网资料并引用来源。</p></div>
      <button type="button" class="secondary" @click="load" :disabled="loading || saving || testing || busy">
        <RefreshCw :size="15" aria-hidden="true" :class="{ spinning: loading }" />读取联网配置
      </button>
    </div>
    <form @submit.prevent="save" @input="feedback = ''" novalidate>
      <fieldset :disabled="!loaded || loading || saving || testing || busy">
        <label class="tavily-toggle label-option" :class="{ 'is-chosen': config.enabled }" for="tavily-enabled">
          <input id="tavily-enabled" type="checkbox" role="switch" v-model="config.enabled"
            aria-describedby="tavily-enabled-help" />
          <span class="label-choice-box" aria-hidden="true"><Check :size="15" /></span>
          <span>启用联网搜索</span><strong>{{ config.enabled ? '已开启' : '已关闭' }}</strong>
        </label>
        <p id="tavily-enabled-help" class="field-help">
          开启后，AI 综合问题与所选上下文决定是否搜索；关闭后不调用 Tavily。修改后需保存生效。
        </p>
        <div class="tavily-fields">
          <div>
            <label for="tavily-mcp-url">MCP 服务地址 <span class="required">*</span></label>
            <input id="tavily-mcp-url" type="url" v-model.trim="config.mcpUrl" @blur="validate"
              :placeholder="defaultUrl" aria-describedby="tavily-url-help"
              :aria-invalid="Boolean(fieldError && fieldError.includes('地址'))" />
            <p id="tavily-url-help" class="field-help">默认使用 Tavily 官方远程服务，无需本地安装。</p>
          </div>
          <div>
            <label for="tavily-api-key">Tavily API Key
              <span class="required" v-if="config.enabled">*</span><span class="optional" v-else>选填</span>
              <span class="configured-key" v-if="hasStoredKey()"><CheckCircle2 :size="12" aria-hidden="true" />已配置</span>
            </label>
            <div class="key-input">
              <input id="tavily-api-key" :type="showKey ? 'text' : 'password'" v-model="config.apiKey"
                autocomplete="off" spellcheck="false" @blur="validate"
                :placeholder="hasStoredKey() ? '留空保留当前密钥' : '输入 Tavily API Key'"
                aria-describedby="tavily-key-help" :aria-invalid="Boolean(fieldError && fieldError.includes('API Key。'))" />
              <button type="button" class="icon-button" @click="showKey = !showKey"
                :aria-label="showKey ? '隐藏 Tavily API Key' : '显示 Tavily API Key'" :aria-pressed="showKey">
                <EyeOff v-if="showKey" :size="16" aria-hidden="true" /><Eye v-else :size="16" aria-hidden="true" />
              </button>
            </div>
            <p id="tavily-key-help" class="field-help">密钥由后端保存，读取时不返回原文；更换地址后需重新填写。</p>
          </div>
        </div>
      </fieldset>
      <div class="api-settings-actions">
        <div class="api-settings-feedback">
          <p v-if="error || fieldError" ref="errorSummary" class="inline-error" role="alert" tabindex="-1">{{ error || fieldError }}</p>
          <p v-else-if="feedback" class="config-saved" role="status"><CheckCircle2 :size="16" aria-hidden="true" />{{ feedback }}</p>
          <p v-else class="field-help">联网配置单独保存。测试连接检查已保存的服务与搜索工具，不执行搜索。</p>
        </div>
        <div class="api-settings-action-buttons">
          <button type="button" class="test-connection" @click="testConnection"
            :class="{ 'is-success': testState === 'success', 'is-error': testState === 'error' }"
            :aria-label="testState === 'success' ? '测试联网连接，最近一次测试成功' : testState === 'error' ? '测试联网连接，最近一次测试失败' : '测试联网连接'"
            :disabled="!loaded || !stored?.keyConfigured || loading || saving || testing || busy">
            <LoaderCircle v-if="testing" class="spinning" :size="16" aria-hidden="true" />
            <CheckCircle2 v-else-if="testState === 'success'" :size="16" aria-hidden="true" />
            <AlertCircle v-else-if="testState === 'error'" :size="16" aria-hidden="true" />
            <Send v-else :size="16" aria-hidden="true" />
            {{ testing ? '测试中…' : '测试联网连接' }}
          </button>
          <button class="primary" :disabled="!loaded || loading || saving || testing || busy">
            <LoaderCircle v-if="saving" class="spinning" :size="16" aria-hidden="true" />{{ saving ? '保存中…' : '保存联网配置' }}
          </button>
        </div>
      </div>
    </form>
  </section>
</template>

<style scoped>
.tavily-settings { margin-top: 32px; }
.model-config-heading { flex-wrap: wrap; }
.model-config-heading > div { flex: 1; min-width: 180px; }
.tavily-logo { flex: 0 0 32px; object-fit: contain; }
.tavily-fields { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-top: 24px; }
.tavily-toggle { position: relative; display: flex; align-items: center; gap: 12px; min-height: 44px; width: fit-content; cursor: pointer; }
.tavily-toggle input { position: absolute; left: 0; top: 50%; transform: translateY(-50%); opacity: 0; width: 24px; height: 24px; padding: 0; margin: 0; cursor: pointer; }
.tavily-toggle strong { color: var(--primary); font-size: 12px; }
.api-settings-feedback { min-height: 4.5em; }
.api-settings-feedback .inline-error { margin: 0; }
input:disabled, fieldset:disabled .tavily-toggle { cursor: default; }
@media (max-width: 760px) {
  .tavily-fields { grid-template-columns: 1fr; }
  .model-config-heading > button { width: 100%; }
}
</style>
