<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { NButton, NInput, NModal, NTabPane, NTabs, NTag, useMessage } from 'naive-ui'
import type { Metrics, RegistryDetail } from '@shared/types'
import { formatKbPair } from '@shared/format'
import { useDistrosStore } from '../../stores/distros'
import { useSettingsStore } from '../../stores/settings'
import { errorLine } from '../../composables/useAppError'
import { stateLabel } from '../../composables/state-label'
import WslConfPanel from '../config/WslConfPanel.vue'
import ActionsPanel from '../actions/ActionsPanel.vue'
import FileBrowserPanel from '../fs/FileBrowserPanel.vue'

const props = defineProps<{ show: boolean; distroName: string }>()
const emit = defineEmits<{
  'update:show': [boolean]
  openTerminal: [name: string]
}>()

const distros = useDistrosStore()
const settings = useSettingsStore()
const message = useMessage()

const detail = ref<RegistryDetail | null>(null)
const loading = ref(false)
const activeTab = ref('overview')
const metrics = ref<Metrics | null>(null)
const lastTask = ref<{ type: string; distro: string; status: string; finishedAt: string } | null>(
  null,
)

const distro = computed(() => distros.byName(props.distroName))

async function loadDetail() {
  if (!props.distroName) return
  loading.value = true
  try {
    detail.value = await window.wslAPI.distros.registryDetail(props.distroName)
  } catch {
    detail.value = null
  } finally {
    loading.value = false
  }
  // 资源 Mini 仪表盘（§12.4）：仅运行中采样
  if (distro.value?.state === 'Running') {
    metrics.value = await window.wslAPI.metrics.sample(props.distroName).catch(() => null)
  } else {
    metrics.value = null
  }
  // 最近任务（§12.4）：state.jsonc.lastTaskResult
  try {
    const s = await window.wslAPI.config.get('state')
    lastTask.value = s.lastTaskResult ?? null
  } catch {
    lastTask.value = null
  }
}

watch(
  () => [props.show, props.distroName],
  ([show]) => {
    if (show) {
      activeTab.value = 'overview'
      void loadDetail()
    }
  },
  { immediate: true },
)

const rows = computed(() => {
  const d = distro.value
  return [
    { label: '名称', value: props.distroName, copy: false },
    { label: '状态', value: d ? stateLabel(d.state) : '—', copy: false },
    {
      label: 'WSL 版本',
      value: detail.value?.version ? `WSL${detail.value.version}` : d ? `WSL${d.version}` : '—',
      copy: false,
    },
    { label: 'GUID', value: detail.value?.guid || '（注册表信息不可用）', copy: true },
    {
      label: '安装位置',
      value: detail.value?.basePath || d?.basePath || '（注册表信息不可用）',
      copy: true,
    },
    {
      label: '默认 UID',
      value: detail.value?.defaultUid != null ? String(detail.value.defaultUid) : '—',
      copy: false,
    },
    {
      label: 'Flags',
      value: detail.value?.flags != null ? `0x${detail.value.flags.toString(16)}` : '—',
      copy: false,
    },
    { label: '默认发行版', value: d?.isDefault ? '是' : '否', copy: false },
    {
      label: '别名 / 备注',
      value: [d?.meta?.alias, d?.meta?.note].filter(Boolean).join(' · ') || '—',
      copy: false,
    },
  ]
})

/** 表单未覆盖的注册表原始值（深层信息） */
const extraValues = computed(() => {
  const known = new Set(['DistributionName', 'BasePath', 'Version', 'DefaultUid', 'Flags'])
  return Object.entries(detail.value?.values ?? {}).filter(([k]) => !known.has(k))
})

async function copyValue(v: string) {
  try {
    await navigator.clipboard.writeText(v)
    message.success('已复制')
  } catch {
    message.warning('复制失败，请手动选择文本')
  }
}

async function act(fn: () => Promise<void>, ok: string) {
  try {
    await fn()
    message.success(ok)
    await distros.refresh()
    await loadDetail()
  } catch (e) {
    message.error(errorLine(e))
  }
}

function onStart() {
  void act(() => distros.start(props.distroName), `已启动 ${props.distroName}`)
}
function onTerminate() {
  void act(() => distros.terminate(props.distroName), `已停止 ${props.distroName}`)
}
function onSetDefault() {
  void act(() => distros.setDefault(props.distroName), `已设 ${props.distroName} 为默认`)
}

async function onUnregister() {
  // 破坏性操作：confirmDestructive 开启时必须显式确认（§13.4）
  if (settings.confirmDestructive) {
    const ok = window.confirm(
      `注销（删除）发行版 ${props.distroName}？\n\n该发行版内的全部数据将被永久删除且不可恢复。\n\n点「确定」执行注销，点「取消」放弃。`,
    )
    if (!ok) return
  }
  try {
    await window.wslAPI.distros.uninstall(props.distroName)
    message.success(`已注销 ${props.distroName}`)
    await distros.refresh()
    emit('update:show', false)
  } catch (e) {
    message.error(errorLine(e, '注销失败'))
  }
}

// ── 元数据编辑（meta:set 闭环）──
const editing = ref(false)
const editAlias = ref('')
const editNote = ref('')
const editTags = ref('')

function startEdit() {
  const m = distro.value?.meta
  editAlias.value = m?.alias ?? ''
  editNote.value = m?.note ?? ''
  editTags.value = (m?.tags ?? []).join(', ')
  editing.value = true
}

async function saveMeta() {
  const base = distro.value?.meta
  try {
    await window.wslAPI.meta.set({
      name: props.distroName,
      alias: editAlias.value.trim(),
      tags: editTags.value
        .split(/[,，]/)
        .map((t) => t.trim())
        .filter(Boolean),
      color: base?.color ?? '',
      icon: base?.icon ?? '',
      note: editNote.value.trim(),
      startupCwd: base?.startupCwd ?? '~',
      pinned: base?.pinned ?? false,
      quickActions: base?.quickActions ?? [],
    })
    message.success('元数据已保存')
    editing.value = false
    await distros.refresh()
  } catch (e) {
    message.error(errorLine(e, '保存元数据失败'))
  }
}
</script>

<template>
  <n-modal
    :show="show"
    preset="card"
    :title="`发行版详情 · ${distroName}`"
    class="detail-modal"
    @update:show="(v: boolean) => emit('update:show', v)"
  >
    <n-tabs v-model:value="activeTab" type="line" size="small">
      <!-- 概览（含注册表详情） -->
      <n-tab-pane name="overview" tab="概览">
        <div v-if="loading" class="loading">读取注册表信息…</div>
        <div class="summary">
          <div v-for="row in rows" :key="row.label" class="row">
            <span class="label">{{ row.label }}</span>
            <span class="value">{{ row.value }}</span>
            <button
              v-if="row.copy && row.value && !row.value.startsWith('（')"
              class="copy-btn"
              :aria-label="`复制${row.label}`"
              title="复制"
              @click="copyValue(row.value)"
            >
              复制
            </button>
          </div>
        </div>

        <!-- 资源 Mini 仪表盘（§12.4） -->
        <div v-if="metrics" class="mini-metrics">
          <div class="mini">
            <span class="mini-label">内存</span>
            <span class="mini-value">{{
              formatKbPair(metrics.memUsedKB, metrics.memTotalKB)
            }}</span>
          </div>
          <div class="mini">
            <span class="mini-label">磁盘</span>
            <span class="mini-value">
              {{ formatKbPair(metrics.diskUsedKB, metrics.diskTotalKB) }}
            </span>
          </div>
          <div class="mini">
            <span class="mini-label">CPU</span>
            <span class="mini-value">{{ metrics.cpuPercent }}%</span>
          </div>
        </div>

        <!-- 最近任务（§12.4） -->
        <div v-if="lastTask" class="last-task">
          最近任务：{{ lastTask.type }} · {{ lastTask.distro || '—' }} · {{ lastTask.status }} ·
          {{ lastTask.finishedAt.slice(0, 19).replace('T', ' ') }}
        </div>

        <div v-if="extraValues.length" class="extra">
          <div class="extra-title">注册表原始值（Lxss）</div>
          <div v-for="[k, v] in extraValues" :key="k" class="extra-row">
            <code class="extra-key">{{ k }}</code>
            <span class="extra-val">{{ v }}</span>
          </div>
        </div>

        <div v-if="distro?.meta?.tags?.length && !editing" class="tags">
          <NTag v-for="t in distro.meta.tags" :key="t" size="tiny" :bordered="false">
            {{ t }}
          </NTag>
        </div>

        <!-- 元数据编辑 -->
        <div v-if="editing" class="meta-edit">
          <div class="field">
            <div class="label">别名</div>
            <NInput v-model:value="editAlias" size="small" placeholder="例如：主力开发" />
          </div>
          <div class="field">
            <div class="label">标签（逗号分隔）</div>
            <NInput v-model:value="editTags" size="small" placeholder="work, node, python" />
          </div>
          <div class="field">
            <div class="label">备注</div>
            <NInput
              v-model:value="editNote"
              size="small"
              type="textarea"
              :rows="2"
              placeholder="日常开发使用…"
            />
          </div>
          <div class="edit-actions">
            <n-button size="small" @click="editing = false"> 取消 </n-button>
            <n-button size="small" type="primary" @click="saveMeta"> 保存元数据 </n-button>
          </div>
        </div>

        <div class="actions">
          <n-button secondary @click="emit('openTerminal', distroName)"> 打开终端 </n-button>
          <n-button v-if="distro && distro.state !== 'Running'" secondary @click="onStart">
            启动
          </n-button>
          <n-button v-else secondary @click="onTerminate"> 停止 </n-button>
          <n-button secondary :disabled="distro?.isDefault" @click="onSetDefault">
            设为默认
          </n-button>
          <n-button secondary @click="startEdit"> 编辑元数据 </n-button>
          <n-button quaternary type="error" @click="onUnregister"> 注销发行版 </n-button>
        </div>
      </n-tab-pane>

      <!-- 配置（wsl.conf） -->
      <n-tab-pane name="config" tab="配置">
        <WslConfPanel :distro-name="distroName" />
      </n-tab-pane>

      <!-- 动作 -->
      <n-tab-pane name="actions" tab="动作">
        <ActionsPanel :distro-name="distroName" />
      </n-tab-pane>

      <!-- 文件 -->
      <n-tab-pane name="files" tab="文件">
        <FileBrowserPanel :distro-name="distroName" />
      </n-tab-pane>
    </n-tabs>
  </n-modal>
</template>

<style scoped>
.detail-modal {
  width: 760px;
  max-width: 94vw;
}

.loading {
  color: var(--color-text-tertiary);
  font-size: 12px;
  margin-bottom: 8px;
}

.summary {
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.row {
  display: flex;
  gap: 16px;
  padding: 9px 12px;
  font-size: 12.5px;
  align-items: center;
}

.row + .row {
  border-top: 1px solid var(--color-border-subtle);
}

.label {
  width: 96px;
  flex-shrink: 0;
  color: var(--color-text-secondary);
}

.value {
  color: var(--color-text-primary);
  word-break: break-all;
  font-family: 'Cascadia Mono', Consolas, monospace;
  font-size: 12px;
  flex: 1;
}

.copy-btn {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--color-text-link);
  padding: 2px 8px;
  border-radius: 6px;
  border: 1px solid var(--color-border-default);
}

.copy-btn:hover {
  background: var(--color-accent-soft);
}

.extra {
  margin-top: 12px;
  border: 1px dashed var(--color-border-default);
  border-radius: var(--radius-md);
  padding: 8px 12px;
}

.extra-title {
  font-size: 11px;
  color: var(--color-text-tertiary);
  margin-bottom: 4px;
}

.extra-row {
  display: flex;
  gap: 10px;
  font-size: 11.5px;
  padding: 2px 0;
}

.extra-key {
  width: 160px;
  color: var(--color-text-secondary);
  font-family: 'Cascadia Mono', Consolas, monospace;
}

.extra-val {
  color: var(--color-text-primary);
  word-break: break-all;
  font-family: 'Cascadia Mono', Consolas, monospace;
}

.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 12px;
}

.mini-metrics {
  display: flex;
  gap: 10px;
  margin-top: 12px;
}

.mini {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 12px;
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-sm);
  background: var(--color-bg-sunken);
}

.mini-label {
  font-size: 11px;
  color: var(--color-text-tertiary);
}

.mini-value {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-primary);
  font-variant-numeric: tabular-nums;
}

.last-task {
  margin-top: 10px;
  font-size: 11.5px;
  color: var(--color-text-tertiary);
}

.meta-edit {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 12px;
  padding: 12px;
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  background: var(--color-bg-sunken);
}

.meta-edit .field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.meta-edit .label {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--color-text-secondary);
}

.edit-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 16px;
}
</style>
