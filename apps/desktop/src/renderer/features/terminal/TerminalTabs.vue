<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref } from 'vue'
import { NButton, NInput, NPopover, NSelect } from 'naive-ui'
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

/** 拖拽排序的 window 监听器清理（组件卸载时兜底，防泄漏 — review M-12） */
const dragCleanups: Array<() => void> = []
onUnmounted(() => {
  while (dragCleanups.length > 0) dragCleanups.pop()!()
})

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
    const i = dragCleanups.indexOf(cleanup)
    if (i >= 0) dragCleanups.splice(i, 1)
  }
  const cleanup = () => {
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
  }
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
  dragCleanups.push(cleanup)
}

/**
 * 双击重命名：Electron 未实现 `window.prompt`（返回 undefined，旧实现还会因
 * `title.trim()` 抛 TypeError），改为标签行内输入（review M-7 根治）。
 */
const renamingId = ref('')
const renameDraft = ref('')

async function startRename(s: TerminalSession) {
  renamingId.value = s.ptyId
  renameDraft.value = s.title
  await nextTick()
  // class 挂在 n-input 包裹层上，真正的 <input> 是它的后代（review 自查）
  const el = document.querySelector<HTMLElement>('.tab .rename-input')?.querySelector('input')
  el?.focus()
  el?.select()
}

/**
 * 提交重命名。必须先判 `renamingId`：
 * Enter 提交后输入框被 v-if 卸载，blur 会再触发一次；Esc 取消同样会触发 blur。
 * 没有这道守卫就会「重复 emit」甚至「Esc 也改名」（review 自查发现）。
 */
function commitRename(s: TerminalSession) {
  if (renamingId.value !== s.ptyId) return
  const t = renameDraft.value.trim()
  renamingId.value = ''
  if (t && t !== s.title) emit('rename', s.ptyId, t)
}

function cancelRename() {
  renamingId.value = ''
}

function submitNew() {
  const d = newDistro.value || props.defaultDistro
  if (!d) return
  emit('create', d)
}
</script>

<template>
  <div class="terminal-tabs">
    <div class="tabs-scroll" role="tablist" aria-label="终端标签">
      <!-- 外层不是 button：内部含关闭按钮，嵌套交互元素非法 HTML（review M4） -->
      <div
        v-for="(s, i) in sessions"
        :key="s.ptyId"
        class="tab"
        role="tab"
        tabindex="0"
        :aria-selected="s.ptyId === activeId"
        :class="{ active: s.ptyId === activeId, dead: !s.alive }"
        @mousedown="onTabMouseDown($event, i)"
        @click="emit('select', s.ptyId)"
        @dblclick="startRename(s)"
        @keydown.enter.prevent="emit('select', s.ptyId)"
        @keydown.space.prevent="emit('select', s.ptyId)"
      >
        <span class="dot" :class="{ on: s.alive }" />
        <n-input
          v-if="renamingId === s.ptyId"
          v-model:value="renameDraft"
          class="rename-input"
          size="tiny"
          :autosize="{ minRows: 1, maxRows: 1 }"
          @click.stop
          @blur="commitRename(s)"
          @keyup.enter="commitRename(s)"
          @keyup.esc="cancelRename"
        />
        <span v-else class="label">{{ s.title }}</span>
        <button class="close" :aria-label="`关闭 ${s.title}`" @click.stop="emit('close', s.ptyId)">
          ×
        </button>
      </div>
    </div>

    <div class="tabs-actions">
      <n-popover trigger="click" placement="bottom-end">
        <template #trigger>
          <n-button size="tiny" secondary :disabled="!canCreate"> + 新建 </n-button>
        </template>
        <div class="new-form">
          <div class="hint">选择发行版（上限 {{ maxSessions }}）</div>
          <n-select
            v-model:value="newDistro"
            :options="distroOptions"
            size="small"
            filterable
            style="width: 220px"
          />
          <n-button size="small" type="primary" style="margin-top: 8px" @click="submitNew">
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

  /* 双击改名不被文本选择干扰（核验修复） */
  user-select: none;
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

.rename-input {
  width: 110px;

  --n-height: 22px !important;
  --n-font-size: 12px !important;
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
