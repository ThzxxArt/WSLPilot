<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{
    values: number[]
    width?: number
    height?: number
    stroke?: string
  }>(),
  { width: 80, height: 28, stroke: 'var(--color-accent)' },
)

const path = computed(() => {
  const vals = props.values?.length ? props.values : [0, 0]
  const min = Math.min(...vals)
  const max = Math.max(...vals)
  const span = max - min || 1
  const step = vals.length > 1 ? props.width / (vals.length - 1) : props.width
  return vals
    .map((v, i) => {
      const x = i * step
      const y = props.height - 2 - ((v - min) / span) * (props.height - 4)
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
})

const area = computed(() => `${path.value} L${props.width},${props.height} L0,${props.height} Z`)
// 实例级 uid（与 ProgressRing 同模式）：禁止由 values 派生（多实例同值会碰撞，gradient 串染）
const uid = `spark-${Math.random().toString(36).slice(2, 9)}`
</script>

<template>
  <svg
    :width="width"
    :height="height"
    :viewBox="`0 0 ${width} ${height}`"
    class="sparkline"
    aria-hidden="true"
  >
    <defs>
      <linearGradient :id="uid" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" :stop-color="stroke" stop-opacity="0.28" />
        <stop offset="100%" :stop-color="stroke" stop-opacity="0" />
      </linearGradient>
    </defs>
    <path :d="area" :fill="`url(#${uid})`" />
    <path
      :d="path"
      fill="none"
      :stroke="stroke"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>
</template>

<style scoped>
.sparkline {
  display: block;
  overflow: visible;
}
</style>
