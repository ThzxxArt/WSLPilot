<script setup lang="ts">
/**
 * WSL 环境卡（0.1.4）：
 * - 环境体检：版本 / 内核 / 默认发行版 / 默认版本（非抛出语义，未安装时给一键安装）
 * - 更新 WSL（wsl --update，含预发布通道；3.0 已无 --rollback，改为版本历史外链）
 * - 设置默认 WSL 版本（wsl --set-default-version；仅影响新导入的发行版）
 * - 能力矩阵：compact/resize/default-user/安装落点/tar.gz 等是否可用
 */
import { computed, onMounted, ref, watch } from 'vue'
import { NButton, NPopover, NSelect, useMessage } from 'naive-ui'
import type { WslEnvInfo } from '@wslpilot/shared'
import { WSL_FEATURE_META } from '@wslpilot/shared'
import { useTasksStore } from '../../stores/tasks'
import { useWslEnvStore } from '../../stores/wsl-env'
import { errorLine } from '../../composables/useAppError'

const message = useMessage()
const tasks = useTasksStore()
const wslEnv = useWslEnvStore()

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

onMounted(() => {
  void load()
  // 卡片与安装向导/详情页共用能力 store：只刷新本地 env 会让向导一直“能力未加载”
  void wslEnv.load()
})

/** 手动刷新：本地环境 + 共享能力缓存一起重拉 */
async function refreshAll() {
  await Promise.all([load(), wslEnv.refresh()])
}

/** WSL 本体级任务进行中（更新 / 安装本体）：动作按钮统一禁用 */
const globalBusy = computed(() =>
  tasks.entries.some(
    (t) => t.status === 'running' && (t.type === 'update' || t.type === 'install'),
  ),
)

const updateBusy = computed(
  () => tasks.byId(updateTaskId.value)?.status === 'running' || globalBusy.value,
)

function watchTask(idRef: typeof installTaskId, onDone: (ok: boolean, text: string) => void) {
  let settled = false
  let stop: (() => void) | null = null
  const finish = () => {
    if (settled) return
    settled = true
    stop?.()
  }
  stop = watch(
    () => tasks.byId(idRef.value)?.status,
    (status, prev) => {
      if (!status || status === 'running' || status === prev) return
      const entry = tasks.byId(idRef.value)
      const ok = status === 'success'
      onDone(ok, ok ? (entry?.message ?? '任务完成') : (entry?.error ?? '任务失败'))
      finish()
    },
    // 任务可能在 watch 注册前就已终态（快速失败/成功）：必须立即补一次判断
    { immediate: true },
  )
  if (settled) stop?.()
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
      void wslEnv.refresh()
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
      void wslEnv.refresh()
    } else {
      message.error(`WSL 更新失败：${text}`)
    }
  })
}

/** 打开 WSL 版本历史（0.1.4：回滚开关已不存在，降级只能手动安装旧版 MSI） */
async function openHistory() {
  try {
    await window.wslAPI.app.openExternal('https://github.com/microsoft/WSL/releases')
  } catch (e) {
    message.error(errorLine(e, '无法打开版本历史'))
  }
}

/** 能力矩阵展示（help 探测结果；null 时如实显示“未检测”） */
const capabilityRows = computed(() => {
  const f = env.value?.capabilities?.flags
  if (!f) return []
  // 最低版本只从 WSL_FEATURE_META 读，避免 UI 与能力探测的版本表各写一份
  const row = (flag: keyof typeof f) => ({
    label: WSL_FEATURE_META[flag].label,
    ok: f[flag],
    min: WSL_FEATURE_META[flag].minVersion,
  })
  return [
    row('compact'),
    row('resize'),
    row('setDefaultUser'),
    row('installLocation'),
    row('vhdSize'),
    row('fixedVhd'),
    row('webDownload'),
    row('importFromFile'),
    row('exportFormats'),
    row('updatePreRelease'),
    row('manageSparse'),
  ]
})

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
          更新 / 修复 WSL
        </n-button>
        <n-popover trigger="click" placement="bottom-start">
          <template #trigger>
            <n-button size="small" quaternary :disabled="updateBusy"> 高级… </n-button>
          </template>
          <div class="advanced">
            <p class="hint">更新命令在线检查可用版本；无更新时版本保持不变（本卡如实展示）。</p>
            <n-button
              size="small"
              secondary
              :disabled="updateBusy || !wslEnv.can('updatePreRelease')"
              :title="wslEnv.can('updatePreRelease') ? '' : wslEnv.requirement('updatePreRelease')"
              @click="updateWsl(true)"
            >
              通过预发布通道更新（wsl --update --pre-release）
            </n-button>
            <n-button size="small" quaternary @click="openHistory">
              查看 WSL 版本历史 / 手动安装旧版
            </n-button>
            <p class="hint">
              0.1.4 起不再提供「回滚最近一次更新」：WSL 3.0 已移除
              <code>--rollback</code>，旧参数在 2.7.3+ 也会失败。需要降级时请从上面的版本历史
              下载对应 MSI 覆盖安装。
            </p>
          </div>
        </n-popover>
        <n-button size="small" quaternary :loading="loading" @click="refreshAll">刷新</n-button>
      </div>

      <!-- 能力矩阵（0.1.4）：help 主探测；不支持的项明确标注，不在别处“点了没反应” -->
      <div v-if="env.capabilities" class="caps">
        <div class="caps-head">
          <span>发行版能力</span>
          <span class="caps-meta">
            WSL {{ env.capabilities.wslVersion || 'inbox' }}
            <template v-if="env.capabilities.wslcVersion">
              · wslc {{ env.capabilities.wslcVersion }}
            </template>
            · Build {{ env.capabilities.windowsBuild || '—' }}
          </span>
        </div>
        <div class="caps-grid">
          <span
            v-for="cap in capabilityRows"
            :key="cap.label"
            class="cap"
            :class="{ off: !cap.ok }"
            :title="cap.ok ? '当前 WSL 支持' : `需要 WSL ${cap.min}+`"
          >
            {{ cap.ok ? '✓' : '×' }} {{ cap.label }}
          </span>
        </div>
      </div>
    </template>

    <!-- 环境读取失败（服务异常等）：如实展示并可重试 -->
    <div v-else class="missing">
      <div class="missing-title">无法读取 WSL 环境信息</div>
      <div class="actions">
        <n-button size="small" :loading="loading" @click="refreshAll">重试</n-button>
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

.caps {
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.caps-head {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-primary);
}

.caps-meta {
  font-weight: 400;
  color: var(--color-text-tertiary);
  font-family: var(--font-mono, monospace);
  font-size: 11px;
}

.caps-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 12px;
}

.cap {
  font-size: 11.5px;
  color: var(--color-text-secondary);
}

.cap.off {
  color: var(--color-text-tertiary);
  text-decoration: line-through;
  text-decoration-color: color-mix(in srgb, var(--color-text-tertiary) 50%, transparent);
}
</style>
