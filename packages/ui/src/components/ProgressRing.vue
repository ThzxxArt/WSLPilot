<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    /** 0-100；null = 不确定进度（流光旋转） */
    percent: number | null
    size?: number
    stroke?: number
    /** 中心主文案（覆盖百分比数字时传） */
    label?: string
    /** 中心副文案 */
    sublabel?: string
    /** 渐变描边（CSS color-stop 两色） */
    gradientFrom?: string
    gradientTo?: string
  }>(),
  {
    size: 160,
    stroke: 12,
    label: '',
    sublabel: '',
    gradientFrom: '#22D3EE',
    gradientTo: '#6366F1',
  },
)

const uid = `pring-${Math.random().toString(36).slice(2, 9)}`

const clamped = computed(() => {
  if (props.percent === null || !Number.isFinite(props.percent)) return null
  return Math.max(0, Math.min(100, props.percent))
})

const indeterminate = computed(() => clamped.value === null)

const radius = computed(() => (props.size - props.stroke) / 2)
const circumference = computed(() => 2 * Math.PI * radius.value)
const dashOffset = computed(() => {
  const p = (clamped.value ?? 0) / 100
  return circumference.value * (1 - p)
})

const center = computed(() => props.size / 2)
const displayLabel = computed(() => {
  if (props.label) return props.label
  if (clamped.value === null) return '…'
  return `${Math.round(clamped.value)}%`
})
</script>

<template>
  <div
    class="progress-ring"
    :class="{ indeterminate }"
    :style="{ width: size + 'px', height: size + 'px' }"
    role="progressbar"
    :aria-valuenow="clamped ?? undefined"
    :aria-valuemin="0"
    :aria-valuemax="100"
    :aria-label="sublabel || '进度'"
  >
    <svg :width="size" :height="size" :viewBox="`0 0 ${size} ${size}`">
      <defs>
        <linearGradient :id="uid" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" :stop-color="gradientFrom" />
          <stop offset="100%" :stop-color="gradientTo" />
        </linearGradient>
      </defs>
      <circle
        class="track"
        :cx="center"
        :cy="center"
        :r="radius"
        :stroke-width="stroke"
        fill="none"
      />
      <circle
        class="value"
        :cx="center"
        :cy="center"
        :r="radius"
        :stroke-width="stroke"
        :stroke="`url(#${uid})`"
        :stroke-dasharray="circumference"
        :stroke-dashoffset="dashOffset"
        fill="none"
      />
    </svg>
    <div class="center">
      <div class="label">
        {{ displayLabel }}
      </div>
      <div v-if="sublabel" class="sublabel">
        {{ sublabel }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.progress-ring {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.progress-ring svg {
  transform: rotate(-90deg);
}

.progress-ring .track {
  stroke: var(--color-bg-sunken, #eff1f6);
}

.progress-ring .value {
  stroke-linecap: round;
  transition: stroke-dashoffset var(--dur-slow, 480ms)
    var(--ease-standard, cubic-bezier(0.2, 0, 0, 1));
}

.progress-ring.indeterminate svg {
  animation: pring-spin 1.4s linear infinite;
}

.progress-ring.indeterminate .value {
  stroke-dasharray: 60 400;
  stroke-dashoffset: 0;
}

.center {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  pointer-events: none;
}

.label {
  font-size: 28px;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--color-text-primary, #0f172a);
  font-variant-numeric: tabular-nums;
  line-height: 1.1;
}

.sublabel {
  font-size: 12px;
  color: var(--color-text-secondary, #475569);
  max-width: 80%;
  text-align: center;
}

@keyframes pring-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .progress-ring.indeterminate svg {
    animation: none;
  }
}

:root[data-reduce-motion='true'] .progress-ring.indeterminate svg {
  animation: none;
}
</style>
