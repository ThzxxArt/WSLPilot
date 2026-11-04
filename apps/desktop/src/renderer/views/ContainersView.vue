<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import {
  NAlert,
  NButton,
  NInput,
  NInputNumber,
  NModal,
  NSwitch,
  NTabPane,
  NTabs,
  NTag,
  useDialog,
  useMessage,
} from 'naive-ui'
import { CodeEditor } from '@wslpilot/ui'
import {
  buildContainerRunArgs,
  defaultContainerRecipe,
  previewWslcCommand,
  type ContainerDetail,
  type ContainerRecipe,
  type ContainerRunSpec,
  type ContainerSummary,
  type WslcImage,
} from '@wslpilot/shared'
import { useContainersStore } from '../stores/containers'
import { useSettingsStore } from '../stores/settings'
import { useTerminalStore } from '../stores/terminal'
import { useRoute, useRouter } from 'vue-router'
import { errorLine } from '../composables/useAppError'

const store = useContainersStore()
const settings = useSettingsStore()
const terminal = useTerminalStore()
const router = useRouter()
const route = useRoute()
const message = useMessage()
const dialog = useDialog()

const tab = ref<'containers' | 'images' | 'networks' | 'volumes' | 'system'>('containers')
const runOpen = ref(false)
const inspectOpen = ref(false)
const inspectData = ref<ContainerDetail | null>(null)
const inspectSrc = ref('')
const inspectDst = ref('')
const settingsText = ref('')
const pullRef = ref('ubuntu:latest')
const buildTag = ref('wslpilot-app:dev')
const buildContext = ref('')
const networkName = ref('wslpilot-net')
const volumeName = ref('wslpilot-vol')
const showEnvValues = ref(false)
const recipeId = ref('')
const recipeLabel = ref('')

const form = ref({
  image: settings.containersLastImage || 'ubuntu:latest',
  name: '',
  command: '',
  ports: '',
  mounts: '',
  env: '',
  network: '',
  memory: '',
  cpus: null as number | null,
  gpus: false,
  healthCmd: '',
  healthInterval: '',
  healthTimeout: '',
  healthRetries: null as number | null,
  stopTimeout: settings.containersDefaultStopTimeoutSec,
  detach: true,
  rm: false,
  pull: false,
})

function notifyTask(handle: { taskId: string } | null, ok: string) {
  if (!handle) return
  message.success(`${ok}（进度见状态栏/任务抽屉）`)
}

const maskEnvValues = computed(() => settings.containersMaskEnvValues)

/** 原始 inspect JSON 也遵守 env 遮挡设置（避免折叠区泄露密钥） */
const inspectRawText = computed(() => {
  const raw = inspectData.value?.raw
  if (!raw || !maskEnvValues.value) return JSON.stringify(inspectData.value, null, 2)
  try {
    const clone = JSON.parse(JSON.stringify(raw)) as Record<string, unknown>
    const redact = (list: unknown): void => {
      if (!Array.isArray(list)) return
      for (let i = 0; i < list.length; i++) {
        const item = String(list[i] ?? '')
        const eq = item.indexOf('=')
        if (eq > 0) list[i] = `${item.slice(0, eq)}=***`
      }
    }
    redact(clone.Env)
    redact(clone.env)
    const config = clone.Config
    if (config && typeof config === 'object') redact((config as { Env?: unknown }).Env)
    return JSON.stringify(clone, null, 2)
  } catch {
    return JSON.stringify(inspectData.value, null, 2)
  }
})

const summary = computed(() => ({
  running: store.running.length,
  containers: store.containers.length,
  images: store.images.length,
  networks: store.networks.length,
  volumes: store.volumes.length,
  storage: store.system?.storageBytes ?? 0,
}))

async function refresh(forceStatus = true) {
  await store.loadAll(forceStatus)
  if (store.settings) settingsText.value = store.settings.content
}

// ── 事件订阅 + 统计/列表轮询（0.2.0）────────────────────────
let offChanged: (() => void) | null = null
let statsTimer: number | undefined
let listTimer: number | undefined
let reloadTimer: number | undefined
let statsBusy = false
let listBusy = false
const pageVisible = ref(document.visibilityState !== 'hidden')

function scheduleReload() {
  if (reloadTimer !== undefined) window.clearTimeout(reloadTimer)
  reloadTimer = window.setTimeout(() => {
    reloadTimer = undefined
    void store.reloadFromEvent()
  }, 250)
}

async function pollStats() {
  if (statsBusy || !store.installed || !pageVisible.value) return
  statsBusy = true
  try {
    await store.refreshStats()
  } catch {
    // 统计是增强：失败静默，列表/事件仍可用
  } finally {
    statsBusy = false
  }
}

async function pollList() {
  if (listBusy || !store.installed || !pageVisible.value) return
  listBusy = true
  try {
    await store.loadContainers()
  } catch {
    /* 轮询失败静默；页面错误由手动刷新给出 */
  } finally {
    listBusy = false
  }
}

function stopTimers() {
  if (statsTimer !== undefined) {
    window.clearInterval(statsTimer)
    statsTimer = undefined
  }
  if (listTimer !== undefined) {
    window.clearInterval(listTimer)
    listTimer = undefined
  }
}

function startTimers() {
  stopTimers()
  if (tab.value !== 'containers' || !store.installed || !pageVisible.value) return
  if (store.running.length > 0) {
    // 窗口失焦/页面隐藏降为 5s（plan §6.6）
    const interval = Math.max(
      500,
      pageVisible.value
        ? settings.containersStatsIntervalMs
        : Math.max(5000, settings.containersStatsIntervalMs),
    )
    statsTimer = window.setInterval(() => void pollStats(), interval)
  }
  // 没有 events 能力时用列表轮询兜底；有 events 时由推送触发节流重载
  if (!store.status?.events) {
    const interval = Math.max(1000, settings.containersPollIntervalMs)
    listTimer = window.setInterval(() => void pollList(), interval)
  }
}

function onVisibilityChange() {
  pageVisible.value = document.visibilityState !== 'hidden'
  if (pageVisible.value) {
    void pollStats()
    void pollList()
  }
  startTimers()
}

watch(
  () => [
    tab.value,
    settings.containersStatsIntervalMs,
    settings.containersPollIntervalMs,
    store.installed,
    store.running.length,
    store.status?.events,
    pageVisible.value,
  ],
  startTimers,
)

watch(
  () => route.query.run,
  (run) => {
    if (run === '1') runOpen.value = true
  },
)

onMounted(async () => {
  // 驾驶舱「运行容器」快捷入口：/containers?run=1 直接打开向导
  if (route.query.run === '1') runOpen.value = true
  await refresh(false)
  await store.loadSettings()
  if (store.settings) {
    settingsText.value = store.settings.content
  }
  offChanged = window.wslAPI.containers.onChanged?.(() => scheduleReload()) ?? null
  document.addEventListener('visibilitychange', onVisibilityChange)
  startTimers()
})

onUnmounted(() => {
  offChanged?.()
  offChanged = null
  document.removeEventListener('visibilitychange', onVisibilityChange)
  stopTimers()
  if (reloadTimer !== undefined) {
    window.clearTimeout(reloadTimer)
    reloadTimer = undefined
  }
})

function parsePorts(text: string): ContainerRunSpec['ports'] {
  const out: ContainerRunSpec['ports'] = []
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim()
    if (!t) continue
    const m = /^(?:(\d{1,3}(?:\.\d{1,3}){3}):)?(\d{1,5}):(\d{1,5})$/.exec(t)
    if (!m) throw new Error(`端口映射格式应为 host:container：${t}`)
    out.push({
      host: Number(m[2]),
      container: Number(m[3]),
      ...(m[1] ? { address: m[1] } : {}),
    })
  }
  return out
}

function parseMounts(text: string): ContainerRunSpec['mounts'] {
  const out: ContainerRunSpec['mounts'] = []
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim()
    if (!t) continue
    // Windows 盘符路径本身带冒号：不能按 ':' 无脑 split。
    // 支持 `D:\www:/html[:ro]` 与 `\\server\share:/html[:ro]`。
    const modeMatch = /:(ro|rw)$/i.exec(t)
    const mode = modeMatch?.[1]?.toLowerCase()
    const body = modeMatch ? t.slice(0, modeMatch.index) : t
    let host = ''
    let container = ''
    if (/^[A-Za-z]:[\\/]/.test(body)) {
      const sep = body.indexOf(':', 2)
      if (sep < 0) throw new Error(`挂载格式应为 主机路径:容器路径[:ro]：${t}`)
      host = body.slice(0, sep)
      container = body.slice(sep + 1)
    } else if (body.startsWith('\\\\')) {
      const sep = body.indexOf(':', 2)
      if (sep < 0) throw new Error(`挂载格式应为 主机路径:容器路径[:ro]：${t}`)
      host = body.slice(0, sep)
      container = body.slice(sep + 1)
    } else {
      const sep = body.indexOf(':')
      if (sep <= 0) throw new Error(`挂载格式应为 主机路径:容器路径[:ro]：${t}`)
      host = body.slice(0, sep)
      container = body.slice(sep + 1)
    }
    if (!host || !container.startsWith('/')) {
      throw new Error(`挂载格式应为 主机路径:容器路径[:ro]：${t}`)
    }
    out.push({ host, container, readOnly: mode === 'ro' })
  }
  return out
}

function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim()
    if (!t) continue
    const eq = t.indexOf('=')
    if (eq <= 0) throw new Error(`环境变量格式应为 KEY=VALUE：${t}`)
    out[t.slice(0, eq).trim()] = t.slice(eq + 1)
  }
  return out
}

function specFromForm(): ContainerRunSpec {
  const healthCmd = form.value.healthCmd.trim()
  return {
    image: form.value.image.trim(),
    name: form.value.name.trim() || undefined,
    command: form.value.command
      .split(/\r?\n/)
      .map((x) => x.trim())
      .filter(Boolean),
    ports: parsePorts(form.value.ports),
    mounts: parseMounts(form.value.mounts),
    env: parseEnv(form.value.env),
    network: form.value.network.trim() || undefined,
    memory: form.value.memory.trim() || undefined,
    ...(form.value.cpus ? { cpus: form.value.cpus } : {}),
    ...(form.value.gpus ? { gpus: 'all' as const } : {}),
    ...(healthCmd
      ? {
          health: {
            cmd: healthCmd,
            ...(form.value.healthInterval.trim()
              ? { interval: form.value.healthInterval.trim() }
              : {}),
            ...(form.value.healthTimeout.trim()
              ? { timeout: form.value.healthTimeout.trim() }
              : {}),
            ...(form.value.healthRetries !== null ? { retries: form.value.healthRetries } : {}),
          },
        }
      : {}),
    detach: form.value.detach,
    rm: form.value.rm,
    pull: form.value.pull,
    stopTimeoutSec: form.value.stopTimeout || undefined,
  }
}

function applyRecipe(recipe: ContainerRecipe) {
  form.value = {
    image: recipe.image,
    name: recipe.name ?? '',
    command: (recipe.command ?? []).join('\n'),
    ports: recipe.ports
      .map((p) => `${p.address ? `${p.address}:` : ''}${p.host}:${p.container}`)
      .join('\n'),
    mounts: recipe.mounts
      .map((m) => `${m.host}:${m.container}${m.readOnly ? ':ro' : ''}`)
      .join('\n'),
    env: Object.entries(recipe.env)
      .map(([k, v]) => `${k}=${v}`)
      .join('\n'),
    network: recipe.network ?? '',
    memory: '',
    cpus: null,
    gpus: false,
    healthCmd: recipe.health?.cmd ?? '',
    healthInterval: recipe.health?.interval ?? '',
    healthTimeout: recipe.health?.timeout ?? '',
    healthRetries: recipe.health?.retries ?? null,
    stopTimeout: recipe.stopTimeoutSec ?? settings.containersDefaultStopTimeoutSec,
    detach: recipe.detach !== false,
    rm: recipe.rm === true,
    pull: false,
  }
  recipeId.value = recipe.id
  recipeLabel.value = recipe.label
}

async function saveRecipe() {
  try {
    const base = defaultContainerRecipe(recipeId.value.trim() || `recipe-${Date.now()}`)
    const spec = specFromForm()
    const recipe: ContainerRecipe = {
      ...base,
      id: recipeId.value.trim() || base.id,
      label: recipeLabel.value.trim() || base.label,
      image: spec.image,
      name: spec.name,
      command: spec.command ?? [],
      ports: spec.ports,
      mounts: spec.mounts,
      env: spec.env,
      network: spec.network,
      detach: spec.detach !== false,
      rm: spec.rm === true,
      stopTimeoutSec: spec.stopTimeoutSec,
      health: spec.health,
    }
    await store.saveRecipe(recipe)
    message.success('容器配方已保存到 containers.jsonc')
  } catch (e) {
    message.error(errorLine(e, '保存配方失败'))
  }
}

async function deleteRecipe() {
  if (!recipeId.value) return
  try {
    await store.deleteRecipe(recipeId.value)
    message.success('配方已删除')
  } catch (e) {
    message.error(errorLine(e, '删除配方失败'))
  }
}

const previewValid = computed(() => {
  try {
    buildContainerRunArgs(specFromForm())
    return true
  } catch {
    return false
  }
})

const preview = computed(() => {
  try {
    return previewWslcCommand(buildContainerRunArgs(specFromForm()))
  } catch (e) {
    return errorLine(e, '参数不完整')
  }
})

async function doRun() {
  try {
    const spec = specFromForm()
    const handle = await store.run(spec)
    notifyTask(handle, '已提交运行容器')
    void settings.setContainersLastImage(spec.image)
    runOpen.value = false
    await store.loadContainers()
  } catch (e) {
    message.error(errorLine(e, '运行容器失败'))
  }
}

async function lifecycle(fn: () => Promise<{ taskId: string } | null>, ok: string) {
  try {
    notifyTask(await fn(), ok)
    setTimeout(() => void store.loadContainers(), 800)
  } catch (e) {
    message.error(errorLine(e, '操作失败'))
  }
}

function confirmAction(title: string, content: string): Promise<boolean> {
  return new Promise((resolve) => {
    dialog.warning({
      title,
      content,
      positiveText: '确定',
      negativeText: '取消',
      onPositiveClick: () => resolve(true),
      onNegativeClick: () => resolve(false),
      onClose: () => resolve(false),
    })
  })
}

async function remove(c: ContainerSummary) {
  const running = c.state === 'running'
  // 已停止容器始终确认；运行中容器由 containers.confirmRemoveRunning 决定是否二次确认
  if (!running || settings.containersConfirmRemoveRunning) {
    if (
      !(await confirmAction(
        running ? '删除运行中的容器' : '删除容器',
        running ? `删除容器「${c.name}」？将强制终止其进程。` : `删除容器「${c.name}」？`,
      ))
    )
      return
  }
  await lifecycle(() => store.remove(c.id, running), '已提交删除容器')
}

async function inspect(c: ContainerSummary) {
  try {
    inspectData.value = await window.wslAPI.containers.inspect(c.id)
    inspectOpen.value = true
  } catch (e) {
    message.error(errorLine(e, '读取容器详情失败'))
  }
}

async function copyContainerFile() {
  if (!inspectData.value) return
  const src = inspectSrc.value.trim()
  const dst = inspectDst.value.trim()
  if (!src || !dst) {
    message.warning('请填写源路径与目标路径')
    return
  }
  try {
    await window.wslAPI.containers.copy(src, dst)
    message.success('文件已复制')
  } catch (e) {
    message.error(errorLine(e, '复制容器文件失败'))
  }
}

async function openTerminal(c: ContainerSummary) {
  if (c.state !== 'running') {
    message.warning('容器未运行，请先启动')
    return
  }
  const id = await terminal.openContainer(c.id, `容器 ${c.name}`, { distro: c.name })
  if (!id) {
    message.error(errorLine(terminal.lastError, '打开容器终端失败'))
    return
  }
  await router.push('/terminal')
}

async function pull() {
  const ref = pullRef.value.trim()
  if (!ref) {
    message.warning('请输入镜像引用')
    return
  }
  await lifecycle(() => store.pull(ref), '已提交拉取镜像')
}

async function build() {
  if (!buildTag.value.trim() || !buildContext.value.trim()) {
    message.warning('请填写镜像 tag 并选择 Containerfile 所在目录')
    return
  }
  await lifecycle(
    () => store.build(buildTag.value.trim(), buildContext.value.trim()),
    '已提交构建镜像',
  )
}

async function pickContext() {
  try {
    const p = await window.wslAPI.app.pickDirectory(buildContext.value || undefined)
    if (p) buildContext.value = p
  } catch (e) {
    message.error(errorLine(e, '选择构建目录失败'))
  }
}

async function createNetwork() {
  if (!networkName.value.trim()) {
    message.warning('请输入网络名')
    return
  }
  try {
    await store.createNetwork({ name: networkName.value.trim() })
    message.success('网络已创建')
  } catch (e) {
    message.error(errorLine(e, '创建网络失败'))
  }
}

async function pruneNetworks() {
  try {
    if (
      settings.containersConfirmPrune &&
      !(await confirmAction('清理网络', '删除所有未使用的 wslc 网络？'))
    )
      return
    const h = await window.wslAPI.networks.prune()
    notifyTask(h, '已提交清理网络')
  } catch (e) {
    message.error(errorLine(e, '清理网络失败'))
  }
}

async function pruneVolumes() {
  try {
    if (
      settings.containersConfirmPrune &&
      !(await confirmAction('清理卷', '删除所有未使用的 wslc 卷？数据将无法恢复。'))
    )
      return
    const h = await window.wslAPI.volumes.prune()
    notifyTask(h, '已提交清理卷')
  } catch (e) {
    message.error(errorLine(e, '清理卷失败'))
  }
}

async function pruneImagesAction() {
  if (
    settings.containersConfirmPrune &&
    !(await confirmAction('清理镜像', '删除所有未使用的镜像？'))
  )
    return
  await lifecycle(() => store.pruneImages(false), '已提交清理镜像')
}

async function pruneContainers() {
  if (
    settings.containersConfirmPrune &&
    !(await confirmAction('清理容器', '删除所有已停止的容器？'))
  )
    return
  await lifecycle(() => store.prune(), '已提交清理容器')
}

function imageRef(img: WslcImage): string {
  const repo = img.repository?.trim()
  if (!repo || repo === '<none>') return img.id
  return `${repo}:${img.tag}`
}

async function removeImage(img: WslcImage) {
  if (!(await confirmAction('删除镜像', `删除镜像「${imageLabel(img)}」？`))) return
  try {
    await store.removeImage(imageRef(img))
    message.success('镜像已删除')
  } catch (e) {
    message.error(errorLine(e, '删除镜像失败'))
  }
}

async function removeNetwork(name: string) {
  if (!(await confirmAction('删除网络', `删除网络「${name}」？`))) return
  try {
    await store.removeNetwork(name)
    message.success('网络已删除')
  } catch (e) {
    message.error(errorLine(e, '删除网络失败'))
  }
}

async function createVolume() {
  if (!volumeName.value.trim()) {
    message.warning('请输入卷名')
    return
  }
  try {
    await store.createVolume(volumeName.value.trim())
    message.success('卷已创建')
  } catch (e) {
    message.error(errorLine(e, '创建卷失败'))
  }
}

async function removeVolume(name: string) {
  if (!(await confirmAction('删除卷', `删除卷「${name}」？数据将无法恢复。`))) return
  try {
    await store.removeVolume(name)
    message.success('卷已删除')
  } catch (e) {
    message.error(errorLine(e, '删除卷失败'))
  }
}

async function saveSettings() {
  try {
    await store.saveSettings(settingsText.value)
    message.success('wslc settings.yaml 已保存')
  } catch (e) {
    message.error(errorLine(e, '保存 wslc 设置失败'))
  }
}

async function resetSettings() {
  if (
    !(await confirmAction('重置 wslc 设置', '将执行 wslc settings reset，覆盖当前 settings.yaml。'))
  )
    return
  try {
    await window.wslAPI.containers.settingsReset()
    await store.loadSettings()
    settingsText.value = store.settings?.content ?? ''
    message.success('已重置 wslc 设置')
  } catch (e) {
    message.error(errorLine(e, '重置 wslc 设置失败'))
  }
}

async function terminateSession() {
  if (
    !(await confirmAction(
      '终止容器会话',
      '将执行 wslc system session terminate，停止该会话中的所有容器。确定吗？',
    ))
  )
    return
  try {
    const h = await store.terminateSession()
    notifyTask(h, '已提交终止会话')
  } catch (e) {
    message.error(errorLine(e, '终止会话失败'))
  }
}

function formatBytes(n: number): string {
  if (!n) return '—'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let v = n
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(i ? 1 : 0)}${units[i]}`
}

function imageLabel(img: WslcImage): string {
  return imageRef(img) === img.id ? img.id.slice(0, 12) : imageRef(img)
}
</script>

<template>
  <div class="containers-page">
    <header class="page-header">
      <div>
        <h1>容器</h1>
        <p class="sub">
          WSL 3 原生容器（wslc）· 镜像 / 网络 / 卷 / 系统会话
          <template v-if="store.status?.version"> · wslc {{ store.status.version }}</template>
        </p>
      </div>
      <div class="header-actions">
        <n-button secondary :loading="store.loading" @click="refresh(true)">刷新</n-button>
        <n-button type="primary" :disabled="!store.installed" @click="runOpen = true"
          >运行容器</n-button
        >
      </div>
    </header>

    <n-alert v-if="store.lastError" type="error" closable>
      {{ store.lastError.message }}
      <template v-if="store.lastError.suggestion"> — {{ store.lastError.suggestion }}</template>
    </n-alert>

    <n-alert v-if="!store.installed" type="warning">
      未检测到 wslc。WSL 容器需要 WSL 2.9.3+；请先执行
      <code>wsl --update</code>，完成后回到本页刷新。
    </n-alert>

    <section class="summary">
      <div class="summary-card">
        <span class="summary-label">运行中</span>
        <strong>{{ summary.running }}</strong>
        <span class="summary-hint">共 {{ summary.containers }} 个容器</span>
      </div>
      <div class="summary-card">
        <span class="summary-label">镜像</span>
        <strong>{{ summary.images }}</strong>
        <span class="summary-hint">本地镜像</span>
      </div>
      <div class="summary-card">
        <span class="summary-label">网络 / 卷</span>
        <strong>{{ summary.networks }} / {{ summary.volumes }}</strong>
        <span class="summary-hint">wslc 资源</span>
      </div>
      <div class="summary-card">
        <span class="summary-label">会话存储</span>
        <strong>{{ summary.storage ? formatBytes(summary.storage) : '—' }}</strong>
        <span class="summary-hint">{{ store.sessions.length }} 个会话</span>
      </div>
    </section>

    <n-tabs v-model:value="tab" type="line" animated>
      <n-tab-pane name="containers" :tab="`容器 ${store.containers.length}`">
        <div class="toolbar">
          <n-button
            size="small"
            secondary
            :disabled="!store.installed"
            @click="store.loadContainers()"
            >刷新</n-button
          >
          <n-button size="small" secondary :disabled="!store.installed" @click="pruneContainers"
            >清理已停止</n-button
          >
        </div>
        <table class="table">
          <thead>
            <tr>
              <th>名称</th>
              <th>镜像</th>
              <th>状态</th>
              <th>端口</th>
              <th>CPU / 内存</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="c in store.containers" :key="c.id">
              <td>
                <button class="link" type="button" @click="inspect(c)">{{ c.name }}</button>
                <div class="muted mono">{{ c.id.slice(0, 12) }}</div>
              </td>
              <td class="mono">{{ c.image }}</td>
              <td>
                <n-tag
                  size="tiny"
                  :bordered="false"
                  :type="c.state === 'running' ? 'success' : 'default'"
                >
                  {{ c.state }}
                </n-tag>
                <n-tag
                  v-if="c.health !== 'none'"
                  size="tiny"
                  :bordered="false"
                  :type="c.health === 'healthy' ? 'success' : 'warning'"
                >
                  {{ c.health }}
                </n-tag>
              </td>
              <td class="mono">
                <div v-for="p in c.ports" :key="`${p.host}-${p.container}`">
                  {{ p.host }} → {{ p.container }}
                </div>
                <span v-if="c.ports.length === 0" class="muted">—</span>
              </td>
              <td class="mono">
                <template v-if="store.statsFor(c.id)">
                  {{ store.statsFor(c.id)!.cpuPercent.toFixed(1) }}% ·
                  {{ formatBytes(store.statsFor(c.id)!.memUsedBytes) }}
                </template>
                <span v-else class="muted">—</span>
              </td>
              <td>
                <div class="row-actions">
                  <n-button
                    size="tiny"
                    secondary
                    :disabled="c.state !== 'running'"
                    @click="openTerminal(c)"
                    >终端</n-button
                  >
                  <n-button
                    size="tiny"
                    secondary
                    :disabled="!store.installed"
                    @click="lifecycle(() => store.logs(c.id, true), '已开始读取日志')"
                    >日志</n-button
                  >
                  <n-button
                    v-if="c.state !== 'running'"
                    size="tiny"
                    type="primary"
                    @click="lifecycle(() => store.start(c.id), '已提交启动')"
                    >启动</n-button
                  >
                  <n-button
                    v-else
                    size="tiny"
                    type="error"
                    @click="
                      lifecycle(
                        () => store.stop(c.id, settings.containersDefaultStopTimeoutSec),
                        '已提交停止',
                      )
                    "
                    >停止</n-button
                  >
                  <n-button
                    size="tiny"
                    quaternary
                    @click="lifecycle(() => store.restart(c.id), '已提交重启')"
                    >重启</n-button
                  >
                  <n-button size="tiny" quaternary type="error" @click="remove(c)">删除</n-button>
                </div>
              </td>
            </tr>
            <tr v-if="store.containers.length === 0">
              <td colspan="6" class="empty">还没有容器。点击右上角「运行容器」创建第一个。</td>
            </tr>
          </tbody>
        </table>
      </n-tab-pane>

      <n-tab-pane name="images" :tab="`镜像 ${store.images.length}`">
        <div class="toolbar wrap">
          <n-input
            v-model:value="pullRef"
            size="small"
            placeholder="镜像引用，如 nginx:latest"
            class="grow"
          />
          <n-button size="small" type="primary" @click="pull">拉取</n-button>
          <n-button size="small" secondary @click="pickContext">选择构建目录…</n-button>
          <n-input v-model:value="buildTag" size="small" placeholder="镜像 tag" class="input-sm" />
          <n-input
            v-model:value="buildContext"
            size="small"
            placeholder="Containerfile 所在 Windows 目录"
            class="grow"
          />
          <n-button size="small" secondary @click="build">构建</n-button>
          <n-button size="small" quaternary @click="pruneImagesAction">清理</n-button>
        </div>
        <table class="table">
          <thead>
            <tr>
              <th>镜像</th>
              <th>ID</th>
              <th>大小</th>
              <th>创建时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="img in store.images" :key="img.id">
              <td class="mono">{{ imageLabel(img) }}</td>
              <td class="mono">{{ img.id.slice(0, 12) }}</td>
              <td>{{ formatBytes(img.sizeBytes) }}</td>
              <td class="muted">{{ img.createdAt || '—' }}</td>
              <td>
                <n-button size="tiny" quaternary type="error" @click="removeImage(img)"
                  >删除</n-button
                >
              </td>
            </tr>
            <tr v-if="store.images.length === 0">
              <td colspan="5" class="empty">还没有镜像。</td>
            </tr>
          </tbody>
        </table>
      </n-tab-pane>

      <n-tab-pane name="networks" :tab="`网络 ${store.networks.length}`">
        <div class="toolbar">
          <n-input v-model:value="networkName" size="small" placeholder="网络名" />
          <n-button size="small" type="primary" @click="createNetwork">创建网络</n-button>
          <n-button size="small" secondary @click="pruneNetworks">清理</n-button>
        </div>
        <table class="table">
          <thead>
            <tr>
              <th>名称</th>
              <th>驱动</th>
              <th>子网</th>
              <th>容器</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="n in store.networks" :key="n.id">
              <td>{{ n.name }}</td>
              <td>{{ n.driver }}</td>
              <td class="mono">{{ n.subnet || '—' }}</td>
              <td>{{ n.containers.join(', ') || '—' }}</td>
              <td>
                <n-button
                  size="tiny"
                  quaternary
                  type="error"
                  :disabled="['bridge', 'host', 'none'].includes(n.name)"
                  @click="removeNetwork(n.name)"
                  >删除</n-button
                >
              </td>
            </tr>
            <tr v-if="store.networks.length === 0">
              <td colspan="5" class="empty">还没有网络。</td>
            </tr>
          </tbody>
        </table>
      </n-tab-pane>

      <n-tab-pane name="volumes" :tab="`卷 ${store.volumes.length}`">
        <div class="toolbar">
          <n-input v-model:value="volumeName" size="small" placeholder="卷名" />
          <n-button size="small" type="primary" @click="createVolume">创建卷</n-button>
          <n-button size="small" secondary @click="pruneVolumes">清理</n-button>
        </div>
        <table class="table">
          <thead>
            <tr>
              <th>名称</th>
              <th>驱动</th>
              <th>挂载点</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="v in store.volumes" :key="v.name">
              <td>{{ v.name }}</td>
              <td>{{ v.driver }}</td>
              <td class="mono">{{ v.mountpoint || '—' }}</td>
              <td>
                <n-button size="tiny" quaternary type="error" @click="removeVolume(v.name)"
                  >删除</n-button
                >
              </td>
            </tr>
            <tr v-if="store.volumes.length === 0">
              <td colspan="4" class="empty">还没有卷。</td>
            </tr>
          </tbody>
        </table>
      </n-tab-pane>

      <n-tab-pane name="system" tab="系统">
        <div class="system-grid">
          <section class="card block">
            <h2>容器会话</h2>
            <p class="muted">wslc 版本：{{ store.status?.version || '—' }}</p>
            <p class="muted">存储路径：{{ store.system?.storagePath || '—' }}</p>
            <p class="muted">
              存储占用：{{
                store.system?.storageBytes ? formatBytes(store.system.storageBytes) : '—'
              }}
            </p>
            <p class="muted mono">设置文件：{{ store.system?.settingsPath || '—' }}</p>
            <div v-for="s in store.sessions" :key="s.name" class="session-row">
              <span>{{ s.name }} · {{ s.state }}</span>
              <span class="mono">{{ s.storagePath || '' }}</span>
            </div>
            <n-button size="small" type="error" secondary class="mt" @click="terminateSession"
              >终止会话（停止所有容器）</n-button
            >
          </section>

          <section class="card block">
            <h2>wslc settings.yaml</h2>
            <p class="muted mono">
              {{ store.settings?.path || '%LOCALAPPDATA%\\wslc\\settings.yaml' }}
            </p>
            <CodeEditor
              v-model="settingsText"
              :min-height="220"
              placeholder="# wslc settings.yaml"
            />
            <div class="toolbar mt">
              <n-button size="small" type="primary" @click="saveSettings">保存</n-button>
              <n-button
                size="small"
                secondary
                @click="
                  store.loadSettings().then(() => (settingsText = store.settings?.content ?? ''))
                "
                >重新载入</n-button
              >
              <n-button size="small" quaternary type="error" @click="resetSettings"
                >重置为默认</n-button
              >
            </div>
          </section>
        </div>
      </n-tab-pane>
    </n-tabs>

    <n-modal
      v-model:show="runOpen"
      preset="card"
      title="运行容器"
      :style="{ width: '680px', maxWidth: '94vw' }"
    >
      <div class="form-grid">
        <label>配方</label>
        <div class="recipe-row">
          <n-select
            :value="recipeId || null"
            size="small"
            clearable
            placeholder="从 containers.jsonc 载入配方"
            :options="store.recipes.map((r) => ({ label: `${r.label} (${r.id})`, value: r.id }))"
            @update:value="
              (id: string | null) => {
                const r = store.recipes.find((x) => x.id === id)
                if (r) applyRecipe(r)
              }
            "
          />
          <n-input v-model:value="recipeId" size="small" placeholder="配方 id" />
          <n-input v-model:value="recipeLabel" size="small" placeholder="配方名称" />
          <n-button size="small" secondary @click="saveRecipe">保存配方</n-button>
          <n-button
            size="small"
            quaternary
            type="error"
            :disabled="!recipeId"
            @click="deleteRecipe"
          >
            删除
          </n-button>
        </div>
        <label>镜像</label>
        <n-input v-model:value="form.image" placeholder="nginx:latest" />
        <label>容器名</label>
        <n-input v-model:value="form.name" placeholder="可空（自动生成）" />
        <label>命令参数</label>
        <n-input
          v-model:value="form.command"
          type="textarea"
          :rows="2"
          placeholder="每行一个 argv（可空 = 镜像默认 CMD）"
        />
        <label>端口映射</label>
        <n-input
          v-model:value="form.ports"
          type="textarea"
          :rows="2"
          placeholder="8080:80（每行一条）"
        />
        <label>挂载</label>
        <n-input
          v-model:value="form.mounts"
          type="textarea"
          :rows="2"
          placeholder="D:\\www:/usr/share/nginx/html:ro（每行一条）"
        />
        <label>环境变量</label>
        <n-input
          v-model:value="form.env"
          type="textarea"
          :rows="2"
          placeholder="KEY=VALUE（每行一条）"
        />
        <label>网络</label>
        <n-input v-model:value="form.network" placeholder="bridge / 自定义网络（可空）" />
        <label>内存上限</label>
        <n-input v-model:value="form.memory" placeholder="512M / 2GB（可空）" />
        <label>CPU 数量</label>
        <n-input-number v-model:value="form.cpus" :min="0.1" :max="1024" :step="0.5" clearable />
        <label>GPU</label>
        <n-switch v-model:value="form.gpus" />
        <label>健康检查命令</label>
        <n-input
          v-model:value="form.healthCmd"
          placeholder="可空，例如 curl -f http://localhost/"
        />
        <label>检查间隔 / 超时</label>
        <div class="inline-inputs">
          <n-input v-model:value="form.healthInterval" size="small" placeholder="5s" />
          <n-input v-model:value="form.healthTimeout" size="small" placeholder="3s" />
        </div>
        <label>检查重试次数</label>
        <n-input-number v-model:value="form.healthRetries" :min="0" :max="100" clearable />
        <label>停止超时（秒）</label>
        <n-input-number v-model:value="form.stopTimeout" :min="1" :max="300" />
        <label>后台运行</label>
        <n-switch v-model:value="form.detach" />
        <label>退出后删除</label>
        <n-switch v-model:value="form.rm" />
        <label>先拉取镜像</label>
        <n-switch v-model:value="form.pull" />
      </div>
      <div class="preview">
        <div class="muted">等价命令</div>
        <code>{{ preview }}</code>
      </div>
      <template #footer>
        <div class="footer">
          <n-button secondary @click="runOpen = false">取消</n-button>
          <n-button type="primary" :disabled="!previewValid" @click="doRun"> 运行 </n-button>
        </div>
      </template>
    </n-modal>

    <n-modal
      v-model:show="inspectOpen"
      preset="card"
      title="容器详情"
      :style="{ width: '720px', maxWidth: '94vw' }"
    >
      <div v-if="inspectData" class="inspect-grid">
        <span class="muted">镜像</span><span class="mono">{{ inspectData.image }}</span>
        <span class="muted">状态</span
        ><span>{{ inspectData.state }} · {{ inspectData.status }}</span>
        <span class="muted">命令</span
        ><span class="mono">{{ inspectData.command?.join(' ') || '—' }}</span>
        <span class="muted">网络</span><span>{{ inspectData.networks?.join(', ') || '—' }}</span>
        <template v-if="inspectData.mounts?.length">
          <span class="muted">挂载</span>
          <span class="mono">
            {{
              inspectData.mounts
                .map((m) => `${m.host} → ${m.container}${m.readOnly ? ' (ro)' : ''}`)
                .join('; ')
            }}
          </span>
        </template>
      </div>
      <div v-if="inspectData?.env && Object.keys(inspectData.env).length" class="env-block">
        <div class="env-head">
          <span class="muted">环境变量（{{ Object.keys(inspectData.env).length }}）</span>
          <n-button size="tiny" text type="primary" @click="showEnvValues = !showEnvValues">
            {{ showEnvValues ? '隐藏值' : '显示值' }}
          </n-button>
        </div>
        <code v-for="[k, v] in Object.entries(inspectData.env)" :key="k" class="env-line"
          >{{ k }}={{ showEnvValues || !maskEnvValues ? v : '••••••' }}</code
        >
      </div>
      <details class="raw">
        <summary>原始 inspect JSON</summary>
        <pre class="inspect">{{ inspectRawText }}</pre>
      </details>
      <div class="copy-row">
        <n-input v-model:value="inspectSrc" size="small" placeholder="源：web:/path 或 D:\\path" />
        <n-input v-model:value="inspectDst" size="small" placeholder="目标：/path 或 D:\\path" />
        <n-button size="small" type="primary" @click="copyContainerFile">复制文件</n-button>
      </div>
    </n-modal>
  </div>
</template>

<style scoped>
.containers-page {
  padding: 24px;
  max-width: 1400px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}

.page-header h1 {
  margin: 0;
  font-size: 24px;
  font-weight: 650;
  color: var(--color-text-primary);
}

.sub {
  margin: 4px 0 0;
  font-size: 13px;
  color: var(--color-text-secondary);
}

.header-actions,
.toolbar,
.row-actions,
.footer {
  display: flex;
  align-items: center;
  gap: 8px;
}

.toolbar {
  margin-bottom: 10px;
}

.toolbar.wrap {
  flex-wrap: wrap;
}

.grow {
  flex: 1;
  min-width: 180px;
}

.input-sm {
  width: 160px;
}

.table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12.5px;
  background: var(--color-bg-surface);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
  overflow: hidden;
}

.table th {
  text-align: left;
  padding: 9px 10px;
  background: var(--color-bg-sunken);
  color: var(--color-text-secondary);
  font-weight: 600;
  white-space: nowrap;
}

.table td {
  padding: 8px 10px;
  border-top: 1px solid var(--color-border-subtle);
  vertical-align: middle;
}

.mono {
  font-family: var(--font-mono);
}

.muted {
  color: var(--color-text-tertiary);
}

.link {
  color: var(--color-text-link);
  font-weight: 600;
}

.empty {
  text-align: center;
  color: var(--color-text-tertiary);
  padding: 28px;
}

.card {
  background: var(--color-bg-surface);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
}

.block {
  padding: 18px 20px;
}

.block h2 {
  margin: 0 0 8px;
  font-size: 15px;
}

.system-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
}

@media (width <= 960px) {
  .system-grid {
    grid-template-columns: 1fr;
  }
}

.session-row {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  padding: 6px 0;
  border-top: 1px solid var(--color-border-subtle);
  font-size: 12px;
}

.mt {
  margin-top: 10px;
}

.form-grid {
  display: grid;
  grid-template-columns: 110px 1fr;
  gap: 10px 12px;
  align-items: center;
}

.form-grid label {
  text-align: right;
  font-size: 12px;
  color: var(--color-text-secondary);
}

.preview,
.inspect {
  margin-top: 14px;
  padding: 10px 12px;
  border-radius: var(--radius-md);
  background: var(--color-bg-sunken);
  font-family: var(--font-mono);
  font-size: 11.5px;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 320px;
  overflow: auto;
}

.footer {
  justify-content: flex-end;
}

.summary {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.summary-card {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 12px 14px;
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-lg);
  background: var(--color-bg-surface);
}

.summary-label {
  font-size: 11px;
  color: var(--color-text-tertiary);
}

.summary-card strong {
  font-size: 20px;
  color: var(--color-text-primary);
}

.summary-hint {
  font-size: 11px;
  color: var(--color-text-tertiary);
}

@media (width <= 960px) {
  .summary {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

.recipe-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}

.recipe-row > :first-child {
  min-width: 220px;
}

.inline-inputs {
  display: flex;
  gap: 8px;
}

.inspect-grid {
  display: grid;
  grid-template-columns: 92px 1fr;
  gap: 6px 10px;
  font-size: 12px;
}

.env-block {
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 180px;
  overflow: auto;
}

.env-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.env-line {
  font-size: 11.5px;
  overflow-wrap: anywhere;
}

.raw {
  margin-top: 12px;
}

.raw summary {
  cursor: pointer;
  font-size: 12px;
  color: var(--color-text-secondary);
}

.copy-row {
  display: flex;
  gap: 8px;
  margin-top: 12px;
}

code {
  font-family: var(--font-mono);
}
</style>
