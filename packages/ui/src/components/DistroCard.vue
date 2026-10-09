<script setup lang="ts">
import { computed } from 'vue'
import { NButton, NDropdown, NTag } from 'naive-ui'
import StatusDot from './StatusDot.vue'
import type { DistroView } from '@wslpilot/shared'
import { distroBrandColors } from '../tokens'

const props = withDefaults(
  defineProps<{
    distro: DistroView
    busy?: boolean
    compact?: boolean
  }>(),
  { busy: false, compact: false },
)

const emit = defineEmits<{
  start: [name: string]
  terminate: [name: string]
  setDefault: [name: string]
  openTerminal: [name: string]
  more: [name: string]
}>()

const brandColor = computed(() => {
  if (props.distro.meta?.color) return props.distro.meta.color
  for (const [k, c] of Object.entries(distroBrandColors)) {
    if (props.distro.name.toLowerCase().includes(k.toLowerCase())) return c
  }
  return 'var(--color-accent)'
})

const isRunning = computed(() => props.distro.state === 'Running')
const displayName = computed(() => props.distro.meta?.alias || props.distro.name)

const moreOptions = computed(() => [
  { label: '设为默认', key: 'setDefault' },
  { label: '打开终端', key: 'terminal' },
  { type: 'divider' as const, key: 'd1' },
  { label: '查看详情', key: 'more' },
])

function onMore(key: string) {
  if (key === 'setDefault') emit('setDefault', props.distro.name)
  else if (key === 'terminal') emit('openTerminal', props.distro.name)
  else if (key === 'more') emit('more', props.distro.name)
}
</script>

<template>
  <article
    class="distro-card card"
    :class="{ compact, running: isRunning }"
    :style="{ '--brand': brandColor }"
  >
    <div class="brand-bar" />
    <header class="head">
      <div class="title-row">
        <span class="icon">{{ distro.meta?.icon === 'ubuntu' ? '🐧' : '🐧' }}</span>
        <div class="names">
          <div class="name">{{ displayName }}</div>
          <div class="sub">
            <span v-if="distro.meta?.alias" class="real">{{ distro.name }}</span>
            <span v-else>WSL{{ distro.version }}</span>
            <n-tag v-if="distro.isDefault" size="tiny" :bordered="false" type="info">默认</n-tag>
          </div>
        </div>
      </div>
      <StatusDot :state="distro.state" />
    </header>

    <div class="state-line">
      <span class="state" :class="{ on: isRunning }">{{ distro.state === 'Running' ? '运行中' : distro.state === 'Stopped' ? '已停止' : distro.state }}</span>
      <span class="ver">WSL{{ distro.version }}</span>
    </div>

    <div v-if="distro.meta?.tags?.length" class="tags">
      <n-tag v-for="t in distro.meta.tags.slice(0, 3)" :key="t" size="tiny" :bordered="false">
        {{ t }}
      </n-tag>
    </div>

    <footer class="actions">
      <n-button
        v-if="!isRunning"
        size="small"
        type="primary"
        :loading="busy"
        :style="{ background: brandColor, border: 'none' }"
        @click="emit('start', distro.name)"
      >
        启动
      </n-button>
      <n-button v-else size="small" secondary :loading="busy" @click="emit('terminate', distro.name)">
        停止
      </n-button>
      <n-button size="small" secondary @click="emit('openTerminal', distro.name)">终端</n-button>
      <n-dropdown trigger="click" :options="moreOptions" @select="onMore">
        <n-button size="small" secondary>···</n-button>
      </n-dropdown>
    </footer>
  </article>
</template>

<style scoped>
.distro-card {
  position: relative;
  padding: 16px 18px 14px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 168px;
}

.brand-bar {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 3px;
  background: linear-gradient(180deg, var(--brand), transparent 85%);
}

.head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}

.title-row {
  display: flex;
  gap: 10px;
  min-width: 0;
}

.icon {
  font-size: 22px;
  line-height: 1;
}

.name {
  font-size: 15px;
  font-weight: 650;
  color: var(--color-text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.sub {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--color-text-tertiary);
  margin-top: 2px;
}

.real {
  color: var(--color-text-secondary);
}

.state-line {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
}

.state {
  color: var(--color-text-secondary);
  font-weight: 500;
}

.state.on {
  color: var(--color-success);
}

.ver {
  color: var(--color-text-tertiary);
}

.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.actions {
  display: flex;
  gap: 6px;
  margin-top: auto;
  opacity: 0.92;
  transition: opacity var(--dur-base) var(--ease-standard);
}

.distro-card:hover .actions {
  opacity: 1;
}

.compact {
  min-height: 0;
}
</style>
