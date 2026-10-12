<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  NButton,
  NInput,
  NModal,
  NSelect,
  NSwitch,
  NTabPane,
  NTabs,
  NTag,
  useDialog,
  useMessage,
} from 'naive-ui'
import { formatKbPair, type DistroMeta, type Metrics, type RegistryDetail } from '@wslpilot/shared'
import { useDistrosStore } from '../../stores/distros'
import { useSettingsStore } from '../../stores/settings'
import { useTasksStore } from '../../stores/tasks'
import { useActionsStore } from '../../stores/actions'
import { useMetricsStore } from '../../stores/metrics'
import { errorLine } from '../../composables/useAppError'
import { stateLabel } from '../../composables/state-label'
import { taskStatusLabel, taskTypeLabel } from '../../composables/useTaskProgress'
import WslConfPanel from '../config/WslConfPanel.vue'
import ActionsPanel from '../actions/ActionsPanel.vue'
import FileBrowserPanel from '../fs/FileBrowserPanel.vue'

const props = defineProps<{ show: boolean; distroName: string }>()
const emit = defineEmits<{
  'update:show': [boolean]
  'update:distroName': [name: string]
  openTerminal: [name: string]
}>()

const distros = useDistrosStore()
const settings = useSettingsStore()
const tasks = useTasksStore()
const metricsStore = useMetricsStore()
const message = useMessage()
const dialog = useDialog()

const detail = ref<RegistryDetail | null>(null)
const loading = ref(false)
const activeTab = ref('overview')
const metrics = ref<Metrics | null>(null)
const lastTask = ref<{ type: string; distro: string; status: string; finishedAt: string } | null>(
  null,
)
/** wsl.conf 面板（切发行版 / 关窗的未保存守卫入口） */
const confPanel = ref<InstanceType<typeof WslConfPanel> | null>(null)
/** 文件面板（关窗的未保存守卫入口 — 文件页同样不得静默丢编辑） */
const filePanel = ref<InstanceType<typeof FileBrowserPanel> | null>(null)

/** 详情操作在途标记（review 0.1.2 根治：转换/注销双击重复发起） */
const converting = ref(false)
const unregistering = ref(false)

const distro = computed(() => distros.byName(props.distroName))
/** 运行状态单一事实源：按钮组严格状态驱动（review 停/启按钮错位根治） */
const isRunning = computed(() => distro.value?.state === 'Running')

// ── 元数据编辑（meta:set 闭环 — 全字段可编辑，不留半套编辑面）──
const actionsStore = useActionsStore()
const editing = ref(false)
const editAlias = ref('')
const editNote = ref('')
const editTags = ref('')
const editIcon = ref('')
const editColor = ref('')
const editStartupCwd = ref('')
const editPinned = ref(false)
const editQuickActions = ref<string[]>([])

/** 快捷动作可选项（来自 actions.jsonc 白名单） */
const quickActionOptions = computed(() =>
  actionsStore.items.map((a) => ({ label: a.label, value: a.id })),
)

/** 复位编辑态（review 0.1.2 根治：切换发行版后不得沿用上一发行版的编辑值写回） */
function resetEditing() {
  editing.value = false
  editAlias.value = ''
  editNote.value = ''
  editTags.value = ''
  editIcon.value = ''
  editColor.value = ''
  editStartupCwd.value = ''
  editPinned.value = false
  editQuickActions.value = []
}

/** 需确认操作统一走 naive dialog（全仓一致，禁止 window.confirm） */
function confirmDangerous(opts: { title: string; content: string }): Promise<boolean> {
  return new Promise((resolve) => {
    dialog.warning({
      title: opts.title,
      content: opts.content,
      positiveText: '确定',
      negativeText: '取消',
      onPositiveClick: () => resolve(true),
      onNegativeClick: () => resolve(false),
      onClose: () => resolve(false),
    })
  })
}

/** detail 代际守卫：切换发行版后旧响应不得覆盖新发行版（review 0.1.2 根治） */
let detailGen = 0
let detailOwner = ''

async function loadDetail() {
  const name = props.distroName
  if (!name) return
  const g = ++detailGen
  // 切换发行版：先清旧详情（含采样与最近任务），防新名字下闪现旧值
  if (detailOwner !== name) {
    detailOwner = name
    detail.value = null
    metrics.value = null
    lastTask.value = null
  }
  loading.value = true
  try {
    const d = await window.wslAPI.distros.registryDetail(name)
    if (g !== detailGen) return
    detail.value = d
  } catch {
    if (g === detailGen) detail.value = null
  } finally {
    if (g === detailGen) loading.value = false
  }
  if (g !== detailGen) return
  // 资源 Mini 仪表盘（§12.4）：仅运行中采样
  if (distro.value?.state === 'Running') {
    const m = await metricsStore.sampleDistro(name)
    if (g !== detailGen) return
    metrics.value = m
  } else {
    metrics.value = null
  }
  if (g !== detailGen) return
  // 最近任务（§12.4）：state.jsonc.lastTaskResult
  try {
    const s = await window.wslAPI.config.get('state')
    if (g !== detailGen) return
    lastTask.value = s.lastTaskResult ?? null
  } catch {
    if (g === detailGen) lastTask.value = null
  }
}

/** 关窗守卫在途标记：连点 Esc/遮罩不叠加确认框（review 0.1.2 根治） */
let closeGuardRunning = false

/**
 * 脏守卫（不关窗，返回 true 表示可以通过）：
 * wsl.conf / 文件页有未保存修改时都先确认（两处同语义，绝不静默丢编辑）。
 * onConvert / onUnregister 先走它、通过后再执行并关窗（review 0.1.2 根治：
 * 此前两处直接 emit('update:show', false)，绕过守卫静默丢弃未保存编辑）。
 */
async function requestClose(): Promise<boolean> {
  if (closeGuardRunning) return false
  closeGuardRunning = true
  try {
    // 面板可能是 stub/未挂载（方法缺失）：缺方法按「无脏编辑」处理，而不是抛 TypeError
    const confFn = confPanel.value?.confirmDiscard
    const confOk = typeof confFn === 'function' ? await confFn() : true
    if (!confOk) return false
    const fileFn = filePanel.value?.confirmDiscard
    const fileOk = typeof fileFn === 'function' ? await fileFn() : true
    if (!fileOk) return false
    return true
  } finally {
    closeGuardRunning = false
  }
}

/** 弹窗自身关闭路径（Esc / 遮罩 / 右上角 ×）：守卫通过才真正收起 */
async function onModalClose() {
  if (await requestClose()) emit('update:show', false)
}

/**
 * 打开 / 切换发行版统一入口（review 0.1.2 根治）：
 * - 仅「关闭 → 打开」沿复位页签为概览；同一弹窗内 distroName 变化
 *   （含 restore-distro 回切）保持当前页签
 * - 打开与换发行版都复位编辑态，杜绝用新名字写回旧值
 */
let wasOpen = false
watch(
  () => [props.show, props.distroName] as const,
  ([show]) => {
    if (show) {
      if (!wasOpen) activeTab.value = 'overview'
      resetEditing()
      void loadDetail()
    }
    wasOpen = show
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
  // 双击/重复点击防抖：busy 集合在 store 中同步占位（review 0.1.2 根治）
  if (distros.isBusy(props.distroName, 'start')) return
  void act(() => distros.start(props.distroName), `已启动 ${props.distroName}`)
}
function onTerminate() {
  if (distros.isBusy(props.distroName, 'terminate')) return
  void act(() => distros.terminate(props.distroName), `已停止 ${props.distroName}`)
}
function onSetDefault() {
  if (distros.isBusy(props.distroName, 'setDefault')) return
  void act(() => distros.setDefault(props.distroName), `已设 ${props.distroName} 为默认`)
}

/** WSL1 ↔ WSL2 转换（wsl --set-version，长任务；运行中必须先停止） */
async function onConvert() {
  const d = distro.value
  if (!d || converting.value) return
  // wsl --set-version 要求发行版处于已停止状态：先拦截，别让用户等长任务失败
  if (d.state === 'Running') {
    message.warning(`请先停止 ${props.distroName}，再进行 WSL 版本转换`)
    return
  }
  const target: 1 | 2 = d.version === 1 ? 2 : 1
  converting.value = true
  try {
    // 关窗前先过脏守卫：配置/文件页未保存编辑不得静默丢弃（review 0.1.2 根治）
    if (!(await requestClose())) return
    if (settings.confirmDestructive) {
      const ok = await confirmDangerous({
        title: `转换为 WSL${target}`,
        content:
          `将 ${props.distroName} 转换为 WSL${target}？\n\n` +
          `该操作耗时较长（虚拟磁盘转换），且要求发行版处于已停止状态。`,
      })
      if (!ok) return
    }
    const entry = await tasks.startConvert(props.distroName, target)
    if (!entry) {
      message.error(errorLine(tasks.lastError, '转换任务启动失败'))
      return
    }
    message.success(`已开始转换 ${props.distroName} → WSL${target}，进度见底部状态栏`)
    emit('update:show', false)
  } catch (e) {
    message.error(errorLine(e, '启动版本转换失败'))
  } finally {
    converting.value = false
  }
}

async function onUnregister() {
  if (!distro.value || unregistering.value) return
  unregistering.value = true
  try {
    // 先过脏守卫，再走破坏性确认；两步都通过才执行并关窗（review 0.1.2 根治）
    if (!(await requestClose())) return
    // 破坏性操作：confirmDestructive 开启时必须显式确认（§13.4）
    if (settings.confirmDestructive) {
      const ok = await confirmDangerous({
        title: '注销发行版',
        content: `注销（删除）发行版 ${props.distroName}？\n\n该发行版内的全部数据将被永久删除且不可恢复。`,
      })
      if (!ok) return
    }
    await window.wslAPI.distros.unregister(props.distroName)
    message.success(`已注销 ${props.distroName}`)
    await distros.refresh()
    emit('update:show', false)
  } catch (e) {
    message.error(errorLine(e, '注销失败'))
  } finally {
    unregistering.value = false
  }
}

/** 打开编辑表单：用 meta:get 读回「当前」元数据预填，避免列表快照过期后整表写回覆盖；读失败退回快照并如实提示 */
async function startEdit() {
  let m: DistroMeta | null = distro.value?.meta ?? null
  try {
    const fresh = await window.wslAPI.meta.get(props.distroName)
    if (fresh) m = fresh
  } catch (e) {
    message.warning(
      `元数据读取失败，已按列表缓存预填，请核对后再保存 — ${errorLine(e, '读取元数据失败')}`,
    )
  }
  editAlias.value = m?.alias ?? ''
  editNote.value = m?.note ?? ''
  editTags.value = (m?.tags ?? []).join(', ')
  editIcon.value = m?.icon ?? ''
  editColor.value = m?.color ?? ''
  editStartupCwd.value = m?.startupCwd ?? '~'
  editPinned.value = !!m?.pinned
  editQuickActions.value = [...(m?.quickActions ?? [])]
  editing.value = true
  if (!actionsStore.loaded) void actionsStore.load()
}

async function saveMeta() {
  try {
    await window.wslAPI.meta.set({
      name: props.distroName,
      alias: editAlias.value.trim(),
      tags: editTags.value
        .split(/[,，]/)
        .map((t) => t.trim())
        .filter(Boolean),
      color: editColor.value.trim(),
      icon: editIcon.value.trim(),
      note: editNote.value.trim(),
      startupCwd: editStartupCwd.value.trim() || '~',
      pinned: editPinned.value,
      quickActions: [...editQuickActions.value],
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
    :style="{ width: '760px', maxWidth: '94vw', maxHeight: '90vh' }"
    :content-style="{ overflow: 'auto' }"
    @update:show="(v: boolean) => (v ? emit('update:show', true) : onModalClose())"
  >
    <!-- config pane 的 display-directive=show（naive 按 pane 读取）：
         切页签不卸载 wsl.conf 面板，否则脏编辑随页签切换静默丢失 -->
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
          最近任务：{{ taskTypeLabel(lastTask.type) }} · {{ lastTask.distro || '—' }} ·
          {{ taskStatusLabel(lastTask.status) }} ·
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
          <div class="field">
            <div class="label">图标名</div>
            <NInput v-model:value="editIcon" size="small" placeholder="ubuntu / debian / …" />
          </div>
          <div class="field">
            <div class="label">品牌色</div>
            <NInput v-model:value="editColor" size="small" placeholder="#E95420" />
          </div>
          <div class="field">
            <div class="label">终端启动目录</div>
            <NInput
              v-model:value="editStartupCwd"
              size="small"
              placeholder="~ 或 /home/me/project"
            />
          </div>
          <div class="field">
            <div class="label">快捷动作（动作卡片上的直达项）</div>
            <NSelect
              v-model:value="editQuickActions"
              size="small"
              multiple
              :options="quickActionOptions"
              placeholder="选择动作 id"
            />
          </div>
          <div class="field field-row">
            <div>
              <div class="label">置顶</div>
              <div class="hint">置顶后固定排在列表最前</div>
            </div>
            <NSwitch v-model:value="editPinned" size="small" />
          </div>
          <div class="edit-actions">
            <n-button size="small" @click="editing = false"> 取消 </n-button>
            <n-button size="small" type="primary" @click="saveMeta"> 保存元数据 </n-button>
          </div>
        </div>

        <p v-if="!distro" class="empty-distro">该发行版信息不可用（可能已被注销），操作已停用</p>

        <div class="actions">
          <!-- 终端只服务运行中发行版：启动只能走「启动」按钮（review 状态门禁） -->
          <n-button
            secondary
            :disabled="!isRunning"
            :title="isRunning ? '' : '发行版未运行，请先启动'"
            @click="emit('openTerminal', distroName)"
          >
            打开终端
          </n-button>
          <n-button
            v-if="distro && !isRunning"
            type="primary"
            :loading="distros.isBusy(distroName, 'start')"
            @click="onStart"
          >
            启动
          </n-button>
          <n-button
            v-else-if="distro"
            type="error"
            :loading="distros.isBusy(distroName, 'terminate')"
            @click="onTerminate"
          >
            停止
          </n-button>
          <n-button
            secondary
            :disabled="!distro || distro.isDefault || distros.isBusy(distroName, 'setDefault')"
            @click="onSetDefault"
          >
            设为默认
          </n-button>
          <n-button secondary :disabled="!distro" @click="startEdit"> 编辑元数据 </n-button>
          <!-- wsl --set-version 要求已停止：运行中禁用并在点击路径拦截；converting 防双击 -->
          <n-button
            secondary
            :disabled="!distro || distro.state === 'Running' || converting"
            :loading="converting"
            @click="onConvert"
          >
            转换为 WSL{{ distro && distro.version === 1 ? '2' : '1' }}
          </n-button>
          <!-- 危险操作：图标 + 文字双编码（§11.4 不仅靠颜色区分）；unregistering 防双击 -->
          <n-button
            quaternary
            type="error"
            :disabled="!distro || unregistering"
            :loading="unregistering"
            @click="onUnregister"
          >
            ⚠ 注销发行版
          </n-button>
        </div>
      </n-tab-pane>

      <!-- 配置（wsl.conf） -->
      <n-tab-pane name="config" tab="配置" display-directive="show">
        <WslConfPanel
          ref="confPanel"
          :distro-name="distroName"
          @restore-distro="(name: string) => emit('update:distroName', name)"
        />
      </n-tab-pane>

      <!-- 动作 -->
      <n-tab-pane name="actions" tab="动作">
        <ActionsPanel :distro-name="distroName" />
      </n-tab-pane>

      <!-- 文件 -->
      <n-tab-pane name="files" tab="文件">
        <FileBrowserPanel
          ref="filePanel"
          :distro-name="distroName"
          @restore-distro="(name: string) => emit('update:distroName', name)"
        />
      </n-tab-pane>
    </n-tabs>
  </n-modal>
</template>

<style scoped>
/* 宽度走 n-modal 的 :style（preset="card" 不给 fallthrough class 挂 scoped 属性） */

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

.empty-distro {
  margin: 12px 0 0;
  font-size: 12px;
  color: var(--color-warning);
}

.field-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.hint {
  font-size: 12px;
  color: var(--color-text-tertiary);
}
</style>
