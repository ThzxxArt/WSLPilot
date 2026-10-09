<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { NButton, NEmpty, NPopconfirm, useMessage } from 'naive-ui'
import { useRouter } from 'vue-router'
import { useDistrosStore } from '../stores/distros'
import { useMetricsStore } from '../stores/metrics'
import { useSettingsStore } from '../stores/settings'
import { usePolling } from '../composables/usePolling'
import { MetricCard, DistroCard, StatusDot } from '@ui/components'
import { ACCENT_GRADIENTS } from '@shared/constants'

const router = useRouter()
const distros = useDistrosStore()
const metrics = useMetricsStore()
const settings = useSettingsStore()
const message = useMessage()

const hour = new Date().getHours()
const greeting = hour < 12 ? '早上好' : hour < 18 ? '下午好' : '晚上好'
const gradient = computed(() => ACCENT_GRADIENTS[settings.accent] ?? ACCENT_GRADIENTS.aurora)

const wslInfo = ref({ wslVersion: '', kernelVersion: '' })
const wslLabel = computed(() => {
  if (wslInfo.value.wslVersion) return `WSL ${wslInfo.value.wslVersion}`
  return 'WSL'
})

const pollInterval = computed(() => {
  const ms = settings.pollIntervalMs
  return typeof ms === 'number' && ms >= 1000 ? ms : 5000
})

async function refreshAll() {
  await Promise.all([distros.refresh(), metrics.sample()])
}

onMounted(() => {
  void refreshAll()
  void window.wslAPI.app.getWslVersion().then((info) => {
    if (info) wslInfo.value = { wslVersion: info.wslVersion, kernelVersion: info.kernelVersion }
  }).catch(() => {})
})

const { start: startPolling } = usePolling(() => void refreshAll(), {
  intervalMs: pollInterval,
})
startPolling()

const memLabel = computed(() => metrics.memLabel)

async function action(fn: () => Promise<void>, ok: string) {
  try {
    await fn()
    message.success(ok)
    await refreshAll()
  } catch (e: any) {
    message.error(e?.message || '操作失败')
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
function onOpenTerminal(name: string) {
  message.info(`终端将在 M3 交付（${name}）`)
}
function onMore(name: string) {
  void router.push({ path: '/distros', query: { focus: name } })
}
</script>

<template>
  <div class="dashboard">
    <header class="hero">
      <div>
        <h1 class="greeting">
          {{ greeting }}，指挥官
        </h1>
        <p class="sub">
          {{ wslLabel }} · {{ distros.items.length }} 个发行版 ·
          <StatusDot
            state="Running"
            :size="8"
            class="inline-dot"
          />
          {{ distros.runningCount }} 个运行中
          <template v-if="wslInfo.kernelVersion">
            · 内核 {{ wslInfo.kernelVersion.split(/\s+/)[0] }}
          </template>
        </p>
      </div>
      <div class="hero-actions">
        <n-button
          secondary
          :loading="distros.loading"
          @click="refreshAll"
        >
          刷新
        </n-button>
        <n-button
          type="primary"
          :style="{ background: gradient, border: 'none' }"
          disabled
        >
          + 安装发行版
        </n-button>
      </div>
    </header>

    <p
      v-if="distros.lastError"
      class="error-banner"
    >
      {{ distros.lastError.message }}
      <span v-if="distros.lastError.suggestion"> — {{ distros.lastError.suggestion }}</span>
    </p>

    <section class="metrics">
      <MetricCard
        label="运行中"
        :value="metrics.overview.runningCount"
        :hint="`共 ${metrics.overview.totalCount} 个发行版`"
        :history="metrics.history.running"
      />
      <MetricCard
        label="内存占用"
        :value="memLabel"
        hint="已采样 Running 发行版合计"
        :history="metrics.history.mem"
      />
      <MetricCard
        label="磁盘占用"
        :value="metrics.diskLabel"
        hint="根分区合计（KB 真值累加）"
        :history="metrics.history.disk"
      />
      <MetricCard
        label="CPU 负载"
        :value="metrics.cpuLabel"
        hint="基于 loadavg 估算"
        :history="metrics.history.cpu"
      />
    </section>

    <section class="panel card">
      <div class="panel-head">
        <h2 class="panel-title">
          我的发行版
        </h2>
        <n-button
          text
          type="primary"
          @click="router.push('/distros')"
        >
          全部 →
        </n-button>
      </div>

      <div
        v-if="distros.items.length === 0"
        class="empty-wrap"
      >
        <n-empty description="还没有发行版数据">
          <template #extra>
            <n-button
              size="small"
              secondary
              @click="refreshAll"
            >
              重新加载
            </n-button>
          </template>
        </n-empty>
      </div>

      <div
        v-else
        class="cards"
      >
        <DistroCard
          v-for="d in distros.items.slice(0, 6)"
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
      <h2 class="panel-title">
        快捷操作
      </h2>
      <div class="quick">
        <n-popconfirm @positive-click="onShutdown">
          <template #trigger>
            <n-button secondary>
              🔌 全部关机
            </n-button>
          </template>
          将执行 <code>wsl --shutdown</code>，关闭所有运行中的发行版，确定吗？
        </n-popconfirm>
        <n-button
          secondary
          disabled
        >
          📦 备份
        </n-button>
        <n-button
          secondary
          disabled
        >
          🧹 清理
        </n-button>
        <n-button
          secondary
          disabled
        >
          🧭 网络配置
        </n-button>
      </div>
    </section>
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

.hero-actions {
  display: flex;
  gap: 10px;
}

.error-banner {
  padding: 10px 14px;
  border-radius: 10px;
  background: color-mix(in srgb, var(--color-danger) 10%, transparent);
  color: var(--color-danger);
  font-size: 13px;
}

.metrics {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
}

@media (width <= 1100px) {
  .metrics {
    grid-template-columns: repeat(2, 1fr);
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

.quick {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
</style>
