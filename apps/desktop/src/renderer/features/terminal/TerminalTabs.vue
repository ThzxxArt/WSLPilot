<script setup lang="ts">
import { computed, ref } from 'vue'
import { NButton, NSelect, NPopover } from 'naive-ui'
import type { TerminalSession } from '../../stores/terminal'

const props = defineProps<{
  sessions: TerminalSession[]
  activeId: string
  maxSessions: number
  distroOptions: { label: string; value: string }[]
  defaultDistro: string
}>()

const emit = defineEmits<{
  create: [distro: string]
  select: [id: string]
  close: [id: string]
  rename: [id: string, title: string]
  reorder: [from: number, to: number]
}>()

const newDistro = ref(props.defaultDistro || '')

const canCreate = computed(() => props.sessions.filter((s) => s.alive).length < props.maxSessions)

function onTabMouseDown(e: MouseEvent, index: number) {
  if (e.button === 1) {
    e.preventDefault()
    const s = props.sessions[index]
    if (s) emit('close', s.ptyId)
    return
  }
  // 拖拽排序：每次成功交换后重置起点（评审 I4）
  let startX = e.clientX
  let dragged = index
  const onMove = (ev: MouseEvent) => {
    const dx = ev.clientX - startX
    if (Math.abs(dx) > 40) {
      const dir = dx > 0 ? 1 : -1
      const target = dragged + dir
      if (target >= 0 && target < props.sessions.length) {
        emit('reorder', dragged, target)
        dragged = target
        startX = ev.clientX // 清零阈值，避免连环乱序
      }
    }
  }
  const onUp = () => {
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
  }
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
}

function startRename(s: TerminalSession) {
  const t = window.prompt('重命名标签', s.title)
  if (t !== null) emit('rename', s.ptyId, t)
}

function submitNew() {
  const d = newDistro.value || props.defaultDistro
  if (!d) return
  emit('create', d)
}
</script>

<template>
  <div class="terminal-tabs">
    <div class="tabs-scroll">
      <button
        v-for="(s, i) in sessions"
        :key="s.ptyId"
        class="tab"
        :class="{ active: s.ptyId === activeId, dead: !s.alive }"
        @mousedown="onTabMouseDown($event, i)"
        @click="emit('select', s.ptyId)"
        @dblclick="startRename(s)"
      >
        <span
          class="dot"
          :class="{ on: s.alive }"
        />
        <span class="label">{{ s.title }}</span>
        <button
          class="close"
          aria-label="关闭"
          @click.stop="emit('close', s.ptyId)"
        >
          ×
        </button>
      </button>
    </div>

    <div class="tabs-actions">
      <n-popover
        trigger="click"
        placement="bottom-end"
      >
        <template #trigger>
          <n-button
            size="tiny"
            secondary
            :disabled="!canCreate"
          >
            + 新建
          </n-button>
        </template>
        <div class="new-form">
          <div class="hint">
            选择发行版（上限 {{ maxSessions }}）
          </div>
          <n-select
            v-model:value="newDistro"
            :options="distroOptions"
            size="small"
            filterable
            style="width: 220px"
          />
          <n-button
            size="small"
            type="primary"
            style="margin-top: 8px"
            @click="submitNew"
          >
            打开终端
          </n-button>
        </div>
      </n-popover>
    </div>
  </div>
</template>

<style scoped>
.terminal-tabs {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  background: var(--color-bg-surface);
  border: 1px solid var(--color-border-subtle);
  border-radius: var(--radius-md);
}

.tabs-scroll {
  display: flex;
  gap: 4px;
  overflow-x: auto;
  flex: 1;
  min-width: 0;
}

.tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 10px;
  border-radius: 8px;
  background: var(--color-bg-sunken);
  color: var(--color-text-secondary);
  font-size: 12px;
  white-space: nowrap;
  transition: background var(--dur-fast) var(--ease-standard);
}

.tab:hover {
  background: var(--color-bg-hover);
}

.tab.active {
  background: var(--color-accent-soft);
  color: var(--color-accent);
  font-weight: 600;
}

.tab.dead .label {
  opacity: 0.55;
  text-decoration: line-through;
}

.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--color-text-tertiary);
}

.dot.on {
  background: var(--color-success);
}

.close {
  margin-left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 4px;
  color: var(--color-text-tertiary);
  line-height: 1;
}

.close:hover {
  background: var(--color-danger);
  color: #fff;
}

.new-form {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.hint {
  font-size: 12px;
  color: var(--color-text-secondary);
}
</style>
