<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    state?: 'Running' | 'Stopped' | 'Installing' | 'Uninstalling' | 'Converting' | 'Unknown'
    size?: number
  }>(),
  { state: 'Stopped', size: 10 },
)

const color = computed(() => {
  switch (props.state) {
    case 'Running':
      return 'var(--color-success)'
    case 'Installing':
    case 'Uninstalling':
    case 'Converting':
      return 'var(--color-warning)'
    default:
      return 'var(--color-text-tertiary)'
  }
})

const pulsing = computed(() => props.state === 'Running' || props.state === 'Installing')
</script>

<template>
  <span
    class="status-dot"
    :class="{ pulsing }"
    :style="{
      width: size + 'px',
      height: size + 'px',
      background: color,
    }"
    role="img"
    :aria-label="`状态：${state}`"
  />
</template>

<style scoped>
.status-dot {
  display: inline-block;
  border-radius: 50%;
  flex-shrink: 0;
  position: relative;
}

.status-dot.pulsing::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 50%;
  background: inherit;
  animation: pulse-ring 1.8s var(--ease-standard) infinite;
}

@keyframes pulse-ring {
  0% {
    transform: scale(1);
    opacity: 0.7;
  }

  100% {
    transform: scale(1.9);
    opacity: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .status-dot.pulsing::after {
    animation: none;
  }
}

:root[data-reduce-motion='true'] .status-dot.pulsing::after {
  animation: none;
}
</style>
