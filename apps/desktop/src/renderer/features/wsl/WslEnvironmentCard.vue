<script setup lang="ts">
/**
 * WSL 环境卡（0.1.3）：
 * - 环境体检：版本 / 内核 / 默认发行版 / 默认版本（非抛出语义，未安装时给一键安装）
 * - 更新 WSL（wsl --update，含预发布通道与回滚入口）
 * - 设置默认 WSL 版本（wsl --set-default-version；仅影响新导入的发行版）
 */
import { computed, onMounted, ref, watch } from 'vue'
import { NButton, NPopover, NSelect, useDialog, useMessage } from 'naive-ui'
import type { WslEnvInfo } from '@wslpilot/shared'
import { useTasksStore } from '../../stores/tasks'
import { errorLine } from '../../composables/useAppError'

const message = useMessage()
const dialog = useDialog()
const tasks = useTasksStore()

const env = ref<WslEnvInfo | null>(null)
const loading = ref(false)
const installTaskId = ref('')
const updateTaskId = ref('')

async function load() {
  loading.value = true
  try {
    env.value = await window.wslAPI.app.wslEnv()
  } catch (e) {
    env.value = null
    message.error(errorLine(e, '读取 WSL 环境失败'))
  } finally {
    loading.value = false
  }
}

onMounted(load)

/** WSL 本体级任务进行中（更新 / 回滚 / 安装本体）：动作按钮统一禁用 */
const globalBusy = computed(() =>
  tasks.entries.some(
    (t) => t.status === 'running' && (t.type === 'update' || (t.type === 'install' && !t.distro)),
  ),
)

const updateBusy = computed(
  () => tasks.byId(updateTaskId.value)?.status === 'running' || globalBusy.value,
)

function watchTask(idRef: typeof installTaskId, onDone: (ok: boolean, text: string) => void) {
  const stop = watch(
    () => tasks.byId(idRef.value)?.status,
    (status, prev) => {
      if (!status || status === 'running' || status === prev) return
      const entry = tasks.byId(idRef.value)
      const ok = status === 'success'
      onDone(ok, ok ? (entry?.message ?? '任务完成') : (entry?.error ?? '任务失败'))
      stop()
    },
  )
}

/** 一键安装 WSL 本体（未安装场景的引导入口） */
async function installWsl() {
  const entry = await tasks.startInstall(undefined)
  if (!entry) {
    message.error(errorLine(tasks.lastError, '启动安装失败'))
    return
  }
  installTaskId.value = entry.taskId
  message.info('已开始安装 WSL，进度见状态栏与任务抽屉（可能触发 UAC 授权）')
  watchTask(installTaskId, (ok, text) => {
    if (ok) {
      message.success(`WSL 安装任务完成：${text}`)
      void load()
    } else {
      message.error(`WSL 安装失败：${text}`)
    }
  })
}

/** 更新 WSL（preRelease = 预发布通道） */
async function updateWsl(preRelease = false) {
  const entry = await tasks.startUpdate({ preRelease })
  if (!entry) {
    message.error(errorLine(tasks.lastError, '启动更新失败'))
    return
  }
  updateTaskId.value = entry.taskId
  message.info(preRelease ? '已开始通过预发布通道更新 WSL' : '已开始更新 WSL，进度见状态栏')
  watchTask(updateTaskId, (ok, text) => {
    if (ok) {
      message.success(text)
      void load()
    } else {
      message.error(`WSL 更新失败：${text}`)
    }
  })
}

/** 回滚最近一次 WSL 更新（危险操作：显式确认） */
function rollback() {
  dialog.warning({
    title: '回滚 WSL 更新',
    content:
      '将执行 wsl --update --rollback，把 WSL 回退到上一次更新前的版本。\n\n' +
      '回滚期间 WSL 会短暂不可用；如回滚后仍异常，可再次执行更新。确定继续吗？',
    positiveText: '回滚',
    negativeText: '取消',
    onPositiveClick: () => {
      void (async () => {
        const entry = await tasks.startUpdateRollback()
        if (!entry) {
          message.error(errorLine(tasks.lastError, '启动回滚失败'))
          return
        }
        updateTaskId.value = entry.taskId
        message.info('已开始回滚 WSL 更新')
        watchTask(updateTaskId, (ok, text) => {
          if (ok) {
            message.success(text)
            void load()
          } else {
            message.error(`WSL 回滚失败：${text}`)
          }
        })
      })()
    },
  })
}

/** 设置默认 WSL 版本（仅影响新导入的发行版） */
const defaultVersionBusy = ref(false)
async function onDefaultVersionChange(version: 1 | 2) {
  if (!env.value || version === env.value.defaultVersion) return
  const prev = env.value.defaultVersion
  defaultVersionBusy.value = true
  try {
    await window.wslAPI.app.wslSetDefaultVersion(version)
    if (env.value) env.value.defaultVersion = version
    message.success(`默认 WSL 版本已设为 WSL${version}（仅影响新导入的发行版）`)
  } catch (e) {
    if (env.value) env.value.defaultVersion = prev
    message.error(errorLine(e, '设置默认版本失败'))
  } finally {
    defaultVersionBusy.value = false
  }
}

/** 未安装详情（原始输出摘要；折叠在 details 中） */
const installDetail = computed(() => {
  const raw = env.value?.statusRaw?.trim() ?? ''
  return raw.length > 400 ? `${raw.slice(0, 400)}…` : raw
})
</script>

<template>
  <div class="wsl-env">
    <!-- 未安装：引导一键安装（与错误目录建议文案同一动作） -->
    <div v-if="env && !env.installed" class="missing" role="alert">
      <div class="missing-title">未检测到 WSL</div>
      <p class="hint">
        一键安装将执行 <code>wsl --install</code>（可能触发 UAC 授权；部分系统需要重启 Windows
        后才能使用）。安装完成后这里会自动刷新。
      </p>
      <div class="actions">
        <n-button
          type="primary"
          size="small"
          :loading="globalBusy"
          :disabled="globalBusy"
          @click="installWsl"
        >
          一键安装 WSL
        </n-button>
      </div>
      <details v-if="installDetail" class="detail">
        <summary>查看原始输出</summary>
        <pre>{{ installDetail }}</pre>
      </details>
    </div>

    <!-- 已安装：版本 / 内核 / 默认项 + 更新入口 -->
    <template v-else-if="env">
      <div class="rows">
        <div class="row">
          <span class="label">WSL 版本</span>
          <span class="value">{{ env.wslVersion || '（无法获取）' }}</span>
        </div>
        <div class="row">
          <span class="label">内核版本</span>
          <span class="value">{{ env.kernelVersion || '（无法获取）' }}</span>
        </div>
        <div class="row">
          <span class="label">默认发行版</span>
          <span class="value">{{ env.defaultDistro || '—' }}</span>
        </div>
        <div class="row">
          <span class="label">默认版本（新导入）</span>
          <span class="value">
            <n-select
              :value="env.defaultVersion"
              size="small"
              style="width: 140px"
              :disabled="defaultVersionBusy || globalBusy"
              :options="[
                { label: 'WSL 2（推荐）', value: 2 },
                { label: 'WSL 1', value: 1 },
              ]"
              :placeholder="'未检测到'"
              @update:value="onDefaultVersionChange"
            />
          </span>
        </div>
      </div>

      <div class="actions">
        <n-button
          type="primary"
          size="small"
          secondary
          :loading="updateBusy"
          :disabled="updateBusy"
          @click="updateWsl(false)"
        >
          更新 WSL
        </n-button>
        <n-popover trigger="click" placement="bottom-start">
          <template #trigger>
            <n-button size="small" quaternary :disabled="updateBusy"> 高级… </n-button>
          </template>
          <div class="advanced">
            <p class="hint">更新命令在线检查可用版本；无更新时版本保持不变（本卡如实展示）。</p>
            <n-button size="small" secondary :disabled="updateBusy" @click="updateWsl(true)">
              通过预发布通道更新（wsl --update --pre-release）
            </n-button>
            <n-button
              size="small"
              secondary
              type="warning"
              :disabled="updateBusy"
              @click="rollback"
            >
              回滚最近一次更新（wsl --update --rollback）
            </n-button>
          </div>
        </n-popover>
        <n-button size="small" quaternary :loading="loading" @click="load">刷新</n-button>
      </div>
    </template>

    <!-- 环境读取失败（服务异常等）：如实展示并可重试 -->
    <div v-else class="missing">
      <div class="missing-title">无法读取 WSL 环境信息</div>
      <div class="actions">
        <n-button size="small" :loading="loading" @click="load">重试</n-button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.wsl-env {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.rows {
  display: flex;
  flex-direction: column;
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.row {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 8px 12px;
  font-size: 12.5px;
}

.row + .row {
  border-top: 1px solid var(--color-border-subtle);
}

.label {
  width: 150px;
  flex-shrink: 0;
  color: var(--color-text-secondary);
}

.value {
  color: var(--color-text-primary);
  font-family: var(--font-mono, monospace);
  font-size: 12px;
  flex: 1;
  word-break: break-all;
}

.hint {
  margin: 0;
  font-size: 11.5px;
  color: var(--color-text-tertiary);
  line-height: 1.7;
}

.hint code {
  background: var(--color-bg-sunken);
  padding: 1px 5px;
  border-radius: 4px;
}

.missing {
  border: 1px solid color-mix(in srgb, var(--color-warning) 40%, transparent);
  border-radius: var(--radius-md);
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: color-mix(in srgb, var(--color-warning) 6%, transparent);
}

.missing-title {
  font-size: 13px;
  font-weight: 650;
  color: var(--color-text-primary);
}

.actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  align-items: center;
}

.detail summary {
  cursor: pointer;
  font-size: 11.5px;
  color: var(--color-text-secondary);
}

.detail pre {
  margin: 6px 0 0;
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--color-bg-sunken);
  font-size: 11px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 160px;
  overflow: auto;
  color: var(--color-text-secondary);
}

.advanced {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 340px;
}
</style>
