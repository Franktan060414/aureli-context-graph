<script setup>
import { reactive, ref, onMounted } from "vue";
import {
  Settings2,
  MessageSquare,
  Database,
  Server,
  Globe,
  Eye,
  EyeOff,
  RefreshCw,
  LoaderCircle,
  CheckCircle2,
  AlertCircle,
  Send,
} from "@lucide/vue";
import { createApiClient } from "../lib/api.js";
const props = defineProps({ apiBase: String, busy: Boolean });
const emit = defineEmits(["base-change", "notify"]);
const serviceBase = ref(props.apiBase),
  loading = ref(false),
  saving = ref(false),
  testing = ref(false),
  error = ref(""),
  testError = ref(""),
  testResult = ref(null),
  loadError = ref(""),
  saved = ref(false);
const dimensions = ref(1536),
  showKeys = reactive({ chat: false, embedding: false });
const defaults = (kind, provider = "local") => ({
  provider,
  baseUrl:
    provider === "local"
      ? "http://127.0.0.1:11434/v1"
      : "https://api.openai.com/v1",
  model:
    provider === "local"
      ? kind === "chat"
        ? "llama3:latest"
        : "qwen3-embedding:4b"
      : kind === "chat"
        ? "gpt-4.1-mini"
        : "text-embedding-3-small",
  apiKey: "",
  keyConfigured: false,
});
const savedProfiles = reactive({ chat: null, embedding: null });
function hasStoredKey(kind) {
  const stored = savedProfiles[kind],
    value = config[kind];
  return Boolean(
    stored?.keyConfigured &&
      stored.provider === value.provider &&
      stored.baseUrl.replace(/\/+$/, "") ===
        value.baseUrl.trim().replace(/\/+$/, ""),
  );
}
const config = reactive({
  chat: defaults("chat"),
  embedding: defaults("embedding"),
});
const groups = [
  {
    id: "chat",
    title: "对话模型",
    subtitle: "用于 Tile 提问与回答生成",
    icon: MessageSquare,
  },
  {
    id: "embedding",
    title: "向量模型",
    subtitle: "用于文档向量化与 RAG 检索",
    icon: Database,
  },
];
function useProvider(kind, provider) {
  Object.assign(config[kind], defaults(kind, provider));
  saved.value = false;
  error.value = "";
}
function normalizeUrl(value, optional = false) {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (!trimmed && optional) return "";
  const url = new URL(trimmed);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error();
  return trimmed;
}
async function load() {
  loadError.value = "";
  loading.value = true;
  try {
    const base = normalizeUrl(serviceBase.value, true);
    const result = await createApiClient(base).modelSettings();
    for (const kind of ["chat", "embedding"])
      Object.assign(config[kind], result.data[kind], { apiKey: "" });
    for (const kind of ["chat", "embedding"])
      savedProfiles[kind] = { ...result.data[kind] };
    dimensions.value = result.data.dimensions;
    saved.value = false;
  } catch {
    loadError.value =
      "暂未读取到服务配置。请确认后端已启动，或填写正确的项目服务地址后重新读取。";
  } finally {
    loading.value = false;
  }
}
onMounted(load);
async function save() {
  error.value = "";
  saved.value = false;
  let base, payload;
  try {
    base = normalizeUrl(serviceBase.value, true);
    payload = { dimensions: dimensions.value };
    for (const kind of ["chat", "embedding"]) {
      const value = config[kind];
      if (!value.model.trim())
        throw new Error(`请填写${kind === "chat" ? "对话" : "向量"}模型名称。`);
      let baseUrl;
      try {
        baseUrl = normalizeUrl(value.baseUrl);
      } catch {
        throw new Error(
          `请填写有效的${kind === "chat" ? "对话" : "向量"}模型 API 地址。`,
        );
      }
      if (
        value.provider === "openai" &&
        !value.apiKey.trim() &&
        !hasStoredKey(kind)
      )
        throw new Error(
          `请填写${kind === "chat" ? "对话" : "向量"}模型的 API Key。`,
        );
      payload[kind] = {
        provider: value.provider,
        baseUrl,
        model: value.model.trim(),
        apiKey: value.apiKey.trim(),
      };
    }
  } catch (e) {
    error.value =
      e.message === "Invalid URL"
        ? "项目服务地址无效，请使用 HTTP / HTTPS 地址。"
        : e.message;
    return;
  }
  saving.value = true;
  try {
    const result = await createApiClient(base).saveModelSettings(payload);
    localStorage.setItem("aureli-api-base", base);
    emit("base-change", base);
    for (const kind of ["chat", "embedding"])
      Object.assign(config[kind], result.data[kind], { apiKey: "" });
    for (const kind of ["chat", "embedding"])
      savedProfiles[kind] = { ...result.data[kind] };
    showKeys.chat = false;
    showKeys.embedding = false;
    loadError.value = "";
    saved.value = true;
    emit("notify", { message: "API 配置已保存并应用到真实工作区" });
  } catch (e) {
    error.value = e.message;
  } finally {
    saving.value = false;
  }
}
async function testConnection() {
  error.value = "";
  testError.value = "";
  testResult.value = null;
  let base;
  try {
    base = normalizeUrl(serviceBase.value, true);
  } catch {
    testError.value = "项目服务地址无效，请使用 HTTP / HTTPS 地址。";
    return;
  }
  testing.value = true;
  try {
    const result = await createApiClient(base).testModelSettings();
    testResult.value = result.data;
    emit("notify", { message: "已保存的 API 配置测试成功" });
  } catch (e) {
    testError.value = e.message;
  } finally {
    testing.value = false;
  }
}
</script>
<template>
  <section class="surface api-settings-panel" aria-label="API 配置">
    <div class="api-settings-heading">
      <span class="metric-icon blue"><Settings2 :size="22" /></span>
      <div>
        <h2>API 配置</h2>
        <p>配置对话模型与向量模型，连接本地服务或 OpenAI 标准接口。</p>
      </div>
      <button
        class="secondary"
        @click="load"
        :disabled="loading || saving || testing || busy"
      >
        <RefreshCw :size="15" :class="{ spinning: loading }" />{{
          loading ? "读取中…" : "读取配置"
        }}
      </button>
    </div>
    <div v-if="loadError" class="config-notice" role="status">
      <AlertCircle :size="16" />
      <p>{{ loadError }}</p>
    </div>
    <form
      @submit.prevent="save"
      @input="saved = false"
      novalidate
    >
      <fieldset :disabled="loading || saving || testing || busy">
        <div class="api-service-field">
          <label for="project-service-url"
            >项目服务地址 <span class="optional">选填</span></label
          ><input
            id="project-service-url"
            type="url"
            v-model.trim="serviceBase"
            placeholder="留空使用当前服务"
            aria-describedby="project-service-help"
          />
          <p id="project-service-help" class="field-help">
            管理接口地址，例如 http://localhost:8080。留空时使用当前服务。
          </p>
        </div>
        <div class="model-config-grid">
          <section
            v-for="group in groups"
            :key="group.id"
            class="model-config-section"
          >
            <div class="model-config-heading">
              <component :is="group.icon" :size="19" />
              <div>
                <h3>{{ group.title }}</h3>
                <p>{{ group.subtitle }}</p>
              </div>
            </div>
            <div
              class="provider-options"
              role="radiogroup"
              :aria-label="`${group.title}来源`"
            >
              <label
                :class="{ selected: config[group.id].provider === 'local' }"
                ><input
                  type="radio"
                  :name="`${group.id}-provider`"
                  :checked="config[group.id].provider === 'local'"
                  @change="useProvider(group.id, 'local')"
                /><Server :size="16" />本地模型</label
              ><label
                :class="{ selected: config[group.id].provider === 'openai' }"
                ><input
                  type="radio"
                  :name="`${group.id}-provider`"
                  :checked="config[group.id].provider === 'openai'"
                  @change="useProvider(group.id, 'openai')"
                /><Globe :size="16" />OpenAI 标准接口</label
              >
            </div>
            <label :for="`${group.id}-base-url`"
              >API Base URL <span class="required">*</span></label
            ><input
              :id="`${group.id}-base-url`"
              type="url"
              v-model.trim="config[group.id].baseUrl"
              :aria-describedby="`${group.id}-url-help`"
            />
            <p :id="`${group.id}-url-help`" class="field-help">
              {{
                config[group.id].provider === "local"
                  ? "支持 Ollama 等提供 /v1 接口的本地服务。"
                  : "可使用 OpenAI 官方地址或兼容 OpenAI 协议的服务。"
              }}
            </p>
            <label :for="`${group.id}-api-key`"
              >API Key
              <span
                class="required"
                v-if="config[group.id].provider === 'openai'"
                >*</span
              ><span class="optional" v-else>选填</span
              ><span class="configured-key" v-if="hasStoredKey(group.id)"
                ><CheckCircle2 :size="12" />已配置</span
              ></label
            >
            <div class="key-input">
              <input
                :id="`${group.id}-api-key`"
                :type="showKeys[group.id] ? 'text' : 'password'"
                v-model="config[group.id].apiKey"
                autocomplete="off"
                :placeholder="
                  hasStoredKey(group.id)
                    ? '留空保留当前密钥'
                    : config[group.id].provider === 'local'
                      ? '无需鉴权时可留空'
                      : '输入服务 API Key'
                "
                :aria-describedby="`${group.id}-key-help`"
              /><button
                type="button"
                class="icon-button"
                @click="showKeys[group.id] = !showKeys[group.id]"
                :aria-label="`${showKeys[group.id] ? '隐藏' : '显示'}${group.title} API Key`"
                :aria-pressed="showKeys[group.id]"
              >
                <EyeOff v-if="showKeys[group.id]" :size="16" /><Eye
                  v-else
                  :size="16"
                />
              </button>
            </div>
            <p :id="`${group.id}-key-help`" class="field-help">
              密钥由后端保存，读取配置时不会返回密钥原文。
            </p>
            <label :for="`${group.id}-model`"
              >模型名称 <span class="required">*</span></label
            ><input
              :id="`${group.id}-model`"
              v-model.trim="config[group.id].model"
              :list="`${group.id}-suggestions`"
              placeholder="输入服务中的模型 ID"
            /><datalist :id="`${group.id}-suggestions`">
              <template v-if="group.id === 'chat'"
                ><option
                  v-if="config[group.id].provider === 'local'"
                  value="llama3:latest" />
                <option v-else value="gpt-4.1-mini"
              /></template>
              <template v-else
                ><option
                  v-if="config[group.id].provider === 'local'"
                  value="qwen3-embedding:4b" />
                <template v-else
                  ><option value="text-embedding-3-small" />
                  <option value="text-embedding-3-large" /></template
              ></template>
            </datalist>
            <p class="field-help">
              支持手动填写自定义模型名称，需与你的服务一致。
            </p>
            <div v-if="group.id === 'embedding'" class="embedding-dimension">
              <span>当前向量维度</span
              ><strong class="mono">{{ dimensions }}</strong>
              <p>
                保持与数据库维度一致。更换向量模型后，已有文档需要重新向量化。
              </p>
            </div>
          </section>
        </div>
      </fieldset>
      <p v-if="error" class="inline-error" role="alert">{{ error }}</p>
      <p v-if="testError" class="inline-error" role="alert">
        {{ testError }}
      </p>
      <div class="api-settings-actions">
        <div class="api-settings-feedback">
          <p v-if="testResult" class="config-test-result" role="status">
            <CheckCircle2 :size="16" />
            <span
              ><strong>{{ testResult.model }}</strong> 返回：{{
                testResult.reply
              }}</span
            >
          </p>
          <p v-else-if="saved" class="config-saved" role="status">
            <CheckCircle2 :size="16" />配置已保存，后续请求使用新模型。
          </p>
          <p v-else class="field-help">
            保存后应用到真实工作区；测试连接仅使用后端已保存的对话模型配置。
          </p>
        </div>
        <div class="api-settings-action-buttons">
          <button
            type="button"
            class="test-connection"
            :class="{
              'is-success': Boolean(testResult),
              'is-error': Boolean(testError),
            }"
            @click="testConnection"
            :disabled="loading || saving || testing || busy"
            :aria-label="
              testResult
                ? '测试链接，最近一次测试成功'
                : testError
                  ? '测试链接，最近一次测试失败'
                  : '测试链接'
            "
          >
            <LoaderCircle v-if="testing" class="spinning" :size="16" />
            <CheckCircle2 v-else-if="testResult" :size="16" />
            <AlertCircle v-else-if="testError" :size="16" />
            <Send v-else :size="16" />{{ testing ? "测试中…" : "测试链接" }}
          </button>
          <button
            class="primary"
            :disabled="loading || saving || testing || busy"
          >
            <LoaderCircle v-if="saving" class="spinning" :size="16" />{{
              saving ? "保存中…" : "保存并应用"
            }}
          </button>
        </div>
      </div>
    </form>
  </section>
</template>
