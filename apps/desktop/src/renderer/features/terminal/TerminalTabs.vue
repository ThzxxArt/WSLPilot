<script setup lang="ts">
/**
 * 终端标签栏（0.1.3 分屏模型）：
 * - 标签 = 一棵分屏面板树（组件只关心标签标题 / 存活态 / 排序）
 * - 新建标签 popover 支持指定发行版、Shell、启动目录（默认值来自设置与发行版元数据）
 * - 拖拽排序 / 双击重命名 / 中键关闭语义保持
 */
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import { NButton, NInput, NPopover, NSelect } from 'naive-ui'

export interface TerminalTabItem {
  id: string
  title: string
  alive: boolean
  /** 悬浮提示（发行版 / shell / 目录 — 0.1.3） */
  tooltip: string
}

const props = defineProps<{
  tabs: TerminalTabItem[]
  activeTabId: string
  maxSessions: number
  distroOptions: { label: string; value: string }[]
  defaultDistro: string
  /** 默认 Shell 占位（settings.wsl.defaultShell 或 /bin/bash） */
  defaultShell: string
  /** 创建中的发行版名单：按钮据此进入 loading 并防重（review 0.1.2 根治） */
  creatingDistros?: string[]
}>()

const emit = defineEmits<{
  create: [payload: { distro: string; shell?: string; cwd?: string }]
  select: [id: string]
  close: [id: string]
  rename: [id: string, title: string]
  reorder: [from: number, to: number]
}>()

/**
 * 新建标签的目标发行版：distros 异步到达后必须同步（否则下拉永远空）。
 * 只在「尚未选择 / 当前选择已不在选项里」时跟随 defaultDistro / 首个选项，
 * 用户手动选过的值不被覆盖。
 */
const newDistro = ref('')
const newShell = ref('')
const newCwd = ref('')
watch(
  () => [props.defaultDistro, props.distroOptions] as const,
  () => {
    const stillValid =
      newDistro.value && props.distroOptions.some((o) => o.value === newDistro.value)
    if (stillValid) return
    newDistro.value = props.defaultDistro || props.distroOptions[0]?.value || ''
  },
  { immediate: true },
)

const canCreate = computed(() => props.tabs.filter((t) => t.alive).length < props.maxSessions)

/** 当前下拉目标正在创建：按钮 loading，双击/重入被挡在 store 去重之外还有视觉反馈 */
const creating = computed(() => (props.creatingDistros ?? []).includes(newDistro.value))

/** 拖拽排序的 window 监听器清理（组件卸载时兜底，防泄漏 — review M-12） */
const dragCleanups: Array<() => void> = []
onUnmounted(() => {
  while (dragCleanups.length > 0) dragCleanups.pop()!()
})

function onTabMouseDown(e: MouseEvent, index: number) {
  if (e.button === 1) {
    e.preventDefault()
    const t = props.tabs[index]
    if (t) emit('close', t.id)
    return
  }
  // 拖拽排序只认左键：右键（button 2）等其余按键不得触发标签重排（review 根治）
  if (e.button !== 0) return
  // 拖拽排序：每次成功交换后重置起点（评审 I4）
  let startX = e.clientX
  let dragged = index
  const onMove = (ev: MouseEvent) => {
    const dx = ev.clientX - startX
    if (Math.abs(dx) > 40) {
      const dir = dx > 0 ? 1 : -1
      const target = dragged + dir
      if (target >= 0 && target < props.tabs.length) {
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

async function startRename(t: TerminalTabItem) {
  renamingId.value = t.id
  renameDraft.value = t.title
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
function commitRename(t: TerminalTabItem) {
  if (renamingId.value !== t.id) return
  const v = renameDraft.value.trim()
  renamingId.value = ''
  if (v && v !== t.title) emit('rename', t.id, v)
}

function cancelRename() {
  renamingId.value = ''
}

function submitNew() {
  const d = newDistro.value || props.defaultDistro
  if (!d) return
  emit('create', {
    distro: d,
    shell: newShell.value.trim() || undefined,
    cwd: newCwd.value.trim() || undefined,
  })
}
</script>

<template>
  <div class="terminal-tabs">
    <!-- 标签增删：缩放淡出（§12.5）+ 拖拽排序 FLIP（§13.2） -->
    <transition-group name="tab" tag="div" class="tabs-scroll" role="tablist" aria-label="终端标签">
      <!-- 外层不是 button：内部含关闭按钮，嵌套交互元素非法 HTML（review M4） -->
      <div
        v-for="(t, i) in tabs"
        :key="t.id"
        class="tab"
        role="tab"
        tabindex="0"
        :title="t.tooltip"
        :aria-selected="t.id === activeTabId"
        :class="{ active: t.id === activeTabId, dead: !t.alive }"
        @mousedown="onTabMouseDown($event, i)"
        @click="emit('select', t.id)"
        @dblclick="startRename(t)"
        @keydown.enter.prevent="emit('select', t.id)"
        @keydown.space.prevent="emit('select', t.id)"
      >
        <span class="dot" :class="{ on: t.alive }" />
        <n-input
          v-if="renamingId === t.id"
          v-model:value="renameDraft"
          class="rename-input"
          size="tiny"
          :autosize="{ minRows: 1, maxRows: 1 }"
          @click.stop
          @blur="commitRename(t)"
          @keyup.enter="commitRename(t)"
          @keyup.esc="cancelRename"
        />
        <span v-else class="label">{{ t.title }}</span>
        <button class="close" :aria-label="`关闭 ${t.title}`" @click.stop="emit('close', t.id)">
          ×
        </button>
      </div>
    </transition-group>

    <div class="tabs-actions">
      <n-popover trigger="click" placement="bottom-end">
        <template #trigger>
          <n-button size="tiny" secondary :disabled="!canCreate || creating"> + 新建 </n-button>
        </template>
        <div class="new-form">
          <div class="hint">选择发行版（上限 {{ maxSessions }}）</div>
          <n-select
            v-model:value="newDistro"
            :options="distroOptions"
            size="small"
            filterable
            style="width: 240px"
          />
          <div class="hint">Shell（可空 = 默认）</div>
          <n-input
            v-model:value="newShell"
            size="small"
            :placeholder="defaultShell || '/bin/bash'"
            style="width: 240px"
          />
          <div class="hint">启动目录（可空 = 发行版默认）</div>
          <n-input
            v-model:value="newCwd"
            size="small"
            placeholder="~/project 或 /home/me/project"
            style="width: 240px"
          />
          <n-button
            size="small"
            type="primary"
            style="margin-top: 8px"
            :loading="creating"
            :disabled="creating"
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

/* 标签增删：缩放淡出（§12.5）+ 排序 FLIP（§13.2） */
.tab-enter-active,
.tab-leave-active {
  transition:
    opacity var(--dur-base) var(--ease-standard),
    transform var(--dur-base) var(--ease-standard);
}

.tab-enter-from,
.tab-leave-to {
  opacity: 0;
  transform: scale(0.92);
}

.tab-move {
  transition: transform var(--dur-base) var(--ease-standard);
}
</style>
