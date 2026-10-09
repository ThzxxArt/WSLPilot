<script setup lang="ts">
/**
 * 快捷键提示（设计书 §10.7.2 Kbd）。
 * keys 传按键序列，如 ['Ctrl', 'K']；单键可用 text。
 */
withDefaults(
  defineProps<{
    keys?: string[]
    text?: string
  }>(),
  { keys: () => [], text: '' },
)
</script>

<template>
  <span class="kbd" role="img" :aria-label="text || keys.join(' + ')">
    <template v-if="keys.length">
      <kbd v-for="(k, i) in keys" :key="k + i" class="key">
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
