<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { NButton, NPopconfirm, useMessage } from 'naive-ui'
import { useRouter } from 'vue-router'
import type { WslEnvInfo } from '@wslpilot/shared'
import { useContainersStore } from '../stores/containers'
import { useDistrosStore } from '../stores/distros'
import { useMetricsStore } from '../stores/metrics'
import { useSettingsStore } from '../stores/settings'
import { useTasksStore } from '../stores/tasks'
import { usePolling } from '../composables/usePolling'
import { errorLine } from '../composables/useAppError'
import { MetricCard, DistroCard, EmptyState, StatusDot, Skeleton } from '@wslpilot/ui'
import { vRipple } from '@wslpilot/ui'
import { ACCENT_GRADIENTS, DEFAULT_POLL_INTERVAL_MS, type DistroView } from '@wslpilot/shared'
import InstallDistroModal from '../features/distros/InstallDistroModal.vue'
import DistroDetailModal from '../features/distros/DistroDetailModal.vue'

const router = useRouter()
const distros = useDistrosStore()
const metrics = useMetricsStore()
const containers = useContainersStore()
const settings = useSettingsStore()
const tasks = useTasksStore()
const message = useMessage()

const installOpen = ref(false)
const cleaning = ref(false)
const detailOpen = ref(false)
const detailName = ref('')

/** 问候语在每次路由进入（组件挂载）时重算：跨天后不让旧问候语僵在页面上 */
function greetingText() {
  const hour = new Date().getHours()
  return hour < 12 ? '早上好' : hour < 18 ? '下午好' : '晚上好'
}
const greeting = ref(greetingText())
const gradient = computed(() => ACCENT_GRADIENTS[settings.accent] ?? ACCENT_GRADIENTS.aurora)

const wslInfo = ref({ wslVersion: '', kernelVersion: '' })
const wslLabel = computed(() => {
  if (wslInfo.value.wslVersion) return `WSL ${wslInfo.value.wslVersion}`
  return 'WSL'
})

/** WSL 环境（0.1.3）：hero 内提供「更新 WSL」入口（已安装时显示） */
const wslEnv = ref<WslEnvInfo | null>(null)

async function onUpdateWsl() {
  const entry = await tasks.startUpdate()
  if (!entry) {
    message.error(errorLine(tasks.lastError, '启动更新失败'))
    return
  }
  message.info('已开始更新 WSL，进度见状态栏与任务抽屉')
}

/**
 * 首页展示排序（review 0.1.2 根治）：running → default → pinned → 名称。
 * 此前直接 slice(0, 6) 截断原始列表，最关心的运行中发行版可能被截掉。
 */
const topDistros = computed(() => {
  const score = (d: DistroView) =>
    (d.state === 'Running' ? 4 : 0) + (d.isDefault ? 2 : 0) + (d.meta?.pinned ? 1 : 0)
  return [...distros.visibleItems]
    .sort((a, b) => {
      const diff = score(b) - score(a)
      return diff !== 0 ? diff : a.name.localeCompare(b.name)
    })
    .slice(0, 6)
})

/** 错误横幅：发行版列表与指标采样的错误合并展示，两个来源都有出口 */
const errorBanner = computed(
  () => distros.lastError ?? metrics.lastError ?? containers.lastError ?? null,
)

/** WSL 缺失（未安装 / 找不到 wsl.exe）：横幅内给「一键安装 WSL」入口（0.1.3） */
const wslMissing = computed(() => {
  const code = errorBanner.value?.code
  return code === 'WSL_NOT_INSTALLED' || code === 'WSL_NOT_FOUND'
})

const pollInterval = computed(() => {
  const ms = settings.pollIntervalMs
  return typeof ms === 'number' && ms >= 1000 ? ms : DEFAULT_POLL_INTERVAL_MS
})

async function refreshAll() {
  await Promise.all([distros.refresh(), metrics.sample()])
}

onMounted(() => {
  // 每次路由进入重算问候语（跨天/长时间挂起后语义正确）
  greeting.value = greetingText()
  // 容器指标卡：wslc 缺失时 store 内部降级为未安装，不影响驾驶舱其余部分
  void containers.loadAll()
  // settings.general.autoRefreshOnStart：关闭后仅在尚无数据时兜底拉取一次
  if (settings.autoRefreshOnStart || distros.items.length === 0) void refreshAll()
  // 版本探测失败（如 getVersion 双失败抛 AppError）不得成为 unhandled rejection 炸页：
  // 兜底 catch + 同步异常 try，hero 文案静默保持「WSL」
  void (async () => {
    try {
      const info = await window.wslAPI.app.getWslVersion()
      if (info) wslInfo.value = { wslVersion: info.wslVersion, kernelVersion: info.kernelVersion }
    } catch {
      /* 版本未知：保持 wslLabel 降级文案 */
    }
    // 0.1.3：环境体检（只用于 hero 的「更新 WSL」入口显隐；失败静默）
    try {
      wslEnv.value = await window.wslAPI.app.wslEnv()
    } catch {
      wslEnv.value = null
    }
  })()
})

const { start: startPolling, stop: stopPolling } = usePolling(() => void refreshAll(), {
  intervalMs: pollInterval,
})
// settings.general.autoRefreshOnStart 必须真正关掉轮询：
// 早期实现只挡首刷，提示语「关闭后仅在手动点击刷新时查询」不成立（review M-2 根治）
watch(
  () => settings.autoRefreshOnStart,
  (on) => (on ? startPolling() : stopPolling()),
  { immediate: true },
)

const memLabel = computed(() => metrics.memLabel)

async function action(fn: () => Promise<void>, ok: string) {
  try {
    await fn()
    message.success(ok)
    await refreshAll()
  } catch (e) {
    message.error(errorLine(e))
  }
}

function onStart(name: string) {
  void action(() => distros.start(name), `已启动 ${name}`)
}
function onTerminate(name: string) {
  void action(() => distros.terminate(name), `已停止 ${name}`)
}
function onSetDefault(name: string) {
  void action(() => distros.setDefault(name), `已将 ${name} 设为默认`)
}
function onShutdown() {
  void action(() => distros.shutdownAll(), '已关闭全部发行版')
}

/** 清理旧备份：按「保留份数」轮转备份目录（真实功能，非死按钮） */
async function onCleanupBackups() {
  cleaning.value = true
  try {
    const { removed } = await window.wslAPI.io.cleanupBackups({
      dir: settings.backupDefaultDir || undefined,
      // keep 防御（review 0.1.2 根治）：非法/缺失值不得传入 0 把备份清空
      keep: Math.max(1, settings.backupKeepRecent),
    })
    message.success(removed > 0 ? `已清理 ${removed} 份旧备份` : '没有需要清理的旧备份')
  } catch (e) {
    message.error(errorLine(e, '清理旧备份失败'))
  } finally {
    cleaning.value = false
  }
}

function onOpenNetwork() {
  void router.push('/network')
}

function onOpenTerminal(name: string) {
  void router.push({ path: '/terminal', query: { distro: name } })
}
function onMore(name: string) {
  detailName.value = name
  detailOpen.value = true
}

function onDetailTerminal(name: string) {
  detailOpen.value = false
  void router.push({ path: '/terminal', query: { distro: name } })
}
</script>

<template>
  <div class="dashboard">
    <header class="hero">
      <div>
        <h1 class="greeting">{{ greeting }}，指挥官</h1>
        <p class="sub">
          {{ wslLabel }} · {{ distros.items.length }} 个发行版 ·
          <StatusDot
            :state="distros.runningCount > 0 ? 'Running' : 'Stopped'"
            :size="8"
            class="inline-dot"
          />
          {{ distros.runningCount }} 个运行中
          <template v-if="wslInfo.kernelVersion">
            · 内核 {{ wslInfo.kernelVersion.split(/\s+/)[0] }}
          </template>
          <n-button
            v-if="wslEnv?.installed"
            size="tiny"
            quaternary
            class="update-wsl"
            aria-label="更新 WSL"
            @click="onUpdateWsl"
          >
            更新 WSL
          </n-button>
        </p>
      </div>
      <div class="hero-actions">
        <n-button secondary :loading="distros.loading" @click="refreshAll"> 刷新 </n-button>
        <n-button
          type="primary"
          :style="{ background: gradient, border: 'none' }"
          @click="installOpen = true"
        >
          + 安装发行版
        </n-button>
      </div>
    </header>

    <p v-if="errorBanner" class="error-banner">
      {{ errorBanner.message }}
      <span v-if="errorBanner.suggestion"> — {{ errorBanner.suggestion }}</span>
      <n-button
        v-if="wslMissing"
        size="tiny"
        type="primary"
        class="banner-action"
        @click="installOpen = true"
      >
        一键安装 WSL
      </n-button>
    </p>

    <section class="metrics" :class="{ 'has-containers': containers.installed }">
      <MetricCard
        label="运行中"
        :value="metrics.overview.runningCount"
        :hint="`共 ${metrics.overview.totalCount} 个发行版`"
        pulse
      />
      <MetricCard label="内存占用" :value="memLabel" hint="已采样 Running 发行版合计" />
      <MetricCard label="磁盘占用" :value="metrics.diskLabel" hint="根分区合计（KB 真值累加）" />
      <MetricCard
        label="CPU 负载"
        :value="metrics.cpuLabel"
        hint="/proc/stat 双采样差分（真实占用）"
        :history="metrics.history.cpu"
      />
      <MetricCard
        v-if="containers.installed"
        label="容器"
        :value="containers.running.length"
        :hint="`共 ${containers.containers.length} 个容器`"
        pulse
      />
    </section>

    <section v-if="containers.installed" class="panel card">
      <div class="panel-head">
        <h2 class="panel-title">容器</h2>
        <div class="panel-head-actions">
          <n-button text type="primary" @click="router.push('/containers?run=1')">
            运行容器
          </n-button>
          <n-button text type="primary" @click="router.push('/containers')"> 全部 → </n-button>
        </div>
      </div>
      <div v-if="containers.containers.length === 0" class="container-empty">
        <span class="muted">还没有容器，运行第一个 WSL 3 容器</span>
        <n-button type="primary" size="small" @click="router.push('/containers?run=1')">
          运行容器
        </n-button>
      </div>
      <div v-else class="container-list">
        <button
          v-for="c in containers.containers.slice(0, 3)"
          :key="c.id"
          class="container-row"
          type="button"
          @click="router.push('/containers')"
        >
          <span
            class="container-dot"
            :class="c.state === 'running' ? 'running' : 'stopped'"
            aria-hidden="true"
          />
          <span class="container-name">{{ c.name }}</span>
          <span class="container-image">{{ c.image }}</span>
          <span class="container-state">{{ c.state }}</span>
        </button>
      </div>
    </section>

    <section class="panel card">
      <div class="panel-head">
        <h2 class="panel-title">我的发行版</h2>
        <n-button text type="primary" @click="router.push('/distros')"> 全部 → </n-button>
      </div>

      <div v-if="distros.loading && distros.items.length === 0" class="skeleton-cards">
        <Skeleton v-for="i in 3" :key="i" height="132px" radius="16px" />
      </div>

      <div v-else-if="distros.items.length === 0" class="empty-wrap">
        <EmptyState description="还没有发行版，去安装一个" illustration="🛫" size="large">
          <n-button type="primary" size="small" @click="installOpen = true">安装发行版</n-button>
        </EmptyState>
      </div>

      <div v-else class="cards">
        <DistroCard
          v-for="d in topDistros"
          :key="d.name"
          :distro="d"
          :busy="distros.isBusy(d.name)"
          @start="onStart"
          @terminate="onTerminate"
          @set-default="onSetDefault"
          @open-terminal="onOpenTerminal"
          @more="onMore"
        />
      </div>
    </section>

    <section class="panel card">
      <h2 class="panel-title">快捷操作</h2>
      <div class="quick">
        <n-popconfirm @positive-click="onShutdown">
          <template #trigger>
            <n-button v-ripple secondary class="press-scale"> 🔌 全部关机 </n-button>
          </template>
          将执行 <code>wsl --shutdown</code>，关闭所有运行中的发行版，确定吗？
        </n-popconfirm>
        <n-button v-ripple secondary class="press-scale" @click="router.push('/backup')">
          📦 备份
        </n-button>
        <n-popconfirm @positive-click="onCleanupBackups">
          <template #trigger>
            <n-button v-ripple secondary class="press-scale" :loading="cleaning">
              🧹 清理旧备份
            </n-button>
          </template>
          将按「保留份数 {{ settings.backupKeepRecent }}」清理备份目录中的旧备份文件，确定吗？
        </n-popconfirm>
        <n-button v-ripple secondary class="press-scale" @click="onOpenNetwork">
          🧭 网络配置
        </n-button>
      </div>
    </section>

    <InstallDistroModal v-model:show="installOpen" />
    <DistroDetailModal
      v-model:show="detailOpen"
      :distro-name="detailName"
      @open-terminal="onDetailTerminal"
    />
  </div>
</template>

<style scoped>
.dashboard {
  padding: 24px;
  display: flex;
  flex-direction: column;
  gap: 20px;
  max-width: 1200px;
  margin: 0 auto;
}

.hero {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
}

.greeting {
  font-size: 24px;
  font-weight: 650;
  line-height: 1.25;
  color: var(--color-text-primary);
}

.sub {
  margin-top: 4px;
  color: var(--color-text-secondary);
  font-size: 13px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.inline-dot {
  display: inline-block;
  vertical-align: middle;
}

.update-wsl {
  --n-height: 20px !important;
  --n-font-size: 11px !important;
  --n-padding: 0 6px !important;
}

.hero-actions {
  display: flex;
  gap: 10px;
}

/* review 0.1.2 审计修复：硬编码 10px 与 ui 包 radius-md 令牌（12px）不一致，统一令牌化 */
.error-banner {
  padding: 10px 14px;
  border-radius: var(--radius-md, 12px);
  background: color-mix(in srgb, var(--color-danger) 10%, transparent);
  color: var(--color-danger);
  font-size: 13px;
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.banner-action {
  flex-shrink: 0;
}

.metrics {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
}

.metrics.has-containers {
  grid-template-columns: repeat(5, minmax(0, 1fr));
}

@media (width <= 1100px) {
  .metrics,
  .metrics.has-containers {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@media (width <= 820px) {
  .metrics,
  .metrics.has-containers {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (width <= 640px) {
  .metrics,
  .metrics.has-containers {
    grid-template-columns: 1fr;
  }
}

.panel {
  padding: 20px 22px;
}

.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
}

.panel-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--color-text-primary);
  margin: 0;
}

.cards {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 14px;
}

@media (width <= 960px) {
  .cards {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (width <= 640px) {
  .cards {
    grid-template-columns: 1fr;
  }
}

.empty-wrap {
  padding: 24px 0;
}

.skeleton-cards {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 14px;
}

@media (width <= 960px) {
  .skeleton-cards {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (width <= 640px) {
  .skeleton-cards {
    grid-template-columns: 1fr;
  }
}

.quick {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.panel-head-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.container-empty {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 0 4px;
}

.muted {
  color: var(--color-text-tertiary);
  font-size: 12.5px;
}

.container-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.container-row {
  display: grid;
  grid-template-columns: 10px minmax(0, 1fr) minmax(0, 1.2fr) auto;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 8px;
  text-align: left;
  font-size: 12.5px;
  color: var(--color-text-secondary);
}

.container-row:hover {
  background: var(--color-bg-hover);
}

.container-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
}

.container-dot.running {
  background: var(--color-success);
}

.container-dot.stopped {
  background: var(--color-text-tertiary);
}

.container-name {
  font-weight: 600;
  color: var(--color-text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.container-image {
  font-family: var(--font-mono);
  font-size: 11.5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.container-state {
  font-size: 11px;
  color: var(--color-text-tertiary);
}
</style>
