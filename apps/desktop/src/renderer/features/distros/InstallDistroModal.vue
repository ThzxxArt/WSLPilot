<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { NButton, NModal, NSelect, NSpin, NTag, NProgress, useMessage } from 'naive-ui'
import type { OnlineDistro } from '@wslpilot/shared'
import { useDistrosStore } from '../../stores/distros'
import { useTasksStore } from '../../stores/tasks'
import { useTaskProgress, taskStatusLabel } from '../../composables/useTaskProgress'
import { errorLine } from '../../composables/useAppError'

const props = defineProps<{ show: boolean }>()
const emit = defineEmits<{ 'update:show': [boolean] }>()

const distros = useDistrosStore()
const tasks = useTasksStore()
const message = useMessage()
const router = useRouter()

const online = ref<OnlineDistro[]>([])
const loadingOnline = ref(false)
/** 在线列表读取失败（常见：未启用 WSL）：与「列表为空」区分，给一键安装 WSL 兜底（0.1.3） */
const onlineError = ref('')
const selected = ref<string | null>(null)
const activeTaskId = ref('')
const startedAt = ref(0)
/** 启动安装在途锁：双击不并发两个安装任务（review 0.1.2 根治） */
const starting = ref(false)

const { task, percentLabel, isRunning, isDone, cancel } = useTaskProgress(activeTaskId)

const elapsed = ref('00:00')
let timer: number | undefined

const onlineOptions = computed(() =>
  online.value.map((d) => ({
    label: d.friendlyName && d.friendlyName !== d.name ? `${d.friendlyName}（${d.name}）` : d.name,
    value: d.name,
  })),
)

/** 实时日志尾（安装过程可见 — review 弹框简陋根治） */
const logTail = computed(() => (task.value?.logs ?? []).slice(-8))
const failed = computed(() => task.value?.status === 'failed')
const succeeded = computed(() => task.value?.status === 'success')
// review 0.1.2 审计修复：canceled 不在 actions 覆盖内 → 取消终态无「关闭/重新开始」按钮死路
const canceled = computed(() => task.value?.status === 'canceled')
/** 任务记录已被 trim 淘汰（task 为 null 但 activeTaskId 还在）：不能成死路（review 0.1.2 根治） */
const taskLost = computed(() => !!activeTaskId.value && !task.value)
/** 步骤指示：0 选择 → 1 安装中 → 2 结果 */
const step = computed(() => (!activeTaskId.value ? 0 : isDone.value ? 2 : 1))
/** 本次安装的是 WSL 本体（而非某个发行版） */
const isWslBodyInstall = computed(() => !task.value?.distro)
/** 安装程序提示需要重启 Windows（0.1.3）：日志文本识别，如实展示 */
const restartHinted = computed(
  () => !!task.value && task.value.logs.some((l) => /重启|重新启动|restart|reboot/i.test(l)),
)

async function loadOnline() {
  loadingOnline.value = true
  onlineError.value = ''
  try {
    online.value = await window.wslAPI.distros.listOnline()
    if (!selected.value && online.value.length > 0) selected.value = online.value[0]!.name
  } catch (e) {
    online.value = []
    onlineError.value = errorLine(e, '获取可安装发行版列表失败')
  } finally {
    loadingOnline.value = false
  }
}

function stopTimer() {
  if (timer) {
    window.clearInterval(timer)
    timer = undefined
  }
}

watch(
  () => props.show,
  (show) => {
    if (show) {
      activeTaskId.value = ''
      // 重新打开必须清零用时，不沿用上一次安装的读数（review 0.1.2 根治）
      elapsed.value = '00:00'
      startedAt.value = 0
      stopTimer()
      void loadOnline()
    } else {
      stopTimer()
    }
  },
  // 初始即 show（路由/父级直接渲染）也要拉列表，否则「开始安装」永远禁用
  { immediate: true },
)

/** 启动安装任务（name 为空 = 安装 WSL 本体 — 0.1.3 兜底路径） */
async function startInstallNamed(name?: string) {
  if (starting.value) return
  starting.value = true
  try {
    const entry = await tasks.startInstall(name)
    if (!entry) {
      message.error(errorLine(tasks.lastError, '启动安装失败'))
      return
    }
    activeTaskId.value = entry.taskId
    startedAt.value = Date.now()
    stopTimer()
    timer = window.setInterval(() => {
      const sec = Math.floor((Date.now() - startedAt.value) / 1000)
      elapsed.value = `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`
    }, 1000)
  } finally {
    starting.value = false
  }
}

async function startInstall() {
  await startInstallNamed(selected.value ?? undefined)
}

/** 一键安装 WSL 本体（在线列表失败 / 未启用 WSL 的兜底入口） */
async function installWslBody() {
  await startInstallNamed(undefined)
}

watch(isDone, (done) => {
  if (done) {
    stopTimer()
    void distros.refresh()
    if (task.value?.status === 'success') message.success('安装完成')
    if (task.value?.status === 'canceled') message.info('安装已取消')
    if (task.value?.status === 'failed')
      message.error(errorLine(task.value.error ?? task.value.message, '安装失败'))
  }
})

// 组件卸载（切路由）时清理计时器，防泄漏（核验修复）
onUnmounted(() => {
  stopTimer()
})

async function onCancel() {
  try {
    await cancel()
    message.info('已请求取消安装')
  } catch (e) {
    message.error(errorLine(e, '取消失败'))
  }
}

function close() {
  if (isRunning.value) {
    message.warning('安装进行中，请先取消或等待完成')
    return
  }
  emit('update:show', false)
}

/** 完成后直达终端（首次启动即进入用户创建向导）；携带发行版，终端直接落在该发行版（review 0.1.2 根治） */
function openTerminal() {
  const name = task.value?.distro || selected.value || undefined
  close()
  void router.push(name ? { path: '/terminal', query: { distro: name } } : '/terminal')
}

/** 失败重试 / 记录被 trim / WSL 本体装完后再装发行版：清任务回选择步（review 0.1.2 根治死路） */
function resetAndPick() {
  activeTaskId.value = ''
  startedAt.value = 0
  elapsed.value = '00:00'
  stopTimer()
  if (online.value.length === 0) void loadOnline()
}
</script>

<template>
  <n-modal
    :show="show"
    preset="card"
    title="安装发行版"
    class="install-modal"
    :style="{ width: '520px', maxWidth: '94vw', maxHeight: '90vh' }"
    :content-style="{ overflow: 'auto' }"
    :mask-closable="!isRunning"
    @update:show="(v: boolean) => (v ? emit('update:show', true) : close())"
  >
    <!-- 步骤指示：① 选择 → ② 安装 → ③ 完成（当前步 aria-current="step" — review 0.1.2 a11y） -->
    <div class="steps">
      <span class="step" :class="{ on: step === 0 }" :aria-current="step === 0 ? 'step' : undefined"
        >① 选择发行版</span
      >
      <span class="step-sep">›</span>
      <span class="step" :class="{ on: step === 1 }" :aria-current="step === 1 ? 'step' : undefined"
        >② 安装</span
      >
      <span class="step-sep">›</span>
      <span class="step" :class="{ on: step === 2 }" :aria-current="step === 2 ? 'step' : undefined"
        >③ 完成</span
      >
    </div>

    <div v-if="!activeTaskId" class="form">
      <!-- 在线列表失败（常见：未启用 WSL）：给「安装 WSL 本体」兜底，而不是死路 — 0.1.3 -->
      <div v-if="onlineError" class="online-error" role="alert">
        <div class="error-title">无法获取可安装发行版列表</div>
        <p class="hint">{{ onlineError }}</p>
        <p class="hint">
          如果系统尚未启用 WSL，可直接一键安装 WSL 本体（安装后回到本窗口选择发行版）。
        </p>
        <div class="actions">
          <n-button size="small" secondary :loading="loadingOnline" @click="loadOnline">
            重试获取列表
          </n-button>
          <n-button size="small" type="primary" :disabled="starting" @click="installWslBody">
            一键安装 WSL
          </n-button>
        </div>
      </div>

      <n-spin v-else :show="loadingOnline">
        <div class="field">
          <div class="label">选择发行版（来自 wsl --list --online）</div>
          <n-select
            v-model:value="selected"
            :options="onlineOptions"
            filterable
            placeholder="选择要安装的发行版"
          />
          <div class="hint">
            将执行 <code>wsl --install{{ selected ? ` -d ${selected}` : '' }} --no-launch</code>
            （装完不自动拉起，任务干净结束）。安装过程可能触发系统 UAC 提权确认；
            进度按安装日志实时呈现，安装完成以发行版注册成功为准。
          </div>
        </div>
      </n-spin>
      <div class="actions">
        <n-button @click="close"> 取消 </n-button>
        <n-button
          v-if="!onlineError"
          type="primary"
          :disabled="!selected || starting"
          :loading="starting"
          @click="startInstall"
        >
          开始安装
        </n-button>
      </div>
    </div>

    <div v-else class="progress">
      <!-- taskLost（任务记录被 trim 淘汰）：不再伪装「进行中」— review 0.1.2 审计修复 -->
      <div v-if="!taskLost" class="progress-line">
        <NTag
          size="small"
          :bordered="false"
          :type="succeeded ? 'success' : failed ? 'error' : 'info'"
        >
          {{ taskStatusLabel(task?.status ?? 'running') }}
        </NTag>
        <span class="pct">{{ percentLabel }}</span>
        <span class="elapsed">用时 {{ elapsed }}</span>
      </div>

      <!-- 不确定态进度条（真实百分比出现后转实心） -->
      <NProgress
        v-if="!taskLost"
        type="line"
        :percentage="typeof task?.percent === 'number' ? task.percent : 100"
        :indeterminate="typeof task?.percent !== 'number'"
        :status="succeeded ? 'success' : failed ? 'error' : 'default'"
        :show-indicator="false"
      />

      <div v-if="!taskLost" class="msg">
        {{ task?.message || '准备中…' }}
      </div>

      <!-- 实时日志尾（下载/安装过程可见） -->
      <div v-if="logTail.length" class="log-box">
        <div v-for="(line, i) in logTail" :key="i" class="log-line">{{ line }}</div>
      </div>

      <div v-if="task?.error" class="error">
        {{ task.error }}
      </div>

      <!-- 任务记录被 trim 淘汰（activeTaskId 还在但 task 为 null）：给兜底出口，别让弹窗成死路 -->
      <div v-if="taskLost" class="error">
        安装任务记录已滚动清理（可能因应用重启或任务列表淘汰），当前无法再查看进度。
      </div>

      <!-- 安装程序提示需要重启 Windows（0.1.3）：如实透传，不假报"即刻可用" -->
      <div v-if="restartHinted" class="restart-note" role="status">
        安装程序提示需要<strong>重启 Windows</strong>后才能使用 WSL。请重启系统，然后回到「发行版」
        页刷新。
      </div>

      <!-- 安装完成：行动导向（review：新装发行版用户名/密码无处可寻根治） -->
      <div v-if="succeeded" class="user-guide">
        <div class="guide-title">✓ 安装完成 — 下一步</div>
        <template v-if="isWslBodyInstall">
          <div class="hint">WSL 本体已安装。点击「安装发行版」选择一个 Linux 发行版开始使用。</div>
        </template>
        <template v-else>
          <div class="hint">
            首次在终端打开该发行版时，多数发行版会进入
            <b>UNIX 用户创建向导</b> ——按提示输入用户名与密码即可。<br />
            若直接进入了 root（未见向导）：终端执行 <code>adduser 用户名</code> 创建用户，
            再到「详情 → 配置」给 <code>/etc/wsl.conf</code> 写入 <code>[user]</code> 段
            <code>default=用户名</code>，停止并重开终端生效。
          </div>
        </template>
      </div>

      <div class="actions">
        <n-button v-if="isRunning" secondary type="error" @click="onCancel"> 取消安装 </n-button>
        <!-- 记录被 trim：给「关闭 / 重新开始」兜底，而不是无按钮死路（review 0.1.2 根治） -->
        <template v-if="taskLost">
          <n-button @click="close"> 关闭 </n-button>
          <n-button type="primary" @click="resetAndPick">重新开始</n-button>
        </template>
        <template v-if="succeeded && isWslBodyInstall">
          <!-- WSL 本体安装完成：引导继续安装发行版（而不是打开终端死路） -->
          <n-button @click="close"> 完成 </n-button>
          <n-button type="primary" @click="resetAndPick">安装发行版</n-button>
        </template>
        <template v-else-if="succeeded">
          <n-button @click="close"> 完成 </n-button>
          <n-button type="primary" @click="openTerminal">打开终端</n-button>
        </template>
        <template v-else-if="failed">
          <n-button @click="close"> 关闭 </n-button>
          <n-button type="primary" @click="resetAndPick">重新开始</n-button>
        </template>
        <!-- 取消终态：同样给「关闭 / 重新开始」，绝不留无按钮死路（review 0.1.2 审计修复） -->
        <template v-else-if="canceled">
          <n-button @click="close"> 关闭 </n-button>
          <n-button type="primary" @click="resetAndPick">重新开始</n-button>
        </template>
      </div>
    </div>
  </n-modal>
</template>

<style scoped>
/* 宽度走 n-modal 的 :style（preset="card" 不给 fallthrough class 挂 scoped 属性） */

.form,
.progress {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.label {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-primary);
}

.hint {
  font-size: 12px;
  color: var(--color-text-secondary);
  line-height: 1.6;
}

.hint code {
  background: var(--color-bg-sunken);
  padding: 1px 5px;
  border-radius: 4px;
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.progress-line {
  display: flex;
  align-items: center;
  gap: 12px;
  font-variant-numeric: tabular-nums;
}

.pct {
  font-size: 20px;
  font-weight: 700;
  color: var(--color-text-primary);
}

.elapsed {
  color: var(--color-text-tertiary);
  font-size: 12px;
}

.msg {
  font-size: 13px;
  color: var(--color-text-secondary);
}

/* 步骤指示条 */
.steps {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--color-text-tertiary);
  margin-bottom: 4px;
}

.steps .step.on {
  color: var(--color-accent, #6366f1);
  font-weight: 600;
}

.steps .step-sep {
  opacity: 0.5;
}

/* 实时日志尾 */
.log-box {
  background: var(--color-bg-sunken);
  border: 1px solid var(--color-border-subtle);
  border-radius: 8px;
  padding: 8px 10px;
  max-height: 132px;
  overflow: auto;
  font-family: var(--font-mono, 'Cascadia Mono', Consolas, monospace);
  font-size: 11px;
  line-height: 1.6;
  color: var(--color-text-secondary);
  white-space: pre-wrap;
  word-break: break-all;
}

/* review 0.1.2 审计修复：硬编码 10px 与 ui 包 radius-md 令牌（12px）不一致，统一令牌化 */
.user-guide {
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md, 12px);
  padding: 12px 14px;
  background: var(--color-bg-sunken);
}

.user-guide .guide-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text-primary);
  margin-bottom: 6px;
}

.user-guide code {
  background: var(--color-bg-surface);
  padding: 1px 5px;
  border-radius: 4px;
}

.error {
  padding: 10px 12px;
  border-radius: var(--radius-md, 12px);
  background: color-mix(in srgb, var(--color-danger) 10%, transparent);
  color: var(--color-danger);
  font-size: 12.5px;
}

.online-error {
  border: 1px solid color-mix(in srgb, var(--color-warning) 40%, transparent);
  border-radius: var(--radius-md, 12px);
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  background: color-mix(in srgb, var(--color-warning) 6%, transparent);
}

.error-title {
  font-size: 13px;
  font-weight: 650;
  color: var(--color-text-primary);
}

.restart-note {
  padding: 10px 12px;
  border-radius: var(--radius-md, 12px);
  background: color-mix(in srgb, var(--color-warning) 12%, transparent);
  color: var(--color-warning);
  font-size: 12.5px;
  line-height: 1.7;
}
</style>
