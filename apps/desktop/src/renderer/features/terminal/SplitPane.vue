<script setup lang="ts">
/**
 * 终端分屏容器（0.1.3）— 递归渲染面板树 + 拖拽分隔条。
 * 叶子通过默认作用域插槽把 ptyId 交给父级（TerminalView 据此渲染 XtermPane）。
 */
import { onBeforeUnmount, ref } from 'vue'
import type { PaneNode } from './panes'

const props = withDefaults(
  defineProps<{
    node: PaneNode
    activePaneId: string
    tabId: string
    /** 当前节点在整棵树中的路径（'a' | 'b' 序列），供比例回写定位 */
    path?: ('a' | 'b')[]
  }>(),
  { path: () => [] },
)

const emit = defineEmits<{
  focus: [ptyId: string]
  ratio: [tabId: string, path: ('a' | 'b')[], ratio: number]
}>()

/** 默认插槽：把叶子 ptyId 交给父级渲染（递归时原样透传） */
defineSlots<{ default(props: { ptyId: string }): unknown }>()

const rootEl = ref<HTMLElement | null>(null)
const dragging = ref(false)
/** 在途拖拽的 window 监听清理（组件卸载时兜底，防泄漏） */
let activeDragCleanup: (() => void) | null = null

function onDividerDown(e: PointerEvent) {
  if (props.node.kind !== 'split') return
  const container = rootEl.value
  if (!container) return
  e.preventDefault()
  dragging.value = true
  const dir = props.node.dir
  const move = (ev: PointerEvent) => {
    const rect = container.getBoundingClientRect()
    const ratio =
      dir === 'row'
        ? (ev.clientX - rect.left) / Math.max(1, rect.width)
        : (ev.clientY - rect.top) / Math.max(1, rect.height)
    emit('ratio', props.tabId, props.path, ratio)
  }
  const up = () => {
    dragging.value = false
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    activeDragCleanup = null
  }
  activeDragCleanup = up
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}

onBeforeUnmount(() => {
  // 拖拽中途卸载（分屏调整时关闭标签等）：必须摘除 window 监听
  activeDragCleanup?.()
  activeDragCleanup = null
})
</script>

<template>
  <div
    v-if="node.kind === 'leaf'"
    class="pane-slot"
    :class="{ active: node.ptyId === activePaneId }"
    @mousedown.capture="emit('focus', node.ptyId)"
  >
    <slot :pty-id="node.ptyId" />
  </div>

  <div
    v-else
    ref="rootEl"
    class="pane-split"
    :class="[node.dir, { dragging }]"
    :data-dragging="dragging ? 'true' : undefined"
  >
    <div
      class="pane-part"
      :style="
        node.dir === 'row' ? { width: `${node.ratio * 100}%` } : { height: `${node.ratio * 100}%` }
      "
    >
      <SplitPane
        :node="node.a"
        :active-pane-id="activePaneId"
        :tab-id="tabId"
        :path="[...path, 'a']"
        @focus="emit('focus', $event)"
        @ratio="(t, p, r) => emit('ratio', t, p, r)"
      >
        <template #default="{ ptyId }">
          <slot :pty-id="ptyId" />
        </template>
      </SplitPane>
    </div>

    <div
      class="pane-divider"
      role="separator"
      :aria-label="node.dir === 'row' ? '左右分屏分隔条' : '上下分屏分隔条'"
      @pointerdown="onDividerDown"
    />

    <div
      class="pane-part"
      :style="
        node.dir === 'row'
          ? { width: `${(1 - node.ratio) * 100}%` }
          : { height: `${(1 - node.ratio) * 100}%` }
      "
    >
      <SplitPane
        :node="node.b"
        :active-pane-id="activePaneId"
        :tab-id="tabId"
        :path="[...path, 'b']"
        @focus="emit('focus', $event)"
        @ratio="(t, p, r) => emit('ratio', t, p, r)"
      >
        <template #default="{ ptyId }">
          <slot :pty-id="ptyId" />
        </template>
      </SplitPane>
    </div>
  </div>
</template>

<style scoped>
.pane-slot {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  border-radius: var(--radius-md);
  outline: 1px solid transparent;
  transition: outline-color var(--dur-fast) var(--ease-standard);
}

/* 活动面板描边（多面板时焦点可见；单面板时不喧宾夺主） */
.pane-slot.active {
  outline-color: color-mix(in srgb, var(--color-accent) 45%, transparent);
}

.pane-slot :deep(> *) {
  flex: 1;
  min-width: 0;
  min-height: 0;
}

.pane-split {
  display: flex;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
}

.pane-split.row {
  flex-direction: row;
}

.pane-split.col {
  flex-direction: column;
}

.pane-part {
  display: flex;
  min-width: 0;
  min-height: 0;
}

.pane-part > :deep(*) {
  flex: 1;
  min-width: 0;
  min-height: 0;
}

.pane-divider {
  flex-shrink: 0;
  background: var(--color-border-subtle);
  border-radius: 999px;
  transition: background var(--dur-fast) var(--ease-standard);
}

.pane-split.row > .pane-divider {
  width: 6px;
  cursor: col-resize;
  margin: 0 2px;
}

.pane-split.col > .pane-divider {
  height: 6px;
  cursor: row-resize;
  margin: 2px 0;
}

.pane-divider:hover,
.pane-split.dragging > .pane-divider {
  background: var(--color-accent);
}

.pane-split.dragging {
  user-select: none;
}
</style>
