<script setup lang="ts">
import { computed, h, onUnmounted, ref, watch } from 'vue'
import {
  NButton,
  NCheckbox,
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
import {
  formatBytes,
  formatKbPair,
  isValidWslSize,
  type DistroMeta,
  type Metrics,
  type RegistryDetail,
} from '@wslpilot/shared'
import { useDistrosStore } from '../../stores/distros'
import { useSettingsStore } from '../../stores/settings'
import { useTasksStore } from '../../stores/tasks'
import { useActionsStore } from '../../stores/actions'
import { useMetricsStore } from '../../stores/metrics'
import { useWslEnvStore } from '../../stores/wsl-env'
import { errorLine } from '../../composables/useAppError'
import { stateLabel } from '../../composables/state-label'
import { taskStatusLabel, taskTypeLabel } from '../../composables/useTaskProgress'
import WslConfPanel from '../config/WslConfPanel.vue'
import ActionsPanel from '../actions/ActionsPanel.vue'
import FileBrowserPanel from '../fs/FileBrowserPanel.vue'
import CloneDistroModal from './CloneDistroModal.vue'

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
const wslEnv = useWslEnvStore()
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
/** 稀疏磁盘操作在途（0.1.3） */
const sparseBusy = ref(false)
/** 存储与身份（0.1.4） */
const compactBusy = ref(false)
const resizeBusy = ref(false)
const userBusy = ref(false)
const shutdownBusy = ref(false)
const resizeSize = ref('')
const defaultUser = ref('')
/** 克隆弹窗（0.1.3） */
const cloneOpen = ref(false)

const distro = computed(() => distros.byName(props.distroName))
/** 运行状态单一事实源：按钮组严格状态驱动（review 停/启按钮错位根治） */
const isRunning = computed(() => distro.value?.state === 'Running')
/** 能力门禁（0.1.4）：未探测/旧版一律禁用 */
const isWsl2 = computed(() => distro.value?.version === 2)
const canCompact = computed(() => isWsl2.value && wslEnv.can('compact'))
const canResize = computed(() => isWsl2.value && wslEnv.can('resize'))
const canSetUser = computed(() => wslEnv.can('setDefaultUser'))
/** 存储区一次只允许一个长任务：多个按钮共用单任务观察器，并发会互相覆盖 */
const anyStorageBusy = computed(
  () =>
    compactBusy.value ||
    resizeBusy.value ||
    userBusy.value ||
    sparseBusy.value ||
    shutdownBusy.value,
)
const compactReason = computed(() =>
  isWsl2.value ? wslEnv.requirement('compact') : '压缩磁盘仅支持 WSL2 发行版',
)
const resizeReason = computed(() =>
  isWsl2.value ? wslEnv.requirement('resize') : '扩容磁盘仅支持 WSL2 发行版',
)
/** 宿主文件 - 内部已用：只能作为“可回收上限”估算，不是承诺值 */
const reclaimEstimate = computed(() => {
  const host = distro.value?.hostDiskBytes
  const used = metrics.value?.diskUsedKB
  if (!host || used === undefined || used <= 0) return null
  const diff = host - used * 1024
  return diff > 0 ? diff : 0
})

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
      void wslEnv.load()
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
      // 宿主侧虚拟磁盘文件大小（0.1.3）：与运行中 df 的「已用」对照可见膨胀程度
      label: '磁盘（宿主）',
      value: distro.value?.hostDiskBytes
        ? `${formatBytes(distro.value.hostDiskBytes)}（ext4.vhdx）`
        : '—',
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

/**
 * 任务终态观察（0.1.3 任务化操作共用）。
 * 每个 taskId 独立 watcher，不能共用一个 stopTaskWatch：并发两个存储任务时，
 * 后一个会停掉前一个的 watcher，前一个 busy 永远不归零。
 * `immediate` 覆盖“任务在 watchTask 注册前已终态”的窗口（极快失败/成功）。
 */
const taskWatchers = new Map<string, () => void>()
function watchTask(
  taskId: string,
  handlers: {
    onSuccess: (message: string) => void
    onFailed: (error: string) => void
    onCanceled?: () => void
  },
) {
  taskWatchers.get(taskId)?.()
  let settled = false
  let stop: (() => void) | null = null
  const finish = () => {
    if (settled) return
    settled = true
    stop?.()
    taskWatchers.delete(taskId)
  }
  stop = watch(
    () => tasks.byId(taskId)?.status,
    (status, prev) => {
      if (!status || status === 'running' || status === prev) return
      const entry = tasks.byId(taskId)
      if (status === 'success') handlers.onSuccess(entry?.message ?? '任务完成')
      else if (status === 'failed') handlers.onFailed(entry?.error ?? '任务失败')
      else handlers.onCanceled?.()
      finish()
    },
    { immediate: true },
  )
  if (settled) {
    stop()
    return
  }
  taskWatchers.set(taskId, stop)
}
onUnmounted(() => {
  for (const stop of taskWatchers.values()) stop()
  taskWatchers.clear()
})

/** 启用稀疏磁盘：wsl --manage <name> --set-sparse true（WSL2；VHD 未被占用） */
async function onSparse() {
  if (anyStorageBusy.value) return
  if (!isWsl2.value) {
    message.warning('稀疏磁盘仅支持 WSL2 发行版')
    return
  }
  if (!wslEnv.can('manageSparse')) {
    message.warning(wslEnv.requirement('manageSparse'))
    return
  }
  if (isRunning.value) {
    message.warning(`请先停止 ${props.distroName}，再启用稀疏磁盘`)
    return
  }
  const ok = await confirmDangerous({
    title: '启用稀疏磁盘',
    content:
      `将执行 wsl --manage ${props.distroName} --set-sparse true。\n\n` +
      '稀疏磁盘让 vhdx 按实际使用增长；启用前请确认该发行版已停止，且 WSL 虚拟机未占用该虚拟磁盘。',
  })
  if (!ok) return
  sparseBusy.value = true
  try {
    const entry = await tasks.startSparse(props.distroName, true)
    if (!entry) {
      sparseBusy.value = false
      message.error(errorLine(tasks.lastError, '启动稀疏磁盘操作失败'))
      return
    }
    watchTask(entry.taskId, {
      onSuccess: async (text) => {
        sparseBusy.value = false
        await distros.refresh()
        await loadDetail()
        message.success(text)
      },
      onFailed: (err) => {
        message.error(err)
        sparseBusy.value = false
      },
      onCanceled: () => {
        sparseBusy.value = false
      },
    })
  } catch (e) {
    sparseBusy.value = false
    message.error(errorLine(e, '稀疏磁盘操作失败'))
  }
}

/**
 * 完全停止 WSL（wsl --shutdown）：3.0.3 的 resize/set-default-user/set-sparse 在发行版
 * Stopped 后仍可能报 VHD in use，官方错误提示就是执行 shutdown。这是全局破坏性动作，
 * 必须逐次确认，绝不自动执行。
 */
async function onShutdownAll() {
  if (anyStorageBusy.value) return
  const ok = await confirmDangerous({
    title: '停止全部 WSL',
    content:
      '将执行 wsl --shutdown：停止所有发行版、所有终端会话与 WSL 虚拟机。\n\n' +
      '未保存的工作会丢失。这是扩容 / 设置默认用户 / 稀疏磁盘在“VHD 正在使用中”时的官方前置步骤。确定继续吗？',
  })
  if (!ok) return
  shutdownBusy.value = true
  try {
    await window.wslAPI.distros.shutdown()
    // shutdown 返回后给 WSL 一点释放 VHD 的时间
    await new Promise((r) => setTimeout(r, 800))
    await distros.refresh()
    await loadDetail()
    message.success('WSL 已完全停止；现在可以重试扩容 / 默认用户 / 稀疏磁盘')
  } catch (e) {
    message.error(errorLine(e, '停止全部 WSL 失败'))
  } finally {
    shutdownBusy.value = false
  }
}

/** 压缩磁盘（0.1.4）：会终止运行中发行版，必须在确认框里说清 */
async function onCompact() {
  if (!canCompact.value || anyStorageBusy.value) {
    if (!canCompact.value) message.warning(compactReason.value)
    return
  }
  const running = isRunning.value
  const ok = await confirmDangerous({
    title: '压缩虚拟磁盘',
    content:
      `将执行 wsl --manage ${props.distroName} --compact。\n\n` +
      (running
        ? '该发行版正在运行，压缩会先终止它：其中的终端、编辑器与未保存进程都会被关闭。\n\n'
        : '') +
      '压缩只回收虚拟磁盘中未使用的块，不删除发行版内文件；完成后刷新可查看宿主文件变化。',
  })
  if (!ok) return
  compactBusy.value = true
  const before = distro.value?.hostDiskBytes
  try {
    const entry = await tasks.startCompact(props.distroName, running)
    if (!entry) {
      compactBusy.value = false
      message.error(errorLine(tasks.lastError, '启动压缩失败'))
      return
    }
    watchTask(entry.taskId, {
      onSuccess: async (text) => {
        await distros.refresh()
        await loadDetail()
        const after = distros.byName(props.distroName)?.hostDiskBytes
        const delta =
          before !== undefined && after !== undefined && before > after
            ? ` · 宿主文件减少 ${formatBytes(before - after)}`
            : ''
        compactBusy.value = false
        message.success(`${text}${delta}`)
      },
      onFailed: async (err) => {
        compactBusy.value = false
        // compact 会先 terminate 运行中发行版，即便随后失败，状态也已经变了；
        // 自动刷新关闭时不能继续显示 Running。
        await distros.refresh()
        await loadDetail()
        message.error(err)
      },
      onCanceled: async () => {
        compactBusy.value = false
        await distros.refresh()
        await loadDetail()
        message.info('压缩已取消')
      },
    })
  } catch (e) {
    compactBusy.value = false
    message.error(errorLine(e, '压缩失败'))
  }
}

/** 扩容磁盘（0.1.4）：只增不减；运行中先拒绝 */
async function onResize() {
  if (!canResize.value || anyStorageBusy.value) {
    if (!canResize.value) message.warning(resizeReason.value)
    return
  }
  const size = resizeSize.value.trim()
  if (!isValidWslSize(size)) {
    message.warning('磁盘大小格式应为整数 + B/K/KB/M/MB/G/GB/T/TB（如 50GB，不接受小数）')
    return
  }
  if (isRunning.value) {
    message.warning(`请先停止 ${props.distroName}，扩容要求文件系统离线`)
    return
  }
  const ok = await confirmDangerous({
    title: '扩容虚拟磁盘',
    content:
      `将执行 wsl --manage ${props.distroName} --resize ${size}。\n\n` +
      '该操作只扩大虚拟磁盘，不会缩小或删除数据；完成后发行版内可用空间以 df 为准。',
  })
  if (!ok) return
  resizeBusy.value = true
  try {
    const entry = await tasks.startResize(props.distroName, size)
    if (!entry) {
      resizeBusy.value = false
      message.error(errorLine(tasks.lastError, '启动扩容失败'))
      return
    }
    watchTask(entry.taskId, {
      onSuccess: async (text) => {
        resizeBusy.value = false
        await distros.refresh()
        await loadDetail()
        message.success(text)
      },
      onFailed: (err) => {
        resizeBusy.value = false
        message.error(err)
      },
      onCanceled: () => {
        resizeBusy.value = false
        message.info('扩容已取消')
      },
    })
  } catch (e) {
    resizeBusy.value = false
    message.error(errorLine(e, '扩容失败'))
  }
}

/** 设置默认用户（0.1.4）：Linux 用户名白名单；运行中拒绝 */
async function onSetDefaultUser() {
  if (!canSetUser.value || anyStorageBusy.value) {
    if (!canSetUser.value) message.warning(wslEnv.requirement('setDefaultUser'))
    return
  }
  const user = defaultUser.value.trim()
  if (!/^[A-Za-z_][A-Za-z0-9_-]{0,31}$/.test(user)) {
    message.warning('用户名格式非法（字母/数字/下划线/连字符，1–32 位）')
    return
  }
  if (isRunning.value) {
    message.warning(`请先停止 ${props.distroName}，再设置默认用户`)
    return
  }
  const ok = await confirmDangerous({
    title: '设置默认用户',
    content: `将执行 wsl --manage ${props.distroName} --set-default-user ${user}。\n\n新会话生效；请确认该用户在发行版内已存在。`,
  })
  if (!ok) return
  userBusy.value = true
  try {
    const entry = await tasks.startSetDefaultUser(props.distroName, user)
    if (!entry) {
      userBusy.value = false
      message.error(errorLine(tasks.lastError, '启动设置默认用户失败'))
      return
    }
    watchTask(entry.taskId, {
      onSuccess: async (text) => {
        userBusy.value = false
        defaultUser.value = ''
        await loadDetail()
        message.success(text)
      },
      onFailed: (err) => {
        userBusy.value = false
        message.error(err)
      },
      onCanceled: () => {
        userBusy.value = false
        message.info('设置默认用户已取消')
      },
    })
  } catch (e) {
    userBusy.value = false
    message.error(errorLine(e, '设置默认用户失败'))
  }
}

async function onUnregister() {
  if (!distro.value || unregistering.value) return
  unregistering.value = true
  try {
    // 先过脏守卫，再走破坏性确认；两步都通过才执行并关窗（review 0.1.2 根治）
    if (!(await requestClose())) return
    // 破坏性操作：confirmDestructive 开启时必须显式确认（§13.4）；
    // 0.1.3：确认框内可选「注销前自动备份」（默认跟随 settings.backup.autoBackupBeforeDestructive）
    const backupFirst = ref(settings.backupAutoBeforeDestructive)
    if (settings.confirmDestructive) {
      const ok = await new Promise<boolean>((resolve) => {
        dialog.warning({
          title: '注销发行版',
          content: () =>
            h('div', [
              h('p', { style: 'margin: 0 0 10px' }, `注销（删除）发行版 ${props.distroName}？`),
              h('p', { style: 'margin: 0 0 10px' }, '该发行版内的全部数据将被永久删除且不可恢复。'),
              h('label', { style: 'display:flex;align-items:center;gap:8px;cursor:pointer' }, [
                h(NCheckbox, {
                  checked: backupFirst.value,
                  'onUpdate:checked': (v: boolean) => (backupFirst.value = v),
                }),
                h('span', '注销前先自动备份（导出到备份目录，可在设置中关闭默认值）'),
              ]),
            ]),
          positiveText: '注销',
          negativeText: '取消',
          onPositiveClick: () => resolve(true),
          onNegativeClick: () => resolve(false),
          onClose: () => resolve(false),
        })
      })
      if (!ok) return
    }
    const entry = await tasks.startUnregister(props.distroName, {
      backupFirst: backupFirst.value,
    })
    if (!entry) {
      message.error(errorLine(tasks.lastError, '启动注销失败'))
      return
    }
    message.info(`已开始注销 ${props.distroName}，进度见状态栏与任务抽屉`)
    watchTask(entry.taskId, {
      onSuccess: (text) => {
        message.success(text)
        void distros.refresh()
        emit('update:show', false)
      },
      onFailed: (err) => message.error(err),
      onCanceled: () => message.info('注销已取消'),
    })
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
  const tags = editTags.value
    .split(/[,，]/)
    .map((t) => t.trim())
    .filter(Boolean)
  if (tags.length > 20) {
    message.warning('标签最多 20 个；请先删减')
    return
  }
  if (tags.some((t) => t.length > 64)) {
    message.warning('单个标签最多 64 个字符；请先缩短')
    return
  }
  if (editQuickActions.value.length > 20) {
    message.warning('快捷动作最多 20 个；请先删减')
    return
  }
  try {
    await window.wslAPI.meta.set({
      name: props.distroName,
      alias: editAlias.value.trim(),
      tags,
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

        <!-- 存储与身份（0.1.4）：宿主 vhdx / 内部用量 / compact / resize / 默认用户 -->
        <div v-if="distro" class="storage-card">
          <div class="storage-head">
            <span class="storage-title">存储与身份</span>
            <span class="hint"
              >WSL{{ distro.version }} · {{ isRunning ? '运行中' : '已停止' }}</span
            >
          </div>
          <div class="storage-grid">
            <div class="storage-item">
              <span class="storage-label">宿主磁盘文件</span>
              <span class="storage-value">
                {{ distro.hostDiskBytes ? formatBytes(distro.hostDiskBytes) : '（不可用）' }}
              </span>
            </div>
            <div class="storage-item">
              <span class="storage-label">内部已用 / 总量</span>
              <span class="storage-value">
                {{
                  metrics ? formatKbPair(metrics.diskUsedKB, metrics.diskTotalKB) : '（运行中采样）'
                }}
              </span>
            </div>
            <div class="storage-item">
              <span class="storage-label">可回收上限估算</span>
              <span class="storage-value">
                {{ reclaimEstimate !== null ? formatBytes(reclaimEstimate) : '—' }}
              </span>
            </div>
            <div class="storage-item">
              <span class="storage-label">默认 UID</span>
              <span class="storage-value">
                {{ detail?.defaultUid !== undefined ? detail.defaultUid : '—' }}
              </span>
            </div>
          </div>

          <div class="storage-actions">
            <n-button
              size="small"
              secondary
              :disabled="!canCompact || anyStorageBusy"
              :loading="compactBusy"
              :title="canCompact ? '' : compactReason"
              @click="onCompact"
            >
              压缩磁盘
            </n-button>
            <n-button
              size="small"
              secondary
              :disabled="!canResize || anyStorageBusy || isRunning"
              :loading="resizeBusy"
              :title="canResize ? (isRunning ? '请先停止发行版' : '') : resizeReason"
              @click="onResize"
            >
              扩容
            </n-button>
            <n-input
              v-model:value="resizeSize"
              size="small"
              class="storage-input"
              placeholder="50GB"
              :disabled="!canResize || anyStorageBusy || isRunning"
            />
            <n-button
              size="small"
              secondary
              :disabled="!canSetUser || anyStorageBusy || isRunning"
              :loading="userBusy"
              :title="
                canSetUser
                  ? isRunning
                    ? '请先停止发行版'
                    : ''
                  : wslEnv.requirement('setDefaultUser')
              "
              @click="onSetDefaultUser"
            >
              设置默认用户
            </n-button>
            <n-input
              v-model:value="defaultUser"
              size="small"
              class="storage-input"
              placeholder="用户名"
              :disabled="!canSetUser || anyStorageBusy || isRunning"
            />
            <n-button
              size="tiny"
              quaternary
              :loading="sparseBusy"
              :disabled="anyStorageBusy || !isWsl2 || !wslEnv.can('manageSparse')"
              :title="
                !isWsl2
                  ? '稀疏磁盘仅支持 WSL2 发行版'
                  : wslEnv.can('manageSparse')
                    ? ''
                    : wslEnv.requirement('manageSparse')
              "
              @click="onSparse"
            >
              启用稀疏磁盘
            </n-button>
            <n-button
              size="tiny"
              quaternary
              type="warning"
              :loading="shutdownBusy"
              :disabled="anyStorageBusy"
              title="wsl --shutdown：停止所有发行版与终端，未保存工作会丢失"
              @click="onShutdownAll"
            >
              关闭 WSL 虚拟机
            </n-button>
          </div>
          <div class="hint">
            压缩会终止运行中的发行版；扩容/稀疏/默认用户要求 WSL 完全停止（仅发行版 Stopped
            不够，3.0.3 实测会报“VHD 当前正在使用中”）。可点「关闭 WSL 虚拟机」执行
            <code>wsl --shutdown</code>（会停止所有发行版，未保存工作会丢失）。 可回收上限 =
            宿主文件 − 内部已用，实际回收量由 WSL 决定。
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

        <!-- 元数据编辑（可视化 label 与控件做程序化关联 — review 0.1.2 a11y） -->
        <div v-if="editing" class="meta-edit">
          <div class="field">
            <div class="label">别名</div>
            <NInput
              v-model:value="editAlias"
              size="small"
              placeholder="例如：主力开发"
              :input-props="{ 'aria-label': '别名' }"
            />
          </div>
          <div class="field">
            <div class="label">标签（逗号分隔）</div>
            <NInput
              v-model:value="editTags"
              size="small"
              placeholder="work, node, python"
              :input-props="{ 'aria-label': '标签' }"
            />
          </div>
          <div class="field">
            <div class="label">备注</div>
            <NInput
              v-model:value="editNote"
              size="small"
              type="textarea"
              :rows="2"
              placeholder="日常开发使用…"
              :input-props="{ 'aria-label': '备注' }"
            />
          </div>
          <div class="field">
            <div class="label">图标名</div>
            <NInput
              v-model:value="editIcon"
              size="small"
              placeholder="ubuntu / debian / …"
              :input-props="{ 'aria-label': '图标名' }"
            />
          </div>
          <div class="field">
            <div class="label">品牌色</div>
            <NInput
              v-model:value="editColor"
              size="small"
              placeholder="#E95420"
              :input-props="{ 'aria-label': '品牌色' }"
            />
          </div>
          <div class="field">
            <div class="label">终端启动目录</div>
            <NInput
              v-model:value="editStartupCwd"
              size="small"
              placeholder="~ 或 /home/me/project"
              :input-props="{ 'aria-label': '终端启动目录' }"
            />
          </div>
          <div class="field">
            <div class="label">快捷动作（动作卡片上的直达项）</div>
            <!-- 非 filterable 多选不渲染内部 input：aria-label 走 fallthrough 到控件根节点 -->
            <NSelect
              v-model:value="editQuickActions"
              size="small"
              multiple
              :options="quickActionOptions"
              placeholder="选择动作 id"
              aria-label="快捷动作"
            />
          </div>
          <div class="field field-row">
            <div>
              <div class="label">置顶</div>
              <div class="hint">置顶后固定排在列表最前</div>
            </div>
            <NSwitch v-model:value="editPinned" size="small" aria-label="置顶" />
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
          <!-- 克隆发行版（0.1.3）：导出→导入组合流程，失败自动回滚 -->
          <n-button
            secondary
            :disabled="!distro || cloneOpen || isRunning"
            :title="isRunning ? '克隆要求源发行版已停止' : ''"
            @click="cloneOpen = true"
          >
            克隆发行版
          </n-button>
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
      <!-- display-directive=show（review 0.1.2 审计修复）：
           根因：默认 'if' 在切页签时卸载 FileBrowserPanel，本地 dirty 无提示销毁；
           与 config 页签同策略常驻后，watch props 的切换/关窗确认仍生效 -->
      <!-- 文件页签同样常驻但**懒挂载**（show:lazy）：首次切到该页才挂载（未点开不做多余
           fs.readDir IPC），之后切页签不卸载（本地脏编辑不随页签切换销毁）— review 0.1.2 审计修复 -->
      <n-tab-pane name="files" tab="文件" display-directive="show:lazy">
        <FileBrowserPanel
          ref="filePanel"
          :distro-name="distroName"
          @restore-distro="(name: string) => emit('update:distroName', name)"
        />
      </n-tab-pane>
    </n-tabs>

    <!-- 克隆向导（0.1.3）：独立弹层，克隆启动后关闭详情弹窗交由任务体系跟踪 -->
    <CloneDistroModal
      v-model:show="cloneOpen"
      :source="distroName"
      :distros="distros.items"
      :default-dir="settings.backupDefaultDir"
      @started="emit('update:show', false)"
    />
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

.storage-card {
  margin-top: 12px;
  padding: 10px 12px;
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.storage-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
}

.storage-title {
  font-size: 12.5px;
  font-weight: 650;
  color: var(--color-text-primary);
}

.storage-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px 16px;
}

.storage-item {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 11.5px;
}

.storage-label {
  color: var(--color-text-secondary);
}

.storage-value {
  color: var(--color-text-primary);
  font-family: var(--font-mono, monospace);
  font-variant-numeric: tabular-nums;
}

.storage-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.storage-input {
  width: 120px;
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
