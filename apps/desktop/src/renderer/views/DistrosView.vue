<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import {
  NButton,
  NInput,
  NPopconfirm,
  NRadioGroup,
  NRadioButton,
  NSelect,
  NTag,
  useMessage,
} from 'naive-ui'
import { useRoute, useRouter } from 'vue-router'
import { useDistrosStore } from '../stores/distros'
import { useSettingsStore } from '../stores/settings'
import { usePolling } from '../composables/usePolling'
import { errorLine } from '../composables/useAppError'
import { DEFAULT_POLL_INTERVAL_MS } from '@wslpilot/shared'
import { DistroCard, EmptyState, StatusDot, Skeleton } from '@wslpilot/ui'
import { stateLabel } from '../composables/state-label'
import DistroDetailModal from '../features/distros/DistroDetailModal.vue'

const route = useRoute()
const router = useRouter()
const distros = useDistrosStore()
const message = useMessage()
const settings = useSettingsStore()

const viewMode = ref<'card' | 'table'>('card')
const search = ref('')
const tagFilter = ref<string | null>(null)
const detailOpen = ref(false)
const detailName = ref('')
/** 手动刷新标识（review 0.1.2 根治）：轮询刷新不得让按钮周期性闪 loading */
const refreshing = ref(false)

async function manualRefresh() {
  refreshing.value = true
  try {
    await distros.refresh()
  } finally {
    refreshing.value = false
  }
}

onMounted(() => {
  // settings.general.autoRefreshOnStart：关闭后仅在尚无数据时兜底拉取一次
  if (settings.autoRefreshOnStart || distros.items.length === 0) {
    void distros.refresh()
  }
})

const pollInterval = computed(() => {
  const ms = settings.pollIntervalMs
  return typeof ms === 'number' && ms >= 1000 ? ms : DEFAULT_POLL_INTERVAL_MS
})

const { start: startPolling, stop: stopPolling } = usePolling(() => void distros.refresh(), {
  intervalMs: pollInterval,
})
// settings.general.autoRefreshOnStart 必须真正关掉轮询（review M-2 根治）
watch(
  () => settings.autoRefreshOnStart,
  (on) => (on ? startPolling() : stopPolling()),
  { immediate: true },
)

const tagOptions = computed(() => {
  const set = new Set<string>()
  for (const d of distros.items) for (const t of d.meta?.tags ?? []) set.add(t)
  return [...set].map((t) => ({ label: t, value: t }))
})

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  return distros.items.filter((d) => {
    if (tagFilter.value && !(d.meta?.tags ?? []).includes(tagFilter.value)) return false
    if (!q) return true
    return (
      d.name.toLowerCase().includes(q) ||
      (d.meta?.alias ?? '').toLowerCase().includes(q) ||
      (d.meta?.note ?? '').toLowerCase().includes(q)
    )
  })
})

watch(
  () => route.query.focus,
  (name) => {
    if (typeof name === 'string' && name) {
      search.value = name
      clearQuery('focus')
    }
  },
  { immediate: true },
)

/** 命令面板「查看发行版」：跳转后直接打开详情弹窗（配置 / 动作 / 文件） */
watch(
  () => route.query.detail,
  (name) => {
    if (typeof name === 'string' && name) {
      detailName.value = name
      detailOpen.value = true
      clearQuery('detail')
    }
  },
  { immediate: true },
)

/**
 * 消费查询参数后清理（review 0.1.2 根治）：
 * 此前 focus/detail 永久留在 hash 上，刷新/撤销返回会重复过滤与弹窗。
 * router.replace 在部分嵌入/测试环境可能缺失，缺失时静默跳过（不影响页面功能）。
 */
function clearQuery(key: 'focus' | 'detail') {
  const replace = (router as { replace?: (to: { query: Record<string, unknown> }) => unknown })
    .replace
  if (typeof replace !== 'function') return
  const rest = { ...route.query }
  delete rest[key]
  void replace.call(router, { query: rest })
}

function stateLabelFn(s: string) {
  return stateLabel(s)
}

async function act(fn: () => Promise<void>, ok: string) {
  try {
    await fn()
    message.success(ok)
    await distros.refresh()
  } catch (e) {
    message.error(errorLine(e))
  }
}

function onStart(name: string) {
  void act(() => distros.start(name), `已启动 ${name}`)
}
function onTerminate(name: string) {
  void act(() => distros.terminate(name), `已停止 ${name}`)
}
function onSetDefault(name: string) {
  void act(() => distros.setDefault(name), `已设 ${name} 为默认`)
}
function onOpenTerminal(name: string) {
  void router.push({ path: '/terminal', query: { distro: name } })
}
function onMore(name: string) {
  detailName.value = name
  detailOpen.value = true
}

function clearFilters() {
  search.value = ''
  tagFilter.value = null
}

function onDetailTerminal(name: string) {
  detailOpen.value = false
  void router.push({ path: '/terminal', query: { distro: name } })
}
</script>

<template>
  <div class="distros">
    <header class="page-header">
      <div>
        <h1>发行版</h1>
        <p class="sub">
          来自 <code>wsl --list --verbose</code> · 实时状态 · 卡片上的按钮可直接启停
        </p>
      </div>
      <div class="toolbar">
        <n-input
          v-model:value="search"
          clearable
          placeholder="搜索名称 / 别名 / 备注"
          class="search"
        />
        <n-select
          v-model:value="tagFilter"
          clearable
          :options="tagOptions"
          placeholder="按标签筛选"
          class="tag-select"
        />
        <n-radio-group v-model:value="viewMode">
          <n-radio-button value="card"> 卡片 </n-radio-button>
          <n-radio-button value="table"> 表格 </n-radio-button>
        </n-radio-group>
        <n-button secondary :loading="refreshing" @click="manualRefresh"> 刷新 </n-button>
      </div>
    </header>

    <p v-if="distros.lastError" class="error-banner">
      {{ distros.lastError.message }}
      <span v-if="distros.lastError.suggestion"> — {{ distros.lastError.suggestion }}</span>
    </p>

    <!-- 首次加载：骨架屏（§12.8 流光扫过，而非转圈） -->
    <div v-if="distros.loading && distros.items.length === 0" class="grid" aria-busy="true">
      <Skeleton v-for="i in 6" :key="i" height="132px" radius="16px" />
    </div>

    <template v-else>
      <EmptyState
        v-if="filtered.length === 0 && !distros.loading"
        :description="search || tagFilter ? '没有匹配的发行版，换个关键词试试' : '尚未检测到发行版'"
        :illustration="search || tagFilter ? '🔍' : '🐧'"
      >
        <n-button v-if="search || tagFilter" size="small" secondary @click="clearFilters">
          清除筛选
        </n-button>
        <n-button v-else size="small" secondary :loading="refreshing" @click="manualRefresh">
          重新扫描
        </n-button>
      </EmptyState>

      <!-- 卡片网格 -->
      <div v-else-if="viewMode === 'card'" class="grid">
        <DistroCard
          v-for="d in filtered"
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

      <!-- 紧凑表格 -->
      <table v-else class="table">
        <caption class="sr-only">
          发行版列表（状态 / 名称 / 别名 / 版本 / 标签 / 操作）
        </caption>
        <thead>
          <tr>
            <th scope="col">状态</th>
            <th scope="col">名称</th>
            <th scope="col">别名</th>
            <th scope="col">版本</th>
            <th scope="col">标签</th>
            <th scope="col">操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="d in filtered" :key="d.name">
            <td>
              <span class="status-cell">
                <StatusDot :state="d.state" :size="8" />
                {{ stateLabelFn(d.state) }}
              </span>
            </td>
            <td>
              <span class="name-cell">
                {{ d.name }}
                <n-tag v-if="d.isDefault" size="tiny" :bordered="false" type="info">默认</n-tag>
              </span>
            </td>
            <td>{{ d.meta?.alias || '—' }}</td>
            <td>WSL{{ d.version }}</td>
            <td>
              <n-tag
                v-for="t in (d.meta?.tags ?? []).slice(0, 3)"
                :key="t"
                size="tiny"
                :bordered="false"
              >
                {{ t }}
              </n-tag>
              <span v-if="!(d.meta?.tags ?? []).length" class="muted">—</span>
            </td>
            <td>
              <div class="row-actions">
                <n-popconfirm v-if="d.state === 'Running'" @positive-click="onTerminate(d.name)">
                  <template #trigger>
                    <n-button size="tiny" type="error" :loading="distros.isBusy(d.name)">
                      停止
                    </n-button>
                  </template>
                  将停止 {{ d.name }}，其中的运行中进程会被终止，确定吗？
                </n-popconfirm>
                <n-button
                  v-else
                  size="tiny"
                  type="primary"
                  :loading="distros.isBusy(d.name)"
                  @click="act(() => distros.start(d.name), `已启动 ${d.name}`)"
                >
                  启动
                </n-button>
                <n-button
                  size="tiny"
                  secondary
                  :disabled="d.isDefault"
                  @click="act(() => distros.setDefault(d.name), `已设 ${d.name} 为默认`)"
                >
                  设默认
                </n-button>
                <n-button size="tiny" quaternary @click="onMore(d.name)"> 详情 </n-button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </template>

    <DistroDetailModal
      v-model:show="detailOpen"
      :distro-name="detailName"
      @update:distro-name="(n: string) => (detailName = n)"
      @open-terminal="onDetailTerminal"
    />
  </div>
</template>

<style scoped>
.distros {
  padding: 24px;
  max-width: 1200px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.page-header {
  display: flex;
  flex-direction: column;
  gap: 12px;
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

.toolbar {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
}

.search {
  width: 220px;
}

.tag-select {
  width: 160px;
}

.error-banner {
  padding: 10px 14px;
  border-radius: 10px;
  background: color-mix(in srgb, var(--color-danger) 10%, transparent);
  color: var(--color-danger);
  font-size: 13px;
}

.grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 14px;
}

@media (width <= 960px) {
  .grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (width <= 640px) {
  .grid {
    grid-template-columns: 1fr;
  }
}

.table {
  width: 100%;
  border-collapse: collapse;
  background: var(--color-bg-surface);
  border-radius: var(--radius-lg);
  overflow: hidden;
  border: 1px solid var(--color-border-subtle);
}

.table th {
  text-align: left;
  padding: 10px 14px;
  background: var(--color-bg-sunken);
  font-size: 12px;
  font-weight: 600;
  color: var(--color-text-secondary);
}

.table td {
  padding: 10px 14px;
  border-top: 1px solid var(--color-border-subtle);
  font-size: 13px;
  color: var(--color-text-primary);
}

.status-cell,
.name-cell {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.row-actions {
  display: flex;
  gap: 6px;
}

.muted {
  color: var(--color-text-tertiary);
}

/* 表格 caption 仅供读屏（最小 a11y） */
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
</style>
