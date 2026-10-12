<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import {
  NButton,
  NCheckbox,
  NDrawer,
  NDrawerContent,
  NRadioGroup,
  NRadioButton,
  NSpin,
  NTag,
  useMessage,
} from 'naive-ui'
import { formatBytes, type BackupFileInfo } from '@wslpilot/shared'
import { ProgressRing, EmptyState } from '@wslpilot/ui'
import { useDistrosStore } from '../stores/distros'
import { useSettingsStore } from '../stores/settings'
import { useTasksStore } from '../stores/tasks'
import {
  useTaskProgress,
  taskStatusLabel,
  taskTypeLabel,
  formatElapsed,
} from '../composables/useTaskProgress'
import { errorLine } from '../composables/useAppError'
import ExportWizard from '../features/backup/ExportWizard.vue'
import ImportWizard from '../features/backup/ImportWizard.vue'
import MoveWizard from '../features/backup/MoveWizard.vue'
import {
  DEFAULT_EXPORT_FORM,
  DEFAULT_IMPORT_FORM,
  DEFAULT_MOVE_FORM,
  buildExportRequest,
  buildImportRequest,
  buildMoveRequest,
  exportCommandPreview,
  exportSummary,
  importCommandPreview,
  importSummary,
  moveCommandPreview,
  moveSummary,
  summaryToText,
  validateExportForm,
  validateImportForm,
  validateMoveForm,
  type ExportForm,
  type ImportForm,
  type MoveForm,
  type WizardMode,
} from '../features/backup/forms'

const distros = useDistrosStore()
const settings = useSettingsStore()
const tasks = useTasksStore()
const message = useMessage()

const mode = ref<WizardMode>('export')
const step = ref<1 | 2 | 3 | 4>(1)
const ackDestructive = ref(false)
const activeTaskId = ref('')
const logOpen = ref(false)
const backups = ref<BackupFileInfo[]>([])
const backupsLoading = ref(false)
/** 备份列表读取失败：与「目录里还没有文件」的空态分开呈现 */
const backupsError = ref('')
/** 启动中锁：双击「开始」会并行拉起两个长任务（review 0.1.2 根治） */
const starting = ref(false)

const exportForm = ref<ExportForm>({ ...DEFAULT_EXPORT_FORM })
const importForm = ref<ImportForm>({ ...DEFAULT_IMPORT_FORM })
const moveForm = ref<MoveForm>({ ...DEFAULT_MOVE_FORM })

function setExportForm(f: ExportForm) {
  exportForm.value = f
}
function setImportForm(f: ImportForm) {
  importForm.value = f
}
function setMoveForm(f: MoveForm) {
  moveForm.value = f
}
function setAck(v: boolean) {
  ackDestructive.value = v
}

/** 目录名（渲染进程无 node:path，字符串截取） */
function parentDir(p: string): string {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  return i > 0 ? p.slice(0, i) : p
}

const {
  task,
  percent,
  percentLabel,
  isRunning,
  isDone,
  cancel: cancelTask,
} = useTaskProgress(activeTaskId)

const elapsedMs = ref(0)
let elapsedTimer: number | undefined

function stopElapsed() {
  if (elapsedTimer !== undefined) {
    window.clearInterval(elapsedTimer)
    elapsedTimer = undefined
  }
}

function tickElapsed() {
  const t = task.value
  if (t) elapsedMs.value = Date.now() - t.startedAt
}

// 秒表仅在「进度步骤 + 任务运行中」时驱动：其余时刻停表，
// 避免每 500ms 一次的无意义重渲染（review 0.1.2 根治）
watch(
  () => isRunning.value && step.value === 4,
  (active) => {
    stopElapsed()
    if (!active) return
    tickElapsed()
    elapsedTimer = window.setInterval(tickElapsed, 500)
  },
  { immediate: true },
)

onUnmounted(stopElapsed)

// 任务终结时刷新最近备份列表：导出的文件立即可见，无需手动点「刷新」
watch(isDone, (done) => {
  if (done) void refreshBackups()
})

const modeOptions: { label: string; value: WizardMode }[] = [
  { label: '导出备份', value: 'export' },
  { label: '导入恢复', value: 'import' },
  { label: '迁移磁盘', value: 'move' },
]

const stepLabels = computed(() => {
  const first = mode.value === 'import' ? '名称与方式' : '选择发行版'
  const second = mode.value === 'import' ? '文件与位置' : '位置与格式'
  return [first, second, '确认', '执行进度']
})

const canNext = computed(() => {
  if (step.value === 1) {
    if (mode.value === 'export') return !!exportForm.value.name
    if (mode.value === 'move') return !!moveForm.value.name
    // 导入：名称非空且不与现有发行版重名（重名在第 2 步也会被 validateCurrent 拦）
    const n = importForm.value.name.trim()
    return !!n && !distros.items.some((d) => d.name === n)
  }
  if (step.value === 2) return validateCurrent() === null
  return true
})

const needAck = computed(() => mode.value === 'move' && settings.confirmDestructive)

/** 路径规范化：Windows 路径大小写不敏感，尾部分隔符忽略 */
function normalizePath(p: string): string {
  return p
    .trim()
    .replace(/[\\/]+$/, '')
    .toLowerCase()
}

function validateCurrent(): string | null {
  if (mode.value === 'export') return validateExportForm(exportForm.value)
  if (mode.value === 'import') {
    // 重名硬拦截：否则 wsl --import 会在长任务里才报同名冲突（review M-11）
    return validateImportForm(
      importForm.value,
      distros.items.map((d) => d.name),
    )
  }
  const moveErr = validateMoveForm(moveForm.value)
  if (moveErr) return moveErr
  // 目标 = 当前位置：MoveWizard 内已提示，这里硬拦截「下一步/开始」
  //（basePath 不可得时跳过，不误拦 — review 0.1.2 根治）
  const selected = distros.items.find((d) => d.name === moveForm.value.name)
  const base = selected?.basePath ?? ''
  if (
    base &&
    moveForm.value.path.trim() &&
    normalizePath(base) === normalizePath(moveForm.value.path)
  ) {
    return '目标位置与发行版当前位置相同，请选择新的目录'
  }
  return null
}

const summaryRows = computed(() => {
  if (mode.value === 'export') return exportSummary(exportForm.value)
  if (mode.value === 'import') return importSummary(importForm.value)
  const selected = distros.items.find((d) => d.name === moveForm.value.name)
  return moveSummary(moveForm.value, {
    willTerminate: selected?.state === 'Running',
    autoBackup: settings.backupAutoBeforeDestructive,
  })
})

const commandPreview = computed(() => {
  if (mode.value === 'export') return exportCommandPreview(exportForm.value)
  if (mode.value === 'import') return importCommandPreview(importForm.value)
  return moveCommandPreview(moveForm.value)
})

async function copySummary() {
  try {
    await navigator.clipboard.writeText(summaryToText(summaryRows.value))
    message.success('摘要已复制')
  } catch {
    message.warning('复制失败，请手动选择文本')
  }
}

function setMode(m: WizardMode) {
  if (step.value === 4 && isRunning.value) {
    message.warning('任务进行中，请先等待完成或取消')
    return
  }
  mode.value = m
  step.value = 1
  ackDestructive.value = false
}

function next() {
  if (step.value === 2) {
    const err = validateCurrent()
    if (err) {
      message.warning(err)
      return
    }
  }
  if (step.value < 4) step.value = (step.value + 1) as 1 | 2 | 3 | 4
}

function back() {
  if (step.value > 1 && step.value < 4) step.value = (step.value - 1) as 1 | 2 | 3 | 4
}

function reset() {
  step.value = 1
  ackDestructive.value = false
  activeTaskId.value = ''
  // 保留设置中的默认格式：reset 不得把「默认 vhd」悄悄打回 tar（review 0.1.2 根治）
  exportForm.value = { ...DEFAULT_EXPORT_FORM, format: settings.backupFormat }
  importForm.value = { ...DEFAULT_IMPORT_FORM, format: settings.backupFormat }
  moveForm.value = { ...DEFAULT_MOVE_FORM }
}

async function start() {
  // 启动锁：双击会在两条 await 链上各拉起一个长任务（review 0.1.2 根治）
  if (starting.value) return
  const err = validateCurrent()
  if (err) {
    message.warning(err)
    return
  }
  if (needAck.value && !ackDestructive.value) {
    message.warning('请勾选「我已知晓」后再执行迁移')
    return
  }

  starting.value = true
  try {
    let entry = null
    if (mode.value === 'export') {
      entry = await tasks.startExport(buildExportRequest(exportForm.value))
    } else if (mode.value === 'import') {
      entry = await tasks.startImport(buildImportRequest(importForm.value))
    } else {
      entry = await tasks.startMove(buildMoveRequest(moveForm.value))
    }

    if (!entry) {
      message.error(errorLine(tasks.lastError, '任务启动失败'))
      return
    }
    activeTaskId.value = entry.taskId
    step.value = 4
  } finally {
    starting.value = false
  }
}

async function cancel() {
  try {
    await cancelTask()
    message.info('已请求取消任务')
  } catch (e) {
    message.error(errorLine(e, '取消失败'))
  }
}

async function openResultDir() {
  // 迁移的目标 path 本身就是目录（发行版被搬到那里）；导出/导入才看父目录
  const target =
    mode.value === 'move'
      ? moveForm.value.path || settings.backupDefaultDir
      : mode.value === 'export'
        ? parentDir(exportForm.value.path || settings.backupDefaultDir)
        : parentDir(importForm.value.installPath || settings.backupDefaultDir)
  try {
    await window.wslAPI.app.openPath(target || settings.backupDefaultDir)
  } catch {
    message.error('无法打开目录')
  }
}

async function refreshBackups() {
  backupsLoading.value = true
  try {
    backups.value = await window.wslAPI.io.listBackups(settings.backupDefaultDir || undefined)
    backupsError.value = ''
  } catch (e) {
    // 失败 ≠ 空目录：独立错误态，绝不伪装成「还没有文件」
    backups.value = []
    backupsError.value = errorLine(e, '读取备份列表失败')
  } finally {
    backupsLoading.value = false
  }
}

onMounted(() => {
  // 默认格式跟随设置（§12.7 备份默认值）——导入同样跟随，
  // 否则「默认格式」设置只对导出半生效（review 幽灵配置根治）
  exportForm.value = { ...DEFAULT_EXPORT_FORM, format: settings.backupFormat }
  importForm.value = { ...DEFAULT_IMPORT_FORM, format: settings.backupFormat }
  void distros.refresh()
  void refreshBackups()

  // 本页发起的长任务仍在运行（切页回来 / 窗口重载）：接续到进度视图，
  // 不要求用户重新走一遍向导（review 0.1.2 根治）
  const running = [...tasks.entries]
    .filter(
      (e) =>
        e.status === 'running' && (e.type === 'export' || e.type === 'import' || e.type === 'move'),
    )
    .sort((a, b) => b.startedAt - a.startedAt)[0]
  if (running) {
    mode.value = running.type as WizardMode
    activeTaskId.value = running.taskId
    step.value = 4
  }
})

/** 日志抽屉只渲染尾部：全量 join 2000 行会在每次进度事件时重排（review 0.1.2 根治） */
const LOG_TAIL_LIMIT = 500
const logLines = computed(() => task.value?.logs ?? [])
const logTail = computed(() => {
  const lines = logLines.value
  return lines.length > LOG_TAIL_LIMIT ? lines.slice(-LOG_TAIL_LIMIT) : lines
})
const logTruncated = computed(() => logLines.value.length > LOG_TAIL_LIMIT)

const statusType = computed(() => {
  const s = task.value?.status
  if (s === 'success') return 'success'
  if (s === 'failed') return 'error'
  return 'warning'
})

const typeLabel = computed(() => taskTypeLabel(task.value?.type ?? mode.value))
</script>

<template>
  <div class="page">
    <header class="page-header">
      <div>
        <h1>备份与迁移</h1>
        <p class="sub">
          导出 / 导入 / 迁移向导 · 长任务带进度、日志与取消 ·
          <code>wsl --export / --import / --manage --move</code>
        </p>
      </div>
    </header>

    <div class="mode-tabs">
      <n-radio-group :value="mode" @update:value="(v: WizardMode) => setMode(v)">
        <n-radio-button v-for="m in modeOptions" :key="m.value" :value="m.value">
          {{ m.label }}
        </n-radio-button>
      </n-radio-group>
    </div>

    <section class="card wizard-card">
      <!-- 步骤条（当前步 aria-current="step" — review 0.1.2 a11y） -->
      <ol class="steps">
        <li
          v-for="(label, i) in stepLabels"
          :key="label"
          class="step-item"
          :class="{ active: step === i + 1, done: step > i + 1 }"
          :aria-current="step === i + 1 ? 'step' : undefined"
        >
          <span class="dot">{{ i + 1 }}</span>
          <span class="step-label">{{ label }}</span>
        </li>
      </ol>

      <!-- 步骤 1-2：向导表单 -->
      <template v-if="step === 1 || step === 2">
        <ExportWizard
          v-if="mode === 'export'"
          :step="step"
          :form="exportForm"
          :distros="distros.items"
          :default-dir="settings.backupDefaultDir"
          :keep-recent="settings.backupKeepRecent"
          @update:form="setExportForm"
        />
        <ImportWizard
          v-else-if="mode === 'import'"
          :step="step"
          :form="importForm"
          :distros="distros.items"
          :default-dir="settings.backupDefaultDir"
          @update:form="setImportForm"
        />
        <MoveWizard
          v-else
          :step="step"
          :form="moveForm"
          :distros="distros.items"
          :auto-backup="settings.backupAutoBeforeDestructive"
          @update:form="setMoveForm"
        />
      </template>

      <!-- 步骤 3：确认 -->
      <div v-else-if="step === 3" class="confirm">
        <div class="summary">
          <div class="summary-head">
            <span class="summary-title">确认信息</span>
            <n-button size="tiny" quaternary @click="copySummary">复制摘要</n-button>
          </div>
          <div v-for="row in summaryRows" :key="row.label" class="summary-row">
            <span class="summary-label">{{ row.label }}</span>
            <span class="summary-value">{{ row.value }}</span>
          </div>
        </div>

        <div v-if="settings.showRawCommand" class="raw">
          <div class="raw-label">等价命令行（仅展示）</div>
          <code>{{ commandPreview }}</code>
        </div>

        <label v-if="needAck" class="ack">
          <n-checkbox :checked="ackDestructive" @update:checked="setAck" />
          <span>我已知晓迁移会移动发行版磁盘位置；失败时可再次迁移回原位置或使用自动备份</span>
        </label>
      </div>

      <!-- 步骤 4：执行进度 -->
      <div v-else class="progress">
        <ProgressRing :percent="percent" :size="180" :stroke="14" :sublabel="typeLabel" />
        <div class="progress-text">
          <div class="progress-msg">
            {{ task?.message || '准备中…' }}
          </div>
          <div class="progress-meta">
            <NTag size="small" :bordered="false" :type="statusType">
              {{ taskStatusLabel(task?.status ?? 'running') }}
            </NTag>
            <span>{{ percentLabel }}</span>
            <span>{{ formatElapsed(elapsedMs) }}</span>
          </div>
          <div v-if="task?.error" class="progress-error">
            {{ task.error }}
          </div>
          <div class="progress-actions">
            <n-button v-if="isRunning" secondary type="error" @click="cancel"> 取消任务 </n-button>
            <n-button secondary @click="logOpen = true">
              查看日志（{{ task?.logs.length ?? 0 }} 行）
            </n-button>
            <template v-if="isDone">
              <n-button type="primary" @click="reset"> 再来一次 </n-button>
              <n-button v-if="task?.status === 'success'" secondary @click="openResultDir">
                打开所在目录
              </n-button>
            </template>
          </div>
        </div>
      </div>

      <!-- 底部导航 -->
      <footer v-if="step < 4" class="wizard-footer">
        <n-button v-if="step > 1" secondary @click="back"> 上一步 </n-button>
        <span class="spacer" />
        <n-button v-if="step < 3" type="primary" :disabled="!canNext" @click="next">
          下一步
        </n-button>
        <n-button
          v-else
          type="primary"
          :loading="starting"
          :disabled="starting || (needAck && !ackDestructive)"
          @click="start"
        >
          开始{{ modeOptions.find((m) => m.value === mode)?.label }}
        </n-button>
      </footer>
    </section>

    <!-- 最近备份 -->
    <section class="card backups">
      <div class="backups-head">
        <h2 class="panel-title">最近备份</h2>
        <n-button text type="primary" @click="refreshBackups"> 刷新 </n-button>
      </div>
      <n-spin :show="backupsLoading">
        <p v-if="backupsError" class="backups-error" role="alert">
          {{ backupsError }}
          <n-button size="tiny" quaternary type="primary" @click="refreshBackups">重试</n-button>
        </p>
        <EmptyState
          v-else-if="backups.length === 0"
          description="备份目录里还没有文件"
          illustration="💾"
        />
        <table v-else class="table">
          <thead>
            <tr>
              <th>文件</th>
              <th>格式</th>
              <th>大小</th>
              <th>修改时间</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="b in backups" :key="b.path">
              <td class="file-cell">
                {{ b.name }}
              </td>
              <td>
                <n-tag size="tiny" :bordered="false">
                  {{ b.format }}
                </n-tag>
              </td>
              <td>{{ formatBytes(b.sizeBytes) }}</td>
              <td>{{ new Date(b.modifiedAt).toLocaleString('zh-CN') }}</td>
            </tr>
          </tbody>
        </table>
      </n-spin>
    </section>

    <!-- 实时日志抽屉（只渲染尾部 ≤500 行，防高频全量重排） -->
    <n-drawer v-model:show="logOpen" :width="480" placement="right">
      <n-drawer-content title="任务日志" closable>
        <p v-if="logTruncated" class="log-note">
          仅显示最后 {{ LOG_TAIL_LIMIT }} 行（共 {{ logLines.length }} 行）
        </p>
        <pre class="log">{{ logTail.join('\n') || '（暂无日志）' }}</pre>
      </n-drawer-content>
    </n-drawer>
  </div>
</template>

<style scoped>
.page {
  padding: 24px;
  max-width: 1000px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.page-header h1 {
  font-size: 24px;
  font-weight: 650;
  color: var(--color-text-primary);
  margin: 0;
}

.sub {
  margin: 4px 0 0;
  color: var(--color-text-secondary);
  font-size: 13px;
}

.sub code {
  background: var(--color-bg-sunken);
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 11px;
}

.mode-tabs {
  display: flex;
  gap: 10px;
}

.wizard-card {
  padding: 22px 24px;
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.steps {
  display: flex;
  gap: 8px;
  list-style: none;
  margin: 0;
  padding: 0;
}

.step-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  border-radius: 999px;
  background: var(--color-bg-sunken);
  color: var(--color-text-tertiary);
  font-size: 12px;
}

.step-item.active {
  background: var(--color-accent-soft);
  color: var(--color-accent);
  font-weight: 600;
}

.step-item.done {
  color: var(--color-success);
}

.step-item .dot {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--color-bg-surface);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 650;
}

.confirm {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.summary {
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.summary-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 14px;
  background: var(--color-bg-sunken);
}

.summary-title {
  font-size: 12px;
  font-weight: 650;
  color: var(--color-text-secondary);
}

.summary-row {
  display: flex;
  padding: 10px 14px;
  font-size: 13px;
  gap: 16px;
}

.summary-row + .summary-row {
  border-top: 1px solid var(--color-border-subtle);
}

.summary-label {
  width: 140px;
  flex-shrink: 0;
  color: var(--color-text-secondary);
}

.summary-value {
  color: var(--color-text-primary);
  word-break: break-all;
}

.raw {
  background: var(--color-bg-sunken);
  border-radius: var(--radius-md);
  padding: 12px 14px;
}

.raw-label {
  font-size: 12px;
  color: var(--color-text-secondary);
  margin-bottom: 6px;
}

.raw code {
  font-size: 12px;
  color: var(--color-text-primary);
  word-break: break-all;
  line-height: 1.6;
}

.ack {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  font-size: 13px;
  color: var(--color-text-secondary);
  cursor: pointer;
}

.progress {
  display: flex;
  gap: 28px;
  align-items: center;
  padding: 12px 0;
}

.progress-text {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}

.progress-msg {
  font-size: 15px;
  font-weight: 600;
  color: var(--color-text-primary);
}

.progress-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 13px;
  color: var(--color-text-secondary);
  font-variant-numeric: tabular-nums;
}

/* review 0.1.2 审计修复：硬编码 10px 与 ui 包 radius-md 令牌（12px）不一致，统一令牌化 */
.progress-error {
  padding: 10px 12px;
  border-radius: var(--radius-md, 12px);
  background: color-mix(in srgb, var(--color-danger) 10%, transparent);
  color: var(--color-danger);
  font-size: 12.5px;
  line-height: 1.6;
}

.progress-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.wizard-footer {
  display: flex;
  align-items: center;
  gap: 10px;
  border-top: 1px solid var(--color-border-subtle);
  padding-top: 16px;
}

.spacer {
  flex: 1;
}

.backups {
  padding: 18px 22px;
}

.backups-error {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0;
  padding: 10px 14px;
  border-radius: var(--radius-md, 12px);
  background: color-mix(in srgb, var(--color-danger) 10%, transparent);
  color: var(--color-danger);
  font-size: 12.5px;
}

.backups-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.panel-title {
  font-size: 15px;
  font-weight: 600;
  margin: 0;
  color: var(--color-text-primary);
}

.table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12.5px;
}

.table th {
  text-align: left;
  padding: 8px 10px;
  color: var(--color-text-secondary);
  font-weight: 600;
  background: var(--color-bg-sunken);
}

.table td {
  padding: 8px 10px;
  border-top: 1px solid var(--color-border-subtle);
  color: var(--color-text-primary);
}

.file-cell {
  font-family: 'Cascadia Mono', Consolas, monospace;
  word-break: break-all;
}

.log-note {
  margin: 0 0 8px;
  font-size: 11.5px;
  color: var(--color-text-tertiary);
}

.log {
  margin: 0;
  font-family: 'Cascadia Mono', Consolas, monospace;
  font-size: 11.5px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-all;
  color: var(--color-text-primary);
}
</style>
