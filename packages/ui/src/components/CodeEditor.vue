<script setup lang="ts">
import { computed, ref, watch } from 'vue'

/**
 * 配置文本 / JSONC / INI 编辑器（设计书 §10.7.2 CodeEditor）。
 * 原生 textarea + 行号槽；Tab 插入两个空格（配置文件缩进惯例）。
 * 超限/只读场景由调用方传 readonly。
 */
const props = withDefaults(
  defineProps<{
    modelValue: string
    readonly?: boolean
    placeholder?: string
    showLineNumbers?: boolean
    minHeight?: number
  }>(),
  {
    readonly: false,
    placeholder: '',
    showLineNumbers: true,
    minHeight: 220,
  },
)

const emit = defineEmits<{ 'update:modelValue': [string] }>()

const text = ref(props.modelValue)
watch(
  () => props.modelValue,
  (v) => {
    if (v !== text.value) text.value = v
  },
)

function onInput(e: Event) {
  const v = (e.target as HTMLTextAreaElement).value
  text.value = v
  emit('update:modelValue', v)
}

function onKeydown(e: KeyboardEvent) {
  // Esc 交还焦点：Tab 被编辑器捕获（插入缩进），必须给键盘用户逃生口（无障碍 §11.4）
  if (e.key === 'Escape') {
    e.preventDefault()
    ;(e.target as HTMLTextAreaElement).blur()
    return
  }
  // Tab 插入空格缩进；Shift+Tab 反缩进
  if (e.key === 'Tab' && !props.readonly) {
    e.preventDefault()
    const el = e.target as HTMLTextAreaElement
    const start = el.selectionStart
    const end = el.selectionEnd
    const insert = e.shiftKey ? '' : '  '
    let next = text.value
    let caret = start + insert.length
    if (e.shiftKey) {
      const lineStart = next.lastIndexOf('\n', Math.max(0, start - 1)) + 1
      const removed = next.slice(lineStart, lineStart + 2) === '  ' ? 2 : 0
      next = next.slice(0, lineStart) + next.slice(lineStart + removed)
      caret = Math.max(lineStart, start - removed)
    } else {
      next = next.slice(0, start) + insert + next.slice(end)
    }
    text.value = next
    emit('update:modelValue', next)
    const raf =
      typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame
        : (fn: () => void) => setTimeout(fn, 0)
    raf(() => {
      el.selectionStart = el.selectionEnd = caret
    })
  }
}

const lines = computed(() => text.value.split('\n').length)

const gutterTop = ref(0)
function onScroll(e: Event) {
  gutterTop.value = -(e.target as HTMLTextAreaElement).scrollTop
}
</script>

<template>
  <div class="code-editor" :style="{ minHeight: minHeight + 'px' }">
    <div v-if="showLineNumbers" class="gutter" aria-hidden="true">
      <div class="gutter-inner" :style="{ transform: `translateY(${gutterTop}px)` }">
        <div v-for="n in lines" :key="n" class="gutter-line">
          {{ n }}
        </div>
      </div>
    </div>
    <textarea
      class="editor-textarea"
      :value="text"
      :readonly="readonly"
      :placeholder="placeholder"
      :aria-label="placeholder || '代码编辑器'"
      spellcheck="false"
      @input="onInput"
      @keydown="onKeydown"
      @scroll="onScroll"
    />
  </div>
</template>

<style scoped>
.code-editor {
  display: flex;
  border: 1px solid var(--color-border-default);
  border-radius: var(--radius-sm);
  background: var(--color-bg-sunken);
  overflow: hidden;
  font-family: var(--font-mono, 'Cascadia Mono', Consolas, monospace);
  font-size: 12.5px;
  line-height: 1.6;
}

.gutter {
  flex-shrink: 0;
  overflow: hidden;
  padding: 8px 0;
  background: var(--color-bg-hover);
  border-right: 1px solid var(--color-border-subtle);
  user-select: none;
}

.gutter-inner {
  will-change: transform;
}

.gutter-line {
  padding: 0 10px;
  text-align: right;
  color: var(--color-text-tertiary);
  font-variant-numeric: tabular-nums;
}

.editor-textarea {
  flex: 1;
  border: none;
  outline: none;
  resize: vertical;
  padding: 8px 10px;
  min-height: inherit;
  background: transparent;
  color: var(--color-text-primary);
  font: inherit;
  white-space: pre;
  overflow-wrap: normal;
  overflow-x: auto;
}

.editor-textarea:read-only {
  color: var(--color-text-secondary);
  cursor: default;
}

.editor-textarea::placeholder {
  color: var(--color-text-tertiary);
}

.editor-textarea:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: -2px;
}
</style>
