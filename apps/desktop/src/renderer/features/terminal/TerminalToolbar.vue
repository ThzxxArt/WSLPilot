<script setup lang="ts">
/**
 * 终端工具栏（0.1.3 增强）：
 * - 分屏（左右/上下）、关闭面板、粘贴、滚动到底部
 * - 搜索：大小写 / 正则选项 + 命中计数（N/M）
 * - 保留：清屏 / 字号 / 复制 / 导出
 */
import { computed, nextTick, ref } from 'vue'
import { NButton, NCheckbox, NInput, NPopover, NTooltip } from 'naive-ui'

const props = withDefaults(
  defineProps<{
    canZoom: boolean
    /** 是否存在活动面板：无面板时清屏/复制/导出一律禁用（导出另有兜底提示） */
    hasSession: boolean
    /** 活动标签是否可继续分屏（4 面板上限时禁用分屏按钮 — 双保险 UI 层） */
    canSplit?: boolean
    fontSize: number
    /** 活动面板视口是否贴底（false 时显示「到底部」按钮） */
    atBottom: boolean
    /** 搜索命中计数（count<=0 或未查询时展示引导） */
    searchCount: number
    searchIndex: number
  }>(),
  { canSplit: true },
)

const emit = defineEmits<{
  clear: []
  search: [payload: { query: string; caseSensitive: boolean; regex: boolean }]
  searchNext: []
  searchPrev: []
  searchClose: []
  copy: []
  paste: []
  export: []
  zoom: [delta: number]
  scrollBottom: []
  splitRow: []
  splitCol: []
  closePane: []
}>()

const query = ref('')
const caseSensitive = ref(false)
const regex = ref(false)
const searchOpen = ref(false)
const searchInput = ref<InstanceType<typeof NInput> | null>(null)

/** 字号夹取范围与 XtermPane.zoom 一致（8..32） */
const MIN_FONT_SIZE = 8
const MAX_FONT_SIZE = 32

// 到达边界时禁用对应按钮，避免点了不动的假反馈（review 0.1.2 根治）
const canShrink = computed(() => props.canZoom && props.fontSize > MIN_FONT_SIZE)
const canGrow = computed(() => props.canZoom && props.fontSize < MAX_FONT_SIZE)

const searchLabel = computed(() => {
  if (!query.value) return '输入关键词后在终端中查找'
  if (props.searchCount <= 0) return '无结果'
  return `${props.searchIndex >= 0 ? props.searchIndex + 1 : 0}/${props.searchCount}`
})

function emitSearch() {
  if (!query.value) return
  emit('search', {
    query: query.value,
    caseSensitive: caseSensitive.value,
    regex: regex.value,
  })
}

/** 选项切换后用当前查询重新搜索（命中集合随选项变化） */
function onOptionChange() {
  emitSearch()
}

/** 供快捷键（Ctrl+Shift+F）打开搜索框并聚焦 */
async function openSearch() {
  searchOpen.value = true
  await nextTick()
  searchInput.value?.focus()
}

function onClose() {
  query.value = ''
  emit('searchClose')
}

defineExpose({ openSearch })
</script>

<template>
  <div class="terminal-toolbar">
    <n-tooltip trigger="hover">
      <template #trigger>
        <n-button
          size="tiny"
          secondary
          aria-label="清屏"
          :disabled="!hasSession"
          @click="emit('clear')"
        >
          清屏
        </n-button>
      </template>
      清空当前终端
    </n-tooltip>

    <n-popover v-model:show="searchOpen" trigger="click" placement="bottom-end" @hide="onClose">
      <template #trigger>
        <n-button size="tiny" secondary aria-label="搜索终端内容"> 搜索 </n-button>
      </template>
      <div class="search-box">
        <n-input
          ref="searchInput"
          v-model:value="query"
          size="small"
          placeholder="在终端中查找"
          clearable
          @keyup.enter.exact="emit('searchNext')"
          @keyup.shift.enter="emit('searchPrev')"
          @update:value="(v: string) => (v === '' ? emit('searchClose') : emitSearch())"
        />
        <div class="search-options">
          <n-checkbox v-model:checked="caseSensitive" size="small" @update:checked="onOptionChange">
            区分大小写
          </n-checkbox>
          <n-checkbox v-model:checked="regex" size="small" @update:checked="onOptionChange">
            正则
          </n-checkbox>
          <span class="search-count" role="status" aria-live="polite">{{ searchLabel }}</span>
        </div>
        <div class="search-row">
          <n-button size="tiny" secondary aria-label="上一个匹配" @click="emit('searchPrev')">
            上一个
          </n-button>
          <n-button size="tiny" secondary aria-label="下一个匹配" @click="emit('searchNext')">
            下一个
          </n-button>
        </div>
      </div>
    </n-popover>

    <div class="zoom">
      <n-button
        size="tiny"
        secondary
        aria-label="缩小终端字号"
        :disabled="!canShrink"
        @click="emit('zoom', -1)"
      >
        A-
      </n-button>
      <span class="fs" aria-live="polite">{{ fontSize }}</span>
      <n-button
        size="tiny"
        secondary
        aria-label="增大终端字号"
        :disabled="!canGrow"
        @click="emit('zoom', 1)"
      >
        A+
      </n-button>
    </div>

    <n-tooltip trigger="hover">
      <template #trigger>
        <n-button
          size="tiny"
          secondary
          aria-label="复制选中内容"
          :disabled="!hasSession"
          @click="emit('copy')"
        >
          复制
        </n-button>
      </template>
      复制选中内容
    </n-tooltip>

    <n-tooltip trigger="hover">
      <template #trigger>
        <n-button
          size="tiny"
          secondary
          aria-label="粘贴剪贴板内容"
          :disabled="!hasSession"
          @click="emit('paste')"
        >
          粘贴
        </n-button>
      </template>
      粘贴剪贴板内容到终端
    </n-tooltip>

    <n-tooltip v-if="hasSession && !atBottom" trigger="hover">
      <template #trigger>
        <n-button size="tiny" secondary aria-label="滚动到底部" @click="emit('scrollBottom')">
          ↓ 到底部
        </n-button>
      </template>
      回到最新输出
    </n-tooltip>

    <n-tooltip trigger="hover">
      <template #trigger>
        <n-button
          size="tiny"
          secondary
          aria-label="左右分屏"
          :disabled="!hasSession || !canSplit"
          @click="emit('splitRow')"
        >
          分屏 ⇢
        </n-button>
      </template>
      左右分屏（Ctrl+Shift+5）
    </n-tooltip>

    <n-tooltip trigger="hover">
      <template #trigger>
        <n-button
          size="tiny"
          secondary
          aria-label="上下分屏"
          :disabled="!hasSession || !canSplit"
          @click="emit('splitCol')"
        >
          分屏 ⇣
        </n-button>
      </template>
      上下分屏（Ctrl+Shift+6）
    </n-tooltip>

    <n-tooltip trigger="hover">
      <template #trigger>
        <n-button
          size="tiny"
          secondary
          aria-label="关闭当前面板"
          :disabled="!hasSession"
          @click="emit('closePane')"
        >
          关闭面板
        </n-button>
      </template>
      关闭当前面板（最后一个面板将关闭标签）
    </n-tooltip>

    <n-tooltip trigger="hover">
      <template #trigger>
        <n-button
          size="tiny"
          secondary
          aria-label="导出当前会话缓冲"
          :disabled="!hasSession"
          @click="emit('export')"
        >
          导出
        </n-button>
      </template>
      导出当前会话缓冲
    </n-tooltip>
  </div>
</template>

<style scoped>
.terminal-toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.search-box {
  width: 240px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.search-options {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.search-count {
  font-size: 11.5px;
  color: var(--color-text-secondary);
  font-variant-numeric: tabular-nums;
  margin-left: auto;
}

.search-row {
  display: flex;
  gap: 6px;
}

.zoom {
  display: inline-flex;
  align-items: center;
  gap: 2px;
}

.fs {
  min-width: 22px;
  text-align: center;
  font-size: 12px;
  color: var(--color-text-secondary);
  font-variant-numeric: tabular-nums;
}
</style>
