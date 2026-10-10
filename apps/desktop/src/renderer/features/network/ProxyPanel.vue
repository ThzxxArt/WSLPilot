<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { NButton, NInput, NSelect, NSwitch, NTag, useMessage } from 'naive-ui'
import {
  buildProxyScript,
  normalizeProxyUrl,
  PROXY_SCRIPT_PATH,
  resolveEffectiveProxy,
  type DistroView,
  type ProxyConfig,
  type ProxyScriptState,
  type WindowsProxyInfo,
} from '@wslpilot/shared'
import { proxyToForm, validateProxyForm, type ProxyForm } from './forms'
import { errorLine } from '../../composables/useAppError'

/**
 * 代理配置面板（M6 · 设计书 §12.6）。
 * 配置写入 network.jsonc；「应用到发行版」把生效代理落成
 * `/etc/profile.d/wslpilot-proxy.sh`（root tee + stdin，可清除、可查看原文）。
 */
const props = defineProps<{
  proxy: ProxyConfig
  distros: DistroView[]
  windowsProxy: WindowsProxyInfo | null
  proxyScript: ProxyScriptState | null
  saving?: boolean
}>()

const emit = defineEmits<{
  save: [ProxyConfig]
  apply: [distro: string]
  clear: [distro: string]
  inspect: [distro: string]
}>()

const message = useMessage()
const form = reactive<ProxyForm>(proxyToForm(props.proxy))
const targetDistro = ref('')
const busy = ref(false)

watch(
  () => props.proxy,
  (p) => Object.assign(form, proxyToForm(p)),
  { deep: true },
)

watch(
  () => props.distros,
  (list) => {
    if (!targetDistro.value && list.length > 0) targetDistro.value = list[0]!.name
  },
  { immediate: true },
)

const distroOptions = computed(() =>
  props.distros.map((d) => ({
    label: d.meta?.alias ? `${d.meta.alias}（${d.name}）` : d.name,
    value: d.name,
  })),
)

const error = computed(() => validateProxyForm(form))

const effective = computed(() =>
  resolveEffectiveProxy(
    {
      useWindowsProxy: form.useWindowsProxy,
      httpProxy: form.httpProxy,
      httpsProxy: form.httpsProxy,
      noProxy: form.noProxy,
    },
    props.windowsProxy,
  ),
)

const scriptPreview = computed(() => buildProxyScript(effective.value))

const windowsProxyLabel = computed(() => {
  const w = props.windowsProxy
  if (!w) return '未检测到 Windows 代理设置'
  if (!w.enabled) return 'Windows 系统代理未启用'
  return `Windows 系统代理：${normalizeProxyUrl(w.server) || w.server}`
})

async function save() {
  const err = error.value
  if (err) {
    message.warning(err)
    return
  }
  emit('save', {
    useWindowsProxy: form.useWindowsProxy,
    httpProxy: form.httpProxy.trim(),
    httpsProxy: form.httpsProxy.trim(),
    noProxy: form.noProxy.trim(),
  })
}

async function applyToDistro() {
  if (!targetDistro.value) {
    message.warning('请选择要应用的发行版')
    return
  }
  if (error.value) {
    message.warning(error.value)
    return
  }
  busy.value = true
  try {
    emit('save', {
      useWindowsProxy: form.useWindowsProxy,
      httpProxy: form.httpProxy.trim(),
      httpsProxy: form.httpsProxy.trim(),
      noProxy: form.noProxy.trim(),
    })
    emit('apply', targetDistro.value)
  } catch (e) {
    message.error(errorLine(e, '应用代理失败'))
  } finally {
    busy.value = false
  }
}

function clearFromDistro() {
  if (!targetDistro.value) {
    message.warning('请选择发行版')
    return
  }
  emit('clear', targetDistro.value)
}

function inspect() {
  if (!targetDistro.value) {
    message.warning('请选择发行版')
    return
  }
  emit('inspect', targetDistro.value)
}
</script>

<template>
  <section class="card proxy-card">
    <div class="head">
      <div>
        <h2 class="panel-title">代理配置</h2>
        <p class="sub">
          保存到 <code>network.jsonc</code> · 应用后写入发行版内
          <code>{{ PROXY_SCRIPT_PATH }}</code>
        </p>
      </div>
      <n-button size="small" type="primary" :loading="saving" :disabled="!!error" @click="save">
        保存配置
      </n-button>
    </div>

    <div class="grid">
      <label class="field toggle">
        <span class="label">跟随 Windows 系统代理</span>
        <n-switch v-model:value="form.useWindowsProxy" />
        <span class="hint">{{ windowsProxyLabel }}</span>
      </label>

      <label class="field">
        <span class="label">HTTP 代理</span>
        <n-input v-model:value="form.httpProxy" placeholder="http://127.0.0.1:7890" />
      </label>

      <label class="field">
        <span class="label">HTTPS 代理</span>
        <n-input v-model:value="form.httpsProxy" placeholder="http://127.0.0.1:7890" />
      </label>

      <label class="field">
        <span class="label">不代理列表（no_proxy）</span>
        <n-input v-model:value="form.noProxy" placeholder="localhost,127.0.0.1" />
      </label>
    </div>

    <div class="apply-row">
      <div class="apply-target">
        <span class="label">应用到发行版</span>
        <n-select
          v-model:value="targetDistro"
          :options="distroOptions"
          filterable
          placeholder="选择发行版"
          class="distro-select"
        />
      </div>
      <div class="apply-actions">
        <n-button
          size="small"
          type="primary"
          :loading="busy"
          :disabled="!!error"
          @click="applyToDistro"
        >
          写入代理脚本
        </n-button>
        <n-button size="small" secondary @click="clearFromDistro">清除代理脚本</n-button>
        <n-button size="small" quaternary @click="inspect">查看当前脚本</n-button>
      </div>
    </div>

    <p v-if="error" class="error">{{ error }}</p>

    <div v-if="proxyScript" class="script-state">
      <div class="script-head">
        <span class="label">发行版内脚本（{{ proxyScript.path }}）</span>
        <n-tag size="tiny" :bordered="false" :type="proxyScript.exists ? 'success' : 'default'">
          {{ proxyScript.exists ? '已写入' : '不存在' }}
        </n-tag>
      </div>
      <pre class="script">{{ proxyScript.content || '（空）' }}</pre>
    </div>

    <div class="preview">
      <div class="preview-label">将写入的内容（生效代理）</div>
      <pre class="script">{{ scriptPreview }}</pre>
    </div>
  </section>
</template>

<style scoped>
.proxy-card {
  padding: 18px 22px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.panel-title {
  font-size: 15px;
  font-weight: 600;
  margin: 0;
  color: var(--color-text-primary);
}

.sub {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--color-text-secondary);
}

.sub code {
  background: var(--color-bg-sunken);
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 11px;
}

.grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px 18px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.toggle {
  gap: 8px;
}

.label {
  font-size: 12px;
  color: var(--color-text-secondary);
  font-weight: 600;
}

.hint {
  font-size: 11.5px;
  color: var(--color-text-tertiary);
}

.apply-row {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
  padding: 12px 14px;
  border-radius: var(--radius-md);
  background: var(--color-bg-sunken);
}

.apply-target {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 240px;
}

.distro-select {
  width: 260px;
}

.apply-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.script-state,
.preview {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.script-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.preview-label {
  font-size: 11px;
  color: var(--color-text-secondary);
}

.error {
  margin: 0;
  font-size: 12px;
  color: var(--color-danger);
}

.script {
  margin: 0;
  padding: 12px 14px;
  border-radius: var(--radius-md);
  background: var(--color-bg-sunken);
  font-family: var(--font-mono);
  font-size: 11.5px;
  line-height: 1.7;
  color: var(--color-text-primary);
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 220px;
  overflow: auto;
}
</style>
