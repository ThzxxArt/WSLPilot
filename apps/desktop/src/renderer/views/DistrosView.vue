<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import {
  NButton,
  NEmpty,
  NInput,
  NRadioGroup,
  NRadioButton,
  NSelect,
  NTag,
  NSpin,
  useMessage,
} from 'naive-ui'
import { useRoute, useRouter } from 'vue-router'
import { useDistrosStore } from '../stores/distros'
import { useMetricsStore } from '../stores/metrics'
import { useSettingsStore } from '../stores/settings'
import { usePolling } from '../composables/usePolling'
import { DistroCard, StatusDot } from '@ui/components'
import { stateLabel } from '../composables/state-label'

const route = useRoute()
const router = useRouter()
const distros = useDistrosStore()
const metrics = useMetricsStore()
const message = useMessage()
const settings = useSettingsStore()

const viewMode = ref<'card' | 'table'>('card')
const search = ref('')
const tagFilter = ref<string | null>(null)

onMounted(() => {
  void distros.refresh()
  void metrics.sample()
})

const pollInterval = computed(() => {
  const ms = settings.pollIntervalMs
  return typeof ms === 'number' && ms >= 1000 ? ms : 5000
})

usePolling(() => void distros.refresh(), { intervalMs: pollInterval }).start()

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
    if (typeof name === 'string' && name) search.value = name
  },
  { immediate: true },
)

function stateLabelFn(s: string) {
  return stateLabel(s)
}

async function act(fn: () => Promise<void>, ok: string) {
  try {
    await fn()
    message.success(ok)
    await distros.refresh()
    await metrics.sample()
  } catch (e) {
    message.error(e instanceof Error ? e.message : '操作失败')
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
  search.value = name
}
</script>

<template>
  <div class="distros">
    <header class="page-header">
      <div>
        <h1>发行版</h1>
        <p class="sub">
          来自 <code>wsl --list --verbose</code> · 实时状态 · 点击卡片可启停
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
          <n-radio-button value="card">
            卡片
          </n-radio-button>
          <n-radio-button value="table">
            表格
          </n-radio-button>
        </n-radio-group>
        <n-button
          secondary
          :loading="distros.loading"
          @click="distros.refresh()"
        >
          刷新
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

    <n-spin :show="distros.loading && distros.items.length === 0">
      <n-empty
        v-if="filtered.length === 0 && !distros.loading"
        :description="search || tagFilter ? '没有匹配的发行版' : '尚未检测到发行版'"
      >
        <template #extra>
          <n-button
            v-if="search || tagFilter"
            size="small"
            secondary
            @click="search = ''; tagFilter = null"
          >
            清除筛选
          </n-button>
          <n-button
            v-else
            size="small"
            secondary
            @click="distros.refresh()"
          >
            重新扫描
          </n-button>
        </template>
      </n-empty>

      <!-- 卡片网格 -->
      <div
        v-else-if="viewMode === 'card'"
        class="grid"
      >
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
      <table
        v-else
        class="table"
      >
        <thead>
          <tr>
            <th>状态</th>
            <th>名称</th>
            <th>别名</th>
            <th>版本</th>
            <th>标签</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="d in filtered"
            :key="d.name"
          >
            <td>
              <span class="status-cell">
                <StatusDot
                  :state="d.state"
                  :size="8"
                />
                {{ stateLabelFn(d.state) }}
              </span>
            </td>
            <td>
              <span class="name-cell">
                {{ d.name }}
                <n-tag
                  v-if="d.isDefault"
                  size="tiny"
                  :bordered="false"
                  type="info"
                >默认</n-tag>
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
              <span
                v-if="!(d.meta?.tags ?? []).length"
                class="muted"
              >—</span>
            </td>
            <td>
              <div class="row-actions">
                <n-button
                  v-if="d.state !== 'Running'"
                  size="tiny"
                  type="primary"
                  secondary
                  :loading="distros.isBusy(d.name)"
                  @click="act(() => distros.start(d.name), `已启动 ${d.name}`)"
                >
                  启动
                </n-button>
                <n-button
                  v-else
                  size="tiny"
                  secondary
                  :loading="distros.isBusy(d.name)"
                  @click="act(() => distros.terminate(d.name), `已停止 ${d.name}`)"
                >
                  停止
                </n-button>
                <n-button
                  size="tiny"
                  secondary
                  :disabled="d.isDefault"
                  @click="act(() => distros.setDefault(d.name), `已设 ${d.name} 为默认`)"
                >
                  设默认
                </n-button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </n-spin>
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
</style>
