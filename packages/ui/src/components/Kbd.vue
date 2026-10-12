<script setup lang="ts">
/**
 * 快捷键提示（设计书 §10.7.2 Kbd）。
 * keys 传按键序列，如 ['Ctrl', 'K']；单键可用 text。
 */
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    keys?: string[]
    text?: string
  }>(),
  { keys: () => [], text: '' },
)

// 空输入守卫（review 0.1.2 根治）：空串/纯空白按键不渲染空 <kbd> 占位
const visibleKeys = computed(() => props.keys.filter((k) => k.trim().length > 0))
const hasContent = computed(() => visibleKeys.value.length > 0 || props.text.trim().length > 0)
</script>

<template>
  <span v-if="hasContent" class="kbd" role="img" :aria-label="text || visibleKeys.join(' + ')">
    <template v-if="visibleKeys.length">
      <kbd v-for="(k, i) in visibleKeys" :key="k + i" class="key">
        {{ k }}
      </kbd>
    </template>
    <kbd v-else class="key">{{ text }}</kbd>
  </span>
</template>

<style scoped>
.kbd {
  display: inline-flex;
  gap: 3px;
  align-items: center;
}

.key {
  font-family: var(--font-mono, 'Cascadia Mono', Consolas, monospace);
  font-size: 11px;
  line-height: 1.4;
  padding: 1px 6px;
  border-radius: 5px;
  background: var(--color-bg-surface);
  border: 1px solid var(--color-border-default);
  border-bottom-width: 2px;
  color: var(--color-text-secondary);
  white-space: nowrap;
}
</style>
